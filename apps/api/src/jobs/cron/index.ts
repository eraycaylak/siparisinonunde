// Zamanlanmış işler (registerCron ile). Temel bakım işleri jobs/system'dedir.
// Buradaki işler: duraklatma bitişi, panel çevrimdışı dedektörü, deneme bitişi (`trial_watch`: 00 §9 iş modeli
// kapısı; iş mantığı services/admin/trial.ts), alarm zinciri emniyet ağı (`order_new_watch`,
// 06 §7.6/§8.5), WABA kota gözcüsü (`waba_quota_watch`: ortak numaranın 24 saatlik konuşma tavanı + kalite
// derecesi; iş mantığı services/messaging/waba-quota.ts), DLQ gözcüsü (`jobs_dlq_watch`: SON 24 SAATTE kalıcı
// başarısız olan iş birikmesi uyarısı; saklama/maskeleme `jobs/system` içindeki `cron.retention` koşusundadır) ve sentetik canary
// (`cron.canary` + adımları `canary.run` / `canary.verify`, 06 §7.10 — iş mantığı services/canary'dedir).
// Burada: registerJobHandler(type, handler), registerCron({...}) ve onOrderTransition/onOrderCreated abonelikleri.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir (tekrar çağrı güvenli).

import { branches, orders, type Database } from '@siparis/db';
import { and, eq, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { alert, type AlertContext } from '../../lib/alert';
import { enqueueJob, generationKey, registerCron, registerJobHandler } from '../../lib/jobs';
import { enforceTrialEnds } from '../../services/admin/trial';
import { testConnection } from '../../services/admin/wa-setup';
import { CANARY_RUN_JOB, CANARY_VERIFY_JOB, createCanaryOrder, runCanaryTick, verifyCanaryOrder } from '../../services/canary/index';
import { detectWabaQuotaPressure, parseMessagingLimit } from '../../services/messaging/waba-quota';
import { alarmDedupeKey, normalizeAlarmPolicy, planAlarmSteps } from '../../services/orders/alarm-policy';
import { detectOfflinePanels } from '../../services/push/presence';
import { emitBranchState } from '../../services/settings/branch';

/**
 * Süresi dolan duraklatmalar (14 §7.1 branch.state): `paused_until` geçmiş şubelerde duraklatmayı temizler ve
 * aynı transaction'da güncel sipariş alma durumunu `branch.state` olarak yayınlar (panel üst çubuğu "Duraklatıldı"da
 * kalmasın). `paused_until` dolu + geçmiş = henüz yayınlanmamış; temizlenince tekrar yayınlanmaz (idempotent).
 * Koşullu güncelleme: bu arada yeniden duraklatılan (gelecek tarihli) şubeye dokunulmaz. Sürüm (`version`)
 * artırılmaz: açık ayar formları gereksiz sürüm çakışması almasın.
 */
export async function publishExpiredPauses(db: Database, now: Date = new Date()): Promise<number> {
  const due = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(isNotNull(branches.pausedUntil), lte(branches.pausedUntil, now)));
  let published = 0;
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(branches)
        .set({ pausedUntil: null, pauseReason: null })
        .where(and(eq(branches.id, id), isNotNull(branches.pausedUntil), lte(branches.pausedUntil, now)))
        .returning();
      if (!row) return false;
      await emitBranchState(tx, row, now);
      return true;
    });
    if (done) published++;
  }
  return published;
}

// ---------------------------------------------------------------------------
// order-new-watch — alarm zincirinin emniyet ağı (06 §7.6, §8.5; denetim H3 / iş 1.8)

/**
 * Bu süreden eski `new` siparişler taranmaz. Zincirin en uzun adımı 30 dk (otomatik iptal üst sınırı); 6 saat
 * boyunca her dakika denendikten sonra kurtarılamayan sipariş zaten elle ele alınmıştır. Üst sınır aynı zamanda
 * saklama temizliğinden gelen yanlış pozitifi engeller: 30 gün sonra biten alarm işlerinin satırları silinir,
 * pencere olmasaydı eski siparişler için zincir yeniden kurulurdu.
 */
