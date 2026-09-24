// Cloud API biçimli webhook yükü üretici (dev simülatörü ve testler). Gerçek Meta yüküyle aynı alanlar:
// entry[].changes[].value.{metadata, contacts, messages | statuses | message_echoes}.

import { randomUUID } from 'node:crypto';

export interface DevSender {
  phone?: string | null;
  name?: string | null;
  bsuid?: string | null;
  username?: string | null;
}

export type DevInboundMessage =
  | { type: 'text'; text: string }
  | { type: 'button_reply'; id: string; title?: string }
  | { type: 'list_reply'; id: string; title?: string }
  | { type: 'location'; lat: number; lng: number; name?: string; address?: string }
  | { type: 'audio' | 'image' | 'video' | 'document' | 'sticker'; caption?: string }
  | { type: 'unsupported' }
  | { type: 'request_welcome' };

export interface DevAccount {
  phoneNumberId: string | null;
  displayPhone: string | null;
  wabaId: string | null;
}

const digits = (p: string | null | undefined) => (p ? p.replace(/\D/g, '') : undefined);
const ts = (d: Date) => String(Math.floor(d.getTime() / 1000));

function envelope(acc: DevAccount, field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: acc.wabaId ?? 'dev-waba',
        changes: [
          {
            field,
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: digits(acc.displayPhone) ?? '', phone_number_id: acc.phoneNumberId ?? '' },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function messageObject(m: DevInboundMessage): Record<string, unknown> {
  switch (m.type) {
    case 'text':
      return { type: 'text', text: { body: m.text } };
    case 'button_reply':
      return { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: m.id, title: m.title ?? m.id } } };
    case 'list_reply':
      return { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: m.id, title: m.title ?? m.id } } };
    case 'location':
      return { type: 'location', location: { latitude: m.lat, longitude: m.lng, ...(m.name ? { name: m.name } : {}), ...(m.address ? { address: m.address } : {}) } };
    case 'audio':
    case 'image':
    case 'video':
    case 'document':
    case 'sticker':
      return { type: m.type, [m.type]: { id: `dev-media-${randomUUID()}`, mime_type: 'application/octet-stream', ...('caption' in m && m.caption ? { caption: m.caption } : {}) } };
    case 'unsupported':
      return { type: 'unsupported', errors: [{ code: 131051, title: 'Message type unknown' }] };
    case 'request_welcome':
      return { type: 'request_welcome' };
  }
}

/** Gelen müşteri mesajı yükü. */
export function buildInboundPayload(
  acc: DevAccount,
  from: DevSender,
  message: DevInboundMessage,
  opts: { wamid?: string; at?: Date } = {},
): { payload: Record<string, unknown>; wamid: string } {
  const wamid = opts.wamid ?? `wamid.dev.${randomUUID()}`;
  const at = opts.at ?? new Date();
  const phone = digits(from.phone);
  const contact: Record<string, unknown> = { profile: { name: from.name ?? '' } };
  if (phone) contact.wa_id = phone;
  if (from.bsuid) contact.user_id = from.bsuid;
  if (from.username) contact.username = from.username;
  const msg: Record<string, unknown> = { id: wamid, timestamp: ts(at), ...messageObject(message) };
  if (phone) msg.from = phone;
  else if (from.bsuid) msg.from = from.bsuid;
  if (from.bsuid) msg.from_user_id = from.bsuid;
  return { payload: envelope(acc, 'messages', { contacts: [contact], messages: [msg] }), wamid };
}

/** Coexistence echo yükü (işletme telefonundan müşteriye yazılan). */
export function buildEchoPayload(acc: DevAccount, to: DevSender, text: string, opts: { wamid?: string; at?: Date } = {}) {
  const wamid = opts.wamid ?? `wamid.echo.${randomUUID()}`;
  const at = opts.at ?? new Date();
  const echo: Record<string, unknown> = {
    from: digits(acc.displayPhone) ?? '',
    id: wamid,
    timestamp: ts(at),
    type: 'text',
    text: { body: text },
  };
  const phone = digits(to.phone);
  if (phone) echo.to = phone;
  if (to.bsuid) echo.to_user_id = to.bsuid;
  return { payload: envelope(acc, 'smb_message_echoes', { message_echoes: [echo] }), wamid };
}

/** Durum yükü (sent/delivered/read/failed). */
export function buildStatusPayload(
  acc: DevAccount,
  s: { wamid: string; status: 'sent' | 'delivered' | 'read' | 'failed'; recipientPhone?: string | null; recipientBsuid?: string | null; errorCode?: number; at?: Date },
) {
  const st: Record<string, unknown> = { id: s.wamid, status: s.status, timestamp: ts(s.at ?? new Date()) };
  if (s.recipientPhone) st.recipient_id = digits(s.recipientPhone);
  if (s.recipientBsuid) st.recipient_user_id = s.recipientBsuid;
  if (s.errorCode) st.errors = [{ code: s.errorCode, title: 'Hata' }];
  if (s.status !== 'failed') st.pricing = { billable: true, pricing_model: 'PMP', category: 'service', type: 'regular' };
  return envelope(acc, 'messages', { statuses: [st] });
}
