// Sentetik canary — tenant canary (06 §7.10, 07 §7 "Sentetik canary", 10 §7.3; 00 §11 "pilot öncesi ZORUNLU
// paket"; denetim H4 / iş 3.6). Uygulama notları ve bilinçli sapmalar: 06 §7.10 "[Faz 1 uygulaması]".
//
// Amaç: "webhook 200 dönüyor ama sipariş panelde yok" türü SESSİZ arızayı gerçek müşteri siparişinden ÖNCE
// yakalamak. Şubenin açık saatlerinde (sapmalı) CANARY_INTERVAL_MS'de bir `test_kind = 'canary'` sentetik sipariş
// GERÇEK yoldan geçer: sunucu fiyat hesabı (`quoteForBranch`, CLAUDE.md kural 3) → `orders` + `order_items` →
// `order_events` + `branch_events` (`order.created`) → LISTEN/NOTIFY → panel SSE. CANARY_ACK_TIMEOUT_MS içinde
// cihaz ack'i (`orders.first_acked_at`) gelmezse "bayat panel": SSE'ye `resync` yazılır, 2 ARDIŞIK başarısızlıkta
// uyarı gider. Kayıt ack'te ya da en geç CANARY_MAX_AGE_MS'de KALICI silinir (FSM'de iptal geçişi kullanılmaz).
//
// Sözleşmenin burada uygulanan maddeleri:
//  - `number = 0`: işletmenin sipariş numarası sayacı (`tenants.order_seq`) TÜKETİLMEZ — `createOrderNumber`
//    çağrılmaz; `orders_tenant_number_uk` canary'yi dışlar (`test_kind is distinct from 'canary'`).
//  - Alarm zinciri HİÇ kurulmaz: `recordOrderCreated` kancası zinciri planlar, aynı transaction'da `cancelJobs`
//    ile silinir. Gerekçe: `planAlarmSteps` canary için hâlâ (REPEAT, AUTO_CANCEL) döndürüyor (DIŞ BAĞIMLILIK) —
//    AUTO_CANCEL canary'yi `cancelled/tenant_no_response` yapardı. Emniyet ağı `cron.order_new_watch` de canary'yi
//    artık taramaz (jobs/cron/index.ts), yoksa sildiğimiz zinciri geri kurardı.
//  - Dış bildirim YOK: Web Push, platform WhatsApp/SMS ve müşteri mesajı yollarının hepsinde `testKind === 'canary'`
//    kapısı var; buraya ikinci emniyet olarak `statusNotifyChannel = 'none'` + `customerId = null` konur.
//  - Kişisel veri YOK (CLAUDE.md kural 7): telefon, adres ve gerçek müşteri kaydı yok; ad sabit bir etikettir.
//
// AÇMA/KAPAMA (bilinçli olarak opt-in):
//  - `CANARY_ENABLED` 1/true olmadıkça hiç sentetik sipariş üretilmez: canary her şubeye 15 dk'da bir sipariş
//    yazar; paylaşılan geliştirme/test veritabanında bunun kendiliğinden başlaması istenmez (15 §10).
//  - `canary` kill-switch'i (`feature_flags`, kayıt yoksa AÇIK) operasyona deploy'suz acil durdurma verir.
//  - `CANARY_STALE_ALERT` 1/true olmadıkça "bayat panel" sinyali hiç üretilmez — ne uyarı, ne `resync`, ne hata
//    logu: panel bugün canary'yi hiç ack'lemiyor (apps/web live/new-order-alarm.tsx canary olayında erken
//    dönüyor, `/panel/orders/active` canary'yi süzüyor), yani sonuç her turda kesin "bayat" çıkar. Açık olsa
//    sağlıklı her şube 15 dk'da bir yanlış alarm + boş resync üretirdi. Sipariş üretme yolunun ölçümü (fiyat →
//    DB → olay → SSE; `canary.run` kalıcı hatası → `job_failed_permanent` + `canary_create_failed`) bu
//    değişkenden BAĞIMSIZ çalışır. Panel tarafı sessiz ack geldiğinde (raporda DIŞ BAĞIMLILIK) 1 yapılır.

import { branchPanelPresence, branches, orders, tenants, type Database } from '@siparis/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { alert, type AlertContext } from '../../lib/alert';
import { appendBranchEvent } from '../../lib/events';
import { isFlagEnabled } from '../../lib/flags';
import { enqueueJob } from '../../lib/jobs';
import { tenantOrderingBlocked } from '../orders/store-context';
import { PANEL_OFFLINE_AFTER_MS } from '../push/presence';
import {
  branchOpenNow,
  CANARY_ACK_TIMEOUT_MS,
  CANARY_DUE_WINDOW_MS,
  CANARY_FLAG_KEY,
  CANARY_INTERVAL_MS,
  CANARY_RUN_JOB,
  CANARY_STALE_STREAK,
  CANARY_VERIFY_JOB,
  canaryEnabled,
  canaryRunKey,
  canaryStaleAlertEnabled,
  purgeCanaryOrder,
  purgeExpiredCanaryOrders,
} from './order';

