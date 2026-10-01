-- "Panel çevrimdışı" uyarısına ardışık uyarı sayacı (bildirimler dilimi, tablo 0700; 06 §7.7). Önceki kural yalnız "şube başına 60 dk'da bir"
-- olduğundan, paneli hiç açılmayan bir şube için uyarı sonsuza dek saat başı tekrarlıyordu: 24 saat açık bir
-- işletmede günde 24 WhatsApp mesajı. Artık bir çevrimdışı serisinde en çok PANEL_OFFLINE_ALERT_MAX uyarı gider;
-- sayaç sipariş ekranı bir kez görüldüğünde VE her yeni açılışta (vardiya) sıfırlanır, yani sınır vardiya başınadır:
-- dünkü sınır bugünü susturmaz, yoksa uyarı kalıcı olarak ölür ve sipariş kaçar.
-- Drizzle karşılığı: packages/db/src/schema/notifications-ext.ts (branchPanelPresence.offlineAlertCount)
ALTER TABLE "branch_panel_presence" ADD COLUMN IF NOT EXISTS "offline_alert_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Geçmiş satırlar: uyarı gönderilmiş şubeler için seri 1 sayılır (hiç uyarılmamışsa 0 kalır); ilk açılışta
-- zaten sıfırlanacağı için bu yalnız göç anındaki saati etkiler.
UPDATE "branch_panel_presence" SET "offline_alert_count" = 1 WHERE "offline_alerted_at" IS NOT NULL;
