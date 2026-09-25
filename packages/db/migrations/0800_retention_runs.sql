-- Saklama ve imha koşu kayıtları (08 §2.8 "Kabul kriterleri (otomatik silme)"): cron.retention'ın her adımı bir satır
-- yazar (iş adı, tenant, silinen/anonimleşen kayıt sayısı, süre, hata). Bu kayıt imha tutanağı yerine geçer ve en az
-- 3 yıl saklanır (§2.8 satır 18): saklama işleri bu tabloyu silmez. Mevcut kolonlar değiştirilmez.
-- Drizzle karşılığı: schema/retention-ext.ts → retentionRuns

-- tenant_id: tenant bazlı adımda (retention.customer_inactive) dolu, tüm tabloya uygulanan SQL adımlarında boş.
-- Tenant silinse de (retention.tenant_offboarding) tutanak kalır: FK ON DELETE SET NULL.
CREATE TABLE IF NOT EXISTS "retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"tenant_id" uuid,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text,
	CONSTRAINT "retention_runs_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "retention_runs_counts_ck" CHECK ("affected_count" >= 0 AND "duration_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_runs_job_started_idx" ON "retention_runs" USING btree ("job_name", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_runs_tenant_started_idx" ON "retention_runs" USING btree ("tenant_id", "started_at") WHERE "tenant_id" IS NOT NULL;
