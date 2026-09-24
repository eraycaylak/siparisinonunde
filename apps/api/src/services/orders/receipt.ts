// Fiş (04 §4.14, 00 §7 "Fişte kişisel veri"): mutfak fişi fiyatsız ve kişisel verisiz; paket (kasa/kurye) fişinde
// adres ve tarif tam, telefon maskeli (son 4 hane). JSON + basit yazdırılabilir HTML (80 mm).

import {
  FULFILLMENT_TYPE_LABELS,
  MEAL_CARD_BRAND_LABELS,
  PAYMENT_METHOD_LABELS,
  formatClockTR,
  formatPhone,
  formatTL,
  maskPhone,
} from '@siparis/core';
import { RECEIPT_TYPES, receiptSchema, type Receipt, type ReceiptType } from '@siparis/core/orders/contracts';
import { DEFAULT_RECEIPT_SETTINGS, receiptSettingsSchema, type ReceiptSettingsDto } from '@siparis/core/settings/contracts';
import type { ItemWithOptions } from './panel-dto';
import type { OrderRow } from './summary';

/** "Soğansız", "Acısız" gibi çıkarılacaklar büyük harf + kalın basılır (04 §4.4). */
export function isRemovalOption(text: string): boolean {
  return /s[ıiuü]z$/iu.test(text.trim());
}

export const RECEIPT_WA_LINE = 'Bir sonraki siparişinizi WhatsApp’tan verin';

/**
 * branches.receipt_settings (jsonb, snake_case) → varsayılanlarla birleşik, doğrulanmış ayar. Bozuk/bilinmeyen
 * değerler yok sayılır (varsayılan kullanılır).
 */
