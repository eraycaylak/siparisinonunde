import { MessageCircle, Phone } from 'lucide-react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { formatPhone } from '@/lib/format';
import { storefrontWaHref } from '@/lib/wa-links';
import { availableImprintRows } from './legal/store-legal';
import { ImprintDetails, StoreLegalLinks } from './legal/store-legal-links';

/**
 * Storefront altbilgisi (03 §4.0): her sayfada aynı yerde "WhatsApp'tan yaz" / "İşletmeyi ara" (tutarlı yardım, WCAG 3.2.6),
 * işletme künyesi (6563 m.3 / 03 §4.9) ve işletmenin yasal metinleri (S-10: aydınlatma, ön bilgilendirme, mesafeli satış).
 * Platform imzası StorefrontShell'de ayrıca durur.
 */
export function StorefrontFooter({ store }: { store: StorefrontView }) {
  const phone = store.branch.phone ?? store.tenant.phone;
  const rows = availableImprintRows({ name: store.tenant.name, legal: store.legal, branchAddress: store.branch.address });
  // Ortak numarada bağlantı dükkan kodlu ön-dolu mesajla açılır (#KOD; 00 §12a madde 8)
  const waHref = storefrontWaHref(store.tenant);
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-hit items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-base font-semibold text-fg shadow-sm hover:bg-accent"
          >
            <MessageCircle aria-hidden className="size-5 text-[#1FAF38]" />
            WhatsApp&apos;tan yaz
          </a>
        ) : null}
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-hit items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-base font-semibold text-fg shadow-sm hover:bg-accent"
          >
            <Phone aria-hidden className="size-5 text-[var(--brand-strong)]" />
            İşletmeyi ara · {formatPhone(phone)}
          </a>
        ) : null}
      </div>
      <ImprintDetails rows={rows} />
      <StoreLegalLinks slug={store.tenant.slug} />
    </div>
  );
}
