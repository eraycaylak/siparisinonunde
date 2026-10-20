-- Emekli QR kısa kodları (00 §3 "Emekli QR kodu", §12a madde 11 "QR ve bağlantılar"; 14 §4). Aralık 0900–0999.
-- Drizzle karşılığı: schema/shared-wa-ext.ts (retiredWaCodes).
--
-- NEDEN: `tenants.wa_code` O4 ile basılı QR'ların kalıcı anahtarı oldu (`yemekgelsin.net/q/<kod>`). Platform yöneticisi
-- bir işletmenin kodunu değiştirince eski kod boşa çıkıyor ve yeni kayıtta (generateWaCode) ya da elle başka bir
-- işletmeye verilebiliyordu: eski işletmenin sahadaki QR'ları müşteriyi başka bir işletmenin vitrinine götürürdü.
-- Eski kod artık işletmesiyle bu tabloya yazılır, hiçbir zaman başka işletmeye verilmez ve eski sahibine çözülür.
-- Tenant'a bağlı (tenant_id NOT NULL) bir tablodur; küresel tablo istisnası değildir.
CREATE TABLE IF NOT EXISTS "retired_wa_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retired_wa_codes_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "retired_wa_codes_code_ck" CHECK ("code" ~ '^[A-Z0-9]{3,12}$' AND "code" ~ '[A-Z]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retired_wa_codes_code_uk" ON "retired_wa_codes" USING btree ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retired_wa_codes_tenant_idx" ON "retired_wa_codes" USING btree ("tenant_id");
