'use client';

import { Printer } from 'lucide-react';
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettingsDto } from '@siparis/core/settings/contracts';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { RadioGroup } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { formatDateNumeric, formatTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useTenantSettings } from './api';
import { SaveBar, Section, SettingsError, SettingsLoading } from './settings-shell';
import { useBranchForm } from './use-branch-form';

type Receipt = Required<ReceiptSettingsDto>;

/** Fiş ayarları (04 §4.14, §7.10) + 80/58 mm önizleme (12 §7.4). */
export function ReceiptSettingsForm() {
  const tenant = useTenantSettings();
  const f = useBranchForm<Receipt>(
    (b) => ({ ...DEFAULT_RECEIPT_SETTINGS, ...b.receiptSettings }) as Receipt,
    (v, b) => {
      const cur = { ...DEFAULT_RECEIPT_SETTINGS, ...b.receiptSettings } as Receipt;
      const changed = (Object.keys(v) as (keyof Receipt)[]).filter((k) => v[k] !== cur[k]);
      return changed.length ? { receiptSettings: Object.fromEntries(changed.map((k) => [k, v[k]])) } : {};
    },
    'Fiş ayarları kaydedildi.',
  );
  if (f.query.isPending) return <SettingsLoading />;
  if (f.query.isError) return <SettingsError error={f.query.error} onRetry={() => void f.query.refetch()} />;
  const v = f.value;
  if (!v) return <SettingsLoading />;
  const set = <K extends keyof Receipt>(k: K, val: Receipt[K]) => f.setValue((x) => ({ ...x, [k]: val }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void f.save();
        }}
        noValidate
        className="flex min-w-0 flex-col gap-4"
      >
        <Section title="Kağıt ve yazdırma" description="Tarayıcıdan yazdırılır. Diyalogsuz yazdırma için kurulum rehberine bakın.">
          <RadioGroup
            legend="Kağıt genişliği"
            variant="chips"
            value={String(v.width_mm)}
            onValueChange={(w) => set('width_mm', Number(w) as 58 | 80)}
            options={[
              { value: '80', label: '80 mm' },
              { value: '58', label: '58 mm' },
            ]}
          />
          <RadioGroup
            legend="Yazı boyutu"
            variant="chips"
            value={v.font_size}
            onValueChange={(s) => set('font_size', s)}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'large', label: 'Büyük' },
            ]}
          />
          <RadioGroup
            legend="Kopya sayısı"
            variant="chips"
            value={String(v.copies)}
            onValueChange={(c) => set('copies', Number(c))}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
          <Switch checked={v.auto_print} onCheckedChange={(on) => set('auto_print', on)} label="Onaylanınca yazdırma penceresini aç" />
          <Switch checked={v.print_kitchen} onCheckedChange={(on) => set('print_kitchen', on)} label="Mutfak fişi" description="Fiyat ve müşteri bilgisi basılmaz." />
          <Switch checked={v.print_delivery} onCheckedChange={(on) => set('print_delivery', on)} label="Paket (kurye) fişi" description="Adres tam, telefon maskeli basılır." />
        </Section>
        <Section title="Fiş alt bilgisi">
          <Switch checked={v.show_logo} onCheckedChange={(on) => set('show_logo', on)} label="İşletme adını büyük bas" />
          <Switch checked={v.show_wa_line} onCheckedChange={(on) => set('show_wa_line', on)} label="“Bir sonraki siparişinizi WhatsApp’tan verin” satırı" />
          <Field label="Alt bilgi metni" hint="Ör. Afiyet olsun! (en çok 200 karakter)">
            <Textarea value={v.footer_text} onChange={(e) => set('footer_text', e.target.value)} maxLength={200} rows={2} />
          </Field>
          <p className="text-sm text-fg-muted">“Mali değeri yoktur” satırı her fişte basılır.</p>
        </Section>
        <SaveBar dirty={f.dirty} saving={f.saving} onReset={f.reset} />
      </form>
      <div className="flex flex-col items-center gap-3">
        <ReceiptPreview settings={v} businessName={tenant.data?.name ?? 'İşletme'} phone={tenant.data?.phone ?? null} />
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden />
          Test fişi yazdır
        </Button>
      </div>
    </div>
  );
}

/** Kasa/kurye fişi önizlemesi (örnek sipariş; telefon maskeli, "Mali değeri yoktur"). */
export function ReceiptPreview({ settings, businessName, phone }: { settings: Receipt; businessName: string; phone: string | null }) {
  const now = new Date();
  const lines = [
    { q: 2, name: 'Kıymalı Pide', total: '360,00' },
    { q: 1, name: 'Ayran', total: '25,00' },
  ];
  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } #receipt-preview, #receipt-preview * { visibility: visible !important; } #receipt-preview { position: absolute; inset: 0 auto auto 0; box-shadow: none; border: 0; } @page { margin: 0; size: ${settings.width_mm}mm auto; } }`}</style>
      <div
        id="receipt-preview"
        aria-label="Fiş önizlemesi"
        className={cn(
          'shrink-0 border border-border bg-white p-3 font-mono text-[#111827] shadow-md',
          settings.font_size === 'large' ? 'text-[13px] leading-5' : 'text-[11px] leading-4',
        )}
        style={{ width: settings.width_mm === 80 ? '80mm' : '58mm', maxWidth: '100%' }}
      >
        <div className="text-center">
          <div className={cn('font-bold', settings.show_logo ? 'text-base' : '')}>{businessName}</div>
          {phone ? <div>{phone.replace(/^\+90/, '0')}</div> : null}
          <div>
            {formatDateNumeric(now)} {formatTime(now)}
          </div>
        </div>
        <div className="my-2 border-t border-dashed border-[#111827]" />
        <div className="flex justify-between font-bold">
          <span>#1024 · PAKET</span>
          <span>Kapıda nakit</span>
        </div>
        <div>Mehmet K. · 0*** *** 45 67</div>
        <div>Aşağınohutlu Mah., Lise Cad. 12 D:3</div>
        <div className="italic">Tarif: Eczanenin üstü</div>
        <div className="my-2 border-t border-dashed border-[#111827]" />
        {lines.map((l) => (
          <div key={l.name} className="flex justify-between gap-2">
            <span>
              {l.q} x {l.name}
            </span>
            <span>{l.total}</span>
          </div>
        ))}
        <div className="flex justify-between">
          <span>Teslimat</span>
          <span>15,00</span>
        </div>
        <div className="mt-1 flex justify-between font-bold">
          <span>TOPLAM (KDV dahil)</span>
          <span>400,00 TL</span>
        </div>
        <div>Para üstü: 500 TL</div>
        <div className="my-2 border-t border-dashed border-[#111827]" />
        {settings.show_wa_line ? <div className="text-center">Bir sonraki siparişinizi WhatsApp’tan verin</div> : null}
        {settings.footer_text ? <div className="whitespace-pre-wrap text-center">{settings.footer_text}</div> : null}
        <div className="text-center">ĞÜŞİÖÇ ğüşıöç</div>
        <div className="mt-1 text-center font-bold">Mali değeri yoktur</div>
      </div>
    </>
  );
}
