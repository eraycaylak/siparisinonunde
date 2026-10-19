// /kunye (6563 m.3): satırlar site.ts `legalEntityRows` tek sırasından gelir — DPA ile aynı 10 alan, KEP dahil —
// ve değerler istek anındaki ortamdan (getLegalEntity) okunur. Eskiden sayfa kendi 9 alanlık listesini tutuyordu:
// vars'a KEP girildiğinde /yasal/dpa gösteriyor, künye sayfası göstermiyordu.

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_ENTITY_ENV } from '@/lib/legal-entity-env';
import { legalEntityRows, resolveLegalEntity } from '@/lib/site';
import ImprintPage from './page';

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));

const KEYS = Object.values(LEGAL_ENTITY_ENV);
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function render(): Promise<string> {
  return renderToStaticMarkup(await ImprintPage());
}

describe('/kunye', () => {
  it('KEP dahil künyenin bütün alanlarını DPA ile aynı sırada gösterir', async () => {
    process.env.LEGAL_ENTITY_NAME = 'Çalışma Zamanı Unvanı';
    process.env.LEGAL_ENTITY_KEP = 'ornek@hs01.kep.tr';
    const html = await render();
    expect(html).toContain('KEP adresi');
    expect(html).toContain('ornek@hs01.kep.tr');
    expect(html).toContain('Çalışma Zamanı Unvanı');

    const labels = [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1]);
    expect(labels).toEqual(legalEntityRows(resolveLegalEntity({})).map((row) => row.label));
    expect(labels).toHaveLength(10);
  });

  it('künye boşsa eksik değişkeni yazar, uydurmaz', async () => {
    const html = await render();
    expect(html).toContain('Eksik yapılandırma: LEGAL_ENTITY_NAME');
    expect(html).toContain('Eksik yapılandırma: LEGAL_ENTITY_TAX_NO');
  });
});
