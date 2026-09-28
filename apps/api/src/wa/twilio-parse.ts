// Twilio webhook yükü (16 §2.5) → NormalizedWaEvent[]. Twilio JSON değil application/x-www-form-urlencoded gönderir;
// rota ham gövdeyi düz nesneye çevirip wa_webhook_events.payload'a yazar, burası o nesneyi okur.
//
// Gelen mesaj:  MessageSid, From ("whatsapp:+90…"), To, Body, ProfileName, WaId, NumMedia, MediaUrl{N},
//               MediaContentType{N}, Latitude, Longitude, Address, Label, ButtonText, ButtonPayload, ListId, ListTitle,
//               OriginalRepliedMessageSid
// Durum:        MessageSid, MessageStatus, ErrorCode (+ To = alıcı)
//
// Twilio'da BSUID (işletme kapsamlı kullanıcı kimliği) ve Coexistence yankısı (echo) yoktur (16 §6).

import type { NormalizedWaEvent, NormalizedWaMessage, WaRecipient, WaSender } from './types';
import { waIdToE164 } from './parse';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Form alanı: boş dizge "verilmedi" sayılır. */
const f = (b: Obj, key: string): string | undefined => {
  const v = b[key];
  if (typeof v === 'string') return v.trim() ? v : undefined;
  if (typeof v === 'number') return String(v);
  return undefined;
};

/** "whatsapp:+905321234567" → "+905321234567"; kanal öneki yoksa olduğu gibi (E.164'e indirgenir). */
export function twilioAddressToE164(addr: string | undefined): string | undefined {
  if (!addr) return undefined;
  const raw = addr.replace(/^whatsapp:/i, '').trim();
  return waIdToE164(raw);
}

/** Twilio mesaj durumu → NormalizedWaEvent status. Gönderim öncesi durumlar (queued, sending…) olay üretmez. */
export function twilioStatus(v: string | undefined): 'sent' | 'delivered' | 'read' | 'failed' | null {
  switch ((v ?? '').toLowerCase()) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
    case 'undelivered':
    case 'canceled':
      return 'failed';
    default:
      // queued, sending, accepted, scheduled, receiving, received: ara durum, mesaj satırını ilerletmez
      return null;
  }
}

/** Gelen mesajın durum alanı ('received', 'receiving'): durum geri bildirimi değil, müşterinin mesajıdır. */
export function isInboundStatus(v: string | undefined): boolean {
  const s = (v ?? '').toLowerCase();
  return s === 'received' || s === 'receiving';
}

/** MIME türü → NormalizedWaMessage medya türü. */
export function mediaKindOf(contentType: string | undefined): 'image' | 'audio' | 'video' | 'document' | 'sticker' {
  const t = (contentType ?? '').toLowerCase();
  if (t === 'image/webp') return 'sticker';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  return 'document';
}

function messageContent(b: Obj): NormalizedWaMessage {
  const buttonPayload = f(b, 'ButtonPayload');
  if (buttonPayload) return { kind: 'button_reply', id: buttonPayload, title: f(b, 'ButtonText') ?? '' };
  const listId = f(b, 'ListId');
  if (listId) return { kind: 'list_reply', id: listId, title: f(b, 'ListTitle') ?? '' };

  const lat = Number(f(b, 'Latitude'));
  const lng = Number(f(b, 'Longitude'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && (f(b, 'Latitude') !== undefined || f(b, 'Longitude') !== undefined)) {
    return { kind: 'location', lat, lng, name: f(b, 'Label'), address: f(b, 'Address') };
  }

  const numMedia = Number(f(b, 'NumMedia') ?? '0');
  if (Number.isFinite(numMedia) && numMedia > 0) {
    const kind = mediaKindOf(f(b, 'MediaContentType0'));
    const caption = f(b, 'Body');
    // Twilio medyayı kimlikle değil geçici URL ile verir; mediaId yerine URL saklanır (indirme Basic Auth ister)
    return { kind, mediaId: f(b, 'MediaUrl0'), ...(caption ? { caption } : {}) };
  }

  const body = f(b, 'Body');
  if (body) return { kind: 'text', text: body };
  return { kind: 'unsupported', type: f(b, 'MessageType') ?? 'empty' };
}

function senderOf(b: Obj): WaSender {
  const sender: WaSender = {};
  const phone = twilioAddressToE164(f(b, 'From')) ?? waIdToE164(f(b, 'WaId'));
  if (phone) sender.phone = phone;
  const name = f(b, 'ProfileName');
  if (name) sender.name = name;
  return sender;
}

/**
 * Twilio webhook nesnesini normalize olaylara çevirir. Tanınmayan yük boş dizi döner (hata fırlatmaz).
 * `phoneNumberId` olarak Twilio Account SID kullanılır: wa_accounts.phone_number_id twilio yolunda Account SID'dir
 * (16 §3.1), böylece ingest'teki hesap–olay eşleşme denetimi çalışır.
 */
export function parseTwilioWebhook(body: unknown): NormalizedWaEvent[] {
  if (!isObj(body)) return [];
  const b = body;
  const sid = f(b, 'MessageSid') ?? f(b, 'SmsSid') ?? f(b, 'SmsMessageSid');
  if (!sid) return [];
  const accountSid = f(b, 'AccountSid') ?? null;

  // Durum geri bildirimi: giden mesajın MessageStatus/SmsStatus'u. DİKKAT: Twilio GELEN mesaj webhook'unda da
  // SmsStatus=received gönderir; 'received'/'receiving' durum değil gelen mesajdır (canlıda bu yüzden müşteri
  // mesajları olay üretmeden düşüyordu).
  const statusRaw = f(b, 'MessageStatus') ?? f(b, 'SmsStatus');
  if (statusRaw && !isInboundStatus(statusRaw)) {
    const status = twilioStatus(statusRaw);
    if (!status) return [];
    const to: WaRecipient = {};
    const phone = twilioAddressToE164(f(b, 'To'));
    if (phone) to.phone = phone;
    const errorCode = f(b, 'ErrorCode');
    return [
      {
        type: 'status',
        phoneNumberId: accountSid,
        wamid: sid,
        status,
        timestamp: new Date(),
        ...(to.phone ? { recipient: to } : {}),
        ...(errorCode ? { errorCode, errorTitle: f(b, 'ErrorMessage') } : {}),
      },
    ];
  }

  const ctx = f(b, 'OriginalRepliedMessageSid');
  return [
    {
      type: 'message',
      phoneNumberId: accountSid,
      wamid: sid,
      from: senderOf(b),
      timestamp: new Date(),
      message: messageContent(b),
      ...(ctx ? { contextWamid: ctx } : {}),
      raw: b,
    },
  ];
}
