import { describe, expect, it } from 'vitest';
import type { StorefrontView } from '@siparis/core/menu/contracts';
import { LEGAL_DOCUMENT_VERSION } from '@siparis/core/enums';
import {
  IMPRINT_PLACEHOLDERS,
  STORE_LEGAL_DOCS,
  WITHDRAWAL_EXCEPTION_TEXT,
  availableImprintRows,
  buildStoreLegalDocument,
  fulfilmentLines,
  imprintRows,
  isStoreLegalDoc,
  paymentMethodsText,
  sellerImprint,
  storeImprint,
  storeLegalHref,
  zoneLines,
  type StoreLegalDocument,
} from './store-legal';

const ID = '00000000-0000-4000-8000-000000000001';
const Z1 = '00000000-0000-4000-8000-0000000000a1';
const Z2 = '00000000-0000-4000-8000-0000000000a2';

const FULL_LEGAL = {
  legalName: 'Mehmet Yılmaz - Bozok Pide Salonu',
  taxNo: '1234567890',
  taxOffice: 'Bozok',
  address: 'Lise Caddesi No: 12, Merkez / Yozgat',
  phone: '+903542120000',
  email: 'iletisim@bozokpide.example',
};

function store(opts: { legal?: Partial<StorefrontView['legal']>; branch?: Partial<StorefrontView['branch']>; zones?: StorefrontView['zones'] } = {}): StorefrontView {
  return {
    tenant: { name: 'Bozok Pide', slug: 'bozok-pide', brandColor: null, logoUrl: null, coverUrl: null, phone: '+903542120000' },
    branch: {
      id: ID,
      name: 'Merkez',
      address: 'Lise Cad. No 12, Medrese Mah., Merkez / Yozgat',
      orderingState: 'open',
      nextOpenAt: null,
      acceptsDelivery: true,
      acceptsPickup: true,
      paymentMethods: ['cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery'],
      mealCardBrands: ['multinet', 'pluxee'],
      prepMinutes: 20,
      busyExtraMinutes: 0,
      phone: '+903542120001',
      ...opts.branch,
    },
    orderingEnabled: true,
    live: true,
    zones: opts.zones ?? [
      { id: Z1, name: 'Medrese', kind: 'neighborhoods', neighborhoods: ['Medrese'], feeKurus: 0, minOrderKurus: 15000, etaMinutes: 10 },
      { id: Z2, name: 'Erdoğan Akdağ', kind: 'neighborhoods', neighborhoods: ['Erdoğan Akdağ'], feeKurus: 2500, minOrderKurus: 0, etaMinutes: 20 },
    ],
    categories: [],
    legal: { ...FULL_LEGAL, ...opts.legal },
  };
}

/** Belgenin tüm metni (başlıklar, paragraflar, listeler, künye satırları). */
function allText(d: StoreLegalDocument): string {
  const parts: string[] = [d.title, ...d.intro];
  for (const s of d.sections) {
    parts.push(s.title);
    for (const b of s.blocks) {
      if (b.kind === 'p') parts.push(b.text);
      else if (b.kind === 'list') parts.push(...b.items);
      else parts.push(...b.rows.map((r) => `${r.label}: ${r.value}`));
    }
  }
  return parts.join('\n');
}

describe('belge adları ve bağlantılar', () => {
  it('yalnız üç belge geçerli', () => {
    expect(STORE_LEGAL_DOCS).toEqual(['aydinlatma', 'on-bilgilendirme', 'mesafeli-satis']);
    for (const d of STORE_LEGAL_DOCS) expect(isStoreLegalDoc(d)).toBe(true);
    expect(isStoreLegalDoc('kvkk-aydinlatma')).toBe(false);
    expect(isStoreLegalDoc('cerez')).toBe(false);
    expect(isStoreLegalDoc('')).toBe(false);
  });

  it('bağlantı işletmenin storefront yolu altında', () => {
    expect(storeLegalHref('bozok-pide', 'aydinlatma')).toBe('/s/bozok-pide/yasal/aydinlatma');
    expect(storeLegalHref('bozok-pide', 'mesafeli-satis')).toBe('/s/bozok-pide/yasal/mesafeli-satis');
  });
});