export * from './order';

/**
 * Şube kimliğinden türeyen sabit sapma (0 … CANARY_INTERVAL_MS). Aynı şube her zaman aynı dakikada test edilir,
 * farklı şubeler 15 dakikaya yayılır — tek bir cron turunda sipariş yığını oluşmaz.
 */
export function canaryJitterMs(branchId: string): number {
  let h = 7;
  for (let i = 0; i < branchId.length; i++) h = (h * 31 + branchId.charCodeAt(i)) % CANARY_INTERVAL_MS;
  return h;
}

/** Şubenin içinde bulunduğu dilim numarası (sapma uygulanmış) ve diliminin başlangıç anı. */
export function canarySlot(branchId: string, now: Date): { slot: number; startedAtMs: number } {
  const jitter = canaryJitterMs(branchId);
  const slot = Math.floor((now.getTime() - jitter) / CANARY_INTERVAL_MS);
  return { slot, startedAtMs: slot * CANARY_INTERVAL_MS + jitter };
}

/** Şube şu an dilim penceresinde mi (sapmalı 15 dk). */
export function isCanaryDue(branchId: string, now: Date): boolean {
  const { startedAtMs } = canarySlot(branchId, now);
  const age = now.getTime() - startedAtMs;
  return age >= 0 && age < CANARY_DUE_WINDOW_MS;
}

export interface CanaryTarget {
  tenantId: string;
  branchId: string;
  slot: number;
}

/**
 * Şu an canary siparişi alması gereken şubeler: işletme sipariş alıyor (`tenantOrderingBlocked` tek kaynak),
 * demo/sandbox değil (platform canary'si ayrı katmandır, 06 §7.10) ve şube AÇIK SAATİNDE.
 *
 * `paused` durumu bilerek YOK SAYILIR (06 §7.10 "şubenin `paused` durumu … canary'de atlanır"): mola veren
 * şubenin paneli hâlâ açıktır, mola yüzünden canary'yi kesmek sessiz arızayı gizlerdi.
 */
export async function dueCanaryBranches(db: Database, now: Date = new Date()): Promise<CanaryTarget[]> {
  const rows = await db
    .select({ branch: branches, tenant: tenants })
    .from(branches)
    .innerJoin(tenants, eq(tenants.id, branches.tenantId))
    .where(and(eq(tenants.orderingEnabled, true), isNotNull(tenants.webLiveAt), eq(tenants.isDemo, false)));

  const out: CanaryTarget[] = [];
  for (const { branch, tenant } of rows) {
    if (tenantOrderingBlocked(tenant)) continue;
    // Pencere kontrolü çalışma saati sorgusundan ÖNCE: her turda yalnız 1/15 şube için ek sorgu yapılır
    if (!isCanaryDue(branch.id, now)) continue;
    if (!(await branchOpenNow(db, branch, now))) continue;
    out.push({ tenantId: tenant.id, branchId: branch.id, slot: canarySlot(branch.id, now).slot });
  }
  return out;
}

/**
 * Dilimi gelen şubelere `canary.run` işi ekler. Tekillik anahtarı dilim başınadır: cron dakikada bir çalışsa da
 * şube 15 dk'da bir sipariş alır, iki worker aynı anda çalışsa da ikinci satır eklenmez.
 */
export async function scheduleCanaryRuns(db: Database, now: Date = new Date()): Promise<{ queued: number; branchIds: string[] }> {
  const targets = await dueCanaryBranches(db, now);
  const branchIds: string[] = [];
  for (const t of targets) {
    const id = await enqueueJob(db, {
      queue: 'cron',
      type: CANARY_RUN_JOB,
      tenantId: t.tenantId,
      runAt: now,
      dedupeKey: canaryRunKey(t.branchId, t.slot),
      payload: { tenantId: t.tenantId, branchId: t.branchId, slot: t.slot },
      // Canary bir ÖLÇÜMDÜR: 3 denemeden sonra bir sonraki dilimi beklemek, kuyruğu meşgul etmekten iyidir.
      // Kalıcı başarısızlık `job_failed_permanent` kritik uyarısını üretir (06 §7.10 "sipariş oluşturma adımı
      // hata verirse platform alarmı") ve aşağıdaki `canaryCreateFailures` turu çok tenant'lı arızayı ayırır.
      maxAttempts: 3,
    });
    if (id) branchIds.push(t.branchId);
  }
  return { queued: branchIds.length, branchIds };
}

