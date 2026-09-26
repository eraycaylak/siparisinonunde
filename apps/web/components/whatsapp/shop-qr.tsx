'use client';

// Ortak numara (00 §12a madde 8) dükkan QR'ı: müşteri bağlantısı (kopyala), QR önizleme + PNG/SVG indirme ve masaya/tezgâha
// konan yazdırılabilir A5/A6 kart ("Sipariş vermek için okut", dükkan adı, dükkan kodu). QR içeriği API'nin ürettiği
// wa.me/<ortak numara>?text=…#KOD bağlantısıdır; müşteri okutunca ortak numaraya dükkan koduyla yazar, bot o dükkan
// adına yanıt verir. Panel WhatsApp ayarları, kurulum sihirbazı ve "QR ve afiş" sayfası kullanır.

import { useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { brandPalette } from '@siparis/core/settings/brand';
import { Button, buttonVariants, Input, RadioGroup } from '@/components/ui';
import { apiPath, withQuery } from '@/lib/api';
import { cn } from '@/lib/cn';

/** SVG metnini <img> kaynağına çevirir (HTML'e gömülmez; yalnız görüntü olarak çizilir). */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Panelin QR indirme adresi (owner, manager): GET /panel/whatsapp/qr?format=svg|png. */
export function qrDownloadHref(format: 'svg' | 'png'): string {
  return withQuery(apiPath('/panel/whatsapp/qr'), { format });
}

async function copyText(text: string, done = 'Bağlantı kopyalandı.') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error('Kopyalanamadı; bağlantıyı seçip elle kopyalayın.');
  }
}

/** Müşteri bağlantısı: salt okunur alan + Kopyala + WhatsApp'ta aç. */
export function CustomerLinkField({ link, label = 'Müşteri bağlantısı' }: { link: string; label?: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <label className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copyText(link)}>
          <Copy aria-hidden />
          Bağlantıyı kopyala
        </Button>
        <a href={link} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost' })}>
          <ExternalLink aria-hidden />
          WhatsApp&apos;ta aç
        </a>
      </div>
    </div>
  );
}

/** QR indirme bağlantıları (PNG baskı için 1024 px, SVG vektör). */
export function QrDownloadLinks({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      <a href={qrDownloadHref('png')} download className={buttonVariants({ variant: 'secondary' })}>
        <Download aria-hidden />
        PNG indir
      </a>
      <a href={qrDownloadHref('svg')} download className={buttonVariants({ variant: 'secondary' })}>
        <Download aria-hidden />
        SVG indir
      </a>
    </div>
  );
}

export type TableCardSize = 'a5' | 'a6';

const CARD_SIZES: Record<TableCardSize, { label: string; description: string; widthMm: number; heightMm: number }> = {
  a5: { label: 'A5 (148×210 mm)', description: 'Kapı, vitrin, tezgâh', widthMm: 148, heightMm: 210 },
  a6: { label: 'A6 (105×148 mm)', description: 'Masa standı, paket içi', widthMm: 105, heightMm: 148 },
};

export interface TableCardProps {
  shopName: string;
  code: string;
  qrSrc: string;
  /** Ortak numara (biçimli); QR okumayan müşteri için "numaraya #KOD yazın" satırı */
  phoneFormatted?: string | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  size: TableCardSize;
}

