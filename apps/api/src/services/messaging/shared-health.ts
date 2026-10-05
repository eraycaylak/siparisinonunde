// Ortak numara sağlığı: SESSİZLİK DEDEKTÖRÜ (denetim H7 / iş 3.4).
//
// Sorun: ortak numaranın webhook'u sustuğunda (sağlayıcıda adres silinmiş, imza anahtarı değişmiş, numara askıya
// alınmış) müşteri mesajları sessizce kayboluyordu; hiçbir alarm yoktu. Admin WhatsApp görünümü (services/admin/
// wa-health.ts) 'shared' sağlayıcıyı sessizlik ölçümünden BİLEREK çıkarıyor, çünkü orada ölçü hesap başınadır:
// tek bir dükkana mesaj gelmemesi bağlantı sorunu değildir. Platform düzeyinde ölçü ise anlamlıdır: ortak numara TÜM
// ortak numara dükkanlarının trafiğini taşır, hepsi birden susarsa bu bir arızadır.
//
// Ölçü: `wa_webhook_events` içinde provider='shared' satırı (gelen mesaj da, durum geri bildirimi de olay üretir).
// Kapı: en az bir seçilebilir ortak numara dükkanı pencere BOYUNCA çalışma saatinde olmalı (kapalı saatte sessizlik
// normaldir). Yanlış pozitif kabul edilmiştir: pilot ölçeğinde 2 saat boyunca hiç müşteri yazmaması mümkündür, bu
// yüzden varsayılan ağırlık 'warning' ve soğuma uzun. Hiç olay yoksa (7 gün) ağırlık 'critical': bu, trafiğin az
// olması değil kanalın hiç kurulmamış/ölmüş olmasıdır.

