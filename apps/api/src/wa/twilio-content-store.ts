// Twilio içerik kaynaklarının kalıcı deposu (16 §2.3): wa_content_templates. Süreçler arası tekillik UNIQUE
// (provider, friendly_name) ile sağlanır — iki worker aynı anda kaynak üretirse ikisi de aynı satırda buluşur ve
// geçerli olan (ilk yazılan) kimlik döner. Uygulama açılışında setTwilioContentStore ile takılır (app.ts, worker.ts).

import { waContentTemplates, type Database } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import type { ContentKind, TwilioContentStore } from './twilio-content';

const PROVIDER = 'twilio';

export function createDbTwilioContentStore(db: Database): TwilioContentStore {
  return {
    async get(friendlyName: string): Promise<string | null> {
      const [row] = await db
        .select({ contentSid: waContentTemplates.contentSid })
        .from(waContentTemplates)
        .where(and(eq(waContentTemplates.provider, PROVIDER), eq(waContentTemplates.friendlyName, friendlyName)));
      return row?.contentSid ?? null;
    },

    async put(friendlyName: string, contentSid: string, kind: ContentKind): Promise<string> {
      await db.insert(waContentTemplates).values({ provider: PROVIDER, friendlyName, contentSid, kind }).onConflictDoNothing();
      const [row] = await db
        .select({ contentSid: waContentTemplates.contentSid })
        .from(waContentTemplates)
        .where(and(eq(waContentTemplates.provider, PROVIDER), eq(waContentTemplates.friendlyName, friendlyName)));
      return row?.contentSid ?? contentSid;
    },

    async forget(friendlyName: string): Promise<void> {
      await db
        .delete(waContentTemplates)
        .where(and(eq(waContentTemplates.provider, PROVIDER), eq(waContentTemplates.friendlyName, friendlyName)));
    },
  };
}
