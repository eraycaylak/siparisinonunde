// Cloud API webhook yükü → NormalizedWaEvent[] (02 §7.3, §8.2). 360dialog ve mock (simülatör) aynı biçimi kullanır.
// Alanlar: messages (gelen), statuses (durum), smb_message_echoes (Coexistence echo). request_welcome dahil.
// BSUID: contacts[].user_id / messages[].from_user_id; telefon (wa_id / from) gelmeyebilir.

import type { NormalizedWaEvent, NormalizedWaMessage, WaRecipient, WaSender } from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : typeof v === 'number' ? String(v) : undefined);

/** "905321234567" → "+905321234567" (E.164). */
export function waIdToE164(waId: string | undefined | null): string | undefined {
  if (!waId) return undefined;
  const digits = String(waId).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return undefined;
  return `+${digits}`;
}

function toDate(ts: unknown): Date {
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return new Date();
}

function parseMessageContent(m: Obj): NormalizedWaMessage {
  const type = str(m.type) ?? 'unsupported';
  switch (type) {
    case 'text': {
      const text = isObj(m.text) ? (str(m.text.body) ?? '') : '';
      return { kind: 'text', text };
    }
    case 'interactive': {
      const i = isObj(m.interactive) ? m.interactive : {};
      const itype = str(i.type);
      if (itype === 'button_reply' && isObj(i.button_reply)) {
        return { kind: 'button_reply', id: str(i.button_reply.id) ?? '', title: str(i.button_reply.title) ?? '' };
      }
      if (itype === 'list_reply' && isObj(i.list_reply)) {
        return { kind: 'list_reply', id: str(i.list_reply.id) ?? '', title: str(i.list_reply.title) ?? '' };
      }
      return { kind: 'unsupported', type: `interactive:${itype ?? '?'}` };
    }
    case 'button': {
      // Şablon hızlı yanıt butonu
      const b = isObj(m.button) ? m.button : {};
      return { kind: 'button_reply', id: str(b.payload) ?? '', title: str(b.text) ?? '' };
    }
    case 'location': {
      const l = isObj(m.location) ? m.location : {};
      const lat = Number(l.latitude);
      const lng = Number(l.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { kind: 'unsupported', type: 'location' };
      return { kind: 'location', lat, lng, name: str(l.name), address: str(l.address) };
    }
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'sticker': {
      const media = isObj(m[type]) ? (m[type] as Obj) : {};
      return { kind: type, mediaId: str(media.id), caption: str(media.caption) };
    }
    case 'voice': {
      const media = isObj(m.voice) ? m.voice : {};
      return { kind: 'audio', mediaId: str(media.id) };
    }
    case 'request_welcome':
      return { kind: 'request_welcome' };
    default:
      return { kind: 'unsupported', type };
  }
}

function senderFrom(m: Obj, contacts: Obj[]): WaSender {
  const fromPhone = str(m.from);
  const fromBsuid = str(m.from_user_id);
  // İlgili contact: user_id ya da wa_id eşleşen; yoksa tek contact
  const contact =
    contacts.find((c) => (fromBsuid && str(c.user_id) === fromBsuid) || (fromPhone && str(c.wa_id) === fromPhone)) ??
    (contacts.length === 1 ? contacts[0] : undefined);
  const profile = contact && isObj(contact.profile) ? contact.profile : {};
  const bsuid = fromBsuid ?? (contact ? str(contact.user_id) : undefined);
  // "from" alanı BSUID olabilir (kullanıcı adı açık, telefon yok) — rakam değilse telefon sayılmaz
  const phoneRaw = fromPhone && /^\+?\d+$/.test(fromPhone) ? fromPhone : contact ? str(contact.wa_id) : undefined;
  const sender: WaSender = {};
  if (bsuid) sender.bsuid = bsuid;
  const phone = waIdToE164(phoneRaw);
  if (phone) sender.phone = phone;
  const name = str(profile.name);
  if (name) sender.name = name;
  const username = contact ? (str(contact.username) ?? (isObj(contact.profile) ? str(contact.profile.username) : undefined)) : undefined;
  if (username) sender.username = username;
  return sender;
}

function recipientFromStatus(s: Obj): WaRecipient | undefined {
  const r: WaRecipient = {};
  const bsuid = str(s.recipient_user_id);
  const phone = waIdToE164(str(s.recipient_id));
  if (bsuid) r.bsuid = bsuid;
  if (phone) r.phone = phone;
  return r.bsuid || r.phone ? r : undefined;
}

const STATUS_VALUES = new Set(['sent', 'delivered', 'read', 'failed']);

/** Cloud API webhook gövdesini ayrıştırır; tanınmayan alanları atlar (hata fırlatmaz). */
export function parseCloudWebhook(body: unknown): NormalizedWaEvent[] {
  const events: NormalizedWaEvent[] = [];
  if (!isObj(body)) return events;
  for (const entry of arr(body.entry)) {
    if (!isObj(entry)) continue;
    for (const change of arr(entry.changes)) {
      if (!isObj(change) || !isObj(change.value)) continue;
      const field = str(change.field) ?? 'messages';
      const value = change.value;
      const metadata = isObj(value.metadata) ? value.metadata : {};
      const phoneNumberId = str(metadata.phone_number_id) ?? null;
      const contacts = arr(value.contacts).filter(isObj);

      if (field === 'messages') {
        for (const m of arr(value.messages)) {
          if (!isObj(m)) continue;
          const wamid = str(m.id);
          if (!wamid) continue;
          const ctx = isObj(m.context) ? m.context : null;
          events.push({
            type: 'message',
            phoneNumberId,
            wamid,
            from: senderFrom(m, contacts),
            timestamp: toDate(m.timestamp),
            message: parseMessageContent(m),
            ...(ctx && str(ctx.id) ? { contextWamid: str(ctx.id) } : {}),
            ...(isObj(m.referral) ? { referral: m.referral } : {}),
            raw: m,
          });
        }
        for (const s of arr(value.statuses)) {
          if (!isObj(s)) continue;
          const wamid = str(s.id);
          const status = str(s.status);
          if (!wamid || !status || !STATUS_VALUES.has(status)) continue;
          const err = arr(s.errors).find(isObj);
          const pricing = isObj(s.pricing) ? s.pricing : null;
          events.push({
            type: 'status',
            phoneNumberId,
            wamid,
            status: status as 'sent' | 'delivered' | 'read' | 'failed',
            timestamp: toDate(s.timestamp),
            recipient: recipientFromStatus(s),
            ...(err ? { errorCode: str(err.code), errorTitle: str(err.title) ?? str(err.message) } : {}),
            ...(pricing
              ? {
                  pricing: {
                    category: str(pricing.category),
                    billable: typeof pricing.billable === 'boolean' ? pricing.billable : undefined,
                    pricingModel: str(pricing.pricing_model),
                    type: str(pricing.type),
                  },
                }
              : {}),
          });
        }
      } else if (field === 'smb_message_echoes') {
        for (const e of arr(value.message_echoes)) {
          if (!isObj(e)) continue;
          const wamid = str(e.id);
          if (!wamid) continue;
          const to: WaRecipient = {};
          const bsuid = str(e.to_user_id);
          const phone = waIdToE164(str(e.to));
          if (bsuid) to.bsuid = bsuid;
          if (phone) to.phone = phone;
          if (!to.bsuid && !to.phone) continue;
          const type = str(e.type) ?? 'text';
          events.push({
            type: 'echo',
            phoneNumberId,
            wamid,
            to,
            timestamp: toDate(e.timestamp),
            ...(type === 'text' && isObj(e.text) ? { text: str(e.text.body) ?? '' } : {}),
            messageType: type,
          });
        }
      }
      // Diğer alanlar (şablon durumu, kalite, account_update, history) Faz 1'de işlenmez.
    }
  }
  return events;
}
