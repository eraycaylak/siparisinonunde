'use client';

// Şube ayar formları: ödeme yöntemleri (04 §7.6), müşteri bildirimleri (04 §7.8), sipariş alarmı (00 §10, 04 §7.7).

import type { FormEvent, ReactNode } from 'react';
import { BellRing, Info, Lock, MessageCircle, Smartphone, TimerOff, TriangleAlert, Volume2 } from 'lucide-react';
import { MEAL_CARD_BRANDS, MEAL_CARD_BRAND_LABELS, PHASE1_PAYMENT_METHODS, type MealCardBrand, type PaymentMethod } from '@siparis/core';
import type { AlarmPolicyDto, BranchSettings, StatusMessages } from '@siparis/core/settings/contracts';
import { ALARM_LIMITS, maxCustomerNoticeMinutes, validateAlarmPolicy } from '@siparis/core/settings/validation';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/cn';
import { SaveBar, Section, SettingsError, SettingsLoading } from './settings-shell';
import { useBranchForm } from './use-branch-form';

function Frame({ q, children }: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; children: () => ReactNode }) {
  if (q.isPending) return <SettingsLoading />;
  if (q.isError) return <SettingsError error={q.error} onRetry={() => void q.refetch()} />;
  return <>{children()}</>;
}

// ---------------------------------------------------------------------------
// Ödeme yöntemleri

const METHOD_TEXT: Record<(typeof PHASE1_PAYMENT_METHODS)[number], { label: string; description: string }> = {
  cash_on_delivery: { label: 'Kapıda nakit', description: 'Paket serviste nakit; müşteri para üstünü belirtebilir.' },
  card_on_delivery: { label: 'Kapıda kredi/banka kartı', description: 'Kurye POS cihazı getirecek.' },
  meal_card_on_delivery: { label: 'Kapıda yemek kartı', description: 'Yalnız işaretlediğiniz kart markaları müşteriye görünür.' },
  pay_at_counter: { label: 'Kasada öde', description: 'Gel-al siparişlerinde işletmede ödeme.' },
};

interface PaymentValue {
  methods: PaymentMethod[];
  brands: MealCardBrand[];
}

