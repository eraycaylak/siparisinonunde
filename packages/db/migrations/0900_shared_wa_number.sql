-- Ortak WhatsApp numarası (00 §12a madde 8; 14 §8.1). Aralık 0900–0999 "ortak numara".
-- Drizzle karşılığı: schema/platform.ts (tenants.wa_code, tenants.wa_mode), schema/shared-wa-ext.ts
-- (shared_wa_routes, shared_wa_messages), schema/whatsapp.ts (wa_accounts.provider 'shared'),
-- schema/orders.ts (order_verification_codes_pending_code_uk). Mevcut kolonlar değiştirilmez; wa_accounts sağlayıcı
-- kısıtı 'shared' değerini kapsayacak şekilde genişletilir.

-- 1) İşletme: dükkan kodu ve WhatsApp modu (varsayılan ortak numara)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "wa_code" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "wa_mode" text DEFAULT 'shared' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_wa_mode_ck" CHECK ("tenants"."wa_mode" in ('shared', 'own'));
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_wa_code_ck" CHECK ("tenants"."wa_code" is null or "tenants"."wa_code" ~ '^[A-Z0-9]{3,12}$');
--> statement-breakpoint
-- Mevcut işletmelere kod: slug'ın ilk parçası (4 harften kısaysa sonraki parçalar eklenir), büyük harf, en çok 10
-- karakter; çakışmada rakam soneki (BOZOK, BOZOK2…). Bot komutu olan sözcükler ve sipariş koduna benzeyen (6 karakter,
-- rakamlı) adaylar atlanır. Aynı kural: packages/core/src/shared-wa.ts (waCodeBase, waCodeCandidate, waCodeProblem).
DO $$
DECLARE
  t record;
  seg text;
  base text;
  cand text;
  n int;
  reserved text[] := ARRAY['DUR', 'STOP', 'START', 'BASLA', 'BASLAT', 'LISTE', 'DUKKAN', 'DUKKANLAR', 'DEGISTIR', 'YETKILI',
    'INSAN', 'OPERATOR', 'IPTAL', 'MENU', 'MERHABA', 'MRB', 'SELAM', 'SLM', 'EVET', 'HAYIR', 'TAMAM', 'SIPARIS', 'YARDIM',
    'KOD', 'TEST'];
BEGIN
  FOR t IN SELECT id, slug FROM tenants WHERE wa_code IS NULL ORDER BY created_at, id LOOP
    base := '';
    FOREACH seg IN ARRAY string_to_array(t.slug, '-') LOOP
      CONTINUE WHEN seg = '';
      base := base || seg;
      EXIT WHEN length(base) >= 4;
    END LOOP;
    base := left(upper(regexp_replace(base, '[^a-z0-9]', '', 'g')), 10);
    IF length(base) < 3 THEN
      base := left(base || 'DKN', 3);
    END IF;
    n := 1;
    LOOP
      cand := CASE WHEN n = 1 THEN base ELSE left(base, 12 - length(n::text)) || n::text END;
      EXIT WHEN NOT (cand = ANY (reserved))
        AND NOT (cand ~ '^[A-HJ-NP-Z2-9]{6}$' AND cand ~ '[0-9]')
        AND NOT EXISTS (SELECT 1 FROM tenants x WHERE x.wa_code = cand);
      n := n + 1;
    END LOOP;
    UPDATE tenants SET wa_code = cand WHERE id = t.id;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_wa_code_uk" ON "tenants" USING btree ("wa_code") WHERE wa_code is not null;
--> statement-breakpoint

-- 2) wa_accounts: 'shared' sağlayıcısı (işletmeye ait satır, kimlik bilgisi yok; gönderim platform numarasından)
ALTER TABLE "wa_accounts" DROP CONSTRAINT IF EXISTS "wa_accounts_provider_ck";
--> statement-breakpoint
ALTER TABLE "wa_accounts" ADD CONSTRAINT "wa_accounts_provider_ck" CHECK ("wa_accounts"."provider" in ('mock', 'cloud', 'd360', 'shared'));
--> statement-breakpoint

-- 3) Mod: kendi numarasını (Meta Cloud API ya da 360dialog) bağlamış işletme 'own' kalır; diğerleri ortak numaraya geçer.
UPDATE "tenants" SET "wa_mode" = 'own'
 WHERE EXISTS (SELECT 1 FROM wa_accounts a WHERE a.tenant_id = tenants.id AND a.provider IN ('cloud', 'd360'));
