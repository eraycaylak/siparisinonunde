import { MessageCircle, Phone } from 'lucide-react';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { formatPhone } from '@/lib/format';

/**
 * Storefront altbilgisi (03 §4.0): her sayfada aynı yerde "WhatsApp'tan yaz" / "İşletmeyi ara" (tutarlı yardım, WCAG 3.2.6) ve
 * işletme künyesi (6563 m.3 / 03 §4.9). Platform imzası StorefrontShell'de ayrıca durur.
 */
export function StorefrontFooter({ store }: { store: StorefrontView }) {
  const phone = store.branch.phone ?? store.tenant.phone;
  const legal = store.legal;
  const rows: [string, string | null][] = [
    ['Unvan', legal.legalName ?? store.tenant.name],
    ['Adres', legal.address ?? store.branch.address],
    ['Telefon', legal.phone ? formatPhone(legal.phone) : null],
    ['E-posta', legal.email],
    ['Vergi dairesi', legal.taxOffice],
    ['Vergi no', legal.taxNo],
  ];
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
      <details className="w-full max-w-md text-start text-sm text-fg-muted">
        <summary className="flex min-h-hit-sf cursor-pointer items-center justify-center rounded-md px-3 font-semibold text-fg">
          İşletme bilgileri (künye)
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-surface p-3">
          {rows
            .filter((r): r is [string, string] => Boolean(r[1]))
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-semibold text-fg">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
        </dl>
      </details>
    </div>
  );
}
