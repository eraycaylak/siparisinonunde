// Zamanlanmış işler (registerCron ile). Temel bakım işleri jobs/system'dedir.
// Buradaki işler: duraklatma bitişi, panel çevrimdışı dedektörü, alarm zinciri emniyet ağı (`order_new_watch`,
// 06 §7.6/§8.5) ve DLQ gözcüsü (`jobs_dlq_watch`: kalıcı başarısız iş birikmesi uyarısı; saklama/maskeleme
// `jobs/system` içindeki `cron.retention` koşusundadır).
// Burada: registerJobHandler(type, handler), registerCron({...}) ve onOrderTransition/onOrderCreated abonelikleri.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir (tekrar çağrı güvenli).

import { branches, orders, type Database } from '@siparis/db';
import { and, eq, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { alert, type AlertContext } from '../../lib/alert';
import { enqueueJob, generationKey, registerCron, registerJobHandler } from '../../lib/jobs';
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
        sql`coalesce(${orders.verifiedAt}, ${orders.placedAt}) >= ${since.toISOString()}::timestamptz`,
      ),
    );

  const result: OrderNewWatchResult = { requeued: 0, orderIds: [], exhausted: [] };
  for (const o of candidates) {
    const rows = (await db.execute<AlarmJobRow>(sql`
      select payload->>'step' as step, payload->>'gen' as gen, status from jobs
       where type = 'order.alarm_step' and payload->>'orderId' = ${o.id}`)) as unknown as AlarmJobRow[];
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

/** Kalıcı başarısız (`failed`) iş sayısı bunu aşarsa uyarı gider. */
export const DLQ_ALERT_THRESHOLD = 10;
/** DLQ uyarısı en sık bu aralıkla tekrarlanır. */
export const DLQ_ALERT_COOLDOWN_MS = 60 * 60_000;

/**
 * DLQ'da bekleyen (`failed`) iş sayısı.
 *
 * Saklama ve maskeleme BURADA YAPILMAZ: `failed` işin yükündeki kişisel veriyi maskeleyen (30 gün) ve satırı silen
 * (90 gün) adımlar `jobs/system` içindeki `cron.retention` koşusundadır — `retention.technical.jobs.failed_payload`
 * ve `retention.technical.jobs.failed` (07 §9, 08 §2.8 satır 22, süreler `RETENTION_DAYS`). Aynı satırlar için
 * burada ikinci bir saklama penceresi açılmaz: kısa olan pencere operatörün yapılandırdığı süreyi sessizce
 * geçersiz kılar ve imha tutanağında (`retention_runs`) aynı iş iki ayrı adla görünürdü.
 */
export async function countFailedJobs(db: Database): Promise<number> {
  const [row] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from jobs where status = 'failed'`)) as unknown as { n: number }[];
  return Number(row?.n ?? 0);
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

  // DLQ gözcüsü (denetim H21/H26): kalıcı başarısız iş birikmesi uyarısı (saklama `cron.retention`'dadır)
  registerJobHandler('cron.jobs_dlq_watch', async (_payload, { db, config, log }) => {
    const failed = await countFailedJobs(db);
    if (failed <= DLQ_ALERT_THRESHOLD) return;
    // Hangi iş türleri birikti: tür adı kişisel veri değildir, yük GÖNDERİLMEZ
    const types = (await db.execute<{ type: string; n: number }>(sql`
      select type, count(*)::int as n from jobs where status = 'failed' group by type order by n desc limit 10`)) as unknown as {
      type: string;
      n: number;
    }[];
    alert(
      { log, config },
      {
        kind: 'jobs_dlq_threshold',
        severity: 'critical',
        message: `${failed} iş kalıcı olarak başarısız durumda (DLQ eşiği ${DLQ_ALERT_THRESHOLD}).`,
        data: { failed, types: types.map((t) => `${t.type}=${t.n}`) },
        dedupeKey: 'jobs_dlq_threshold',
        cooldownMs: DLQ_ALERT_COOLDOWN_MS,
      },
    );
  });
  registerCron({ name: 'jobs_dlq_watch', type: 'cron.jobs_dlq_watch', schedule: { everyMinutes: 15 } });
}