export function resolveReceiptSettings(raw: unknown): Required<ReceiptSettingsDto> {
  const out: Required<ReceiptSettingsDto> = { ...DEFAULT_RECEIPT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const shape = receiptSettingsSchema.shape;
  for (const key of Object.keys(shape) as (keyof ReceiptSettingsDto)[]) {
    const parsed = shape[key].safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success && parsed.data !== undefined) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

export function buildReceipt(input: {
  type: ReceiptType;
  order: OrderRow;
  items: ItemWithOptions[];
  business: { name: string; branchName: string | null; phone: string | null; timezone?: string | null };
  copy: boolean;
  trackingUrl: string | null;
  /** branches.receipt_settings (ham jsonb) */
  settings?: unknown;
  /** Bağlı WhatsApp numarası (E.164); yoksa WhatsApp satırı basılmaz */
  waPhone?: string | null;
  now?: Date;
}): Receipt {
  const { order, type } = input;
  const tz = input.business.timezone ?? undefined;
  const kitchen = type === 'kitchen';
  const st = resolveReceiptSettings(input.settings);
  const footerText = st.footer_text.trim();
  const changeKurus =
    order.paymentMethod === 'cash_on_delivery' && order.changeForKurus && order.changeForKurus > order.totalKurus
      ? order.changeForKurus - order.totalKurus
      : null;
  const payLabel =
    order.paymentMethod === 'meal_card_on_delivery' && order.mealCardBrand
      ? `${PAYMENT_METHOD_LABELS[order.paymentMethod]} · ${MEAL_CARD_BRAND_LABELS[order.mealCardBrand]}`
      : PAYMENT_METHOD_LABELS[order.paymentMethod];
  return {
    type,
    copy: input.copy,
    business: { name: input.business.name, branchName: input.business.branchName, phone: kitchen ? null : input.business.phone },
    number: order.number,
    placedAt: formatClockTR(order.placedAt, tz),
    printedAt: formatClockTR(input.now ?? new Date(), tz),
    fulfillmentType: order.fulfillmentType,
    fulfillmentLabel: FULFILLMENT_TYPE_LABELS[order.fulfillmentType],
    estimatedReadyAt: order.estimatedReadyAt ? formatClockTR(order.estimatedReadyAt, tz) : null,
    items: input.items.map((i) => ({
      quantity: i.quantity,
      name: i.name,
      options: i.options.map((o) => ({ text: o.optionName, removal: isRemovalOption(o.optionName) })),
      note: i.note,
      ...(kitchen ? {} : { lineTotalKurus: i.lineTotalKurus }),
    })),
    note: order.note,
    wantsCutlery: order.wantsCutlery,
    customer: kitchen
      ? null
      : {
          name: order.customerName,
          phoneMasked: order.customerPhone ? maskPhone(order.customerPhone) : null,
          neighborhood: order.fulfillmentType === 'delivery' ? order.neighborhood : null,
          addressLine: order.fulfillmentType === 'delivery' ? order.addressLine : null,
          directions: order.fulfillmentType === 'delivery' ? order.directions : null,
          zoneName: order.zoneName,
        },
    totals: kitchen
      ? null
      : { subtotalKurus: order.subtotalKurus, deliveryFeeKurus: order.deliveryFeeKurus, totalKurus: order.totalKurus },
    payment: kitchen ? null : { method: order.paymentMethod, label: payLabel, changeForKurus: order.changeForKurus, changeKurus },
    trackingUrl: kitchen ? null : input.trackingUrl,
    footer: kitchen ? 'MUTFAK FİŞİ' : 'Mali değeri yoktur.',
    layout: { widthMm: st.width_mm, fontSize: st.font_size, copies: st.copies, showLogo: st.show_logo },
    waLine: !kitchen && st.show_wa_line && input.waPhone ? `${RECEIPT_WA_LINE}: ${formatPhone(input.waPhone)}` : null,
    footerText: !kitchen && footerText ? footerText : null,
    printPlan: { auto: st.auto_print, kitchen: st.print_kitchen, delivery: st.print_delivery },
  };
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const up = (s: string) => s.toLocaleUpperCase('tr-TR');

/**
 * 80 mm (ya da 58 mm) yazdırılabilir HTML; tarayıcıdan window.print ile basılır. Genişlik verilmezse fiş ayarı;
 * yazı boyutu, kopya sayısı (sayfa sonuyla tekrar), işletme adı boyutu, WhatsApp satırı ve alt bilgi fiş ayarından.
 */
export function renderReceiptHtml(r: Receipt, widthMm: 58 | 80 = r.layout.widthMm): string {
  const lines: string[] = [];
  lines.push(`<div class="c b${r.layout.showLogo ? ' big' : ''}">${esc(r.business.name)}</div>`);
  if (r.copy) lines.push('<div class="c b big">KOPYA</div>');
  lines.push(`<div class="c huge">#${r.number}</div>`);
  lines.push(`<div class="c b">${esc(up(r.fulfillmentLabel))}</div>`);
  lines.push(`<div class="c">Sipariş ${esc(r.placedAt)}${r.estimatedReadyAt ? ` · Hedef ${esc(r.estimatedReadyAt)}` : ''}</div>`);
  lines.push('<hr>');
  for (const i of r.items) {
    const price = i.lineTotalKurus != null ? `<span class="r">${esc(formatTL(i.lineTotalKurus))}</span>` : '';
    lines.push(`<div class="item"><span class="b">${i.quantity}× ${esc(i.name)}</span>${price}</div>`);
    for (const o of i.options) lines.push(`<div class="opt${o.removal ? ' b rm' : ''}">${o.removal ? esc(up(o.text)) : esc(o.text)}</div>`);
    if (i.note) lines.push(`<div class="note">Not: ${esc(i.note)}</div>`);
  }
  if (r.note) lines.push(`<hr><div class="note b">Sipariş notu: ${esc(r.note)}</div>`);
  if (r.wantsCutlery) lines.push('<div>Çatal-bıçak isteniyor</div>');
  if (r.customer) {
    lines.push('<hr>');
    if (r.customer.name) lines.push(`<div class="b">${esc(r.customer.name)}</div>`);
    if (r.customer.phoneMasked) lines.push(`<div>Tel: ${esc(r.customer.phoneMasked)}</div>`);
    if (r.customer.neighborhood) lines.push(`<div>${esc(r.customer.neighborhood)} Mah.</div>`);
    if (r.customer.addressLine) lines.push(`<div>${esc(r.customer.addressLine)}</div>`);
    if (r.customer.directions) lines.push(`<div class="b">Tarif: ${esc(r.customer.directions)}</div>`);
  }
  if (r.totals) {
    lines.push('<hr>');
    lines.push(`<div class="item"><span>Ara toplam</span><span class="r">${esc(formatTL(r.totals.subtotalKurus))}</span></div>`);
    if (r.totals.deliveryFeeKurus) {
      lines.push(`<div class="item"><span>Teslimat</span><span class="r">${esc(formatTL(r.totals.deliveryFeeKurus))}</span></div>`);
    }
    lines.push(`<div class="item b big"><span>TOPLAM (KDV dahil)</span><span class="r">${esc(formatTL(r.totals.totalKurus))}</span></div>`);
  }
  if (r.payment) {
    lines.push(`<div class="b">${esc(up(r.payment.label))}</div>`);
    if (r.payment.changeForKurus && r.payment.changeKurus) {
      lines.push(`<div>${esc(formatTL(r.payment.changeForKurus))}'ye para üstü: ${esc(formatTL(r.payment.changeKurus))}</div>`);
    }
  }
  if (r.waLine || r.footerText) {
    lines.push('<hr>');
    if (r.waLine) lines.push(`<div class="c">${esc(r.waLine)}</div>`);
    if (r.footerText) lines.push(`<div class="c pre">${esc(r.footerText)}</div>`);
  }
  lines.push(`<hr><div class="c small">${esc(r.footer)} · ${esc(r.printedAt)}</div>`);
  const body = lines.join('\n');
  const copies = Array.from({ length: r.layout.copies }, (_, i) => `<section class="copy${i > 0 ? ' pb' : ''}">${body}</section>`);
  const fontPx = r.layout.fontSize === 'large' ? 15 : 13;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Fiş #${r.number}</title>
<style>
@page { size: ${widthMm}mm auto; margin: 2mm; }
body { width: ${widthMm - 4}mm; margin: 0 auto; font: ${fontPx}px/1.35 system-ui, sans-serif; color: #000; }
.pb { break-before: page; page-break-before: always; } .pre { white-space: pre-wrap; }
.c { text-align: center; } .b { font-weight: 700; } .big { font-size: 16px; } .huge { font-size: 28px; font-weight: 800; }
.small { font-size: 11px; } .item { display: flex; justify-content: space-between; gap: 6px; }
.opt { padding-left: 10px; } .rm { font-size: 15px; } .note { background: #eee; padding: 2px 4px; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; } .r { white-space: nowrap; }
</style></head><body>${copies.join('\n')}</body></html>`;
}

export { RECEIPT_TYPES, receiptSchema };
export type { Receipt, ReceiptType };
