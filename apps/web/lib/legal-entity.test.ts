// Künyenin çalışma zamanı okuması (15 §4; 6563 m.3). Üç kapı:
//   1) getLegalEntity değeri connection()'DAN SONRAKİ ortamdan okur (rota prerender dışına alınmadan ortam okunmaz).
//   2) Geçerli ad yalnız LEGAL_*'dır; NEXT_PUBLIC_LEGAL_* okunmaz (derlemede gömülür; API kapısı da saymaz).
//   3) Künyeyi gösteren hiçbir sayfa/bileşen/yardımcı derleme anındaki değere bağlı kalamaz: ya getLegalEntity
//      kullanır ya da istek anında çizilen yasal yerleşimin (app/(marketing)/yasal/layout.tsx) altındadır.
// Kapı 3 olmadan yeni bir sayfa künyeyi doğrudan okuyup statik derlenirse canlıda "Eksik yapılandırma:
// LEGAL_ENTITY_*" sessizce geri döner (vars dolu, API kapısı açık, sayfa boş).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLegalEntity } from './legal-entity';
import { LEGAL_ENTITY_ENV, readLegalEntityEnv } from './legal-entity-env';

// connection() istek kapsamı dışında hata verir; taklit çağrıyı kaydeder ve isterse ortamı DEĞİŞTİRİR — böylece
// ortamın connection()'dan önce mi sonra mı okunduğu dönen değerden anlaşılır.
const { calls, hook } = vi.hoisted(() => ({
  calls: [] as string[],
  hook: { onConnection: null as null | (() => void) },
}));

vi.mock('next/server', () => ({
  connection: vi.fn(async () => {
    calls.push('connection');
    hook.onConnection?.();
  }),
}));

