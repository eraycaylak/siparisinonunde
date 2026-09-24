-- Dilim 3 (WhatsApp + SMS): konuşma motoru bot durumu (schema/whatsapp-ext.ts → conversationBotState)
CREATE TABLE IF NOT EXISTS "conversation_bot_state" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"next_send_at" timestamp with time zone,
	"cooldowns" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"code_fail_count" integer DEFAULT 0 NOT NULL,
	"code_fail_since" timestamp with time zone,
	"marketing_opt_out_at" timestamp with time zone,
	"opted_out_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_bot_state_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "conversation_bot_state_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_bot_state_tenant_idx" ON "conversation_bot_state" USING btree ("tenant_id");
--> statement-breakpoint
-- Gelen mesaj → konuşma listesi ve dev simülatörü sorguları
CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_to_phone_idx" ON "sms_messages" USING btree ("to_phone", "created_at");
