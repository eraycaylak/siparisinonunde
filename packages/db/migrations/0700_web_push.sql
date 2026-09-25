-- Web Push (00 §10 alarm t=0, 04 §4.5) ve panel çevrimdışı dedektörü (06 §7.7, 04 §4.17). Mevcut kolonlar değiştirilmez.
-- Drizzle karşılığı: schema/notifications-ext.ts → pushSubscriptions, branchPanelPresence

-- Cihaz başına tarayıcı push aboneliği (endpoint tekil). Kullanıcı + işletme (+ seçili şube) + oturuma bağlıdır:
-- oturum silinince (çıkış, süre dolumu temizliği) abonelik de silinir; itme servisi 404/410 dönerse disabled_at dolar.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "push_subscriptions_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "push_subscriptions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "push_subscriptions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_uk" ON "push_subscriptions" USING btree ("endpoint");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_tenant_idx" ON "push_subscriptions" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_session_idx" ON "push_subscriptions" USING btree ("session_id");
--> statement-breakpoint
CREATE TRIGGER push_subscriptions_set_updated_at BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Şube başına panel varlığı: sipariş ekranı (SSE akışı) açıkken dakikada bir dokunulur. Çevrimdışı uyarısının
-- tekilliği (şube başına 60 dk'da en çok 1) offline_alerted_at ile tutulur; hiç görülmemiş açık şube için satırı
-- cron açar (last_seen_at boş).
CREATE TABLE IF NOT EXISTS "branch_panel_presence" (
	"branch_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone,
	"offline_alerted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_panel_presence_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "branch_panel_presence_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branch_panel_presence_tenant_idx" ON "branch_panel_presence" USING btree ("tenant_id");
