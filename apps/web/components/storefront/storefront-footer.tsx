import { MessageCircle, Phone } from 'lucide-react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { formatPhone } from '@/lib/format';
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
  return (
    <div className="flex w-full flex-col items-center gap-2">
      {store.tenant.whatsappPhone ? (
        <a
          href={`https://wa.me/${store.tenant.whatsappPhone.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-hit-sf items-center gap-2 rounded-md px-3 text-base font-semibold text-[var(--brand-strong)] underline-offset-4 hover:underline"
        >
          <MessageCircle aria-hidden className="size-5" />
          WhatsApp&apos;tan yaz
        </a>
      ) : null}
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="inline-flex min-h-hit-sf items-center gap-2 rounded-md px-3 text-base font-semibold text-[var(--brand-strong)] underline-offset-4 hover:underline"
        >
          <Phone aria-hidden className="size-5" />
          İşletmeyi ara · {formatPhone(phone)}
        </a>
      ) : null}
      <ImprintDetails rows={rows} />
      <StoreLegalLinks slug={store.tenant.slug} />
    </div>
  );
}