/**
 * Şubenin ÖNCEKİ canary kontrolü başarısız mıydı. Durum ayrı bir tabloda değil, biten `canary.verify` işinin
 * KENDİ YÜKÜNDE tutulur (`payload.stale`): iş satırı 30 gün yaşar (`retention.technical.jobs`), ardışıklık için
 * gereken tek bilgi son turun sonucudur ve yeni tablo/göç gerekmez.
 */
export async function previousCanaryStale(db: Database, branchId: string, excludeJobId?: string | null): Promise<boolean> {
  const rows = (await db.execute<{ stale: string | null }>(sql`
    select payload->>'stale' as stale
      from jobs
     where type = ${CANARY_VERIFY_JOB}
       and payload->>'branchId' = ${branchId}
       and payload->>'stale' is not null
       ${excludeJobId ? sql`and id <> ${excludeJobId}::uuid` : sql``}
     order by created_at desc
     limit 1`)) as unknown as { stale: string | null }[];
  return rows[0]?.stale === 'true';
}

/** Kontrolün sonucunu işin kendi yüküne yazar (sonraki tur ardışıklığı buradan okur). */
export async function markCanaryVerifyResult(db: Database, jobId: string | null | undefined, stale: boolean): Promise<void> {
  if (!jobId) return;
  await db.execute(sql`update jobs set payload = payload || ${JSON.stringify({ stale })}::jsonb where id = ${jobId}::uuid`);
}

/** Şubede "çevrimiçi" sipariş ekranı var mı (06 §7.7 varlık nabzı; canary uyarısının önkoşulu). */
export async function panelOnline(db: Database, branchId: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ lastSeenAt: branchPanelPresence.lastSeenAt })
    .from(branchPanelPresence)
    .where(eq(branchPanelPresence.branchId, branchId));
  if (!row?.lastSeenAt) return false;
  return now.getTime() - row.lastSeenAt.getTime() <= PANEL_OFFLINE_AFTER_MS;
}

export interface CanaryVerifyResult {
  outcome: 'acked' | 'stale' | 'missing';
  /** Sipariş → ilk ack süresi (ms); `canary_ack_seconds` ölçümünün kaynağı. */
  ackMs?: number;
  /** Ardışık başarısızlık sayısı (1 = ilk, CANARY_STALE_STREAK = uyarı eşiği). */
  streak?: number;
  /** SSE'ye `resync` yazıldı mı. */
  resyncSent?: boolean;
  /** `owner` uyarısı gönderildi mi (eşik + çevrimiçi cihaz + CANARY_STALE_ALERT). */
  alerted?: boolean;
}

/**
 * 60 sn sonraki ack kontrolü (06 §7.10).
 *  - ack geldiyse: süre ölçülür, kayıt silinir, ardışıklık sıfırlanır.
 *  - ack gelmediyse: "bayat panel" → SSE'ye `resync` (panel anlık görüntüyü yeniden çeker), ardışıklık artar,
 *    2. ardışık başarısızlıkta uyarı; kayıt yine silinir (sentetik sipariş ekranlarda birikmez).
 *  - `CANARY_STALE_ALERT` kapalıyken bayat panel sinyalinin TAMAMI (resync + uyarı + hata logu) susar: panel
 *    sessiz ack atmadığı sürece bu sonuç kesindir, yani ölçüm değil gürültüdür.
 */