export const ORDER_NEW_WATCH_WINDOW_MS = 6 * 60 * 60_000;

/**
 * Aynı (sipariş, adım) için en çok bu kadar KALICI BAŞARISIZ deneme onarılır. Onarım her seferinde bir sonraki
 * nesli (`alarm:<sipariş>:<adım>#g<n>`, `generationKey`) açtığı için tam unique engel olmaz; sınır sonsuz döngüyü
 * keser ve sınıra gelindiğinde kritik uyarı gider ("elle ele alınmalı").
 *
 * Sayım yalnız `failed` satırları kapsar: bekleyen ret ertelemesinin ürettiği `done` nesil satırları (geri alınmış
 * retten sonra sipariş yeniden taranır) bütçeyi tüketip sahte "exhausted" uyarısı üretmesin.
 */
export const ORDER_NEW_WATCH_MAX_JOBS_PER_STEP = 3;

export interface OrderNewWatchResult {
  /** Yeniden kuyruğa atılan (sipariş, adım) çifti sayısı. */
  requeued: number;
  /** Zinciri eksik bulunan sipariş kimlikleri. */
  orderIds: string[];
  /** Adım sınırına takıldığı için kurtarılamayan sipariş kimlikleri (kritik uyarı). */
  exhausted: string[];
}

type AlarmJobRow = { step: number | string | null; gen: number | string | null; status: string };

/**
 * `new` durumda olup alarm zinciri işi KAYBOLMUŞ ya da `failed` olmuş siparişleri bulur ve eksik adımları
 * yeniden kuyruğa atar (06 §8.5 `order-new-watch`).
 *
 * Bir adım "canlı" sayılır: o adımın EN YÜKSEK NESİLLİ satır(lar)ından biri `pending`, `running` ya da `done` ise.
 * Neden en yüksek nesil: bekleyen ret ertelemesinde adımın nesil 0 satırı `done` olur ama adım ÇALIŞMAMIŞTIR —
 * işi devrettiği `#g1` satırı kalıcı başarısız olursa, "herhangi bir `done` satır varsa canlı" kuralı adımı
 * sonsuza kadar onarılamaz sayardı (sessizce `new` kalan sipariş). Anahtar değil **yük içindeki `step`** okunur.
 * Eksik adım, siparişin `new` olduğu andan (`verified_at` ya da `placed_at` — `bumpCustomer` ile aynı ölçü)
 * itibaren hesaplanan ORİJİNAL zamanıyla eklenir: zincir baştan başlatılmaz, kaldığı yerden sürer. Vakti geçmiş
 * adım hemen çalışır; otomatik iptal adımı da bu yolla gelir, yani 15 dk'yı aşmış sipariş `tenant_no_response`
 * ile kapanır ve müşteriye özür mesajı `runAlarmStep` üzerinden gider (iş mantığı tek yerde kalır).
 *
 * Kapsam dışı:
 *  - `manual` kanal: telefon siparişini personel kendisi girer, zincir hiç kurulmaz (04 §4.5).
 *  - `canary` siparişleri: alarm zinciri sözleşme gereği HİÇ kurulmaz (06 §7.10); taranırsa onarım zinciri
 *    geri kurar ve otomatik iptal adımı sentetik siparişi iptal eder.
 *  - Pencere dışı siparişler (ORDER_NEW_WATCH_WINDOW_MS).
 *  - **Bekleyen ret** (`rejection_scheduled_at` dolu): eskalasyon bilerek duruyor ve adımlar ret penceresinin
 *    sonrasına ertelenmiş olabilir; burada onarılacak bir şey yok, siparişle 30 sn içinde `order.finalize_rejection`
 *    ilgilenir. (Bu iş kalıcı başarısız olursa DLQ uyarısı verir; sipariş kilitlenmez — "geri al" + yeniden ret
 *    nesil eki sayesinde TAZE anahtar alır, ayrıca admin ekranından yeniden denenebilir.)
 *  - `t=0` Web Push yeniden GÖNDERİLMEZ: 10 dakika gecikmiş "yeni sipariş" bildirimi yanıltıcıdır ve zincirin
 *    sonraki adımları siparişi zaten bir insana ulaştırır.
 */