describe('künye', () => {
  it('tam künye: yer tutucu yok, telefon biçimli', () => {
    const i = storeImprint(store());
    expect(i.missing).toEqual([]);
    expect(i.legalName).toBe(FULL_LEGAL.legalName);
    expect(i.phone).toBe('0 (354) 212 00 00');
    expect(i.email).toBe(FULL_LEGAL.email);
    expect(imprintRows(i).map((r) => r.label)).toEqual(['Unvan', 'İşletme adı', 'Adres', 'Telefon', 'E-posta', 'Vergi dairesi', 'Vergi kimlik no']);
  });

  it('boş zorunlu alanlar köşeli parantezli yer tutucu; isteğe bağlı alanlar hiç gösterilmez', () => {
    const i = sellerImprint({ name: 'Yeni İşletme', legal: { legalName: '  ', taxNo: null, taxOffice: null, address: null, phone: null, email: null } });
    expect(i.legalName).toBe(IMPRINT_PLACEHOLDERS.legalName);
    expect(i.legalName).toBe('[İşletme unvanı]');
    expect(i.address).toBe('[İşletme adresi]');
    expect(i.phone).toBe('[İşletme telefonu]');
    expect(i.taxNo).toBe('[Vergi kimlik no]');
    expect(i.missing).toEqual(['Unvan', 'Adres', 'Telefon', 'Vergi kimlik no']);
    const labels = imprintRows(i).map((r) => r.label);
    expect(labels).not.toContain('E-posta');
    expect(labels).not.toContain('Vergi dairesi');
  });

  it('künye adresi/telefonu yoksa şube adresi ve telefonu kullanılır', () => {
    const i = storeImprint(store({ legal: { address: null, phone: null } }));
    expect(i.address).toBe('Lise Cad. No 12, Medrese Mah., Merkez / Yozgat');
    expect(i.phone).toBe('0 (354) 212 00 01');
    expect(i.missing).toEqual([]);
  });

  it('altbilgi/takip kutusu yalnız dolu alanları gösterir; unvan yoksa ticari ad', () => {
    expect(availableImprintRows({ name: 'Bozok Pide', legal: {} })).toEqual([{ label: 'Unvan', value: 'Bozok Pide' }]);
    const rows = availableImprintRows({ name: 'Bozok Pide', legal: { ...FULL_LEGAL, email: null }, phone: '+905321112233' });
    expect(rows.map((r) => r.label)).toEqual(['Unvan', 'Adres', 'Telefon', 'Vergi dairesi', 'Vergi kimlik no']);
    // Künye telefonu şube telefonundan önce gelir
    expect(rows.find((r) => r.label === 'Telefon')!.value).toBe('0 (354) 212 00 00');
    expect(availableImprintRows({ name: 'X', legal: {}, phone: '+905321112233' }).find((r) => r.label === 'Telefon')!.value).toBe('0 (532) 111 22 33');
  });
});

describe('aydınlatma metni (08 §2.4-B)', () => {
  const d = buildStoreLegalDocument('aydinlatma', store());
  const text = allText(d);

  it('veri sorumlusu işletme, platform veri işleyen', () => {
    expect(d.title).toBe('KVKK aydınlatma metni');
    expect(d.version).toBe(LEGAL_DOCUMENT_VERSION);
    expect(d.sections[0]!.title).toBe('Veri sorumlusu');
    expect(text).toContain('Kişisel verilerinizin veri sorumlusu, künyesi aşağıda yer alan işletmedir');
    expect(d.sections[0]!.blocks.find((b) => b.kind === 'facts')).toMatchObject({ rows: expect.arrayContaining([{ label: 'Unvan', value: FULL_LEGAL.legalName }]) });
    expect(d.intro[0]).toMatch(new RegExp(`^${FULL_LEGAL.legalName} olarak, 6698 sayılı`));
    expect(text).toMatch(/Siparişin Önünde, verilerinizi yalnız bizim adımıza ve talimatımızla işleyen veri işleyendir/);
  });

  it('zorunlu içerik: amaçlar ve hukuki sebepler, toplama yöntemi, aktarım, saklama, m.11 hakları', () => {
    expect(d.sections.map((s) => s.title)).toEqual([
      'Veri sorumlusu',
      'İşlenen kişisel veriler',
      'İşleme amaçları ve hukuki sebepler',
      'Toplama yöntemi',
      'Aktarılan taraflar ve aktarım amacı',
      'Saklama süreleri',
      'Haklarınız (KVKK m.11)',
    ]);
    expect(text).toContain('m.5/2-c');
    expect(text).toContain('m.5/2-ç');
    expect(text).toContain('m.5/2-f');
    expect(text).toMatch(/WhatsApp.*yurt dışı/);
    expect(text).toContain('KVKK m.9');
    expect(text).toContain("Türkiye'deki SMS hizmet sağlayıcısı");
    expect(text).toContain('30 gün sonra silinir');
    expect(text).toContain('7 gün sonra geçersiz olur');
    expect(text).toContain('24 ay');
    expect(text).toContain('35 gün');
  });

  it('başvuru yazılı: künye adresi ve e-postası; telefon bilgi için', () => {
    const rights = d.sections.at(-1)!;
    const para = rights.blocks.filter((b) => b.kind === 'p').map((b) => (b.kind === 'p' ? b.text : '')).join(' ');
    expect(para).toContain(`${FULL_LEGAL.address} adresine ya da ${FULL_LEGAL.email} e-posta adresine`);
    expect(para).toContain('0 (354) 212 00 00 numaralı telefondan');
    expect(para).toContain('30 gün');
  });

  it('belirsiz ifade yok ("vb.", "gibi") ve açık rıza istenmez (08 §2.4)', () => {
    expect(text).not.toMatch(/\bvb\.|\bvs\.|\bgibi\b/i);
    expect(text).toContain('açık rıza metni değildir');
  });

  it('künye eksikse yer tutucularla üretilir', () => {
    const empty = buildStoreLegalDocument('aydinlatma', store({ legal: { legalName: null, taxNo: null, address: null, phone: null, email: null }, branch: { address: null, phone: null } }));
    expect(empty.imprint.missing.length).toBeGreaterThan(0);
    expect(allText(empty)).toContain('[İşletme unvanı]');
    expect(allText(empty)).toContain('[İşletme adresi] adresine iletebilirsiniz');
  });
});

