// Yasal metin ve künye denetimi (08 §4.7, §7.5; 15 §4, §12). Üç şeyi birlikte sorar:
//   1) Künye (6563 m.3) ortam değişkenlerinden tam dolmuş mu — eksikse hangi değişken eksik?
//   2) Yürürlükteki yasal metin sürümü taslak mı — taslaksa müşteriye sözleşme onaylatılamaz (denetim B2).
//   3) Yasal metin kaynaklarında kodda kalmış yer tutucu / "teyit edilecek" / TODO var mı; yayımlanan yasal
//      bağlantıların sayfası gerçekten var mı; metin içeriği sürümü değişmeden değişmiş mi (içerik özeti).
// Hatada çıkış kodu 1 verir, böylece CI ve dağıtım adımı durur. Gizli değer yazmaz; yalnız değişken ADLARINI yazar.
//
//   node --import tsx scripts/check-legal.ts              # tümü (üretim ortam değişkenleriyle çalıştırın)
//   node --import tsx scripts/check-legal.ts --metinler   # yalnız kaynak taraması (ortam değişkeni gerekmez)
//   node --import tsx scripts/check-legal.ts --ozet       # beklenen içerik özetini yazdır (sürüm yükseltirken)

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_VERSION, isDraftLegalVersion } from '../packages/core/src/enums';
import { LEGAL_NAV, resolveLegalEntity } from '../apps/web/lib/site';

const ROOT = resolve(import.meta.dirname, '..');
const WEB = join(ROOT, 'apps/web');

/** Metin sürümüyle birlikte dondurulan içerik özeti. Metin değişirse bu değer de değişir (08 §7.5). */
const PINNED_TEXT_DIGEST: Record<string, string> = {
  '2026-09-28-taslak': '0fb5c574496153a3a8855b79a3e1a15c7ac34b062e70c69c7153e05371c2d54f',
};

/** Satır bazlı muafiyet işareti: aynı satırda ya da bir üst satırda geçerse o satır taranmaz. */
const EXEMPT_MARKER = 'yasal-denetim:muaf';

/** Kodda kalmamış olması gereken kalıplar. `skip`: kuralın bilerek uygulanmadığı dosyalar. */
const FORBIDDEN: Array<{ id: string; re: RegExp; why: string; skip?: string[] }> = [
  { id: 'teyit', re: /teyit edilecek/i, why: '"teyit edilecek" notu canlı metinde kalmış' },
  { id: 'inceleme', re: /hukuki inceleme/i, why: 'sayfaya çivilenmiş "hukuki inceleme bekliyor" bandı' },
  { id: 'taslak', re: /\btaslakt(ır|ir)\b|\bTaslak tarihi\b|\bTaslak,/i, why: 'sayfaya çivilenmiş taslak ibaresi' },
  { id: 'todo', re: /\b(TODO|FIXME)\b/, why: 'tamamlanmamış iş notu' },
  {
    id: 'parantez',
    re: /\[[A-ZÇĞİÖŞÜ][^\]\n]{3,}\]/,
    why: 'köşeli parantezli yer tutucu metin',
    // İŞLETME künyesi eksikken gösterilen yer tutucular ürünün belgelenmiş davranışıdır (08 §4.7): vitrin bu
    // hâldeyken yayına alınmaz. Platform künyesi artık yapılandırmadan gelir, orada yer tutucu yoktur.
    skip: ['apps/web/components/storefront/legal/store-legal-imprint.ts'],
  },
];

/** İçerik özetine giren yasal metin kaynakları (platformun ve işletmenin belgeleri). */
const TEXT_SOURCES = [
  'apps/web/lib/site.ts',
  'apps/web/components/storefront/legal/store-legal.ts',
  'apps/web/components/storefront/legal/store-legal-imprint.ts',
  ...legalPageFiles(),
];

/** Yer tutucu taraması: metin kaynakları + yalnız çizim yapan kabuklar (künye sayfası, yasal metin kabı). */
const SCANNED = [...TEXT_SOURCES, 'apps/web/app/(marketing)/kunye/page.tsx', 'apps/web/components/marketing/legal-page.tsx'];

const errors: string[] = [];
const notes: string[] = [];

function legalPageFiles(): string[] {
  const dir = join(WEB, 'app/(marketing)/yasal');
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const page = join(dir, entry, 'page.tsx');
    try {
      if (statSync(page).isFile()) out.push(relative(ROOT, page));
    } catch {
      // page.tsx'i olmayan klasör (ör. ortak bileşen): atlanır
    }
  }
  return out;
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