export async function watchNewOrders(db: Database, now: Date = new Date(), ctx?: AlertContext): Promise<OrderNewWatchResult> {
  const since = new Date(now.getTime() - ORDER_NEW_WATCH_WINDOW_MS);
  const candidates = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      branchId: orders.branchId,
      testKind: orders.testKind,
      alarmPolicy: branches.alarmPolicy,
      startedAt: sql<Date>`coalesce(${orders.verifiedAt}, ${orders.placedAt})`,
    })
    .from(orders)
    .innerJoin(branches, eq(branches.id, orders.branchId))
    .where(
      and(
        eq(orders.status, 'new'),
        ne(orders.channel, 'manual'),
        isNull(orders.rejectionScheduledAt),
        // Canary: zinciri BİLEREK yok (06 §7.10, services/canary). Emniyet ağı burayı taramasa, canary'nin
        // oluşturulurken silinen (REPEAT, AUTO_CANCEL) adımlarını 1 dk sonra geri kurar, "zincir eksikti"
        // kritik uyarısı üretir ve AUTO_CANCEL sentetik siparişi `cancelled/tenant_no_response` yapardı.
        or(isNull(orders.testKind), ne(orders.testKind, 'canary'))!,
        sql`coalesce(${orders.verifiedAt}, ${orders.placedAt}) >= ${since.toISOString()}::timestamptz`,
      ),
    );

  const result: OrderNewWatchResult = { requeued: 0, orderIds: [], exhausted: [] };
  if (!candidates.length) return result;

  // TEK SORGU (denetim 2026-10-05 LOW 1): adayların alarm işleri bir kerede okunur ve bellekte sipariş kimliğine
  // göre gruplanır. Eskiden bu okuma DÖNGÜNÜN İÇİNDEYDİ, yani aday sipariş başına bir sorgu koşuyordu; tur dakikada
  // bir olduğu için yoğun saatte 20 açık sipariş = dakikada 20 sorgu. Sorgu `payload->>'orderId'` üzerinde
  // İNDEKSSİZDİ: `jobs_type_idx` türü daraltır ama alarm adımları işin en kalabalık türüdür, bu yüzden her çağrı
  // o türün tamamını tarıyordu. İndeks aynı turda eklendi (0004_jobs_alarm_order_idx.sql); toplu okuma indeksle
  // birlikte tek bitmap taramasına iner.
  //
  // ⚠️ `sql.param(...)` ŞART (bağımsız inceleme 2026-10-05): Drizzle'ın `sql` şablonuna ÇIPLAK bir JS dizisi
  // verilirse dizi TEK bir parametreye bağlanmaz, parantezli listeye AÇILIR (`sql/sql.cjs` → `Array.isArray`
  // dalı): `any(($1, $2, $3)::text[])`. Bu geçerli SQL değildir — Postgres `(…)` ifadesini ROW sayar ve sorgu
  // HAZIRLANIRKEN "cannot cast type record to text[]" ile düşer; tek adaylı turda ise `($1)::text[]` sözdizimsel
  // olarak geçer ama çalışma anında "malformed array literal" verir. Yani her iki durumda da emniyet ağının
  // kendisi çöker (iş kalıcı başarısız → DLQ) ve alarm zinciri eksik siparişler ONARILMADAN kalır.
  // `sql.param` diziyi tek yer tutucuya bağlar, postgres-js onu gerçek bir `text[]` olarak gönderir.
  // Regresyon kapısı: `apps/api/test/jobs-cron.test.ts` → "toplu okuma siparişleri karıştırmaz" (iki aday
  // olduğu için açılmış liste orada derhal patlar).
  const grouped = new Map<string, AlarmJobRow[]>();
  const alarmRows = (await db.execute<AlarmJobRow & { orderId: string }>(sql`
    select payload->>'orderId' as "orderId", payload->>'step' as step, payload->>'gen' as gen, status from jobs
     where type = 'order.alarm_step' and payload->>'orderId' = any(${sql.param(candidates.map((c) => c.id))}::text[])`)) as unknown as (AlarmJobRow & {
    orderId: string;
  })[];
  for (const r of alarmRows) {
    const list = grouped.get(r.orderId);
    if (list) list.push(r);
    else grouped.set(r.orderId, [r]);
  }

  for (const o of candidates) {
    const rows = grouped.get(o.id) ?? [];
    /** Adım → o adımda görülen en yüksek nesil (satır hiç yoksa anahtar eklenmez). */
    const maxGen = new Map<number, number>();
    /** Adım → en yüksek nesilde canlı (pending/running/done) satır var mı. */
    const liveAtMaxGen = new Map<number, boolean>();
    /** Adım → kalıcı başarısız deneme sayısı (onarım bütçesi). */
    const failures = new Map<number, number>();
    for (const r of rows) {
      const step = Number(r.step);
      if (!Number.isFinite(step)) continue;
      const gen = Number(r.gen ?? 0) || 0;
      const isLive = r.status === 'pending' || r.status === 'running' || r.status === 'done';
      if (r.status === 'failed') failures.set(step, (failures.get(step) ?? 0) + 1);
      const seen = maxGen.get(step);
      if (seen == null || gen > seen) {
        maxGen.set(step, gen);
        liveAtMaxGen.set(step, isLive);
      } else if (gen === seen && isLive) {
        liveAtMaxGen.set(step, true);
      }
    }

    const planned = planAlarmSteps(normalizeAlarmPolicy(o.alarmPolicy), o.testKind);
    const startedAt = new Date(o.startedAt).getTime();
    let repaired = 0;
    let blocked = false;
    for (const s of planned) {
      if (liveAtMaxGen.get(s.step)) continue;
      if ((failures.get(s.step) ?? 0) >= ORDER_NEW_WATCH_MAX_JOBS_PER_STEP) {
        blocked = true;
        continue;
      }
      // Hiç satır yoksa nesil 0 (çıplak anahtar); varsa bir sonraki nesil — tam unique çakışmaz
      const seen = maxGen.get(s.step);
      const gen = seen == null ? 0 : seen + 1;
      const runAt = new Date(Math.max(startedAt + s.delayMs, now.getTime()));
      const id = await enqueueJob(db, {
        queue: 'notify',
        type: 'order.alarm_step',
        tenantId: o.tenantId,
        runAt,
        dedupeKey: generationKey(alarmDedupeKey(o.id, s.step), gen),
        payload: { orderId: o.id, tenantId: o.tenantId, branchId: o.branchId, step: s.step, ...(gen ? { gen } : {}) },
      });
      if (id) repaired++;
    }
    if (repaired) {
      result.requeued += repaired;
      result.orderIds.push(o.id);
    }
    if (blocked) result.exhausted.push(o.id);
  }

  if (ctx && result.requeued) {
    alert(ctx, {
      kind: 'order_new_watch',
      severity: 'critical',
      message: `${result.orderIds.length} siparişin alarm zinciri eksikti; ${result.requeued} adım yeniden kuyruğa atıldı.`,
      data: { orders: result.orderIds.length, steps: result.requeued, orderIds: result.orderIds.slice(0, 10) },
      dedupeKey: 'order_new_watch',
    });
  }
  if (ctx && result.exhausted.length) {
    alert(ctx, {
      kind: 'order_new_watch_exhausted',
      severity: 'critical',
      message: `${result.exhausted.length} siparişin alarm adımı sürekli başarısız; otomatik kurtarma durdu, ELLE ele alınmalı.`,
      data: { orders: result.exhausted.length, orderIds: result.exhausted.slice(0, 10) },
      dedupeKey: 'order_new_watch_exhausted',
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// DLQ gözcüsü — kalıcı başarısız iş birikmesi (denetim H21, H26 / iş 1.9)

/** Pencere içinde kalıcı başarısız olan iş sayısı bunu aşarsa uyarı gider. */
export const DLQ_ALERT_THRESHOLD = 10;
/** DLQ uyarısı en sık bu aralıkla tekrarlanır. */
export const DLQ_ALERT_COOLDOWN_MS = 60 * 60_000;

/**
 * Eşik YALNIZ bu pencerede başarısız olan işleri sayar (denetim 2026-10-05 MEDIUM B).
 *
 * NEDEN PENCERE: eşik tablodaki TÜM `failed` satırları sayıyordu, satırlar ise saklama kuralı gereği 90 gün duruyor
 * (`retention.technical.jobs.failed`). 11 hata 90 güne yayılmış olsa bile sayı bir daha eşiğin altına inmediği için
 * gözcü SONSUZA DEK saat başı kritik uyarı üretiyordu: nöbetçi "zaten hep kırmızı" diyip kanalı kapatır ve gerçek
 * yığılma görülmez (uyarı yorgunluğu). Pencere, uyarıyı "şu an biriken iş var" bilgisine geri döndürür.
 *
 * TEK TEK HATA KAYBOLMAZ: her kalıcı başarısızlık zaten düştüğü anda `job_failed_permanent` kritik uyarısı
 * gönderir (`lib/jobs.ts`, iş türü başına soğumalı). Bu gözcü tek hatayı değil YIĞILMAYI arar.
 *
 * Ölçü `coalesce(finished_at, updated_at)`: `failed` yapan iki yol da (`processDueJobs` ve `recoverStaleJobs`)
 * `finished_at = now()` yazar; `cron.retention` de aynı ifadeyi kullandığı için eski bir satır (örneğin elle
 * yazılmış, `finished_at` boş) "az önce başarısız oldu" sayılmaz.
 */
export const DLQ_ALERT_WINDOW_MS = 24 * 60 * 60_000;

/** Pencerenin başlangıcı: bu andan ÖNCE başarısız olmuş satırlar eşiğe sayılmaz. */
export function dlqWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - DLQ_ALERT_WINDOW_MS);
}

/** `failed` ifadesinin pencere koşulu (sayım ve tür dökümü AYNI koşulu kullanır). */
const dlqWindowFilter = (since: Date) => sql`coalesce(finished_at, updated_at) >= ${since.toISOString()}::timestamptz`;

export interface FailedJobCounts {
  /** Pencere içinde başarısız olan iş sayısı — eşik BUNU okur. */
  recent: number;
  /** Tablodaki tüm `failed` satırlar (saklama penceresi dolana kadar durur); yalnız uyarı gövdesinde bağlam. */
  total: number;
}

/**
 * DLQ'da bekleyen (`failed`) işler: pencere içindeki sayı + toplam.
 *
 * Saklama ve maskeleme BURADA YAPILMAZ: `failed` işin yükündeki kişisel veriyi maskeleyen (30 gün) ve satırı silen
 * (90 gün) adımlar `jobs/system` içindeki `cron.retention` koşusundadır — `retention.technical.jobs.failed_payload`
 * ve `retention.technical.jobs.failed` (07 §9, 08 §2.8 satır 22, süreler `RETENTION_DAYS`). Aynı satırlar için
 * burada ikinci bir saklama penceresi açılmaz: kısa olan pencere operatörün yapılandırdığı süreyi sessizce
 * geçersiz kılar ve imha tutanağında (`retention_runs`) aynı iş iki ayrı adla görünürdü. Uyarı penceresi (24 saat)
 * saklama penceresi DEĞİLDİR: satırı silmez, yalnız eşiğe neyin sayıldığını belirler.
 */
export async function countFailedJobs(db: Database, now: Date = new Date()): Promise<FailedJobCounts> {
  const since = dlqWindowStart(now);
  const [row] = (await db.execute<{ recent: number; total: number }>(sql`
    select count(*) filter (where ${dlqWindowFilter(since)})::int as recent, count(*)::int as total
      from jobs where status = 'failed'`)) as unknown as { recent: number; total: number }[];
  return { recent: Number(row?.recent ?? 0), total: Number(row?.total ?? 0) };
}

export function registerCronJobs(): void {
  registerJobHandler('cron.branch_pause_end', async (_payload, { db, log }) => {
    const n = await publishExpiredPauses(db);
    if (n) log.info({ branches: n }, 'süresi dolan duraklatmalar yayınlandı');
  });
  registerCron({ name: 'branch_pause_end', type: 'cron.branch_pause_end', schedule: { everyMinutes: 1 } });

  // Panel çevrimdışı dedektörü (06 §7.7): sipariş alan şubede sipariş ekranı 5 dk'dır görülmüyorsa sahibine
  // platform.alert `panel_offline` (şube başına 60 dk'da en çok 1, yerel günde en çok PANEL_OFFLINE_ALERT_PER_DAY)
  registerJobHandler('cron.panel_presence', async (_payload, { db, log }) => {
    const alerts = await detectOfflinePanels(db);
    if (alerts.length) log.warn({ branches: alerts.map((a) => a.branchId) }, 'panel çevrimdışı uyarısı kuyruğa atıldı');
  });
  registerCron({ name: 'panel_presence', type: 'cron.panel_presence', schedule: { everyMinutes: 1 } });

  // Alarm zincirinin emniyet ağı (06 §7.6, §8.5): zincir işi kaybolmuş ya da `failed` olmuş `new` siparişi yakalar
  registerJobHandler('cron.order_new_watch', async (_payload, { db, config, log }) => {
    const res = await watchNewOrders(db, new Date(), { log, config });
    if (res.requeued) log.error({ orders: res.orderIds, steps: res.requeued }, 'alarm zinciri eksik siparişler yeniden kuyruğa atıldı');
    if (res.exhausted.length) log.error({ orders: res.exhausted }, 'alarm adımı sürekli başarısız: otomatik kurtarma durdu');
  });
  registerCron({ name: 'order_new_watch', type: 'cron.order_new_watch', schedule: { everyMinutes: 1 } });

  // WABA kota gözcüsü (denetim açık soru 2): ortak numaranın 24 SAATLİK iş-kaynaklı konuşma tavanı. Ölçü mevcut
  // kayıtlardan türetilir (yeni tablo yok, `services/messaging/waba-quota.ts`); %70 uyarı, %90 kritik, tavan dolunca
  // ACİL. Saatte bir de sağlayıcıdan kalite derecesi + basamak okunur (`testConnection`; okunamazsa yalnız loglanır).
  // 5 dakikalık tur: kota kayan 24 saatlik penceredir, dakikalık ölçüme gerek yok; gönderim kapısının göstergesi de
  // bu turda tazelenir (bayatlarsa kapı kendiliğinden devre dışı kalır, mesaj akar).
  // Eşik logu `detectWabaQuotaPressure` içindedir (kiracı payıyla birlikte): burada tekrar edilmez, yoksa her
  // tur iki neredeyse-aynı `log.error` satırı üretirdi ve log tabanlı sayım eşikleri iki kat okurdu.
  registerJobHandler('cron.waba_quota_watch', async (_payload, { db, config, log }) => {
    await detectWabaQuotaPressure(
      { db, config, log },
      {
        readQuality: async () => {
          const t = await testConnection(config);
          const raw = t.phone.throughputLevel;
          return {
            readable: true,
            qualityRating: t.phone.qualityRating,
            messagingLimitRaw: raw,
            // Cloud'da bu alan throughput'tur (STANDARD/HIGH) ve BASAMAK DEĞİLDİR → parseMessagingLimit null döner
            messagingLimitCap: parseMessagingLimit(raw),
            ready: t.ready,
          };
        },
      },
    );
  });
  registerCron({ name: 'waba_quota_watch', type: 'cron.waba_quota_watch', schedule: { everyMinutes: 5 } });

  // DLQ gözcüsü (denetim H21/H26): kalıcı başarısız iş birikmesi uyarısı (saklama `cron.retention`'dadır).
  // Eşik PENCERELİDİR (DLQ_ALERT_WINDOW_MS): eski satırlar uyarı üretmez, gerekçe sabitin başındadır.
  registerJobHandler('cron.jobs_dlq_watch', async (_payload, { db, config, log }) => {
    const now = new Date();
    const { recent, total } = await countFailedJobs(db, now);
    if (recent <= DLQ_ALERT_THRESHOLD) return;
    // Hangi iş türleri birikti: tür adı kişisel veri değildir, yük GÖNDERİLMEZ. Döküm de PENCERELİ: aksi halde
    // uyarı "son 24 saatte 12 iş" derken 90 günün türlerini sayar ve nöbetçi yanlış türü kovalar.
    const since = dlqWindowStart(now);
    const types = (await db.execute<{ type: string; n: number }>(sql`
      select type, count(*)::int as n from jobs
       where status = 'failed' and ${dlqWindowFilter(since)}
       group by type order by n desc limit 10`)) as unknown as {
      type: string;
      n: number;
    }[];
    const windowHours = Math.round(DLQ_ALERT_WINDOW_MS / 3_600_000);
    alert(
      { log, config },
      {
        kind: 'jobs_dlq_threshold',
        severity: 'critical',
        message: `Son ${windowHours} saatte ${recent} iş kalıcı olarak başarısız oldu (DLQ eşiği ${DLQ_ALERT_THRESHOLD}; tabloda toplam ${total} satır).`,
        data: { failed: recent, total, windowHours, types: types.map((t) => `${t.type}=${t.n}`) },
        dedupeKey: 'jobs_dlq_threshold',
        cooldownMs: DLQ_ALERT_COOLDOWN_MS,
      },
    );
  });
  registerCron({ name: 'jobs_dlq_watch', type: 'cron.jobs_dlq_watch', schedule: { everyMinutes: 15 } });

  // -------------------------------------------------------------------------
  // Deneme bitişi (00 §9, 05 §A.2.1; 14 §cron tablosu: günlük 04:00). Denetim 04.10.2026 (A): iş yazılmıştı ama
  // KAYDEDİLMEMİŞTİ — `enforceTrialEnds` yalnız testten çağrıldığı için deneme bitişi CANLIDA uygulanmıyordu ve
  // hiçbir işletme `read_only`'ye düşmüyordu (ücretli iş modelinin yarısı fiilen yoktu).
  // Günlük tur yeterlidir: karar gün hassasiyetindedir (`trial_ends_at` + 3 gün) ve 04:00 sipariş trafiğinin en
  // düşük olduğu saattir — bir işletmenin sipariş alması gün ortasında durmaz. İş idempotenttir (koşullu update
  // + satır kilidi), yani yeniden denenen tur ikinci kez düşürme yapmaz.
  // TEK İSTİSNA — ilk tur: `scheduleCronJobs` günlük dilimi "bugünün 04:00'ı geçtiyse hemen" kuyruğa atar, yani
  // bu kaydın CANLIYA ÇIKTIĞI dağıtım 04:00'tan sonraysa birikmiş denemeler o anda düşer (gün ortası olabilir).
  // Sonraki turların hepsi 04:00'tadır. Dağıtımdan önce admin panosundan bandı dolmuş işletme listesine bakılır.
  // Düşen işletme operasyonun gözünden kaçmasın: log satırı + uyarı kanalı (tahsilat araması, 05 dunning panosu).
  // Uyarı gövdesinde kişisel veri yoktur (CLAUDE.md kural 7): yalnız sayı ve tenant kimlikleri gider, işletme adı
  // ve slug GİTMEZ — log satırı sunucuda kalır ve slug'ı taşır.
  registerJobHandler('cron.trial_watch', async (_payload, { db, config, log }) => {
    const applied = await enforceTrialEnds(db);
    if (!applied.length) return;
    log.warn(
      { tenants: applied.length, slugs: applied.map((a) => a.slug), stage: 'read_only' },
      'deneme bitişi uygulandı: işletmeler salt-okunur aşamaya düştü, online sipariş alma durdu',
    );
    alert(
      { log, config },
      {
        kind: 'trial_ended',
        severity: 'warning',
        message: `${applied.length} işletmenin denemesi bitti; aşama salt-okunur (read_only) oldu ve online sipariş alma durdu.`,
        data: { tenants: applied.length, tenantIds: applied.map((a) => a.tenantId).slice(0, 10) },
        dedupeKey: 'trial_ended',
      },
    );
  });
  registerCron({ name: 'trial_watch', type: 'cron.trial_watch', schedule: { dailyAt: '04:00' } });

  // -------------------------------------------------------------------------
  // Sentetik canary (06 §7.10; denetim H4 / iş 3.6). Tur dakikada bir koşar ama şube başına dilim 15 dk'dır
  // (`isCanaryDue` sapması): her şubenin kendi dakikası vardır, tek turda sipariş yığını oluşmaz.
  // `CANARY_ENABLED` kapalıysa tur yalnız süresi geçmiş sentetik siparişleri temizler.
  registerJobHandler('cron.canary', async (_payload, { db, config, log }) => {
    const res = await runCanaryTick(db, { log, config });
    if (res.purged) log.info({ purged: res.purged }, 'süresi geçmiş canary siparişleri silindi');
    if (res.queued) log.info({ branches: res.branchIds.length }, 'canary siparişi kuyruğa atıldı');
  });
  registerCron({ name: 'canary', type: 'cron.canary', schedule: { everyMinutes: 1 } });

  // Şubenin dilim işi: sentetik siparişi GERÇEK yoldan oluşturur ve 60 sn sonraya ack kontrolünü kurar.
  // Hata YUTULMAZ: iş yeniden denenir, denemesi tükenirse `job_failed_permanent` kritik uyarısı gider
  // (06 §7.10 "sipariş oluşturma adımı hata verirse platform alarmı").
  registerJobHandler<{ tenantId: string; branchId: string }>(CANARY_RUN_JOB, async (payload, { db, log }) => {
    const res = await createCanaryOrder(db, { tenantId: payload.tenantId, branchId: payload.branchId });
    if (res.created) log.info({ canary: 'created', branchId: payload.branchId, orderId: res.orderId }, 'canary siparişi oluşturuldu');
    else log.info({ canary: 'skipped', branchId: payload.branchId, reason: res.reason, detail: res.detail }, 'canary siparişi atlandı');
  });

  // Ack kontrolü: ack geldiyse süre ölçülür, gelmediyse SSE'ye `resync` + 2. ardışık turda uyarı; kayıt silinir.
  // Sonucu `verifyCanaryOrder` kendi (iş bağlamını taşıyan) logger'ıyla zaten yazar — burada ikinci satır yok;
  // yoksa CANARY_STALE_ALERT kapalıyken kesin-yanlış "bayat panel" hatası her turda loga düşerdi.
  registerJobHandler<{ tenantId: string; branchId: string; orderId: string }>(CANARY_VERIFY_JOB, async (payload, { db, config, log, job }) => {
    await verifyCanaryOrder(
      db,
      { tenantId: payload.tenantId, branchId: payload.branchId, orderId: payload.orderId, jobId: job.id },
      { log, config },
    );
  });
}