--> statement-breakpoint
-- Simülatör (mock) hesabı gerçek numara değildir: ortak numara satırına çevrilir (sohbet geçmişi aynı satırda kalır).
-- Gösterim numarası uygulama açılışında PLATFORM_WA_DISPLAY_PHONE'dan yazılır (syncSharedWaAccounts).
UPDATE "wa_accounts"
   SET provider = 'shared', phone_number_id = NULL, waba_id = NULL, api_key_enc = NULL, display_phone = NULL,
       status = 'connected', last_error = NULL, version = version + 1, updated_at = now()
 WHERE provider = 'mock'
   AND tenant_id IN (SELECT id FROM tenants WHERE wa_mode = 'shared');
--> statement-breakpoint
-- Hesabı olmayan ortak numara işletmelerine varsayılan şubede satır
INSERT INTO "wa_accounts" (tenant_id, branch_id, provider, webhook_token, status)
SELECT DISTINCT ON (b.tenant_id) b.tenant_id, b.id, 'shared',
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'connected'
  FROM branches b
  JOIN tenants t ON t.id = b.tenant_id
 WHERE t.wa_mode = 'shared'
   AND NOT EXISTS (SELECT 1 FROM wa_accounts a WHERE a.tenant_id = b.tenant_id)
 ORDER BY b.tenant_id, b.is_default DESC, b.created_at ASC
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4) Akış B kodu tüm işletmelerde tekil (bekleyen kodlar): ortak numarada yönlendirici kodu işletme bilmeden bulur.
-- Olası eski çakışmada yalnız en yeni kod bekleyen kalır; eskiler süre sonlarıyla "kullanılmış" işaretlenir.
UPDATE "order_verification_codes" v SET used_at = v.expires_at
 WHERE v.used_at IS NULL
   AND EXISTS (
     SELECT 1 FROM order_verification_codes w
      WHERE w.code = v.code AND w.used_at IS NULL AND w.id <> v.id
        AND (w.created_at, w.id) > (v.created_at, v.id)
   );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_verification_codes_pending_code_uk" ON "order_verification_codes" USING btree ("code") WHERE used_at is null;
--> statement-breakpoint
-- Kullanılmış/süresi geçmiş kodun işletmesi de bulunur (yönlendirici "kod kullanıldı/süresi doldu" yanıtını doğru dükkana verir)
CREATE INDEX IF NOT EXISTS "order_verification_codes_code_idx" ON "order_verification_codes" USING btree ("code", "created_at");
--> statement-breakpoint

-- 5) Yönlendirme durumu (KÜRESEL, kişisel veri; 24 ay hareketsizlikte silinir — retention.shared_wa_routes)
CREATE TABLE IF NOT EXISTS "shared_wa_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_bsuid" text,
	"phone_e164" text,
	"current_tenant_id" uuid,
	"recent_tenant_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"last_routed_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_picker_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_wa_routes_current_tenant_id_fk" FOREIGN KEY ("current_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "shared_wa_routes_key_ck" CHECK ("wa_bsuid" IS NOT NULL OR "phone_e164" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shared_wa_routes_bsuid_uk" ON "shared_wa_routes" USING btree ("wa_bsuid") WHERE wa_bsuid is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shared_wa_routes_phone_uk" ON "shared_wa_routes" USING btree ("phone_e164") WHERE phone_e164 is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_wa_routes_last_inbound_idx" ON "shared_wa_routes" USING btree ("last_inbound_at");
--> statement-breakpoint

-- 6) Platform düzeyi mesajlar (dükkan seçici vb.; KÜRESEL; 30 gün — retention.technical.shared_wa_messages)
CREATE TABLE IF NOT EXISTS "shared_wa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid,
	"direction" text NOT NULL,
	"wamid" text,
	"kind" text NOT NULL,
	"body" text,
	"payload" jsonb,
	"status" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_wa_messages_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."shared_wa_routes"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "shared_wa_messages_direction_ck" CHECK ("direction" in ('in', 'out')),
	CONSTRAINT "shared_wa_messages_kind_ck" CHECK ("kind" in ('text', 'interactive', 'button_reply', 'list_reply', 'location', 'image', 'audio', 'template', 'system', 'echo')),
	CONSTRAINT "shared_wa_messages_status_ck" CHECK ("status" in ('queued', 'sent', 'delivered', 'read', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shared_wa_messages_wamid_uk" ON "shared_wa_messages" USING btree ("wamid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_wa_messages_route_idx" ON "shared_wa_messages" USING btree ("route_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_wa_messages_created_idx" ON "shared_wa_messages" USING btree ("created_at");