// 1 — Künye
function checkEntity(): void {
  const entity = resolveLegalEntity();
  if (entity.isConfigured) {
    notes.push('Künye tam: zorunlu alanların hepsi yapılandırılmış.');
    return;
  }
  errors.push(`Künye eksik (6563 m.3). Tanımlanması gereken ortam değişkenleri: ${entity.missing.join(', ')}`);
}

// 2 — Sürüm
function checkVersion(): void {
  if (isDraftLegalVersion(LEGAL_DOCUMENT_VERSION)) {
    errors.push(
      `Yasal metin sürümü taslak: "${LEGAL_DOCUMENT_VERSION}". Avukat onayından sonra packages/core/src/enums.ts ` +
        'içindeki LEGAL_DOCUMENT_VERSION tarihli yayın sürümüne çevrilmelidir. UYARI: taslak sürümde sipariş ucunu ' +
        'kapatan fail-closed kapı henüz yazılmadı (08 §7.5), yani şu an taslak metinle sözleşme kuruluyor.',
    );
  } else {
    notes.push(`Yasal metin sürümü yayınlanmış: ${LEGAL_DOCUMENT_VERSION}`);
  }
  if (!(LEGAL_DOCUMENTS as readonly string[]).includes('dpa')) errors.push('LEGAL_DOCUMENTS içinde "dpa" yok: DPA kabul kaydı yazılamaz.');
}

// 3a — Yer tutucu taraması
function checkSources(): void {
  for (const path of SCANNED) {
    const lines = read(path).split('\n');
    lines.forEach((line, i) => {
      if (line.includes(EXEMPT_MARKER) || lines[i - 1]?.includes(EXEMPT_MARKER)) return;
      for (const rule of FORBIDDEN) {
        if (rule.skip?.includes(path)) continue;
        if (rule.re.test(line)) errors.push(`${path}:${i + 1} — ${rule.why}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

// 3b — Yayımlanan yasal bağlantıların sayfası var mı
function checkNavTargets(): void {
  for (const item of LEGAL_NAV) {
    const page = join(WEB, 'app/(marketing)', `${item.href}/page.tsx`);
    try {
      statSync(page);
    } catch {
      errors.push(`Altbilgideki "${item.label}" bağlantısının sayfası yok: ${item.href}`);
    }
  }
}

// 3c — İçerik özeti
function textDigest(): string {
  const hash = createHash('sha256');
  for (const path of TEXT_SOURCES) hash.update(`${path}\n${read(path)}\n`);
  return hash.digest('hex');
}

function checkDigest(): void {
  const digest = textDigest();
  const pinned = PINNED_TEXT_DIGEST[LEGAL_DOCUMENT_VERSION];
  if (!pinned) {
    errors.push(
      `"${LEGAL_DOCUMENT_VERSION}" sürümü için içerik özeti sabitlenmemiş. scripts/check-legal.ts içindeki ` +
        `PINNED_TEXT_DIGEST'e ekleyin: '${LEGAL_DOCUMENT_VERSION}': '${digest}'`,
    );
    return;
  }
  if (pinned !== digest) {
    errors.push(
      `Yasal metin değişmiş ama sürüm aynı kalmış (08 §7.5: yayınlanmış sürüm değiştirilemez). Yeni bir sürüm yazın ` +
        `ya da bu sürümün özetini güncelleyin. Beklenen: ${pinned} · Bulunan: ${digest}`,
    );
    return;
  }
  notes.push(`İçerik özeti sürümle uyumlu: ${digest.slice(0, 16)}…`);
}

const args = new Set(process.argv.slice(2));

if (args.has('--ozet')) {
  console.log(`${LEGAL_DOCUMENT_VERSION} ${textDigest()}`);
  process.exit(0);
}

if (!args.has('--metinler')) checkEntity();
checkVersion();
checkSources();
checkNavTargets();
checkDigest();

for (const note of notes) console.log(`Tamam: ${note}`);
if (errors.length) {
  console.error(`\nYasal denetim başarısız (${errors.length} bulgu):`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nAyrıntı: docs/08-mevzuat-kvkk-odeme-fatura.md §4.7 ve §7.5, docs/15-kurulum-ve-isletim.md §4, §12.');
  process.exitCode = 1;
} else {
  console.log('Yasal denetim tamam: künye dolu, sürüm yayınlanmış, metinlerde yer tutucu yok.');
}
