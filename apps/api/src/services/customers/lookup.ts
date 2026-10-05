// Telefon siparişinde müşteri arama (04 §4.13; uç `GET /panel/orders/manual/customers`).
//
// İSTEK (Eray): "telefon numarasına 0 yazdığım andan itibaren listeleme başlasın, Ahmet'te de mesela a'ya
// bastım direk listelemeye başlasın ve çok hızlı olsun bekleyip durmasın." Yani: ilk karakterden itibaren,
// telefonun yanı sıra ADLA da, tuş başına.
//
// ÜÇ DAL (sınıflandırma mekaniktir, `classifyLookup`):
//   * `latest` — normalize edilmiş ulusal telefon kısmı BOŞSA ("0", "+90", "90", "(0)" …) süzgeç UYGULANMAZ ve
//     son sipariş verenler döner. Türkiye'de her cep numarası `0` ile başladığı için `0` sıfır seçicilik taşır;
//     eski kod onu boş dizgeye düşürüp "en az 3 karakter" kapısından boş liste döndürüyordu — Eray'ın gördüğü
//     "hiçbir şey olmuyor" tam olarak budur. Bu dal hem en faydalı listedir (telefonla arayan kişi büyük
//     olasılıkla son dönemin müşterisidir) hem de bedavadır: mevcut `customers_tenant_last_order_idx`
//     Index Scan Backward ile karşılar (ölçüm 0,017 ms / 90.000 satır).
//     ⚠️ `where last_order_at is not null order by last_order_at desc` yazımı ZORUNLU. `desc nulls last`
//     yazılırsa indeks sırası eşleşmez ve planlayıcı tüm kiracıyı sıralar (ölçüm: 7,6 ms). Siparişi olmayan
//     taze kayıtlar bu dalda listelenmez (bilinçli: kasiyer o durumda zaten yeni müşteri giriyor).
//   * `phone` — ulusal rakamlara ÖNEK aramasi (`+90<rakamlar>%`), `customers_tenant_phone_prefix_idx`.
//   * `name`  — katlanmış ada ÖNEK aramasi, `customers_tenant_name_fold_idx` (ifade indeksi).
//
// İÇERİK (contains) YEDEĞİ aynı SQL'de `union all` ile, `rnk = 1` olarak döner (tek gidiş-dönüş). Yalnız
// telefonda ≥ 4 rakam / adda ≥ 3 harf iken eklenir: kısa desende içerik aramasi hem anlamsız hem pahalıdır.
// Bu dal `apps/api/test/order-panel.test.ts`'teki `?phone=2223344` (son 7 hane) aramasını yeşil tutar.
//
// ⚠️ İÇERİK BACAĞI İNDEKSSİZDİR VE MALİYETİ ADAY PENCERESİYLE SINIRLANMAZ — ölçülmüş borç, 09'da madde.
// `like '%x%'` btree kullanamaz; üstelik `${LIVE}` anti-join'i planlayıcı Hash (Right) Anti Join seçtiğinde
// eşleşen kümenin TAMAMI materyalize edilir ve `limit 200`'ün erken çıkışı KAYBOLUR. Tek kiracıda ölçüm
// (PostgreSQL 17; 90.000 satırlık kiracı, 100.000 satırlık tablo): ad öneki 1–4 ms, ama 7+ harflik ad (içerik bacağı 200'ü dolduramıyor)
// 160–230 ms — tuş BAŞINA, geciktirme de yok. 10.000 satırlık kiracıda aynı sorgu 10–16 ms, yani PİLOT
// ÖLÇEKTE (tek işletme, binlerce müşteri) kabul edilebilir; on binlere çıkınca gerekir: ya içerik bacağını
// kaldırmak (önek yeter), ya pg_trgm + GIN, ya da normalize/ters çevrilmiş kolon + önek indeksi.
//
// 200'LÜK ADAY PENCERESİ (`LOOKUP_CANDIDATE_WINDOW`): önek süzgeci + `order by last_order_at` eşleşen TÜM
// satırları sıralatır, bu da seçici olmayan sorgularda (tek harf `a` → on binlerce eşleşme) indeks olsa bile
// patlar. İç sorgu sıralamasız `limit 200` ile kesilir, sıralama dış sorguda 200 aday üzerinde yapılır
// (ölçüm: tek harf `a%` 17,9–51,4 ms → 0,212 ms). Bedeli: seçici olmayan sorguda "en yeni 8" YAKLAŞIK DEĞİL,
// SİSTEMATİK OLARAK SAPMALIDIR — pencere sıralamasız kesildiği için gelen 200 aday indeks sırasındaki ilk
// 200'dür, yani alfabede/numarada EN ÖNDE olanlar; "en yeni" sıralaması yalnız o 200 içinde doğrudur.
// 1–2 karakterde bu zararsızdır (o listeye kimse bakmaz), 3+ karakterde aday kümesi pratikte tamdır.
//
// YÜK BÖLME: liste yolu (`detail=0`) TEK sorgudur. Adres/son sipariş/kalem/seçenek yükü `loadCustomerDetails`
// ile ayrıntı yoluna taşındı ve eşleşme sayısından BAĞIMSIZ 4 sorgudur (eskiden müşteri başına ~4 sorgu: 5
// müşteri = ~21 sorgu).

