'use client';

// Telefon siparişi · 1. adım "Müşteri": telefon VE ad alanı + ilk karakterden itibaren, tuş başına beslenen
// birleşik kutu (combobox) + seçilen müşterinin ayrıntı kartı (04 §4.13).
//
// NEDEN AYRI DOSYA: `phone-order.tsx` zaten 500 satır sınırına dayanmıştı (CLAUDE.md) ve bu ekranın müşteri
// adımı kendi başına bir bileşen: arama durumu, klavye gezinmesi ve ayrıntı yüklemesi burada kapanır; forma
// yalnız "şu müşteriyi doldur" ve "şu kalemleri ekle" diye konuşur.
//
// ERİŞİLEBİLİRLİK (ARIA 1.2 combobox + listbox, `aria-activedescendant` deseni):
//   * Odak HER ZAMAN yazı alanında kalır; ↑/↓ yalnız ETKİN satırı değiştirir (`aria-activedescendant`),
//     Enter seçer, Esc listeyi kapatır. Liste öğeleri odaklanabilir DEĞİLDİR.
//   * `role="option"` içine düğme KONULMAZ (iç içe etkileşim ekran okuyucuda satırı okunamaz hâle getirir) —
//     "Aynısını ekle" bu yüzden listede değil, seçilen müşterinin ayrıntı kartındadır. Zaten listede o veri
//     de yok: liste gövdesi (`detail=0`) adres ve sipariş taşımaz, yalnız sayılarını taşır.
//   * Birleşik kutu rolleri YALNIZ yazılan alana verilir. İki alanın ikisine birden `role="combobox"` +
//     aynı `aria-controls` vermek iki ayrı kutunun tek açılır listeyi paylaşması demek olurdu; her an tek
//     kutu var olsun diye roller alan değiştikçe taşınır.
//   * Sonuç sayısı kısılmış canlı bölgeden duyurulur (`useQuietMessage`): liste anında güncellenir, duyuru
//     yazım durunca gelir.
//
// ODAK KAYBINDA LİSTE `blur` İLE KAPATILMAZ (bilinçli): `blur` ile kapatmak satıra tıklamayı yarışa sokar —
// alan odağı kaybedince liste DOM'dan kalkar ve `click` hiç ulaşmaz. Liste seçimle, Esc ile, alan boşalınca ya
// da ÖTEKİ ALAN ODAK ALINCA kapanır; son durum şart, çünkü klavye olayları yalnız aranan alana bağlıdır ve açık
// kalan listeye Tab'dan sonra ne oklar ne Esc ulaşır. Satıra fareyle basmak odağı alandan çıkarmaz
// (`onMouseDown` + `preventDefault`), yani seçimden sonra odak her iki yolda da yazı alanındadır.

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { MapPin, Plus, StickyNote, UserRound, X } from 'lucide-react';
import type { CustomerLookupItem, CustomerLookupResponse } from '@siparis/core/orders/contracts';
import { Alert, Badge, Button, Field, Input, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney, formatPhone, formatRelative } from '@/lib/format';
import { nextActive, useCustomerDetail, useCustomerLookup, useFillOnce, useQuietMessage, type LookupField } from './customer-lookup';

/** "Aynısını ekle"nin beslediği kalem listesi (ayrıntı gövdesinden gelir). */
export type LastOrderItems = NonNullable<CustomerLookupItem['lastOrders']>[number]['items'];

type LookupMode = CustomerLookupResponse['mode'];

/** Arama bitti ve hiç sonuç yoksa yazılacak metin. Dal farkı önemlidir: "eşleşme yok" ≠ "hiç müşteri yok". */
export function emptyLookupText(mode: LookupMode): string {
  if (mode === 'latest') return 'Henüz siparişi olan müşteri yok. Ad ve telefonu yazıp devam edin.';
  return 'Eşleşen müşteri yok. Ad ve telefonu yazıp yeni müşteri olarak kaydedebilirsiniz.';
}

/** Canlı bölge metni. Arama sürerken boştur: duyuru yalnız KESİNLEŞMİŞ sonuç için yapılır. */
export function lookupStatusText(mode: LookupMode, count: number, isSettled: boolean): string {
  if (!isSettled) return '';
  if (count === 0) return emptyLookupText(mode);
  if (mode === 'latest') return `En son sipariş veren ${count} müşteri listelendi.`;
  return `${count} müşteri bulundu. Gezinmek için yukarı ve aşağı okları, seçmek için Enter.`;
}