describe('ön bilgilendirme ve mesafeli satış (08 §4.4)', () => {
  it('ön bilgilendirme: satıcı, fiyat, ödeme, teslimat, cayma istisnası, şikâyet yolu', () => {
    const d = buildStoreLegalDocument('on-bilgilendirme', store());
    const text = allText(d);
    expect(d.title).toBe('Ön bilgilendirme formu');
    expect(text).toContain(`Unvan: ${FULL_LEGAL.legalName}`);
    expect(text).toContain('KDV dahil');
    expect(text).toContain(WITHDRAWAL_EXCEPTION_TEXT);
    expect(text).toContain('Mesafeli Sözleşmeler Yönetmeliği m.15');
    expect(text).toContain('tüketici hakem heyetine');
    expect(text).toContain('ödeme yükümlülüğü doğar');
    expect(text).toContain('Siparişin Önünde satıcı ya da aracı değildir');
    // Bölgeye göre teslimat ücreti ve minimum sepet
    expect(text).toContain('Medrese: teslimat ücretsiz, minimum sipariş 150 TL.');
    expect(text).toContain('Erdoğan Akdağ: teslimat ücreti 25 TL.');
  });

  it('mesafeli satış: taraflar, kurulma anı, doğrulamanın ayrı onay olmadığı, cayma istisnası', () => {
    const d = buildStoreLegalDocument('mesafeli-satis', store());
    const text = allText(d);
    expect(d.title).toBe('Mesafeli satış sözleşmesi');
    expect(d.sections[0]!.title).toBe('Taraflar');
    expect(text).toContain(`Vergi kimlik no: ${FULL_LEGAL.taxNo}`);
    expect(text).toContain('ayrı bir sözleşme onayı değildir');
    expect(text).toContain(WITHDRAWAL_EXCEPTION_TEXT);
    expect(text).toContain('taksit yapılmaz');
  });

  it('cayma cümlesi checkout kilitli metniyle aynı (03 §4.4)', () => {
    expect(WITHDRAWAL_EXCEPTION_TEXT).toBe('Gıda siparişleri çabuk bozulabilen ürünler olduğundan cayma hakkı kapsamı dışındadır.');
  });

  it('ödeme yöntemleri: online kart yok, yemek kartı markaları, gel-alda kasa', () => {
    expect(paymentMethodsText(store())).toBe('kapıda nakit, kapıda kredi/banka kartı, kapıda yemek kartı (Multinet, Pluxee); gel-al siparişlerde kasada ödeme.');
    expect(paymentMethodsText(store({ branch: { paymentMethods: ['cash_on_delivery', 'online_card'], acceptsPickup: false } }))).toBe('kapıda nakit.');
  });

  it('teslimat satırları teslim türlerine göre; paket servis kapalıysa bölge listesi boş', () => {
    const both = fulfilmentLines(store());
    expect(both).toHaveLength(2);
    expect(both[0]).toMatch(/^Paket servis: .*Tahmini teslim süresi \d+–\d+ dk;/);
    expect(both[1]).toContain('Gel-al: siparişinizi Lise Cad. No 12, Medrese Mah., Merkez / Yozgat adresinden teslim alırsınız');
    expect(both[1]).toContain('20 dakikadır');
    const pickupOnly = store({ branch: { acceptsDelivery: false } });
    expect(fulfilmentLines(pickupOnly)).toHaveLength(1);
    expect(zoneLines(pickupOnly)).toEqual([]);
  });
});
