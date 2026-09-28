-- wa_accounts.provider CHECK'i Drizzle şemasıyla (WA_PROVIDERS, packages/core/src/enums.ts) aynı olsun: 'twilio'
-- WA_PROVIDERS'a eklendi (docs/16) ama 0900'deki kısıt eski listede kalmıştı. Twilio yalnız platform numarasıdır
-- (PLATFORM_WA_PROVIDER); işletmenin kendi numarası panelden Twilio seçemez (WA_OWN_PROVIDERS). Kısıt yine de şemayla
-- birebir tutulur ki şema ile veritabanı ayrışmasın.
ALTER TABLE "wa_accounts" DROP CONSTRAINT IF EXISTS "wa_accounts_provider_ck";
--> statement-breakpoint
ALTER TABLE "wa_accounts" ADD CONSTRAINT "wa_accounts_provider_ck" CHECK ("wa_accounts"."provider" in ('mock', 'cloud', 'd360', 'twilio', 'shared'));
