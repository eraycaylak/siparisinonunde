// Feature flag ve kill-switch'ler (05 A-13; 00 §4): GET/PATCH /admin/flags. Kapatma gerekçeli + audit.

import { adminFlagPatchSchema, adminFlagSchema, adminFlagsResponseSchema, type AdminFlag } from '@siparis/core/admin/contracts';
import { KILL_SWITCHES, KILL_SWITCH_LABELS, type KillSwitch } from '@siparis/core';
import { featureFlags, users, type Database } from '@siparis/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError, notFound } from '../../lib/errors';
import { adminActor, adminAudit, isoOrNull, requireAdmin } from '../../services/admin/util';

/** Kill-switch olmayan bilinen bayrakların etiketleri. */
const OTHER_FLAG_LABELS: Record<string, string> = {
  platform_wa_alerts: 'Platform WhatsApp uyarıları',
};

const isKillSwitch = (key: string): key is KillSwitch => (KILL_SWITCHES as readonly string[]).includes(key);

function labelFor(key: string): string {
  return isKillSwitch(key) ? KILL_SWITCH_LABELS[key] : (OTHER_FLAG_LABELS[key] ?? key);
}

async function loadFlags(db: Database): Promise<AdminFlag[]> {
  const list = await db
    .select({ f: featureFlags, updatedByName: users.name })
    .from(featureFlags)
    .leftJoin(users, eq(users.id, featureFlags.updatedByUserId))
    .orderBy(asc(featureFlags.kind), asc(featureFlags.key));
  const items: AdminFlag[] = list.map(({ f, updatedByName }) => ({
    key: f.key,
    enabled: f.enabled,
    kind: f.kind,
    label: labelFor(f.key),
    description: f.description ?? null,
    persisted: true,
    updatedAt: isoOrNull(f.updatedAt),
    updatedByName: updatedByName ?? null,
  }));
  // Kaydı olmayan kill-switch'ler varsayılan açıktır (lib/flags.ts)
  for (const key of KILL_SWITCHES) {
    if (!items.some((i) => i.key === key)) {
      items.push({ key, enabled: true, kind: 'kill_switch', label: labelFor(key), description: null, persisted: false, updatedAt: null, updatedByName: null });
    }
  }
  const order = (i: AdminFlag) => (i.kind === 'kill_switch' ? 0 : i.kind === 'ops' ? 1 : 2);
  items.sort((a, b) => order(a) - order(b) || a.key.localeCompare(b.key));
  return items;
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/flags',
    { preHandler: requireAdmin('flags:read'), schema: { response: { 200: adminFlagsResponseSchema } } },
    async () => ({ items: await loadFlags(app.db) }),
  );

  // PATCH /admin/flags {key, enabled, reason?} — kill-switch kapatırken gerekçe zorunlu
  app.patch(
    '/flags',
    { preHandler: requireAdmin('flags:write'), schema: { body: adminFlagPatchSchema, response: { 200: adminFlagSchema } } },
    async (request) => {
      const actor = adminActor(request);
      const { key, enabled } = request.body;
      const reason = request.body.reason?.trim() || null;

      await app.db.transaction(async (tx) => {
        const [before] = await tx.select().from(featureFlags).where(eq(featureFlags.key, key)).for('update');
        if (!before && !isKillSwitch(key)) throw notFound('Bayrak bulunamadı.');
        const kind = before?.kind ?? 'kill_switch';
        const wasEnabled = before?.enabled ?? true;
        if (kind === 'kill_switch' && !enabled && wasEnabled && (!reason || reason.length < 10)) {
          throw new AppError(400, 'reason_required', 'Acil durdurma anahtarını kapatmak için en az 10 karakterlik gerekçe yazın.', {
            issues: [{ path: '/reason', message: 'Gerekçe en az 10 karakter olmalı.' }],
          });
        }
        if (before) {
          await tx.update(featureFlags).set({ enabled, updatedByUserId: actor.userId }).where(eq(featureFlags.key, key));
        } else {
          await tx.insert(featureFlags).values({ key, enabled, kind: 'kill_switch', updatedByUserId: actor.userId });
        }
        await adminAudit(tx, actor, {
          action: 'admin.flag_update',
          entityType: 'feature_flag',
          entityId: key,
          data: { kind, before: wasEnabled, after: enabled, reason },
        });
      });

      const flag = (await loadFlags(app.db)).find((f) => f.key === key);
      if (!flag) throw notFound('Bayrak bulunamadı.');
      return flag;
    },
  );
};

export default routes;