import { FOLD_FROM, FOLD_TO, foldSearch, maskPhone } from '@siparis/core';
import type { CustomerLookupItem } from '@siparis/core/orders/contracts';
import type { Database } from '@siparis/db';
import { sql, type SQL } from 'drizzle-orm';
import { isoOrNull } from '../settings/common';

/** İç sorgunun aday tavanı; dış sıralama bu pencere üzerinde yapılır. */
export const LOOKUP_CANDIDATE_WINDOW = 200;
/** Önek eşleşmesi yoksa içerik (contains) yedeği: telefonda en az bu kadar rakam gerekir. */
export const PHONE_CONTAINS_MIN_DIGITS = 4;
/** Ad için içerik yedeği eşiği. */
export const NAME_CONTAINS_MIN_CHARS = 3;
/** Ayrıntı yolunda müşteri başına dönen adres ve sipariş sayısı (bugünkü davranış). */
export const DETAIL_ADDRESS_LIMIT = 5;
export const DETAIL_ORDER_LIMIT = 3;

// Katlama harfleri `@siparis/core`'dan gelir ki SQL ifadesi ile TS ikizi (`foldSearch`) tek kaynaktan beslensin.
// Dizgeler SQL'e HAM gömülür (`sql.raw`), çünkü ifade indeksinin eşleşmesi için desenin planlama anında sabit
// olması en güvenli yoldur. Gömülen değer kullanıcı girdisi DEĞİL, derleme zamanı sabitidir; yine de sınırda
// doğrulanır (CLAUDE.md "Validate input at system boundaries").
if (/['\\]/.test(FOLD_FROM + FOLD_TO)) {
  throw new Error('FOLD_FROM/FOLD_TO tek tırnak veya ters bölü içeremez (SQL ifadesine ham gömülüyor).');
}
/**
 * Ad katlama ifadesi — `packages/db/migrations/0006_customers_search_index.sql` içindeki indeks ifadesiyle ve
 * `packages/core/src/text.ts` → `foldSearch` ile BİREBİR aynı sonucu vermek zorundadır.
 *
 * `lower()`/`ILIKE` KULLANILMAZ; gerekçe `packages/core/src/text.ts` başında ölçümleriyle durur. Kısası:
 * `lower()` HİÇBİR collation'da `ı`/`İ`'yi `i`'ye katlamaz (`lower('Ahmet Yıldız')` → `'ahmet yıldız'`,
 * `'Ahmet Yıldız' ILIKE '%yildiz%'` → false; PostgreSQL 17'de `C` ve `C.UTF-8`'de ölçüldü), üstelik `ILIKE`
 * önek indeksini hiç kullanamaz. `translate()` locale'den bağımsız ve IMMUTABLE'dır (ifade indeksi için şart).
 *
 * ⚠️ ÖNEK İNDEKSİNİN KULLANILMASI HAZIR DEYİM (prepared statement) OLMAMASINA BAĞLIDIR. PostgreSQL önek
 * çıkarımını (`like 'ahm%'` → `~>=~ 'ahm'`) yalnız deseni BİLDİĞİNDE yapar; aynı hazır deyim birkaç kez
 * koşup planlayıcı GENEL (generic) plana geçtiğinde desen bilinmez olur ve plan Seq Scan'e düşer — ölçüldü
 * (`prepare` + 7. koşu → `Seq Scan on customers`, indeks yok). Bugün bu olmuyor çünkü drizzle'ın postgres-js
 * oturumu her sorguyu `client.unsafe(query, params)` ile yolluyor ve postgres-js `unsafe`i `prepare: false`
 * ile kuruyor (`drizzle-orm/postgres-js/session`, `postgres/src/index.js`), yani her koşu ÖZEL (custom) plan.
 * Sürücü değişirse ya da `prepare: true` açılırsa bu indeksler SESSİZCE devre dışı kalır; o adımda ad/telefon
 * aramasını yeniden ölçün. (`apps/api/test/order-lookup.test.ts` içindeki EXPLAIN çiti deseni SABİT yazdığı
 * için bu durumu göremez.)
 */
export const NAME_FOLD_SQL = sql.raw(`translate(c.name, '${FOLD_FROM}', '${FOLD_TO}')`);

/** LIKE deseninde joker kaçışı. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Ulusal telefon rakamları: baştaki sıfırlar ve ülke kodu atılır. "0" → "" (süzgeçsiz dal), "0532" → "532",
 * "00905321" → "5321", "9" → "" (ülke kodunun yarısı; tek başına eleme yapmaz).
 */
export function nationalDigits(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (d === '9') return '';
  return d.startsWith('90') ? d.slice(2) : d;
}

export type LookupMode = 'latest' | 'phone' | 'name';

export interface LookupTerms {
  mode: LookupMode;
  /** `phone` dalında ulusal rakamlar; diğer dallarda boş. */
  digits: string;
  /** `name` dalında katlanmış desen; diğer dallarda boş. */
  fold: string;
}

/**
 * Sorguyu dala ayırır. Harf VARSA ad dalı (rakam da olsa: "Ahmet 2" bir addır); yalnız rakam/biçim karakteri
 * varsa telefon dalı; normalize sonucu boşsa `latest`.
 */
export function classifyLookup(raw: string): LookupTerms {
  const q = raw.trim();
  const letters = q.replace(/[\d\s()+./-]/g, '');
  if (letters.length > 0) {
    const fold = foldSearch(q);
    return fold === '' ? { mode: 'latest', digits: '', fold: '' } : { mode: 'name', digits: '', fold };
  }
  const digits = nationalDigits(q);
  return digits === '' ? { mode: 'latest', digits: '', fold: '' } : { mode: 'phone', digits, fold: '' };
}

// Ham satır tipleri `interface` DEĞİL `type` olmak zorunda: `db.execute<T>` T'den `Record<string, unknown>`
// ister ve TypeScript örtük indeks imzasını yalnız tip TAKMA ADLARINA verir, arayüzlere vermez.
type LookupRow = {
  id: string;
  name: string | null;
  phone_e164: string | null;
  order_count: number | string;
  is_blocked: boolean;
  notes: string | null;
  last_order_at: Date | string | null;
  address_count: number | string;
};

const toDate = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

/** Anonimleştirilmiş (KVKK, 08 §2.10) müşteri aramada ÇIKMAZ — CRM listesiyle aynı kapı. */
const LIVE = sql`not exists (select 1 from customer_erasures e where e.customer_id = c.id)`;

/** Bir dalın aday sorgusu; her bacak kendi `limit`i için alt sorguya sarılır (çıplak `union all` + `limit` hatalıdır). */
function candidateSql(tenantId: string, terms: LookupTerms, limit: number): SQL {
  if (terms.mode === 'latest') {
    return sql`select c.id, 0 as rnk from customers c
       where c.tenant_id = ${tenantId} and c.last_order_at is not null and ${LIVE}
       order by c.last_order_at desc
       limit ${limit}`;
  }
  const legs: SQL[] = [];
  if (terms.mode === 'phone') {
    const d = escapeLike(terms.digits);
    legs.push(sql`select c.id, 0 as rnk from customers c
       where c.tenant_id = ${tenantId} and c.phone_e164 is not null and c.phone_e164 like ${`+90${d}%`} and ${LIVE}
       limit ${LOOKUP_CANDIDATE_WINDOW}`);
    if (terms.digits.length >= PHONE_CONTAINS_MIN_DIGITS) {
      legs.push(sql`select c.id, 1 as rnk from customers c
         where c.tenant_id = ${tenantId} and c.phone_e164 is not null and c.phone_e164 like ${`%${d}%`} and ${LIVE}
         limit ${LOOKUP_CANDIDATE_WINDOW}`);
    }
  } else {
    const f = escapeLike(terms.fold);
    legs.push(sql`select c.id, 0 as rnk from customers c
       where c.tenant_id = ${tenantId} and c.name is not null and ${NAME_FOLD_SQL} like ${`${f}%`} and ${LIVE}
       limit ${LOOKUP_CANDIDATE_WINDOW}`);
    if (terms.fold.length >= NAME_CONTAINS_MIN_CHARS) {
      legs.push(sql`select c.id, 1 as rnk from customers c
         where c.tenant_id = ${tenantId} and c.name is not null and ${NAME_FOLD_SQL} like ${`%${f}%`} and ${LIVE}
         limit ${LOOKUP_CANDIDATE_WINDOW}`);
    }
  }
  return sql.join(
    legs.map((leg) => sql`select id, rnk from (${leg}) w`),
    sql` union all `,
  );
}

/**
 * Bir eşleşme: dışa verilecek LİSTE gövdesi (`item`, maskeli) + yalnız ayrıntı gövdesinde kullanılacak ham
 * alanlar. Ham telefon ve not asla kendiliğinden yanıta girmez; `attachDetails` ile bilinçli eklenir.
 */
export interface LookupHit {
  item: CustomerLookupItem;
  phoneE164: string | null;
  notes: string | null;
}

/** Müşteri kolonları; `c` takma adı şarttır. Üç yerde aynı: aday penceresi, liste ve `/:id`. */
const BASE_FIELDS = sql`c.id, c.name, c.phone_e164, c.order_count, c.is_blocked, c.notes, c.last_order_at`;
/** `select` listesi iki yerde (arama ve `/:id`) aynı; tek kaynak. */
const LIST_FIELDS = sql`${BASE_FIELDS}, coalesce(a.n, 0) as address_count`;
/** Adres sayısı: `customer_addresses_customer_idx (tenant_id, customer_id)` indeks aramasi, satır başına bir kez. */
const ADDRESS_COUNT_JOIN = (tenantId: string) => sql`left join lateral (
        select count(*) as n from customer_addresses ca
         where ca.tenant_id = ${tenantId} and ca.customer_id = c.id
      ) a on true`;

function toHit(r: LookupRow): LookupHit {
  return {
    item: {
      id: r.id,
      name: r.name,
      phoneMasked: r.phone_e164 ? maskPhone(r.phone_e164) : null,
      orderCount: Number(r.order_count ?? 0),
      isBlocked: r.is_blocked,
      hasNotes: Boolean(r.notes),
      lastOrderAt: isoOrNull(toDate(r.last_order_at)),
      addressCount: Number(r.address_count ?? 0),
    },
    phoneE164: r.phone_e164,
    notes: r.notes,
  };
}

/**
 * Liste yolu: TEK sorgu (tek gidiş-dönüş). Ham telefon dönmez; `phoneMasked` maskelidir (CLAUDE.md kural 7).
 *
 * ⚠️ SIRALAMA `top` ARA SORGUSUNDA KESİLİR, ADRES SAYISI ONDAN SONRA EKLENİR. Yan yana yazıldığında
 * (`join customers … left join lateral … order by … limit`) planlayıcı LIMIT'i ancak Sort'un ÜSTÜNE koyabilir,
 * yani lateral sayım ADAY PENCERESİNİN TAMAMI için koşar: ölçüm `loops=200` (iki bacaklı sorguda `loops=400`
 * → tekilleştirme sonrası 200), `limit` 8 iken. `top` ile ölçüm `loops=8`. Sonuç kümesi ve sırası birebir aynı
 * (90.000 satırlık kiracıda doğrulandı); değişen yalnız sayımın kaç satır için koştuğu. Dış `order by` ŞARTTIR:
 * CTE'nin satır sırası garanti değildir, bu yüzden `rnk` dışarı taşınır.
 */
export async function lookupCustomers(db: Database, tenantId: string, terms: LookupTerms, limit: number): Promise<LookupHit[]> {
  const cand = candidateSql(tenantId, terms, limit);
  const rows = (await db.execute<LookupRow>(sql`
    with cand as (${cand}),
         best as (select id, min(rnk) as rnk from cand group by id),
         top as (
           select b.rnk, ${BASE_FIELDS}
             from best b
             join customers c on c.id = b.id and c.tenant_id = ${tenantId}
            order by b.rnk, c.last_order_at desc nulls last, c.id
            limit ${limit}
         )
    select ${LIST_FIELDS}
      from top c
      ${ADDRESS_COUNT_JOIN(tenantId)}
     order by c.rnk, c.last_order_at desc nulls last, c.id`)) as unknown as LookupRow[];
  return rows.map(toHit);
}

/** `GET /panel/orders/manual/customers/:id` — tenant kapsamlı tek müşteri; yoksa ya da silinmişse `null`. */
export async function lookupCustomerById(db: Database, tenantId: string, id: string): Promise<LookupHit | null> {
  const rows = (await db.execute<LookupRow>(sql`
    select ${LIST_FIELDS}
      from customers c
      ${ADDRESS_COUNT_JOIN(tenantId)}
     where c.tenant_id = ${tenantId} and c.id = ${id} and ${LIVE}
     limit 1`)) as unknown as LookupRow[];
  const row = rows[0];
  return row ? toHit(row) : null;
}

type DetailPart = Pick<CustomerLookupItem, 'addresses' | 'lastOrders'>;

type AddressRow = {
  customer_id: string;
  id: string;
  label: string | null;
  neighborhood: string | null;
  address_line: string | null;
  directions: string | null;
};
type OrderRow = {
  customer_id: string;
  id: string;
  number: number | string;
  placed_at: Date | string;
  total_kurus: number | string;
};
type ItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  quantity: number | string;
  note: string | null;
};
type OptionRow = {
  order_item_id: string;
  option_id: string;
};

