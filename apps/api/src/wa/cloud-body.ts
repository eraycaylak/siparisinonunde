// Cloud API biçimli giden mesaj gövdeleri (POST /{phone_number_id}/messages). 360dialog aynı gövdeyi kullanır.
// Sınırlar (03 §9.1, teyit edilmeli): reply buton başlığı ≤ 20, en çok 3 buton; liste satırı ≤ 24; gövde ≤ 1.024;
// üst/alt bilgi ≤ 60; CTA metni ≤ 20.

import type { WaInteractiveMessage, WaRecipient, WaTemplateButton } from './types';
import { WaSendError } from './errors';

export const LIMITS = {
  body: 1024,
  headerFooter: 60,
  buttonTitle: 20,
  maxButtons: 3,
  listRowTitle: 24,
  listRowDescription: 72,
  listButton: 20,
  ctaLabel: 20,
} as const;

export type CloudMessageBody = Record<string, unknown> & { messaging_product: 'whatsapp'; type: string };

/** Uzunluğu sınırla (sondaki fazlalık "…" ile). */
export function clip(text: string, max: number): string {
  const t = text ?? '';
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Alıcı alanı: WhatsApp kaynaklı telefon varsa telefona (Meta önerisi), yoksa BSUID'ye (02 §8.2).
 * BSUID'ye gönderimde istek alan adı "recipient" (teyit edilmeli).
 */
export function recipientFields(to: WaRecipient): Record<string, string> {
  if (to.phone) return { to: to.phone.replace(/\D/g, '') };
  if (to.bsuid) return { recipient: to.bsuid };
  throw new WaSendError('no_recipient', 'Alıcı telefonu ya da BSUID yok.', { retryable: false });
}

function base(to: WaRecipient, type: string): CloudMessageBody {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', ...recipientFields(to), type };
}

export function textBody(to: WaRecipient, text: string): CloudMessageBody {
  return { ...base(to, 'text'), text: { body: clip(text, 4096), preview_url: false } };
}

function headerFooter(msg: WaInteractiveMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (msg.header) out.header = { type: 'text', text: clip(msg.header, LIMITS.headerFooter) };
  if (msg.footer) out.footer = { text: clip(msg.footer, LIMITS.headerFooter) };
  return out;
}

export function interactiveBody(to: WaRecipient, msg: WaInteractiveMessage): CloudMessageBody {
  const body = { text: clip(msg.body, LIMITS.body) };
  switch (msg.kind) {
    case 'buttons': {
      const buttons = (msg.buttons ?? []).slice(0, LIMITS.maxButtons);
      if (!buttons.length) throw new WaSendError('invalid_message', 'Butonlu mesajda buton yok.', { retryable: false });
      return {
        ...base(to, 'interactive'),
        interactive: {
          type: 'button',
          ...headerFooter(msg),
          body,
          action: { buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: clip(b.title, LIMITS.buttonTitle) } })) },
        },
      };
    }
    case 'cta_url': {
      if (!msg.url) throw new WaSendError('invalid_message', 'CTA mesajında bağlantı yok.', { retryable: false });
      return {
        ...base(to, 'interactive'),
        interactive: {
          type: 'cta_url',
          ...headerFooter(msg),
          body,
          action: { name: 'cta_url', parameters: { display_text: clip(msg.url.label, LIMITS.ctaLabel), url: msg.url.href } },
        },
      };
    }
    case 'list': {
      if (!msg.list) throw new WaSendError('invalid_message', 'Liste mesajında satır yok.', { retryable: false });
      return {
        ...base(to, 'interactive'),
        interactive: {
          type: 'list',
          ...headerFooter(msg),
          body,
          action: {
            button: clip(msg.list.buttonTitle, LIMITS.listButton),
            sections: msg.list.sections.map((s) => ({
              ...(s.title ? { title: clip(s.title, LIMITS.listRowTitle) } : {}),
              rows: s.rows.slice(0, 10).map((r) => ({
                id: r.id.slice(0, 200),
                title: clip(r.title, LIMITS.listRowTitle),
                ...(r.description ? { description: clip(r.description, LIMITS.listRowDescription) } : {}),
              })),
            })),
          },
        },
      };
    }
    case 'location_request':
      return {
        ...base(to, 'interactive'),
        interactive: { type: 'location_request_message', body, action: { name: 'send_location' } },
      };
  }
}

export function templateBody(
  to: WaRecipient,
  name: string,
  lang: 'tr',
  params: string[],
  buttons: WaTemplateButton[] = [],
): CloudMessageBody {
  const components: Record<string, unknown>[] = [];
  if (params.length) {
    // Değişkende satır sonu olmaz (02 §5.2)
    components.push({ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p).replace(/\s*\n+\s*/g, ' ') })) });
  }
  for (const b of buttons) {
    components.push({
      type: 'button',
      sub_type: b.type === 'url' ? 'url' : 'quick_reply',
      index: String(b.index),
      parameters: [b.type === 'url' ? { type: 'text', text: b.param } : { type: 'payload', payload: b.param }],
    });
  }
  return { ...base(to, 'template'), template: { name, language: { code: lang }, ...(components.length ? { components } : {}) } };
}
