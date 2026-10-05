-- DİLİM: TEMEL (0000–0099). `customers` tablosu bu dilimde, 0000_init.sql içinde oluşturuldu; bu dosya kolon,
-- kısıt ya da veri DEĞİŞTİRMEZ — yalnız iki arama indeksi ekler. Geri alma: `DROP INDEX` (aşağıda).
--
-- NEDEN BU DOSYA VAR (Eray'ın isteği, 04 §4.13): telefon siparişi ekranında müşteri araması İLK KARAKTERDEN
-- itibaren ve TUŞ BAŞINA koşacak, ayrıca telefonun yanı sıra ADLA da arayacak. Eski sorgu
-- `phone_e164 LIKE '%<rakamlar>%'` idi: baştaki joker yüzünden hiçbir indeks kullanılamıyor, her tuşta tüm
-- kiracı taranıyordu. Ad araması ise hiç yoktu.
--   * `customers_tenant_phone_uk (tenant_id, phone_e164)` kısmi UNIQUE ve
--     `customers_tenant_last_order_idx (tenant_id, last_order_at)` mevcut; ikisi de `LIKE '%…%'` ile kullanılamaz.
-- Ölçüm (bu makinede, PostgreSQL 17, tek kiracıda 90.000 satır): seçici ad öneki indekssiz 36,65 ms →
-- indeksle 0,014 ms; tek harf `a%` (33.000 eşleşme) 17,9–51,4 ms → 0,212 ms.
--
-- 1) ÖNEK İNDEKSİ `text_pattern_ops` İLE — ZORUNLU, çünkü collation dağıtıma göre değişiyor: canlı container
-- `initdb --locale=C.UTF-8` (deploy/cloudflare/entrypoint.sh), docker-compose `postgres:16` varsayılanı
-- `en_US.utf8`, geliştirme makinesi `C`. Düz (varsayılan opclass) btree indeksi `LIKE 'x%'` önekini YALNIZ `C`
-- benzeri collation'larda karşılar; `text_pattern_ops` üçünde de karşılar (planlayıcı `~>=~`/`~<~` ile tarar).
-- Parametreli sorguda da çalışır: PostgreSQL önek çıkarımını yalnız sabit desende yapabildiği için genel
-- (generic) plan seq scan olur, maliyeti yüksek çıkar ve plan önbelleği ÖZEL (custom) planda kalır — ölçüldü,
-- aynı hazır deyim 7 kez koştuktan sonra da Index Scan kullanıyor.
--
-- 2) AD İÇİN İFADE İNDEKSİ `translate(...)` İLE — `lower()` ya da `ILIKE` KULLANILMAZ: `C.UTF-8` altında
-- `lower('ÇİĞDEM')` → `'ÇİĞdem'` ve `'ÇİĞDEM' ILIKE 'çiğ%'` → false (ölçüldü). Yani "küçült, karşılaştır" yolu
-- canlıda Türkçe büyük harfli adları HİÇ bulamaz. `translate()` locale'den bağımsızdır ve IMMUTABLE'dır
-- (ifade indeksi için şart). Katlama I/İ/ı/i → `i` olacak şekilde bilerek geniştir (arama kutusunda harf
-- ayrımı kullanıcıyı cezalandırır). Bilinen sınır: Türkçe dışı aksanlar katlanmaz (`JOSÉ` → `josÉ`).
--
-- İFADE METNİ İKİ YERDE DURUR ve BİREBİR AYNI OLMALI (ayrışırsa indeks kullanılmaz = yavaş, ama sonuç yanlış
-- OLMAZ): sorgu tarafı `apps/api/src/services/customers/lookup.ts` → `NAME_FOLD_SQL`; istemci/TS ikizi
-- `packages/core/src/text.ts` → `foldSearch` (`FOLD_FROM`/`FOLD_TO`). Ayrışmayı makineye soran çit:
-- `apps/api/test/order-lookup.test.ts` içindeki `EXPLAIN` testi (plan metninde indeks adı geçmeli).
--
-- ELENEN ALTERNATİFLER:
--   * pg_trgm + GIN: LIKE deseni 3 karakterden KISAYSA trigram indeksi kullanılamaz — yani istenen 1–2
--     karakterlik durumda tam olarak işe yaramaz. Üstelik depoda hiç `CREATE EXTENSION` yok; taze kurulumu ve
--     sapma testini contrib paketine bağlardı.
--   * STORED üretilmiş kolon: Drizzle'ın `generatedAlwaysAs` alanı `hasDefault` KURMUYOR (drizzle-orm 0.45.3),
--     bu yüzden `pg_attrdef` dolu olurken şema "varsayılan yok" derdi ve `schema-drift.test.ts` kırmızı yanardı.
--   * SQL fonksiyonu (`search_fold()`): depoda hiç özel fonksiyon yok ve sapma testi fonksiyonları taramıyor;
--     sessizce `CREATE OR REPLACE` edilen IMMUTABLE bir fonksiyon indeksi YANLIŞ SONUÇ verecek şekilde bozar.
--
-- CONCURRENTLY BİLEREK KULLANILMADI: `migrate.ts` her dosyayı TEK transaction içinde uygular
-- (`packages/db/src/migrate.ts` `sql.begin` → `tx.unsafe(stmt)`), `CREATE INDEX CONCURRENTLY` ise transaction
-- içinde çalışmaz — 0004_jobs_alarm_order_idx.sql'deki gerekçenin aynısı. Pilot ölçeğinde (tek işletme, binlerce
-- müşteri) kurulum milisaniyelerle ölçülür; tablo milyon satıra çıkarsa indeks ELLE `CONCURRENTLY` ile kurulup
-- bu dosya `IF NOT EXISTS` sayesinde no-op geçirilebilir.
--
-- GERİ ALMA: `DROP INDEX IF EXISTS "customers_tenant_name_fold_idx", "customers_tenant_phone_prefix_idx";`
-- Kolon/kısıt/veri değişmediği için geri alma veri kaybı taşımaz; arama yalnız yavaşlar.
--
-- Drizzle karşılığı: packages/db/src/schema/orders.ts → `customers` tanımındaki iki `index(...)`
-- (şema ↔ veritabanı sapma testi `packages/db/test/schema-drift.test.ts` ikisini karşılaştırır; opclass'ı
-- `pg_get_indexdef(oid, k, true)` YAZMADIĞI için sapma testi `text_pattern_ops`'u ne görür ne de korur —
-- onun çiti yukarıdaki EXPLAIN testidir).
CREATE INDEX IF NOT EXISTS "customers_tenant_phone_prefix_idx"
  ON "customers" USING btree ("tenant_id", "phone_e164" text_pattern_ops)
  WHERE phone_e164 IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_tenant_name_fold_idx"
  ON "customers" USING btree ("tenant_id",
    translate("name",
      'ABCDEFGHIJKLMNOPQRSTUVWXYZÇĞİIÖŞÜçğıöşü',
      'abcdefghijklmnopqrstuvwxyzcgiiosucgiosu') text_pattern_ops)
  WHERE name IS NOT NULL;
