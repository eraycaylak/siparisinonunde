// Mesaj ve konuşma görünümleri (panel sohbetleri ve dev simülatörü ortak).

import { z } from 'zod';
import type { messages } from '@siparis/db';
import type { OutboundPayload } from './outbound';

export type MessageRow = typeof messages.$inferSelect;

export const messageViewSchema = z.object({
  id: z.string(),
  direction: z.enum(['in', 'out']),
  kind: z.string(),
  body: z.string().nullable(),
  code: z.string().nullable(),
  sentBy: z.string().nullable(),
  sentByUserId: z.string().nullable(),
  sentByName: z.string().nullable().optional(),
  status: z.string().nullable(),
  errorCode: z.string().nullable(),
  templateName: z.string().nullable(),
  orderId: z.string().nullable(),
  orderNumber: z.number().int().nullable().optional(),
  createdAt: z.string(),
  buttons: z.array(z.object({ id: z.string(), title: z.string() })).optional(),
  cta: z.object({ label: z.string(), url: z.string() }).optional(),
  list: z
    .object({
      buttonTitle: z.string(),
      rows: z.array(z.object({ id: z.string(), title: z.string(), description: z.string().optional() })),
    })
    .optional(),
  location: z.object({ lat: z.number(), lng: z.number(), name: z.string().nullable().optional() }).optional(),
  locationRequest: z.boolean().optional(),
  /** Gelen buton/liste yanıtının kimliği */
  replyId: z.string().optional(),
});
export type MessageView = z.infer<typeof messageViewSchema>;

type Obj = Record<string, unknown>;

export function toMessageView(row: MessageRow, extra: { sentByName?: string | null; orderNumber?: number | null } = {}): MessageView {
  const payload = (row.payload ?? {}) as Obj;
  const view: MessageView = {
    id: row.id,
    direction: row.direction,
    kind: row.kind,
    body: row.body,
    code: row.direction === 'out' ? (((payload as unknown as OutboundPayload).code as string | null | undefined) ?? null) : null,
    sentBy: row.sentBy,
    sentByUserId: row.sentByUserId,
    sentByName: extra.sentByName ?? null,
    status: row.status,
    errorCode: row.errorCode,
    templateName: row.templateName,
    orderId: row.orderId,
    orderNumber: extra.orderNumber ?? null,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.direction === 'out') {
    const spec = (payload as unknown as OutboundPayload).spec;
    if (spec?.type === 'interactive') {
      const i = spec.interactive;
      if (i.kind === 'buttons' && i.buttons?.length) view.buttons = i.buttons.map((b) => ({ id: b.id, title: b.title }));
      if (i.kind === 'cta_url' && i.url) view.cta = { label: i.url.label, url: i.url.href };
      if (i.kind === 'list' && i.list) {
        view.list = { buttonTitle: i.list.buttonTitle, rows: i.list.sections.flatMap((s) => s.rows.map((r) => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) }))) };
      }
      if (i.kind === 'location_request') view.locationRequest = true;
    }
    if (spec?.type === 'template' && spec.buttons?.length) {
      // Şablon URL butonu (takip): gösterim için
      const token = spec.buttons.find((b) => b.type === 'url')?.param;
      if (token) view.cta = { label: spec.name === 'siparis_teslim_v1' ? 'Değerlendir' : 'Siparişi takip et', url: `/t/${token}` };
    }
  } else {
    if (typeof payload.id === 'string') view.replyId = payload.id;
    if (row.kind === 'location' && typeof payload.lat === 'number' && typeof payload.lng === 'number') {
      view.location = { lat: payload.lat, lng: payload.lng, name: (payload.name as string | null) ?? null };
    }
  }
  return view;
}
