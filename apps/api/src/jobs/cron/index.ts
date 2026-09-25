// Zamanlanmış işler (registerCron ile). Temel bakım işleri jobs/system'dedir.
// Burada: registerJobHandler(type, handler), registerCron({...}) ve onOrderTransition/onOrderCreated abonelikleri.
// Bu fonksiyon hem API hem worker sürecinde çağrılır; kayıtlar ada göre tekildir (tekrar çağrı güvenli).

import { branches, type Database } from '@siparis/db';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { registerCron, registerJobHandler } from '../../lib/jobs';
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

export function registerCronJobs(): void {
  registerJobHandler('cron.branch_pause_end', async (_payload, { db, log }) => {
    const n = await publishExpiredPauses(db);
    if (n) log.info({ branches: n }, 'süresi dolan duraklatmalar yayınlandı');
  });
  registerCron({ name: 'branch_pause_end', type: 'cron.branch_pause_end', schedule: { everyMinutes: 1 } });

  // Panel çevrimdışı dedektörü (06 §7.7): sipariş alan şubede sipariş ekranı 5 dk'dır görülmüyorsa sahibine
  // platform.alert `panel_offline` (şube başına 60 dk'da en çok 1)
  registerJobHandler('cron.panel_presence', async (_payload, { db, log }) => {
    const alerts = await detectOfflinePanels(db);
    if (alerts.length) log.warn({ branches: alerts.map((a) => a.branchId) }, 'panel çevrimdışı uyarısı kuyruğa atıldı');
  });
  registerCron({ name: 'panel_presence', type: 'cron.panel_presence', schedule: { everyMinutes: 1 } });
}
