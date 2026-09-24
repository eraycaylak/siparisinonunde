'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { currentRole, useMe } from '@/lib/auth';
import { settingsForRole } from './nav-config';

/** Ayarlar ana sayfası: role göre ayar bölümleri. */
export function SettingsIndex() {
  const me = useMe();
  const items = settingsForRole(currentRole(me.data));
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(({ href, label, description, icon: Icon }) => (
        <li key={href}>
          <Link
            href={href}
            className="flex min-h-20 items-center gap-4 rounded-lg border border-border bg-surface-raised p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface text-fg">
              <Icon aria-hidden className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-semibold text-fg">{label}</span>
              {description ? <span className="text-sm text-fg-muted">{description}</span> : null}
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-fg-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
