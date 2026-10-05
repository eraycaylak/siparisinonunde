-- Kurye "Teslim edilemedi" bildirimleri (04 §9.2; denetim H13). Kurye kapıda teslim edemediğinde siparişin DURUMU
-- DEĞİŞMEZ (karar işletmededir: tekrar dene ya da `courier_issue` ile iptal), ama her deneme buraya bir satır yazar:
-- işletme panelinde uyarı, gün sonu raporunda "teslim edilemeyenler" ve kurye başına tekrar sayısı buradan okunur.
-- Mevcut kolonlar değiştirilmez. Drizzle karşılığı: schema/orders-ext.ts → orderDeliveryAttempts.
-- Sebep listesi tek kaynaktan gelir: packages/core/src/orders/delivery.ts → DELIVERY_FAILURE_REASONS.

CREATE TABLE IF NOT EXISTS "order_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"courier_user_id" uuid,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_delivery_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "order_delivery_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "order_delivery_attempts_courier_user_id_users_id_fk" FOREIGN KEY ("courier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "order_delivery_attempts_reason_ck" CHECK ("reason" in ('customer_absent', 'customer_unreachable', 'address_not_found', 'customer_refused', 'other'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_delivery_attempts_order_idx" ON "order_delivery_attempts" USING btree ("tenant_id", "order_id", "created_at");