import { branches, type Database } from '@siparis/db';
import { inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../../config';
import { alert, type AlertContext } from '../../lib/alert';
import { waErrorSummary, type WaSendError } from '../../wa/errors';
import { loadSchedules, openThroughout, stateOf } from '../admin/schedule';
import { selectableSharedShops } from './shared';

/** "Sessizlik": açık saatte bu süredir ortak numaradan hiç webhook olayı yok (wa-health WA_SILENCE_MS ile aynı ölçü). */
export const SHARED_SILENCE_MS = 2 * 60 * 60_000;
/** Hiç olay yok denmesi için geriye bakış: bu sürede tek satır yoksa kanal ölü sayılır. */
export const SHARED_SILENCE_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** Aynı sessizlik uyarısının yinelenme aralığı (alert varsayılanı 10 dk; sessizlik için gereksiz sık). */
export const SHARED_SILENCE_ALERT_COOLDOWN_MS = 60 * 60_000;

export type SharedSilenceReason =
  /** Ortak numara kapalı (simülatör): ölçüm yapılmaz. */
  | 'provider_mock'
  /** Ortak numarada seçilebilir dükkan yok: susması beklenir. */
  | 'no_shop'
  /** Açık dükkan yok (kapalı saatte sessizlik normaldir). */
  | 'no_open_shop'
  /** Pencere içinde olay var: sağlıklı. */
  | 'recent_event'
  /** Açık saatte pencere boyunca hiç olay yok. */
  | 'silent'
  /** Geriye bakışta HİÇ olay yok: kanal hiç kurulmamış ya da ölmüş. */
  | 'never';

export interface SharedSilenceResult {
  reason: SharedSilenceReason;
  /** Uyarı ÜRETİLDİ mi (kanal yapılandırması ve soğuma kararı `alert()` içindedir; kanal yoksa yalnız loglanır). */
  alerted: boolean;
  /** Son ortak numara olayından beri geçen dakika (hiç olay yoksa null). */
  silentMinutes: number | null;
  /** Pencere boyunca açık kalan ortak numara dükkanı sayısı. */
  openShops: number;
  /** Seçilebilir ortak numara dükkanı sayısı. */
  shops: number;
}

export interface SharedHealthDeps {
  db: Database;
  config: Config;
  log: FastifyBaseLogger;
}

/**
 * Ortak numarada kimlik / hesap hatası (Meta 190 · 131042; Twilio 20003 · 20005 → 190, docs/16 §2.6).
 * Bu bir PLATFORM arızasıdır: tek bir işletmenin değil TÜM ortak numara dükkanlarının mesajları durur. Eskiden
 * yalnız bir log satırıydı (denetim H8 / iş 3.4). İşletmenin satırı duraklatılmaz, işletmeye "bağlantı sorunu"
 * uyarısı GİTMEZ (numara platformundur, yapacağı bir şey yok); uyarı nöbetçiye gider.
 */
export function alertSharedAccountError(ctx: AlertContext, err: WaSendError, provider: string): void {
  if (err.action !== 'account_token' && err.action !== 'account_payment') return;
  alert(ctx, {
    kind: 'shared_wa_account_error',
    severity: 'critical',
    message: `Ortak WhatsApp numarası kimlik/hesap hatası verdi: ${waErrorSummary(err)}. Tüm ortak numara dükkanlarının mesajları durdu.`,
    data: { code: err.code, action: err.action, provider },
    dedupeKey: `shared_wa_account_error:${err.code}`,
  });
}

/** Son ortak numara webhook olayından beri geçen saniye; geriye bakışta hiç olay yoksa null. */
async function silentSeconds(db: Database, now: Date, lookbackMs: number): Promise<number | null> {
  const nowIso = now.toISOString();
  const sinceIso = new Date(now.getTime() - lookbackMs).toISOString();
  // received_at indeksli; provider süzgeci + geriye bakış sınırı taramayı sınırlı tutar
  const rows = (await db.execute<{ age_s: number }>(sql`
    select greatest(0, extract(epoch from (${nowIso}::timestamptz - received_at)))::int as age_s
      from wa_webhook_events
     where provider = 'shared'
       and received_at >= ${sinceIso}::timestamptz
     order by received_at desc
     limit 1`)) as unknown as { age_s: number }[];
  return rows[0] ? Number(rows[0].age_s) : null;
}

/**
 * Ortak numara sessizliğini ölçer ve gerekiyorsa uyarı gönderir. Cron'dan çağrılır (bkz. raporda DIŞ BAĞIMLILIK:
 * `cron.shared_wa_silence`). Veritabanı hatası yukarı çıkar (cron işi yeniden denenir, DLQ gözcüsü görür);
 * uyarı gönderimi `alert()` ile ateşle-ve-unuttur, ölçümü hiçbir koşulda başarısız yapmaz.
 */
export async function detectSharedNumberSilence(deps: SharedHealthDeps, opts: { now?: Date; windowMs?: number } = {}): Promise<SharedSilenceResult> {
  const { db, config, log } = deps;
  const now = opts.now ?? new Date();
  const windowMs = opts.windowMs ?? SHARED_SILENCE_MS;
  const base: SharedSilenceResult = { reason: 'provider_mock', alerted: false, silentMinutes: null, openShops: 0, shops: 0 };

  // Simülatörde ortak numara yoktur (vitrinde bağlantı gösterilmez): ölçüm anlamsız
  if (config.PLATFORM_WA_PROVIDER === 'mock') return base;

  const shops = await selectableSharedShops(db);
  if (!shops.length) return { ...base, reason: 'no_shop' };

  const branchRows = await db
    .select({ id: branches.id, timezone: branches.timezone, pausedUntil: branches.pausedUntil, busyExtraMinutes: branches.busyExtraMinutes })
    .from(branches)
    .where(inArray(branches.id, [...new Set(shops.map((s) => s.branchId))]));
  const schedules = await loadSchedules(db, branchRows, now);
  // Pencere boyunca açık: duraklatma (busy/paused) bağlantı sorunu değildir, yalnız çalışma saati sayılır
  const openWindow = branchRows.filter((b) => openThroughout(schedules.get(b.id), windowMs, now));
  const openNow = branchRows.filter((b) => stateOf(schedules.get(b.id), now).isOpenBySchedule);
  const result: SharedSilenceResult = { ...base, reason: 'no_open_shop', openShops: openWindow.length, shops: shops.length };
  if (!openNow.length) return result;

  const ageS = await silentSeconds(db, now, SHARED_SILENCE_LOOKBACK_MS);
  const silentMinutes = ageS == null ? null : Math.floor(ageS / 60);

  // Hiç olay yok: kanal kurulmamış ya da ölmüş (trafik azlığıyla açıklanamaz) → kritik
  if (ageS == null) {
    const r: SharedSilenceResult = { ...result, reason: 'never', silentMinutes: null };
    log.error({ shops: r.shops, openShops: r.openShops, lookbackDays: Math.round(SHARED_SILENCE_LOOKBACK_MS / 86_400_000) }, 'ortak numara: hiç webhook olayı yok');
    alert(
      { log, config },
      {
        kind: 'shared_wa_silence',
        severity: 'critical',
        message: `Ortak numaradan ${Math.round(SHARED_SILENCE_LOOKBACK_MS / 86_400_000)} gündür HİÇ webhook olayı gelmedi; ${r.openShops} dükkan açık. Sağlayıcıda webhook adresi ve imza ayarını kontrol edin.`,
        data: { shops: r.shops, openShops: r.openShops, provider: config.PLATFORM_WA_PROVIDER },
        dedupeKey: 'shared_wa_silence:never',
        cooldownMs: SHARED_SILENCE_ALERT_COOLDOWN_MS,
      },
    );
    return { ...r, alerted: true };
  }

  if (ageS * 1000 <= windowMs) return { ...result, reason: 'recent_event', silentMinutes };
  // Sessizlik yalnız pencere BOYUNCA açık kalan dükkan varsa arızadır (yeni açılan dükkanda henüz trafik olmaz)
  if (!openWindow.length) return { ...result, reason: 'no_open_shop', silentMinutes };

  const r: SharedSilenceResult = { ...result, reason: 'silent', silentMinutes };
  log.error({ silentMinutes, openShops: r.openShops, shops: r.shops }, 'ortak numara sessiz: webhook olayı gelmiyor');
  alert(
    { log, config },
    {
      kind: 'shared_wa_silence',
      severity: 'warning',
      message: `Ortak numaradan ${silentMinutes} dakikadır webhook olayı gelmiyor (${r.openShops} dükkan açık). Müşteri mesajları kaybolabilir.`,
      data: { silentMinutes, openShops: r.openShops, shops: r.shops, provider: config.PLATFORM_WA_PROVIDER },
      dedupeKey: 'shared_wa_silence:window',
      cooldownMs: SHARED_SILENCE_ALERT_COOLDOWN_MS,
    },
  );
  return { ...r, alerted: true };
}