const KEYS = Object.values(LEGAL_ENTITY_ENV);

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  calls.length = 0;
  hook.onConnection = null;
  for (const key of KEYS) {
    saved[key] = process.env[key];
    saved[`NEXT_PUBLIC_${key}`] = process.env[`NEXT_PUBLIC_${key}`];
    delete process.env[key];
    delete process.env[`NEXT_PUBLIC_${key}`];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function setFullEntity(title: string): void {
  process.env.LEGAL_ENTITY_NAME = title;
  process.env.LEGAL_ENTITY_TYPE = 'Şahıs şirketi';
  process.env.LEGAL_ENTITY_ADDRESS = 'Örnek Mahallesi 1. Sokak No 1, Merkez / Yozgat';
  process.env.LEGAL_ENTITY_PHONE = '+903540000000';
  process.env.LEGAL_ENTITY_TAX_OFFICE = 'Yozgat';
  process.env.LEGAL_ENTITY_TAX_NO = '1234567890';
}

describe('getLegalEntity: künye istek anında okunur (15 §4)', () => {
  it('ortam connection() SONRASI okunur', async () => {
    setFullEntity('connection öncesi');
    hook.onConnection = () => {
      process.env.LEGAL_ENTITY_NAME = 'connection sonrası';
    };
    const entity = await getLegalEntity();
    expect(calls).toEqual(['connection']);
    // Ortam connection()'dan önce okunsaydı "connection öncesi" dönerdi (prerender'da derleme ortamı donardı)
    expect(entity.title).toBe('connection sonrası');
    expect(entity.isConfigured).toBe(true);
  });

  it('değer her çağrıda yeniden okunur: modül yüklenirken dondurulmuş bir kopya yok', async () => {
    setFullEntity('Birinci Unvan');
    expect((await getLegalEntity()).title).toBe('Birinci Unvan');
    process.env.LEGAL_ENTITY_NAME = 'İkinci Unvan';
    expect((await getLegalEntity()).title).toBe('İkinci Unvan');
    expect(calls).toEqual(['connection', 'connection']);
  });

  it('künye boşsa uydurulmaz: eksik değişkenin adı yazar, isteğe bağlılar "Yok", e-posta marka adresi', async () => {
    const entity = await getLegalEntity();
    expect(entity.isConfigured).toBe(false);
    expect(entity.missing).toEqual([
      'LEGAL_ENTITY_NAME',
      'LEGAL_ENTITY_TYPE',
      'LEGAL_ENTITY_ADDRESS',
      'LEGAL_ENTITY_PHONE',
      'LEGAL_ENTITY_TAX_OFFICE',
      'LEGAL_ENTITY_TAX_NO',
    ]);
    expect(entity.title).toBe('Eksik yapılandırma: LEGAL_ENTITY_NAME');
    expect(entity.mersis).toBe('Yok');
    expect(entity.email).toBe('destek@yemekgelsin.net');
  });
});

describe('geçerli ad yalnız LEGAL_* (API kapısıyla aynı anlam)', () => {
  it('NEXT_PUBLIC_LEGAL_* okunmaz: düz ad tanımsızsa alan eksiktir', async () => {
    setFullEntity('Düz Ad');
    delete process.env.LEGAL_ENTITY_TAX_NO;
    process.env.NEXT_PUBLIC_LEGAL_ENTITY_TAX_NO = '1234567890';
    process.env.NEXT_PUBLIC_LEGAL_ENTITY_KEP = 'ornek@hs01.kep.tr';
    const entity = await getLegalEntity();
    expect(entity.missing).toEqual(['LEGAL_ENTITY_TAX_NO']);
    expect(entity.kep).toBe('Yok');
  });

  // Compose `web.environment` LEGAL_X'i her zaman yazar (.env'de yoksa ""): bu vaka eskiden web'de "eksik", API
  // kapısında "tam" çıkıyordu — sipariş alınırken /kunye boş kalıyordu. Aynı vaka apps/api/test/legal-gate.test.ts'te
  // API için sınanır; ikisi de LEGAL_ENTITY_TAX_NO'yu eksik sayar.
  it('LEGAL_X="" + NEXT_PUBLIC_LEGAL_X dolu → eksik (API kapısı da kapalı kalır)', async () => {
    setFullEntity('Düz Ad');
    process.env.LEGAL_ENTITY_TAX_NO = '';
    process.env.NEXT_PUBLIC_LEGAL_ENTITY_TAX_NO = '1234567890';
    expect((await getLegalEntity()).missing).toEqual(['LEGAL_ENTITY_TAX_NO']);
  });

  it('readLegalEntityEnv verilen ortamdan yalnız LEGAL_* adlarını alır', () => {
    const raw = readLegalEntityEnv({ LEGAL_ENTITY_NAME: 'A', NEXT_PUBLIC_LEGAL_ENTITY_TYPE: 'B', LEGAL_ENTITY_KEP: 'k' });
    expect(raw.title).toBe('A');
    expect(raw.type).toBeUndefined();
    expect(raw.kep).toBe('k');
    expect(Object.keys(raw).sort()).toEqual(Object.keys(LEGAL_ENTITY_ENV).sort());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Kaynak kapıları

const WEB = fileURLToPath(new URL('../', import.meta.url));
const LEGAL_LAYOUT = 'app/(marketing)/yasal/layout.tsx';
const read = (path: string): string => readFileSync(join(WEB, path), 'utf8');

describe('LEGAL_ENTITY_ENV, site.ts LEGAL_ENTITY_FIELDS ile birebir aynı (sapma kapısı)', () => {
  it('alan → değişken eşlemesi ve sırası aynı', () => {
    // site.ts yasal metin içerik özetine girer (scripts/check-legal.ts TEXT_SOURCES), eşleme oradan dışa açılmadı;
    // kaynak metinden okunur.
    const src = read('lib/site.ts');
    const block = /const LEGAL_ENTITY_FIELDS = \{([\s\S]*?)\n\} satisfies/.exec(src);
    expect(block, 'site.ts içinde LEGAL_ENTITY_FIELDS bloğu bulunamadı').toBeTruthy();
    const fromSite = [...block![1]!.matchAll(/^\s*(\w+): \{ env: '([A-Z0-9_]+)'/gm)].map((m) => [m[1], m[2]]);
    expect(fromSite.length).toBe(10);
    expect(Object.entries(LEGAL_ENTITY_ENV)).toEqual(fromSite);
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(relative(WEB, full).split(sep).join('/'));
  }
  return out;
}

/**
 * Künyeyi istek anı dışında (derleme anında donabilecek biçimde) okuyan kalıplar:
 *   - `LEGAL_ENTITY` sabiti: modül yüklenirken hesaplanır; statik rotada `next build` ortamı HTML'e donar
 *   - `legalEntityRows()` argümansız: varsayılan parametresi `LEGAL_ENTITY` sabitidir (site.ts)
 *   - `resolveLegalEntity(` / `readLegalEntityEnv(` doğrudan çağrısı: connection() olmadan ortam okur
 *   - `process.env.LEGAL_*` / `process.env.NEXT_PUBLIC_LEGAL_*` doğrudan okuması
 */
const BUILD_TIME_READS: Array<{ id: string; re: RegExp }> = [
  { id: 'LEGAL_ENTITY sabiti', re: /\bLEGAL_ENTITY\b(?!_)/ },
  { id: 'legalEntityRows() argümansız', re: /\blegalEntityRows\(\s*\)/ },
  { id: 'resolveLegalEntity(', re: /\bresolveLegalEntity\(/ },
  { id: 'readLegalEntityEnv(', re: /\breadLegalEntityEnv\(/ },
  { id: 'process.env künye okuması', re: /process\.env(?:\.|\[\s*['"`])(?:NEXT_PUBLIC_)?LEGAL_/ },
];

/** Yorum satırları hariç (açıklama bu adlardan söz edebilir). */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

function buildTimeReads(src: string): string[] {
  const code = codeOnly(src);
  return BUILD_TIME_READS.filter((rule) => rule.re.test(code)).map((rule) => rule.id);
}

/** Künyeyi okumanın TANIMLANDIĞI dosyalar: kural bunların içini değil, kullananları denetler. */
const DEFINERS = new Set(['lib/site.ts', 'lib/legal-entity.ts', 'lib/legal-entity-env.ts']);

describe('künyeyi gösteren her yer derleme anına bağlı değildir', () => {
  const files = [...sourceFiles(join(WEB, 'app')), ...sourceFiles(join(WEB, 'components')), ...sourceFiles(join(WEB, 'lib'))].filter(
    (path) => !DEFINERS.has(path),
  );

  it('dedektör derleme anı okumalarını tanır, istek anı okumasını tanımaz', () => {
    expect(buildTimeReads('const t = LEGAL_ENTITY.title;')).toEqual(['LEGAL_ENTITY sabiti']);
    expect(buildTimeReads('legalEntityRows().map((r) => r.label)')).toEqual(['legalEntityRows() argümansız']);
    expect(buildTimeReads('const e = resolveLegalEntity();')).toEqual(['resolveLegalEntity(']);
    expect(buildTimeReads('resolveLegalEntity(readLegalEntityEnv())')).toEqual(['resolveLegalEntity(', 'readLegalEntityEnv(']);
    expect(buildTimeReads('const n = process.env.LEGAL_ENTITY_NAME;')).toEqual(['process.env künye okuması']);
    expect(buildTimeReads("const k = process.env['NEXT_PUBLIC_LEGAL_ENTITY_KEP'];")).toEqual(['process.env künye okuması']);
    expect(buildTimeReads('const e = await getLegalEntity(); legalEntityRows(e);')).toEqual([]);
    expect(buildTimeReads('// LEGAL_ENTITY yorumda geçebilir\nconst x = 1;')).toEqual([]);
  });

  it('künyeyi derleme anında okuyabilen kod yalnız istek anında çizilen yasal yerleşimin altında', () => {
    const users = files.filter((path) => buildTimeReads(read(path)).length > 0);
    // Tarama gerçekten çalışıyor mu (klasör taşınırsa kapı sessizce "temiz" görünmesin): üç klasör de taranıyor
    expect(users).toContain('app/(marketing)/yasal/kvkk-aydinlatma/page.tsx');
    expect(files).toContain('components/marketing/site-footer.tsx');
    expect(files).toContain('lib/seo.ts');
    const offenders = users
      .filter((path) => !path.startsWith('app/(marketing)/yasal/'))
      .map((path) => `${path}: ${buildTimeReads(read(path)).join(', ')}`);
    expect(offenders, 'künyeyi getLegalEntity() ile (istek anında) okuyun; bkz. lib/legal-entity.ts').toEqual([]);
  });

  it('yasal yerleşim her isteği dinamik çizer (connection)', () => {
    const layout = read(LEGAL_LAYOUT);
    expect(layout).toMatch(/import \{ connection \} from 'next\/server'/);
    expect(layout).toMatch(/await connection\(\);/);
  });

  it('altbilgi ve künye sayfası künyeyi getLegalEntity ile okur', () => {
    for (const path of ['components/marketing/site-footer.tsx', 'app/(marketing)/kunye/page.tsx']) {
      expect(read(path), path).toMatch(/await getLegalEntity\(\)/);
    }
  });

  it('getLegalEntity istemci bileşeninde kullanılmaz (connection yalnız sunucuda çalışır)', () => {
    const offenders = files.filter((path) => {
      const src = read(path);
      return /^\s*['"]use client['"]/.test(src) && src.includes('@/lib/legal-entity');
    });
    expect(offenders).toEqual([]);
  });
});
