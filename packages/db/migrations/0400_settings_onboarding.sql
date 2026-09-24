-- Dilim 4 (işletme ayarları + onboarding + müşteriler): yeni tablolar. Mevcut kolonlar değiştirilmez.

-- Onboarding ilerlemesi (04 §3): son adım kodu, "WhatsApp'sız başla" seçimi, test siparişi.
CREATE TABLE IF NOT EXISTS tenant_onboarding (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  step text,
  whatsappless_at timestamptz,
  test_order_id uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TRIGGER tenant_onboarding_set_updated_at BEFORE UPDATE ON tenant_onboarding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- KVKK silme/anonimleştirme kaydı (08 §2.10): anonimleştirilen müşteri aramada ve listede çıkmaz.
CREATE TABLE IF NOT EXISTS customer_erasures (
  customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  erased_at timestamptz NOT NULL DEFAULT now(),
  erased_by_user_id uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_erasures_tenant_idx ON customer_erasures (tenant_id);