export async function verifyCanaryOrder(
  db: Database,
  input: { tenantId: string; branchId: string; orderId: string; jobId?: string | null },
  ctx: AlertContext,
  now: Date = new Date(),
): Promise<CanaryVerifyResult> {
  const [order] = await db
    .select({ id: orders.id, placedAt: orders.placedAt, firstAckedAt: orders.firstAckedAt, testKind: orders.testKind })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, input.tenantId)));
  // Kayıt yok: süpürme ya da elle silme olmuş. Başarısız SAYILMAZ — olmayan kanıtla alarm üretilmez. Sonuç da
  // YAZILMAZ: "kanıt yok" bir önceki turun gerçek verdiğini silip ardışıklığı sahteden sıfırlamasın.
  if (!order || order.testKind !== 'canary') return { outcome: 'missing' };

  if (order.firstAckedAt) {
    const ackMs = Math.max(0, order.firstAckedAt.getTime() - order.placedAt.getTime());
    await markCanaryVerifyResult(db, input.jobId, false);
    await purgeCanaryOrder(db, order.id);
    ctx.log.info({ canary: 'ack', branchId: input.branchId, ackMs }, 'canary ack alındı');
    return { outcome: 'acked', ackMs };
  }

  const previous = await previousCanaryStale(db, input.branchId, input.jobId);
  const streak = previous ? CANARY_STALE_STREAK : 1;
  await markCanaryVerifyResult(db, input.jobId, true);

  // Panel sessiz ack'i gelene kadar (CANARY_STALE_ALERT kapalı) "ack gelmedi" bir ÖLÇÜM DEĞİL, bilinen bir
  // eksiktir: her turda kesin gerçekleşir. Bu durumda ne `resync` yazılır ne de hata seviyesinde log atılır —
  // şube başına 15 dk'da bir kesin-yanlış sinyal gerçek hataları gömer ve panelleri boşuna tazeletir. Sipariş
  // üretme yolunun ölçümü (fiyat → DB → olay → SSE + `canary.run` hataları) bu değişkenden bağımsız sürer.
  const staleSignalEnabled = canaryStaleAlertEnabled();
  if (staleSignalEnabled) {
    // İlk çare: panelin anlık görüntüyü yeniden çekmesi. Panel 'resync' olayını zaten dinliyor (apps/web lib/sse.ts).
    await appendBranchEvent(db, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      type: 'resync',
      payload: { reason: 'canary_stale' },
    });
  }

  const online = await panelOnline(db, input.branchId, now);
  const alertAllowed = staleSignalEnabled && streak >= CANARY_STALE_STREAK && online;
  if (alertAllowed) {
    alert(ctx, {
      kind: 'canary_stale_panel',
      severity: 'critical',
      message: `Bayat panel: şubenin sipariş ekranı çevrimiçi görünüyor ama ${CANARY_STALE_STREAK} ardışık sentetik sipariş ${CANARY_ACK_TIMEOUT_MS / 1000} sn içinde görülmedi.`,
      data: { branchId: input.branchId, streak, timeoutSec: CANARY_ACK_TIMEOUT_MS / 1000 },
      dedupeKey: `canary_stale_panel:${input.branchId}`,
    });
  } else if (!staleSignalEnabled) {
    ctx.log.info(
      { canary: 'stale_unmeasured', branchId: input.branchId, streak, panelOnline: online },
      'canary ack gelmedi: panelin sessiz ack yolu yok, bayat panel sinyali CANARY_STALE_ALERT ile kapalı',
    );
  } else {
    ctx.log.warn({ canary: 'stale', branchId: input.branchId, streak, panelOnline: online }, 'canary ack gelmedi');
  }

  await purgeCanaryOrder(db, order.id);
  return { outcome: 'stale', streak, resyncSent: staleSignalEnabled, alerted: alertAllowed };
}

/**
 * Son bir saatte KALICI başarısız olan `canary.run` işleri: sipariş oluşturma adımının kendisi bozuksa canary
 * hiç yazılamaz ve "ack gelmedi" sinyali de doğmaz. Birden çok tenant'ta görülmesi platform arızası demektir
 * (06 §7.10: "birden çok tenant'ta → P1").
 */
export async function canaryCreateFailures(db: Database): Promise<{ jobs: number; tenants: number }> {
  const [row] = (await db.execute<{ n: number; t: number }>(sql`
    select count(*)::int as n, count(distinct tenant_id)::int as t
      from jobs
     where type = ${CANARY_RUN_JOB} and status = 'failed' and finished_at > now() - interval '1 hour'`)) as unknown as {
    n: number;
    t: number;
  }[];
  return { jobs: Number(row?.n ?? 0), tenants: Number(row?.t ?? 0) };
}

export interface CanaryTickResult {
  purged: number;
  queued: number;
  branchIds: string[];
  skipped: 'env' | 'flag' | null;
}

/**
 * Dakikada bir koşan tur (`cron.canary`): süresi geçmiş kayıtları siler, dilimi gelen şubelere iş ekler ve
 * sipariş oluşturma adımının topluca bozulmasını uyarır. Temizlik canary kapalıyken de çalışır: anahtar
 * kapatıldığında yolda kalmış sentetik siparişler panelde/raporda birikmez.
 */
export async function runCanaryTick(db: Database, ctx: AlertContext, now: Date = new Date()): Promise<CanaryTickResult> {
  const purged = await purgeExpiredCanaryOrders(db, now);
  if (!canaryEnabled()) return { purged, queued: 0, branchIds: [], skipped: 'env' };
  if (!(await isFlagEnabled(db, CANARY_FLAG_KEY))) return { purged, queued: 0, branchIds: [], skipped: 'flag' };

  const fails = await canaryCreateFailures(db);
  if (fails.tenants >= 2) {
    alert(ctx, {
      kind: 'canary_create_failed',
      severity: 'critical',
      message: `Sentetik sipariş oluşturulamıyor: son 1 saatte ${fails.tenants} işletmede ${fails.jobs} canary işi kalıcı başarısız (platform arızası olabilir).`,
      data: { tenants: fails.tenants, jobs: fails.jobs },
      dedupeKey: 'canary_create_failed',
    });
  }

  const { queued, branchIds } = await scheduleCanaryRuns(db, now);
  return { purged, queued, branchIds, skipped: null };
}
