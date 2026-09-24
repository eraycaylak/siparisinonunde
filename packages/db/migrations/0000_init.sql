CREATE TABLE "admin_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"impersonator_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"data" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"phone" text,
	"address_line" text,
	"neighborhood" text,
	"district" text DEFAULT 'Merkez' NOT NULL,
	"city" text DEFAULT 'Yozgat' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"timezone" text DEFAULT 'Europe/Istanbul' NOT NULL,
	"paused_until" timestamp with time zone,
	"pause_reason" text,
	"busy_extra_minutes" integer DEFAULT 0 NOT NULL,
	"default_prep_minutes" integer DEFAULT 20 NOT NULL,
	"use_preparing_step" boolean DEFAULT false NOT NULL,
	"accepts_delivery" boolean DEFAULT true NOT NULL,
	"accepts_pickup" boolean DEFAULT true NOT NULL,
	"pickup_min_order_kurus" integer DEFAULT 0 NOT NULL,
	"payment_methods" text[] DEFAULT '{cash_on_delivery,card_on_delivery}'::text[] NOT NULL,
	"meal_card_brands" text[] DEFAULT '{}'::text[] NOT NULL,
	"status_messages" jsonb DEFAULT '{"received":true,"accepted":true,"preparing":false,"ready":true,"on_the_way":true,"delivered":true}'::jsonb NOT NULL,
	"alarm_policy" jsonb DEFAULT '{"auto_cancel_minutes":15,"customer_notice_minutes":10,"platform_wa_enabled":true,"sms_enabled":true}'::jsonb NOT NULL,
	"receipt_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_busy_ck" CHECK ("branches"."busy_extra_minutes" between 0 and 180),
	CONSTRAINT "branches_prep_ck" CHECK ("branches"."default_prep_minutes" between 1 and 240),
	CONSTRAINT "branches_payment_methods_ck" CHECK ("branches"."payment_methods" <@ array['cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery', 'online_card', 'pay_at_counter']::text[])
);
--> statement-breakpoint
CREATE TABLE "courier_login_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_kind_ck" CHECK ("feature_flags"."kind" in ('kill_switch', 'ops', 'release'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"business_name" text,
	"phone" text,
	"email" text,
	"city" text,
	"source" text DEFAULT 'demo_form' NOT NULL,
	"calculator_input" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_status_ck" CHECK ("leads"."status" in ('new', 'contacted', 'demo_scheduled', 'demo_done', 'proposal', 'won', 'lost'))
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tenant_id" uuid,
	"order_id" uuid,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "legal_acceptances_document_ck" CHECK ("legal_acceptances"."document" in ('abonelik', 'kvkk_aydinlatma', 'mesafeli_satis', 'on_bilgilendirme')),
	CONSTRAINT "legal_acceptances_subject_ck" CHECK ("legal_acceptances"."user_id" is not null or "legal_acceptances"."order_id" is not null or "legal_acceptances"."tenant_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_role_ck" CHECK ("memberships"."role" in ('owner', 'manager', 'cashier', 'kitchen', 'courier'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text DEFAULT 'user' NOT NULL,
	"tenant_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"impersonator_user_id" uuid,
	"impersonation_reason" text,
	"read_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_kind_ck" CHECK ("sessions"."kind" in ('user', 'courier', 'impersonation'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"status" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"founder_discount_bp" integer,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_plan_code_ck" CHECK ("subscriptions"."plan_code" in ('esnaf', 'pro', 'zincir')),
	CONSTRAINT "subscriptions_status_ck" CHECK ("subscriptions"."status" in ('trialing', 'active', 'past_due', 'read_only', 'suspended', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legal_name" text,
	"tax_no" text,
	"tax_office" text,
	"phone" text,
	"email" text,
	"address" text,
	"lifecycle_stage" text DEFAULT 'trial' NOT NULL,
	"suspension_reason" text,
	"ordering_enabled" boolean DEFAULT true NOT NULL,
	"sms_fallback_enabled" boolean DEFAULT true NOT NULL,
	"bot_enabled" boolean DEFAULT true NOT NULL,
	"brand_color" text,
	"logo_url" text,
	"cover_url" text,
	"marketplace_commission_bp" integer DEFAULT 2500 NOT NULL,
	"plan_code" text DEFAULT 'esnaf' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"live_at" timestamp with time zone,
	"web_live_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"order_seq" integer DEFAULT 1000 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_lifecycle_stage_ck" CHECK ("tenants"."lifecycle_stage" in ('lead', 'onboarding', 'pilot', 'trial', 'active', 'past_due', 'read_only', 'suspended', 'churned')),
	CONSTRAINT "tenants_suspension_reason_ck" CHECK ("tenants"."suspension_reason" in ('payment', 'trial_ended', 'pilot_ended', 'policy', 'abuse', 'legal')),
	CONSTRAINT "tenants_plan_code_ck" CHECK ("tenants"."plan_code" in ('esnaf', 'pro', 'zincir')),
	CONSTRAINT "tenants_slug_format_ck" CHECK ("tenants"."slug" ~ '^[a-z0-9](-?[a-z0-9]){2,39}$'),
	CONSTRAINT "tenants_brand_color_ck" CHECK ("tenants"."brand_color" is null or "tenants"."brand_color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"phone" text,
	"name" text NOT NULL,
	"password_hash" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"platform_role" text,
	"totp_secret_enc" text,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_platform_role_ck" CHECK ("users"."platform_role" in ('platform_owner', 'platform_admin', 'support_agent', 'finance', 'sales_rep')),
	CONSTRAINT "users_email_lower_ck" CHECK ("users"."email" is null or "users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"internal_name" text,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_groups_min_ck" CHECK ("option_groups"."min_select" >= 0),
	CONSTRAINT "option_groups_max_ck" CHECK ("option_groups"."max_select" is null or "option_groups"."max_select" >= "option_groups"."min_select")
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_delta_kurus" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_change_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"product_ids" uuid[] NOT NULL,
	"previous_prices" jsonb,
	"applied_by_user_id" uuid,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_change_batches_kind_ck" CHECK ("price_change_batches"."kind" in ('percent', 'fixed'))
);
--> statement-breakpoint
CREATE TABLE "product_option_groups" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_option_groups_product_id_group_id_pk" PRIMARY KEY("product_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_kurus" integer NOT NULL,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sold_out_until" timestamp with time zone,
	"wa_restricted" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_price_ck" CHECK ("products"."price_kurus" >= 0)
);
--> statement-breakpoint
CREATE TABLE "branch_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"neighborhoods" text[] DEFAULT '{}'::text[] NOT NULL,
	"polygon" jsonb,
	"radius_m" integer,
	"fee_kurus" integer DEFAULT 0 NOT NULL,
	"min_order_kurus" integer DEFAULT 0 NOT NULL,
	"eta_minutes" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_zones_kind_ck" CHECK ("delivery_zones"."kind" in ('neighborhoods', 'polygon', 'radius')),
	CONSTRAINT "delivery_zones_fee_ck" CHECK ("delivery_zones"."fee_kurus" >= 0 and "delivery_zones"."min_order_kurus" >= 0),
	CONSTRAINT "delivery_zones_radius_ck" CHECK ("delivery_zones"."radius_m" is null or "delivery_zones"."radius_m" > 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"tenant_id" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_queue_ck" CHECK ("jobs"."queue" in ('wa-inbound', 'wa-outbound', 'wa-media', 'notify', 'llm', 'print', 'images', 'cron', 'integrations')),
	CONSTRAINT "jobs_status_ck" CHECK ("jobs"."status" in ('pending', 'running', 'done', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"order_id" uuid,
	"recipient_user_id" uuid,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_channel_ck" CHECK ("notifications"."channel" in ('platform_wa', 'sms', 'email', 'log')),
	CONSTRAINT "notifications_status_ck" CHECK ("notifications"."status" in ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" text NOT NULL,
	"closes_at" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_hours_weekday_ck" CHECK ("opening_hours"."weekday" between 0 and 6),
	CONSTRAINT "opening_hours_opens_ck" CHECK ("opening_hours"."opens_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "opening_hours_closes_ck" CHECK ("opening_hours"."closes_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "special_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_closed" boolean DEFAULT true NOT NULL,
	"opens_at" text,
	"closes_at" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_days_opens_ck" CHECK ("special_days"."opens_at" is null or "special_days"."opens_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "special_days_closes_ck" CHECK ("special_days"."closes_at" is null or "special_days"."closes_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "cancellation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "cancellation_requests_status_ck" CHECK ("cancellation_requests"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"neighborhood" text,
	"address_line" text,
	"directions" text,
	"lat" double precision,
	"lng" double precision,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"wa_bsuid" text,
	"phone_e164" text,
	"wa_username" text,
	"name" text,
	"notes" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"last_order_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_acks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"device_label" text,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text DEFAULT 'status_changed' NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"note" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_events_actor_type_ck" CHECK ("order_events"."actor_type" in ('customer', 'user', 'system')),
	CONSTRAINT "order_events_from_status_ck" CHECK ("order_events"."from_status" in ('awaiting_customer', 'new', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'rejected', 'cancelled')),
	CONSTRAINT "order_events_to_status_ck" CHECK ("order_events"."to_status" in ('awaiting_customer', 'new', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "order_item_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"option_id" uuid,
	"group_name" text NOT NULL,
	"option_name" text NOT NULL,
	"price_delta_kurus" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"category_name" text,
	"unit_price_kurus" integer NOT NULL,
	"options_unit_kurus" integer DEFAULT 0 NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_kurus" integer NOT NULL,
	"note" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_ck" CHECK ("order_items"."quantity" between 1 and 50),
	CONSTRAINT "order_items_line_total_ck" CHECK ("order_items"."line_total_kurus" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_verification_codes_code_ck" CHECK ("order_verification_codes"."code" ~ '^[A-HJ-NP-Z2-9]{6}$')
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text NOT NULL,
	"channel" text NOT NULL,
	"fulfillment_type" text NOT NULL,
	"test_kind" text,
	"customer_id" uuid,
	"conversation_id" uuid,
	"link_token_id" uuid,
	"verification_method" text,
	"verified_at" timestamp with time zone,
	"status_notify_channel" text DEFAULT 'whatsapp' NOT NULL,
	"zone_id" uuid,
	"zone_name" text,
	"neighborhood" text,
	"address_line" text,
	"directions" text,
	"lat" double precision,
	"lng" double precision,
	"out_of_zone_override" boolean DEFAULT false NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"subtotal_kurus" integer NOT NULL,
	"delivery_fee_kurus" integer DEFAULT 0 NOT NULL,
	"discount_kurus" integer DEFAULT 0 NOT NULL,
	"total_kurus" integer NOT NULL,
	"min_order_kurus" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'TRY' NOT NULL,
	"payment_method" text NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"meal_card_brand" text,
	"change_for_kurus" integer,
	"paid_at" timestamp with time zone,
	"wants_cutlery" boolean DEFAULT false NOT NULL,
	"note" text,
	"internal_note" text,
	"eta_minutes" integer,
	"estimated_ready_at" timestamp with time zone,
	"courier_user_id" uuid,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_acked_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"preparing_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"on_the_way_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"created_by_user_id" uuid,
	"rejection_reason" text,
	"rejection_note" text,
	"rejection_scheduled_at" timestamp with time zone,
	"rejection_requested_by" uuid,
	"cancelled_by" text,
	"cancel_reason" text,
	"cancel_note" text,
	"cancel_requested_at" timestamp with time zone,
	"tracking_expires_at" timestamp with time zone,
	"delay_notice_count" smallint DEFAULT 0 NOT NULL,
	"wa_status_msg_count" smallint DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"confirmation_ip" text,
	"confirmation_user_agent" text,
	"source_meta" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_ck" CHECK ("orders"."status" in ('awaiting_customer', 'new', 'accepted', 'preparing', 'ready', 'on_the_way', 'delivered', 'rejected', 'cancelled')),
	CONSTRAINT "orders_channel_ck" CHECK ("orders"."channel" in ('wa_link', 'wa_ai', 'web', 'table_qr', 'wa_flow', 'wa_reorder', 'manual')),
	CONSTRAINT "orders_fulfillment_type_ck" CHECK ("orders"."fulfillment_type" in ('delivery', 'pickup', 'dine_in')),
	CONSTRAINT "orders_test_kind_ck" CHECK ("orders"."test_kind" in ('onboarding_test', 'canary')),
	CONSTRAINT "orders_verification_method_ck" CHECK ("orders"."verification_method" in ('wa_link', 'wa_code', 'wa_button', 'sms_otp', 'staff')),
	CONSTRAINT "orders_payment_method_ck" CHECK ("orders"."payment_method" in ('cash_on_delivery', 'card_on_delivery', 'meal_card_on_delivery', 'online_card', 'pay_at_counter')),
	CONSTRAINT "orders_payment_status_ck" CHECK ("orders"."payment_status" in ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded')),
	CONSTRAINT "orders_meal_card_brand_ck" CHECK ("orders"."meal_card_brand" in ('multinet', 'pluxee', 'edenred', 'setcard', 'metropol', 'other')),
	CONSTRAINT "orders_rejection_reason_ck" CHECK ("orders"."rejection_reason" in ('closed', 'out_of_zone', 'item_unavailable', 'too_busy', 'duplicate', 'suspected_fake', 'other')),
	CONSTRAINT "orders_cancelled_by_ck" CHECK ("orders"."cancelled_by" in ('customer', 'tenant', 'system')),
	CONSTRAINT "orders_cancel_reason_ck" CHECK ("orders"."cancel_reason" in ('customer_request', 'customer_timeout', 'tenant_no_response', 'item_unavailable', 'courier_issue', 'duplicate', 'suspected_fake', 'payment_timeout', 'other')),
	CONSTRAINT "orders_status_notify_channel_ck" CHECK ("orders"."status_notify_channel" in ('whatsapp', 'sms', 'none')),
	CONSTRAINT "orders_total_ck" CHECK ("orders"."total_kurus" = "orders"."subtotal_kurus" + "orders"."delivery_fee_kurus" - "orders"."discount_kurus"),
	CONSTRAINT "orders_amounts_ck" CHECK ("orders"."subtotal_kurus" >= 0 and "orders"."delivery_fee_kurus" >= 0 and "orders"."discount_kurus" >= 0),
	CONSTRAINT "orders_rejection_pending_ck" CHECK ("orders"."rejection_scheduled_at" is null or "orders"."status" = 'new'),
	CONSTRAINT "orders_rejected_reason_ck" CHECK ("orders"."status" <> 'rejected' or "orders"."rejection_reason" is not null),
	CONSTRAINT "orders_cancelled_reason_ck" CHECK ("orders"."status" <> 'cancelled' or ("orders"."cancelled_by" is not null and "orders"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "otp_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating_ck" CHECK ("reviews"."rating" in ('good', 'ok', 'bad'))
);
--> statement-breakpoint
CREATE TABLE "storefront_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"token_hash" text NOT NULL,
	"conversation_id" uuid,
	"customer_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"first_opened_at" timestamp with time zone,
	"exchanged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"wa_account_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"mode" text DEFAULT 'bot' NOT NULL,
	"human_until" timestamp with time zone,
	"state" text DEFAULT 'idle' NOT NULL,
	"active_order_id" uuid,
	"last_inbound_at" timestamp with time zone,
	"last_welcome_at" timestamp with time zone,
	"last_nudge_at" timestamp with time zone,
	"last_status_card_at" timestamp with time zone,
	"last_closed_notice_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"last_message_preview" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_mode_ck" CHECK ("conversations"."mode" in ('bot', 'human')),
	CONSTRAINT "conversations_state_ck" CHECK ("conversations"."state" in ('idle', 'greeting', 'menu_link_sent', 'order_linking', 'order_active', 'ai_ordering', 'awaiting_confirm'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"wamid" text,
	"kind" text NOT NULL,
	"body" text,
	"payload" jsonb,
	"template_name" text,
	"status" text,
	"error_code" text,
	"sent_by" text,
	"sent_by_user_id" uuid,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_direction_ck" CHECK ("messages"."direction" in ('in', 'out')),
	CONSTRAINT "messages_kind_ck" CHECK ("messages"."kind" in ('text', 'interactive', 'button_reply', 'list_reply', 'location', 'image', 'audio', 'template', 'system', 'echo')),
	CONSTRAINT "messages_status_ck" CHECK ("messages"."status" in ('queued', 'sent', 'delivered', 'read', 'failed')),
	CONSTRAINT "messages_sent_by_ck" CHECK ("messages"."sent_by" in ('bot', 'user', 'customer', 'business_phone'))
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"order_id" uuid,
	"to_phone" text NOT NULL,
	"body" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"counts_toward_quota" boolean DEFAULT false NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_purpose_ck" CHECK ("sms_messages"."purpose" in ('otp', 'status', 'alarm')),
	CONSTRAINT "sms_messages_status_ck" CHECK ("sms_messages"."status" in ('queued', 'sent', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "wa_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"display_phone" text,
	"phone_number_id" text,
	"waba_id" text,
	"api_key_enc" text,
	"webhook_token" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"last_webhook_at" timestamp with time zone,
	"last_error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_accounts_provider_ck" CHECK ("wa_accounts"."provider" in ('mock', 'cloud', 'd360')),
	CONSTRAINT "wa_accounts_status_ck" CHECK ("wa_accounts"."status" in ('connected', 'disconnected', 'error'))
);
--> statement-breakpoint
CREATE TABLE "wa_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"wa_account_id" uuid,
	"tenant_id" uuid,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_login_links" ADD CONSTRAINT "courier_login_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_login_links" ADD CONSTRAINT "courier_login_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonator_user_id_users_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_group_id_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_batches" ADD CONSTRAINT "price_change_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_group_id_option_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."option_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_events" ADD CONSTRAINT "branch_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_events" ADD CONSTRAINT "branch_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_days" ADD CONSTRAINT "special_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_days" ADD CONSTRAINT "special_days_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_requests" ADD CONSTRAINT "cancellation_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_acks" ADD CONSTRAINT "order_acks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_acks" ADD CONSTRAINT "order_acks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_option_id_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_verification_codes" ADD CONSTRAINT "order_verification_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_verification_codes" ADD CONSTRAINT "order_verification_codes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_zone_id_delivery_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."delivery_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_courier_user_id_users_id_fk" FOREIGN KEY ("courier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_link_tokens" ADD CONSTRAINT "storefront_link_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_link_tokens" ADD CONSTRAINT "storefront_link_tokens_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_wa_account_id_wa_accounts_id_fk" FOREIGN KEY ("wa_account_id") REFERENCES "public"."wa_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_accounts" ADD CONSTRAINT "wa_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_accounts" ADD CONSTRAINT "wa_accounts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_notes_tenant_idx" ON "admin_notes" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "branches_tenant_idx" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_login_links_token_uk" ON "courier_login_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "courier_login_links_tenant_idx" ON "courier_login_links" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "legal_acceptances_tenant_idx" ON "legal_acceptances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "legal_acceptances_order_idx" ON "legal_acceptances" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_uk" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uk" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_tenant_active_uk" ON "subscriptions" USING btree ("tenant_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uk" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_lifecycle_idx" ON "tenants" USING btree ("lifecycle_stage");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uk" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uk" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "categories_tenant_sort_idx" ON "categories" USING btree ("tenant_id","sort");--> statement-breakpoint
CREATE INDEX "option_groups_tenant_idx" ON "option_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "options_group_sort_idx" ON "options" USING btree ("group_id","sort");--> statement-breakpoint
CREATE INDEX "options_tenant_idx" ON "options" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "price_change_batches_tenant_idx" ON "price_change_batches" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "product_option_groups_tenant_idx" ON "product_option_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "products_tenant_category_sort_idx" ON "products" USING btree ("tenant_id","category_id","sort");--> statement-breakpoint
CREATE INDEX "branch_events_branch_seq_idx" ON "branch_events" USING btree ("branch_id","seq");--> statement-breakpoint
CREATE INDEX "branch_events_created_idx" ON "branch_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "delivery_zones_branch_sort_idx" ON "delivery_zones" USING btree ("tenant_id","branch_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_uk" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_pending_run_at_idx" ON "jobs" USING btree ("run_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "jobs_running_locked_idx" ON "jobs" USING btree ("locked_at") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_type_idx" ON "jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notifications_tenant_created_idx" ON "notifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_order_idx" ON "notifications" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "opening_hours_branch_idx" ON "opening_hours" USING btree ("branch_id","weekday");--> statement-breakpoint
CREATE INDEX "opening_hours_tenant_idx" ON "opening_hours" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "special_days_branch_date_uk" ON "special_days" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "special_days_tenant_idx" ON "special_days" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cancellation_requests_pending_uk" ON "cancellation_requests" USING btree ("order_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "cancellation_requests_tenant_idx" ON "cancellation_requests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_bsuid_uk" ON "customers" USING btree ("tenant_id","wa_bsuid") WHERE wa_bsuid is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_phone_uk" ON "customers" USING btree ("tenant_id","phone_e164") WHERE phone_e164 is not null;--> statement-breakpoint
CREATE INDEX "customers_tenant_last_order_idx" ON "customers" USING btree ("tenant_id","last_order_at");--> statement-breakpoint
CREATE INDEX "order_acks_order_idx" ON "order_acks" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("tenant_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_item_options_item_idx" ON "order_item_options" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id","sort");--> statement-breakpoint
CREATE INDEX "order_items_tenant_idx" ON "order_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_verification_codes_order_uk" ON "order_verification_codes" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_verification_codes_pending_uk" ON "order_verification_codes" USING btree ("tenant_id","code") WHERE used_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_number_uk" ON "orders" USING btree ("tenant_id","number") WHERE test_kind is distinct from 'canary';--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_idempotency_uk" ON "orders" USING btree ("tenant_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "orders_open_idx" ON "orders" USING btree ("tenant_id","branch_id","status") WHERE status in ('awaiting_customer','new','accepted','preparing','ready','on_the_way');--> statement-breakpoint
CREATE INDEX "orders_branch_placed_idx" ON "orders" USING btree ("tenant_id","branch_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("tenant_id","customer_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_courier_idx" ON "orders" USING btree ("tenant_id","courier_user_id") WHERE courier_user_id is not null;--> statement-breakpoint
CREATE INDEX "orders_rejection_scheduled_idx" ON "orders" USING btree ("rejection_scheduled_at") WHERE rejection_scheduled_at is not null;--> statement-breakpoint
CREATE INDEX "otp_verifications_order_idx" ON "otp_verifications" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "otp_verifications_phone_idx" ON "otp_verifications" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_order_uk" ON "reviews" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reviews_tenant_idx" ON "reviews" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storefront_link_tokens_hash_uk" ON "storefront_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "storefront_link_tokens_tenant_idx" ON "storefront_link_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_account_customer_uk" ON "conversations" USING btree ("tenant_id","wa_account_id","customer_id");--> statement-breakpoint
CREATE INDEX "conversations_branch_last_msg_idx" ON "conversations" USING btree ("tenant_id","branch_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_wamid_uk" ON "messages" USING btree ("wamid");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("tenant_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_order_idx" ON "messages" USING btree ("order_id") WHERE order_id is not null;--> statement-breakpoint
CREATE INDEX "sms_messages_tenant_created_idx" ON "sms_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_messages_created_idx" ON "sms_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_accounts_webhook_token_uk" ON "wa_accounts" USING btree ("webhook_token");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_accounts_branch_uk" ON "wa_accounts" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_accounts_phone_number_id_uk" ON "wa_accounts" USING btree ("phone_number_id") WHERE phone_number_id is not null;--> statement-breakpoint
CREATE INDEX "wa_webhook_events_received_idx" ON "wa_webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "wa_webhook_events_account_idx" ON "wa_webhook_events" USING btree ("wa_account_id");