/**
 * Ayrıntı yükü: kayıtlı adresler + son 3 sipariş (kalemler ve seçenek kimlikleriyle, "Aynısını ekle" için).
 * EŞLEŞME SAYISINDAN BAĞIMSIZ 4 SORGU — müşteri başına değil. Boş `ids` ile hiç sorgu koşmaz.
 *
 * ⚠️ `sql.param(...)` ŞART: Drizzle'ın `sql` şablonuna çıplak JS dizisi verilirse dizi parantezli listeye
 * açılır ve `any((…)::uuid[])` çalışma anında patlar (gerekçe `apps/api/src/jobs/cron/index.ts` satır 145).
 */
export async function loadCustomerDetails(db: Database, tenantId: string, ids: string[]): Promise<Map<string, DetailPart>> {
  const out = new Map<string, DetailPart>();
  if (!ids.length) return out;
  for (const id of ids) out.set(id, { addresses: [], lastOrders: [] });

  const idParam = sql.param(ids);
  const addrs = (await db.execute<AddressRow>(sql`
    select customer_id, id, label, neighborhood, address_line, directions from (
      select ca.customer_id, ca.id, ca.label, ca.neighborhood, ca.address_line, ca.directions,
             row_number() over (partition by ca.customer_id order by ca.last_used_at desc nulls last, ca.created_at desc) as rn
        from customer_addresses ca
       where ca.tenant_id = ${tenantId} and ca.customer_id = any(${idParam}::uuid[])
    ) z
     where rn <= ${DETAIL_ADDRESS_LIMIT}
     order by customer_id, rn`)) as unknown as AddressRow[];
  for (const a of addrs) {
    out.get(a.customer_id)?.addresses?.push({
      id: a.id,
      label: a.label,
      neighborhood: a.neighborhood,
      addressLine: a.address_line,
      directions: a.directions,
    });
  }

  // Müşteri başına en yeni 3 sipariş; `orders_customer_idx (tenant_id, customer_id, placed_at)` karşılar.
  const orderRows = (await db.execute<OrderRow>(sql`
    select o.customer_id, o.id, o.number, o.placed_at, o.total_kurus
      from unnest(${idParam}::uuid[]) as u(cid)
      cross join lateral (
        select id, customer_id, number, placed_at, total_kurus from orders
         where tenant_id = ${tenantId} and customer_id = u.cid
         order by placed_at desc
         limit ${DETAIL_ORDER_LIMIT}
      ) o
     order by o.customer_id, o.placed_at desc`)) as unknown as OrderRow[];
  const orderIds = orderRows.map((o) => o.id);

  const items = orderIds.length
    ? ((await db.execute<ItemRow>(sql`
        select oi.id, oi.order_id, oi.product_id, oi.name, oi.quantity, oi.note from order_items oi
         where oi.order_id = any(${sql.param(orderIds)}::uuid[])
         order by oi.order_id, oi.sort`)) as unknown as ItemRow[])
    : [];
  const itemIds = items.map((i) => i.id);
  const opts = itemIds.length
    ? ((await db.execute<OptionRow>(sql`
        select oio.order_item_id, oio.option_id from order_item_options oio
         where oio.order_item_id = any(${sql.param(itemIds)}::uuid[]) and oio.option_id is not null`)) as unknown as OptionRow[])
    : [];
  const optionsByItem = new Map<string, string[]>();
  for (const o of opts) {
    const list = optionsByItem.get(o.order_item_id);
    if (list) list.push(o.option_id);
    else optionsByItem.set(o.order_item_id, [o.option_id]);
  }
  const lineByOrder = new Map<string, { productId: string | null; name: string; quantity: number; note: string | null; optionIds: string[] }[]>();
  for (const i of items) {
    const list = lineByOrder.get(i.order_id) ?? [];
    list.push({
      productId: i.product_id,
      name: i.name,
      quantity: Number(i.quantity),
      note: i.note,
      optionIds: optionsByItem.get(i.id) ?? [],
    });
    lineByOrder.set(i.order_id, list);
  }
  for (const o of orderRows) {
    out.get(o.customer_id)?.lastOrders?.push({
      id: o.id,
      number: Number(o.number),
      placedAt: (toDate(o.placed_at) ?? new Date(0)).toISOString(),
      totalKurus: Number(o.total_kurus),
      items: lineByOrder.get(o.id) ?? [],
    });
  }
  return out;
}

/**
 * Ayrıntı gövdesi: liste alanlarının üzerine ham telefon, not, adresler ve son siparişler eklenir.
 * Legacy `detail=1` ile `GET …/customers/:id` AYNI yoldan geçer — kod iki kopya değil.
 */
export async function attachDetails(db: Database, tenantId: string, hits: LookupHit[]): Promise<CustomerLookupItem[]> {
  const details = await loadCustomerDetails(
    db,
    tenantId,
    hits.map((h) => h.item.id),
  );
  return hits.map((h) => ({
    ...h.item,
    phoneE164: h.phoneE164,
    notes: h.notes,
    addresses: details.get(h.item.id)?.addresses ?? [],
    lastOrders: details.get(h.item.id)?.lastOrders ?? [],
  }));
}