const selectPayment = (b: BranchSettings): PaymentValue => ({ methods: b.paymentMethods as PaymentMethod[], brands: b.mealCardBrands as MealCardBrand[] });
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export function PaymentForm({ onSaved }: { onSaved?: () => void }) {
  const f = useBranchForm(
    selectPayment,
    (v, b) => ({
      ...(sameSet(v.methods, b.paymentMethods) ? {} : { paymentMethods: v.methods as (typeof PHASE1_PAYMENT_METHODS)[number][] }),
      ...(sameSet(v.brands, b.mealCardBrands) ? {} : { mealCardBrands: v.brands }),
    }),
    'Ödeme yöntemleri kaydedildi.',
  );
  return (
    <Frame q={f.query}>
      {() => {
        const v = f.value;
        if (!v) return <SettingsLoading />;
        const none = v.methods.length === 0;
        const mealNoBrand = v.methods.includes('meal_card_on_delivery') && v.brands.length === 0;
        const toggle = (m: PaymentMethod, on: boolean) =>
          f.setValue((x) => ({ ...x, methods: on ? [...x.methods, m] : x.methods.filter((y) => y !== m) }));
        const onSubmit = (e: FormEvent) => {
          e.preventDefault();
          if (!none && !mealNoBrand) void f.save(onSaved);
        };
        return (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <Section title="Müşterinin seçebileceği yöntemler">
              {PHASE1_PAYMENT_METHODS.map((m) => (
                <Switch key={m} checked={v.methods.includes(m)} onCheckedChange={(on) => toggle(m, on)} label={METHOD_TEXT[m].label} description={METHOD_TEXT[m].description} />
              ))}
              {none ? <p className="text-sm font-medium text-destructive">En az bir ödeme yöntemi açık olmalı.</p> : null}
              <p className="flex items-start gap-2 rounded-md bg-info-bg p-3 text-sm text-fg">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                Kapıda kartla ödemeye ek ücret eklenemez. Online kartla ödeme sonraki aşamada gelecek.
              </p>
            </Section>
            {v.methods.includes('meal_card_on_delivery') ? (
              <Section title="Yemek kartı markaları">
                <div className="grid gap-2 sm:grid-cols-2">
                  {MEAL_CARD_BRANDS.map((brand) => (
                    <Checkbox
                      key={brand}
                      label={MEAL_CARD_BRAND_LABELS[brand]}
                      checked={v.brands.includes(brand)}
                      onChange={(e) => {
                        const on = e.currentTarget.checked;
                        f.setValue((x) => ({ ...x, brands: on ? [...x.brands, brand] : x.brands.filter((y) => y !== brand) }));
                      }}
                    />
                  ))}
                </div>
                {mealNoBrand ? <p className="text-sm font-medium text-destructive">En az bir kart markası seçin.</p> : null}
              </Section>
            ) : null}
            <SaveBar dirty={f.dirty} saving={f.saving} onReset={f.reset} />
          </form>
        );
      }}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Müşteri bildirimleri (durum mesajları)

const MESSAGE_ROWS: { key: keyof StatusMessages; label: string; description: string; locked?: boolean; warnOn?: boolean }[] = [
  { key: 'received', label: 'Alındı + takip bağlantısı', description: 'Siparişiniz alındı mesajı. Kapatılamaz.', locked: true },
  { key: 'accepted', label: 'Onaylandı + tahmini süre', description: 'Kapatılamaz.', locked: true },
  { key: 'preparing', label: 'Hazırlanıyor', description: 'Varsayılan kapalı. Açarsanız 4 mesaj sınırını aşma riski var.', warnOn: true },
  { key: 'ready', label: 'Hazır (gel-al)', description: 'Yalnız gel-al siparişlerinde gider.' },
  { key: 'on_the_way', label: 'Yolda', description: 'Kurye adı paylaşılır; kurye telefonu paylaşılmaz.' },
  { key: 'delivered', label: 'Teslim edildi + değerlendirme', description: 'Üç butonlu kısa değerlendirme isteği içerir.' },
];

export function NotificationsForm({ onSaved }: { onSaved?: () => void }) {
  const f = useBranchForm(
    (b) => ({ ...b.statusMessages }),
    (v, b) => {
      const changed = (Object.keys(v) as (keyof StatusMessages)[]).filter((k) => v[k] !== b.statusMessages[k]);
      return changed.length ? { statusMessages: Object.fromEntries(changed.map((k) => [k, v[k]])) } : {};
    },
    'Bildirim ayarları kaydedildi.',
  );
  return (
    <Frame q={f.query}>
      {() => {
        const v = f.value;
        if (!v) return <SettingsLoading />;
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void f.save(onSaved);
            }}
            noValidate
            className="flex flex-col gap-4"
          >
            <Section
              title="Müşteriye giden durum mesajları"
              description="WhatsApp'tan (WhatsApp'sız modda kritik durumlar SMS ile) otomatik gider. Sipariş başına en fazla 4 durum mesajı gönderilir."
            >
              {MESSAGE_ROWS.map((row) => (
                <div key={row.key} className="flex flex-col">
                  <Switch
                    checked={row.locked ? true : v[row.key]}
                    disabled={row.locked}
                    onCheckedChange={(on) => f.setValue((x) => ({ ...x, [row.key]: on }))}
                    label={
                      <span className="inline-flex items-center gap-2">
                        {row.locked ? <Lock aria-hidden className="size-4 text-fg-muted" /> : null}
                        {row.label}
                      </span>
                    }
                    description={row.description}
                  />
                  {row.warnOn && v[row.key] ? (
                    <p className="flex items-start gap-2 rounded-md bg-warning-bg p-3 text-sm text-fg">
                      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                      Hazırlanıyor mesajı açıkken paket siparişinde alındı, onaylandı, hazırlanıyor, yolda ve teslim edildi mesajları 4 sınırını
                      aşar; bu durumda en az önemli mesaj gönderilmez.
                    </p>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-border pt-3 text-sm text-fg-muted">
                <Lock aria-hidden className="size-4" />
                Ret ve iptal bildirimleri her zaman gider.
              </div>
            </Section>
            <Section title="4 mesaj bütçesi neden var?">
              <p className="text-sm text-fg">
                WhatsApp, işletme mesajlarını sınırlı tutmanızı ister; çok mesaj alan müşteri sizi engelleyebilir ve numaranızın kalitesi düşer.
                Gecikme ve iptal gibi olağan dışı bilgilendirmeler bu sınıra dahil değildir. Durum mesajlarına kampanya ya da indirim yazılamaz.
              </p>
            </Section>
            <SaveBar dirty={f.dirty} saving={f.saving} onReset={f.reset} />
          </form>
        );
      }}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Sipariş alarmı

export function AlarmForm({ onSaved }: { onSaved?: () => void }) {
  const f = useBranchForm(
    (b) => ({ ...b.alarmPolicy }),
    (v, b) => {
      const changed = (Object.keys(v) as (keyof AlarmPolicyDto)[]).filter((k) => v[k] !== b.alarmPolicy[k]);
      return changed.length ? { alarmPolicy: Object.fromEntries(changed.map((k) => [k, v[k]])) } : {};
    },
    'Alarm ayarları kaydedildi.',
  );
  return (
    <Frame q={f.query}>
      {() => {
        const v = f.value;
        if (!v) return <SettingsLoading />;
        const issues = validateAlarmPolicy(v);
        const maxNotice = maxCustomerNoticeMinutes(v.auto_cancel_minutes);
        const setAuto = (n: number) =>
          f.setValue((x) => ({ ...x, auto_cancel_minutes: n, customer_notice_minutes: Math.min(x.customer_notice_minutes, maxCustomerNoticeMinutes(n)) }));
        const steps: { at: string; icon: typeof BellRing; title: string; body: ReactNode; locked?: boolean; off?: boolean }[] = [
          { at: '0 sn', icon: Volume2, title: 'Panel sesi ve bildirim', body: 'Yeni sipariş panelde sesli uyarı ve telefon bildirimiyle düşer.', locked: true },
          { at: '60 sn', icon: BellRing, title: 'Ses tekrarı (yükselen)', body: 'Onaylanmayan siparişte ses yükselerek tekrarlanır.', locked: true },
          {
            at: '2 dk',
            icon: MessageCircle,
            title: 'Sahibe WhatsApp uyarısı',
            off: !v.platform_wa_enabled,
            body: (
              <Switch
                checked={v.platform_wa_enabled}
                onCheckedChange={(on) => f.setValue((x) => ({ ...x, platform_wa_enabled: on }))}
                label="Platform numarasından WhatsApp uyarısı"
                description={v.platform_wa_enabled ? 'İşletme sahibinin telefonuna kısa uyarı gider.' : 'Kapalı: panel başında kimse yoksa sipariş kaçabilir.'}
              />
            ),
          },
          {
            at: '5 dk',
            icon: Smartphone,
            title: 'Sahibe SMS',
            off: !v.sms_enabled,
            body: (
              <Switch
                checked={v.sms_enabled}
                onCheckedChange={(on) => f.setValue((x) => ({ ...x, sms_enabled: on }))}
                label="SMS uyarısı"
                description={v.sms_enabled ? 'WhatsApp uyarısı görülmezse SMS gider.' : 'Kapalı: internet sorununda uyarı alamayabilirsiniz.'}
              />
            ),
          },
          {
            at: `${v.customer_notice_minutes} dk`,
            icon: Info,
            title: 'Müşteriye bilgi',
            body: (
              <label className="flex flex-col gap-2 text-sm text-fg">
                Müşteriye “İşletme henüz onaylamadı” bilgisi {v.customer_notice_minutes}. dakikada gider (en geç {maxNotice}. dakika).
                <input
                  type="range"
                  min={ALARM_LIMITS.customerNoticeMin}
                  max={Math.max(ALARM_LIMITS.customerNoticeMin, maxNotice)}
                  step={1}
                  value={v.customer_notice_minutes}
                  onChange={(e) => f.setValue((x) => ({ ...x, customer_notice_minutes: Number(e.target.value) }))}
                  className="h-12 w-full accent-[var(--primary)]"
                  aria-label="Müşteri bilgi dakikası"
                />
              </label>
            ),
          },
          {
            at: `${v.auto_cancel_minutes} dk`,
            icon: TimerOff,
            title: 'Otomatik iptal',
            body: (
              <label className="flex flex-col gap-2 text-sm text-fg">
                Onaylanmayan sipariş {v.auto_cancel_minutes}. dakikada iptal edilir ve müşteriden özür dilenir ({ALARM_LIMITS.autoCancelMin}–
                {ALARM_LIMITS.autoCancelMax} dk).
                <input
                  type="range"
                  min={ALARM_LIMITS.autoCancelMin}
                  max={ALARM_LIMITS.autoCancelMax}
                  step={1}
                  value={v.auto_cancel_minutes}
                  onChange={(e) => setAuto(Number(e.target.value))}
                  className="h-12 w-full accent-[var(--primary)]"
                  aria-label="Otomatik iptal süresi (dakika)"
                />
              </label>
            ),
          },
        ];
        return (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!issues.length) void f.save(onSaved);
            }}
            noValidate
            className="flex flex-col gap-4"
          >
            <Section title="Onaylanmayan sipariş için uyarı zinciri" description="Sipariş “Yeni” durumunda beklerken sırayla çalışır; onaylayınca durur.">
              <ol className="flex flex-col">
                {steps.map((s, i) => (
                  <li key={s.title} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-full border-2',
                          s.off ? 'border-border text-fg-muted' : 'border-primary text-fg',
                        )}
                      >
                        <s.icon aria-hidden className="size-5" />
                      </span>
                      {i < steps.length - 1 ? <span aria-hidden className="w-0.5 flex-1 bg-border" /> : null}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 pb-5">
                      <span className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
                        <span className="rounded bg-surface px-2 py-0.5 text-sm tabular-nums">{s.at}</span>
                        {s.title}
                        {s.locked ? (
                          <span className="inline-flex items-center gap-1 text-sm font-normal text-fg-muted">
                            <Lock aria-hidden className="size-4" />
                            kapatılamaz
                          </span>
                        ) : null}
                      </span>
                      {typeof s.body === 'string' ? <p className="text-sm text-fg-muted">{s.body}</p> : s.body}
                    </div>
                  </li>
                ))}
              </ol>
              {issues.length ? <p className="text-sm font-medium text-destructive">{issues[0]!.message}</p> : null}
              {f.errors['alarmPolicy.auto_cancel_minutes'] || f.errors['alarmPolicy.customer_notice_minutes'] ? (
                <p className="text-sm font-medium text-destructive">{f.errors['alarmPolicy.auto_cancel_minutes'] ?? f.errors['alarmPolicy.customer_notice_minutes']}</p>
              ) : null}
            </Section>
            <SaveBar dirty={f.dirty} saving={f.saving} onReset={f.reset} />
          </form>
        );
      }}
    </Frame>
  );
}