export interface CustomerPickerProps {
  phone: string;
  name: string;
  /** Alan değişikliği: çağıran seçimi de temizler (yazmaya başlamak seçimi bozar). */
  onPhoneChange: (value: string) => void;
  onNameChange: (value: string) => void;
  /** Seçili müşteri kimliği; null = yeni müşteri. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Ayrıntı gövdesi geldiğinde BİR KEZ çağrılır: formu doldurur (telefon, ad, adres). */
  onFill: (item: CustomerLookupItem) => void;
  /** "Aynısını ekle". */
  onAddSame: (items: LastOrderItems) => void;
  phoneError?: string;
  nameError?: string;
}

export function CustomerPicker({
  phone,
  name,
  onPhoneChange,
  onNameChange,
  selectedId,
  onSelect,
  onFill,
  onAddSame,
  phoneError,
  nameError,
}: CustomerPickerProps) {
  const [field, setField] = useState<LookupField>('phone');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // `useId()` biçimi React sürümleri arasında değişti (`:r0:` → `_r_0_`); `aria-controls` ile eşleşen bir
  // id üretmek için harf/rakam dışındaki her karakter atılır.
  const listId = `lk${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const optionId = (index: number) => `${listId}-o${index}`;

  const lookup = useCustomerLookup(field, field === 'phone' ? phone : name, open);
  const { items } = lookup;
  const listOpen = open && lookup.term.length > 0;

  // Liste kısalınca etkin satır listenin dışında kalmasın (son satır etkinken bir karakter daha yazılması).
  useEffect(() => {
    setActive((a) => (a >= items.length ? items.length - 1 : a));
  }, [items.length]);

  const detail = useCustomerDetail(selectedId);
  const selected = detail.data?.item;
  useFillOnce(selectedId, selected, onFill);

  const edit = (next: LookupField, value: string) => {
    setField(next);
    setOpen(true);
    setActive(-1);
    if (next === 'phone') onPhoneChange(value);
    else onNameChange(value);
  };

  const pick = (item: CustomerLookupItem) => {
    onSelect(item.id);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((a) => nextActive(a, items.length, event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter') {
      const item = active >= 0 ? items[active] : undefined;
      if (listOpen && item) {
        event.preventDefault();
        pick(item);
      }
      return;
    }
    if (event.key === 'Escape' && listOpen) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  /**
   * Birleşik kutu rolleri yalnız o an yazılan alanda. `aria-controls` yalnız liste DOM'dayken geçerlidir.
   *
   * DİĞER ALANA ODAKLANILINCA LİSTE KAPANIR: klavye olayları yalnız aranan alana bağlı olduğundan, Tab ile
   * öteki alana geçilip liste açık bırakılsa ↑/↓ ile gezilemez ve Esc ile kapatılamazdı. `active` da sıfırlanır,
   * yoksa `aria-activedescendant` DOM'dan kalkmış bir satırı gösterirdi.
   */
  const combobox = (own: LookupField) =>
    own === field
      ? {
          role: 'combobox',
          'aria-expanded': listOpen,
          'aria-autocomplete': 'list' as const,
          ...(listOpen ? { 'aria-controls': listId } : {}),
          ...(active >= 0 && items[active] ? { 'aria-activedescendant': optionId(active) } : {}),
          onKeyDown,
        }
      : {
          onFocus: () => {
            setOpen(false);
            setActive(-1);
          },
        };

  const status = useQuietMessage(lookupStatusText(lookup.mode, items.length, lookup.isSettled));

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <h2 className="text-base font-bold">1 · Müşteri</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telefon" required hint="0 (5xx) xxx xx xx · ilk rakamdan itibaren arar" error={phoneError}>
          <Input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => edit('phone', e.target.value)} {...combobox('phone')} />
        </Field>
        <Field label="Ad" required hint="İlk harften itibaren arar" error={nameError}>
          <Input maxLength={80} autoComplete="off" value={name} onChange={(e) => edit('name', e.target.value)} {...combobox('name')} />
        </Field>
      </div>

      {listOpen ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-fg-muted">
            {lookup.mode === 'latest' ? 'En son sipariş verenler' : 'Eşleşen müşteriler'}
            {lookup.isFetching ? <Spinner size="sm" className="ms-2 align-middle" /> : null}
          </p>
          {/* min-h: liste kısalıp uzarken düzen zıplamasın (tuş başına arama). */}
          <ul
            id={listId}
            role="listbox"
            aria-label={lookup.mode === 'latest' ? 'En son sipariş verenler' : 'Eşleşen müşteriler'}
            aria-busy={lookup.isFetching || undefined}
            className={cn('flex min-h-14 flex-col gap-1', lookup.isFetching && 'opacity-70')}
          >
            {items.map((c, index) => (
              /* onMouseDown: odaklanamayan bir öğeye basmak odağı `body`ye düşürür (sonraki Tab belgenin
                 başından başlar). `preventDefault` odağı yazı alanında tutar — klavye ve fare seçimi aynı
                 yerde bitsin — ve tıklamayı blur yarışından da kurtarır. */
              <li
                key={c.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onPointerEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(c)}
                className={cn(
                  'flex min-h-hit cursor-pointer flex-wrap items-center gap-2 rounded-md border px-3 py-2',
                  index === active ? 'border-primary bg-accent' : 'border-border bg-surface',
                )}
              >
                <UserRound aria-hidden className="size-5 shrink-0 text-fg-muted" />
                <span className="font-semibold">{c.name ?? 'Müşteri'}</span>
                <span className="text-sm tabular-nums text-fg-muted">{c.phoneMasked}</span>
                <Badge size="sm" variant={c.orderCount > 1 ? 'info' : 'neutral'}>
                  {c.orderCount > 0 ? `${c.orderCount} sipariş` : 'Yeni'}
                </Badge>
                {c.isBlocked ? (
                  <Badge size="sm" variant="danger">
                    Kara listede
                  </Badge>
                ) : null}
                {c.hasNotes ? (
                  <Badge size="sm" variant="warning">
                    <StickyNote aria-hidden /> Not var
                  </Badge>
                ) : null}
                {c.addressCount > 0 ? (
                  <span className="flex items-center gap-1 text-sm text-fg-muted">
                    <MapPin aria-hidden className="size-4" /> {c.addressCount} adres
                  </span>
                ) : null}
                {c.lastOrderAt ? <span className="ms-auto text-sm text-fg-muted">{formatRelative(c.lastOrderAt)}</span> : null}
              </li>
            ))}
          </ul>
          {/* "Sonuç yok" yalnız arama GERÇEKTEN bitince: yükleniyor durumunda önceki liste ekranda kalır. */}
          {lookup.isSettled && items.length === 0 ? <p className="text-sm text-fg-muted">{emptyLookupText(lookup.mode)}</p> : null}
          {lookup.error ? <Alert variant="warning">{errorMessage(lookup.error, 'Müşteri aranamadı.')}</Alert> : null}
        </div>
      ) : null}

      {selectedId ? <SelectedCustomer item={selected} isPending={detail.isPending} error={detail.error} onClear={() => onSelect(null)} onAddSame={onAddSame} /> : null}

      {/* Canlı bölge HER ZAMAN DOM'da: sonradan takılan bölge bazı ekran okuyucularda hiç duyurulmaz. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}

function SelectedCustomer({
  item,
  isPending,
  error,
  onClear,
  onAddSame,
}: {
  item: CustomerLookupItem | undefined;
  isPending: boolean;
  error: unknown;
  onClear: () => void;
  onAddSame: (items: LastOrderItems) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-primary bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <UserRound aria-hidden className="size-5" />
        <span className="font-semibold">{item?.name ?? 'Seçili müşteri'}</span>
        {item?.phoneE164 ? <span className="text-sm tabular-nums text-fg-muted">{formatPhone(item.phoneE164)}</span> : null}
        {item?.isBlocked ? (
          <Badge size="sm" variant="danger">
            Kara listede
          </Badge>
        ) : null}
        <Button variant="ghost" size="sm" className="ms-auto" onClick={onClear}>
          <X aria-hidden /> Seçimi kaldır
        </Button>
      </div>
      {isPending ? <Spinner size="sm" label="Müşteri bilgileri yükleniyor" /> : null}
      {error ? <Alert variant="warning">{errorMessage(error, 'Müşteri bilgileri yüklenemedi.')}</Alert> : null}
      {item?.notes ? <p className="text-sm text-warning">Not: {item.notes}</p> : null}
      {(item?.addresses ?? []).slice(0, 2).map((a) => (
        <p key={a.id} className="text-sm text-fg-muted">
          {a.neighborhood ? `${a.neighborhood} · ` : ''}
          {a.addressLine}
        </p>
      ))}
      {(item?.lastOrders ?? []).map((o) => (
        <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-muted">
            #{o.number} · {formatRelative(o.placedAt)} · {formatMoney(o.totalKurus)} · {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
          </span>
          <Button variant="ghost" size="sm" onClick={() => onAddSame(o.items)}>
            <Plus aria-hidden /> Aynısını ekle
          </Button>
        </div>
      ))}
    </div>
  );
}
