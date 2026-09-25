-- Kimlik güvenliği: TOTP iki adımlı doğrulama (00 §12a madde 7, 14 §5). Mevcut kolonlar değiştirilmez;
-- users.totp_secret_enc (0000) etkin sırrı tutar.

-- Açıldığı an (null = kapalı)
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
--> statement-breakpoint
-- Kurulumu süren sır (şifreli); ilk doğru kodla totp_secret_enc'e taşınır
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret_enc text;
--> statement-breakpoint
-- Tekrar oynatma koruması: son kabul edilen 30 sn'lik adım
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint;
--> statement-breakpoint
-- Tek kullanımlık kurtarma kodlarının SHA-256 özetleri
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_hashes text[] NOT NULL DEFAULT '{}'::text[];