/** Yazdırılabilir masa kartı (önizleme ekranda ölçeklenir; baskıda gerçek boyut). */
export function TableCard({ shopName, code, qrSrc, phoneFormatted, brandColor, logoUrl, size }: TableCardProps) {
  const palette = brandPalette(brandColor);
  const dims = CARD_SIZES[size];
  return (
    <div
      id="print-table-card"
      className="mx-auto flex w-full flex-col items-center overflow-hidden border border-border bg-white text-center text-[#111827] shadow-sm"
      style={{ maxWidth: `${dims.widthMm}mm`, aspectRatio: `${dims.widthMm} / ${dims.heightMm}`, containerType: 'inline-size' }}
    >
      <div className="flex w-full items-center justify-center gap-[3cqw] px-[6cqw] py-[4cqw]" style={{ background: palette.brand, color: palette.brandContrast }}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="size-[10cqw] shrink-0 rounded-full bg-white object-cover" />
        ) : null}
        <span className="min-w-0 text-[7cqw] font-extrabold leading-tight [overflow-wrap:anywhere]">{shopName}</span>
      </div>
      <div className="flex w-full flex-1 flex-col items-center justify-evenly gap-[1.5cqw] px-[6cqw] py-[2cqw]">
        <span className="text-[6.4cqw] font-extrabold leading-tight">Sipariş vermek için okut</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrSrc} alt={`${shopName} WhatsApp sipariş QR kodu`} className="aspect-square w-[52cqw]" />
        <span className="text-[5cqw] font-bold leading-tight">
          Dükkan kodu: <span className="font-mono tracking-wide">#{code}</span>
        </span>
        <span className="text-[3.3cqw] leading-snug text-[#374151]">
          Telefon kameranızla okutun, WhatsApp&apos;ta açılan mesajı gönderin; menü bağlantısı gelir.
        </span>
        {phoneFormatted ? (
          <span className="text-[3.1cqw] leading-snug text-[#374151]">
            QR okumazsa WhatsApp&apos;tan <strong className="whitespace-nowrap">{phoneFormatted}</strong> numarasına <strong>#{code}</strong> yazın.
          </span>
        ) : null}
      </div>
      <p className="px-[6cqw] pb-[3.5cqw] text-[2.4cqw] leading-snug text-[#4b5563]">
        Sohbette “Siparişin Önünde” adını görürsünüz; mesajlarınız yalnız {shopName} işletmesine iletilir ve numaranız yalnız siparişiniz için kullanılır.
      </p>
    </div>
  );
}

/** Masa kartı önizlemesi + boyut seçimi + yazdır. */
export function TableCardPrinter(props: Omit<TableCardProps, 'size'>) {
  const [size, setSize] = useState<TableCardSize>('a6');
  const [printing, setPrinting] = useState(false);
  const dims = CARD_SIZES[size];

  useEffect(() => {
    if (!printing) return;
    const t = window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 50);
    return () => window.clearTimeout(t);
  }, [printing]);

  return (
    <div className="flex flex-col gap-3">
      {/* Baskıda yalnız kart: kartın ataları dışındaki her şey gizlenir (tek sayfa), atalar kutusuz kalır */}
      <style>{`@media print {
        body *:not(:has(#print-table-card)):not(#print-table-card):not(#print-table-card *) { display: none !important; }
        body *:has(#print-table-card) { position: static !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important;
          background: none !important; min-height: 0 !important; height: auto !important; max-width: none !important; overflow: visible !important; }
        #print-table-card { position: absolute !important; inset: 0 auto auto 0 !important; margin: 0 !important; box-shadow: none !important; border: 0 !important;
          width: ${dims.widthMm}mm !important; height: ${dims.heightMm}mm !important; max-width: none !important; }
        @page { size: ${size === 'a5' ? 'A5' : 'A6'}; margin: 0; }
      }`}</style>
      <RadioGroup
        legend="Kart boyutu"
        variant="chips"
        value={size}
        onValueChange={setSize}
        options={(Object.keys(CARD_SIZES) as TableCardSize[]).map((value) => ({ value, label: CARD_SIZES[value].label, description: CARD_SIZES[value].description }))}
      />
      <div className="rounded-md bg-surface p-3">
        <TableCard {...props} size={size} />
      </div>
      <div>
        <Button variant="secondary" onClick={() => setPrinting(true)}>
          <Printer aria-hidden />
          Masa kartını yazdır ({size === 'a5' ? 'A5' : 'A6'})
        </Button>
      </div>
    </div>
  );
}
