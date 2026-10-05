-- DİLİM: TEMEL (0000–0099). `branches` tablosu bu dilimde, 0000_init.sql içinde oluşturuldu; bu dosya kolon
-- EKLEMEZ, yalnız var olan `is_default` kolonuna tekillik kısıtı kurar (ve kuramadan önce veriyi düzeltir).
--
-- NEDEN BU DOSYA VAR (denetim 2026-10-04 H33 · FAZ 4.1'in kod parçası): `branches.is_default` varsayılanı
-- `true` ve TEK-VARSAYILAN KISITI YOKTU. Yani ikinci şube eklemek (`insert into branches (tenant_id, name)`)
-- işletmeyi sessizce "iki varsayılan şubeli" hale getiriyordu. Vitrin her zaman varsayılan şubeyi yükler
-- (`services/storefront/load.ts`): iki varsayılan varsa hangisinin geldiği SIRA GARANTİSİ OLMAYAN bir seçim
-- (`limit 1`) olur — aynı müşteri iki istekte iki ayrı şubenin menüsünü, teslimat bölgesini ve ödeme
-- yöntemlerini görebilir. Ortak numara yönlendirmesi de aynı sıralamaya dayanıyor
-- (0900_shared_wa_number.sql satır 82: `order by b.tenant_id, b.is_default desc, b.created_at asc`).
--
-- NE YAPILMADI (Eray'ın kararı, docs/14 §7.1 notu): çok şubeli işletme SATIŞI ertelendi — vitrine şube seçimi
-- EKLENMEDİ. Bu dosya yalnız veri bütünlüğünü kurar: tek varsayılan garanti altına alınır, böylece "iki
-- varsayılan" hali ilerde şube seçimi yazıldığında geçmiş veriden sızamaz.
--
-- 1. ADIM — VERİYİ DÜZELT (kısıt kurulabilsin): bir işletmede birden çok varsayılan şube varsa EN ESKİSİ
-- (`created_at`, eşitlikte `id`) varsayılan kalır, diğerleri `false` olur. Neden en eskisi: kayıt sihirbazı ilk
-- şubeyi işletmeyle birlikte açar, vitrin bugüne kadar fiilen onu göstermiş olabilir — "varsayılanı değiştirme"
-- kararını göç veremez. `0900` sıralaması da (`is_default desc, created_at asc`) aynı satırı seçiyordu, yani
-- ortak numara yönlendirmesi bu düzeltmeden sonra DEĞİŞMEZ.
UPDATE branches b
   SET is_default = false
 WHERE b.is_default
   AND EXISTS (
     SELECT 1 FROM branches k
      WHERE k.tenant_id = b.tenant_id
        AND k.is_default
        AND (k.created_at, k.id) < (b.created_at, b.id)
   );
--> statement-breakpoint
-- 2. ADIM — KISMİ UNIQUE: işletme başına EN ÇOK bir varsayılan şube. `where is_default` olması zorunlu, aksi
-- halde `(tenant_id)` üzerindeki tam unique işletmeye ikinci şubeyi hiç eklettirmezdi. "En az bir" tarafı
-- veritabanında zorlanmaz (tek satırı `false` yapmak hâlâ mümkün): bunun kapısı uygulama katmanındadır, çünkü
-- bir kısıtla ifade edilmesi şube silme/ekleme işlemlerinde geçici ihlal gerektirir (deferrable constraint +
-- trigger). Vitrin varsayılan şube bulamazsa zaten hata verir ve sapma görünür olur.
--
-- Drizzle karşılığı: packages/db/src/schema/platform.ts → `uniqueIndex('branches_default_uk')`.
CREATE UNIQUE INDEX IF NOT EXISTS "branches_default_uk" ON "branches" USING btree ("tenant_id")
  WHERE "is_default";
