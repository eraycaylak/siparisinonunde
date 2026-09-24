// Özellik bayrakları ve kill-switch'ler (00 §4). Kayıt yoksa açık kabul edilir.

import type { KillSwitch } from '@siparis/core';
import { featureFlags, type Database } from '@siparis/db';
import { eq } from 'drizzle-orm';

export async function isFlagEnabled(db: Database, key: KillSwitch | (string & {})): Promise<boolean> {
  const [row] = await db.select({ enabled: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, key));
  return row ? row.enabled : true;
}
