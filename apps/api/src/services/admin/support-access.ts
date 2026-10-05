// Destek erişimi bildirimleri — YAZMA (admin tarafı) ve OKUMA (işletme tarafı).
//
// Denetim bulgusu: impersonation başlarken `notifications` satırı yazılıyordu ama bu satırı hiçbir uç nokta
// okumuyordu, yani işletme destek erişiminden fiilen HİÇ haberdar olmuyordu (00 §4 "işletmeye bildirim",
// 04 §7 destek bandı, 08 §2 madde 4 DPA). Bu dosya kaydın iki ucunu birbirine bağlar:
//   - `supportAccessNotice()`: başlangıç / bitiş / parola sıfırlama satırlarını aynı biçimde yazar.
//   - `loadSupportAccessNotices()`: işletmenin kendi oturumuyla okuyacağı listeyi üretir.
//
// Kurallar:
//   - Gerekçe (`reason`) işletmeye GÖSTERİLMEZ: destek görevlisinin serbest metni müşteri bilgisi içerebilir.
//     İşletmeye giden bilgi 04 §7'deki biçimdir: kim, ne zaman, ne zamana kadar.
//   - "Şu an açık mı" sorusunun tek doğru kaynağı `sessions` tablosudur: 30 dk dolunca oturum sunucuda geçersiz
//     olur ama `end` çağrılmadığı için bitiş satırı yazılmaz. Bu yüzden bant `active`'e bakar, listeye bakmaz.

import type { SupportAccessNotice, SupportAccessNoticesResponse } from '@siparis/core/admin/support-access';
import { notifications, sessions, users, type Database } from '@siparis/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { iso } from './util';

/** `notifications.kind` değerleri (07 §`notifications` sözlüğü). */
export const SUPPORT_ACCESS_KINDS = {
  started: 'support_access_started',
  ended: 'support_access_ended',
  password_reset: 'support_access_password_reset',
} as const;

type NoticeKind = keyof typeof SUPPORT_ACCESS_KINDS;

const KIND_TO_NOTICE: Record<string, NoticeKind> = {
  [SUPPORT_ACCESS_KINDS.started]: 'started',
  [SUPPORT_ACCESS_KINDS.ended]: 'ended',
  [SUPPORT_ACCESS_KINDS.password_reset]: 'password_reset',
};

/** Listede gösterilen en fazla kayıt. */
const NOTICE_LIMIT = 20;

export interface SupportAccessNoticeInput {
  tenantId: string;
  kind: NoticeKind;
  /** Bildirimi görecek işletme kullanıcıları (sahipler). Boşsa işletme çapında tek satır yazılır. */
  recipientUserIds: readonly string[];
  /** Erişen destek görevlisinin adı. */
  supportAgentName: string;
  /** Kişisel veri İÇERMEYEN ek bağlam (oturum kimliği, zaman, kapatan taraf). */
  data?: Record<string, unknown>;
  now?: Date;
}

/**
 * Destek erişimi kaydını `notifications`'a yazar. Çağıran transaction'ı verir: kayıt yazılamazsa erişim de
 * başlamaz / bitmez (impersonation rotasındaki tek transaction kuralı).
 */
export async function supportAccessNotice(tx: Database, input: SupportAccessNoticeInput): Promise<void> {
  const now = input.now ?? new Date();
  const recipients: (string | null)[] = input.recipientUserIds.length ? [...input.recipientUserIds] : [null];
  await tx.insert(notifications).values(
    recipients.map((recipientUserId) => ({
      tenantId: input.tenantId,
      recipientUserId,
      kind: SUPPORT_ACCESS_KINDS[input.kind],
      channel: 'log' as const,
      status: 'sent' as const,
      sentAt: now,
      payload: { supportAgentName: input.supportAgentName, at: now.toISOString(), ...(input.data ?? {}) },
    })),
  );
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Yükteki tarih alanı: biçimi bozuk ya da eksik satır listeyi düşürmez, yalnız null döner. */
function payloadIso(payload: Record<string, unknown>, key: string): string | null {
  const v = payloadString(payload, key);
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * İşletmenin destek erişimi görünümü: şu an açık oturumlar + son kayıtlar.
 * Aynı erişim için sahip başına bir satır yazıldığından liste kullanıcıya göre süzülür (sahip kendi satırlarını
 * ve alıcısı boş olan işletme çapındaki satırları görür).
 */
export async function loadSupportAccessNotices(
  db: Database,
  opts: { tenantId: string; userId: string; now?: Date },
): Promise<SupportAccessNoticesResponse> {
  const now = opts.now ?? new Date();
  const agent = alias(users, 'support_agent');

  const live = await db
    .select({ sessionId: sessions.id, agentName: agent.name, startedAt: sessions.createdAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .leftJoin(agent, eq(agent.id, sessions.impersonatorUserId))
    .where(and(eq(sessions.tenantId, opts.tenantId), eq(sessions.kind, 'impersonation'), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.createdAt));

  // Alıcı süzmesi SQL'de: her erişim için sahip başına bir satır yazılır, çağıran yalnız kendi satırını
  // (ve sahipsiz işletme satırını) görür.
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      payload: notifications.payload,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, opts.tenantId),
        inArray(notifications.kind, Object.values(SUPPORT_ACCESS_KINDS)),
        or(isNull(notifications.recipientUserId), eq(notifications.recipientUserId, opts.userId)),
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTICE_LIMIT);

  const notices: SupportAccessNotice[] = [];
  for (const r of rows) {
    const kind = KIND_TO_NOTICE[r.kind];
    if (!kind) continue;
    notices.push({
      id: r.id,
      kind,
      at: iso(r.createdAt),
      supportAgentName: payloadString(r.payload, 'supportAgentName'),
      expiresAt: payloadIso(r.payload, 'expiresAt'),
    });
  }

  return {
    active: live.map((s) => ({
      sessionId: s.sessionId,
      supportAgentName: s.agentName ?? null,
      startedAt: iso(s.startedAt),
      expiresAt: iso(s.expiresAt),
    })),
    notices,
  };
}
