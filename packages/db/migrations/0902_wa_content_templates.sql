-- Twilio Content API kaynak önbelleği (16 §2.3). Twilio etkileşimli mesajı serbest gövdeyle almaz; buton/liste için
-- bir "content" kaynağı (HX…) ister. Her mesaj için kaynak üretmemek adına buton/satır sayısı başına TEK kaynak
-- üretilir ve kimliği burada saklanır; metinler gönderimde ContentVariables ile doldurulur.
--
-- Şablonlar (pencere dışı mesajlar) da aynı tabloda tutulur: friendly_name = şablon adı (siparis_alindi_v1 …),
-- kind = 'template'. Admin "Şablonları gönder" adımı üretir, gönderim yalnız okur.
--
-- KÜRESEL tablo (tenant_id yok): kaynaklar platformun Twilio hesabına aittir, işletmeye değil — ortak numara
-- (00 §12a madde 8) ile aynı kapsam. packages/db/test/schema.test.ts'te istisna olarak belgelidir.
-- Drizzle karşılığı: packages/db/src/schema/wa-content-ext.ts
CREATE TABLE IF NOT EXISTS "wa_content_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "friendly_name" text NOT NULL,
  "content_sid" text NOT NULL,
  "kind" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wa_content_templates_provider_ck" CHECK ("provider" in ('twilio')),
  CONSTRAINT "wa_content_templates_kind_ck" CHECK ("kind" in ('interactive', 'template'))
);
--> statement-breakpoint
-- Aynı adın iki kez üretilmesini engeller: eşzamanlı worker'lar ON CONFLICT ile tek kimlikte buluşur
CREATE UNIQUE INDEX IF NOT EXISTS "wa_content_templates_name_uk" ON "wa_content_templates" ("provider", "friendly_name");
