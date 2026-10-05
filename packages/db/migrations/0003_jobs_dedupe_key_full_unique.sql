-- DİLİM: TEMEL (0000–0099). `jobs` tablosu bu dilimde, 0000_init.sql içinde oluşturuldu; bu dosya o tablonun
-- tekillik indeksini 0000'daki TAM unique'e YAKINSATIR (üretimde hiçbir şey değişmez).
--
-- NEDEN BU DOSYA VAR: aynı numarada kısa süre `0003_jobs_dedupe_partial_unique.sql` adlı, `dedupe_key`
-- tekilliğini `where status in ('pending','running')` yüklemine indiren bir göç duruyordu. ÜRETİME HİÇ
-- UYGULANMADI; yalnız yerelde `pnpm db:migrate` çalıştırılmış geliştirici veritabanlarında kurulmuş olabilir.
-- `migrate.ts` içeriği değişen bir dosyayı YENİDEN UYGULAMAZ (yalnız uyarır) — bu yüzden eski dosya silinip
-- yakınsayan göç YENİ ADLA eklendi: kısmi indeksi olan veritabanları bu adı "uygulanmamış" görüp onarılır.
-- (Eski adın `_migrations`'ta kalan satırı zararsız: `migrate.ts` disk üstündeki dosya listesini dolaşır.)
--
-- SORUN (kısmi tekillik neyi kırıyordu): CLAUDE.md değişmez kural 6 (idempotency: aynı dış etki iki kez olmaz)
-- ve kural 8 (sipariş başına en çok 4 durum mesajı) veritabanı düzeyinde ANAHTARA dayanır. Biten (`done`) iş
-- anahtarı bıraktığı anda `push:new_order:<sipariş>`, `platform_alert:new_order:<sipariş>`, `sms_alarm:<sipariş>`,
-- `notify:<sipariş>:<durum>`, `notify_approval_delay:<sipariş>`, `sms_status:<sipariş>:<key>`, `wa_send:<mesaj>`,
-- `wa_send_shared:<mesaj>`, `wa_in:<olay>` anahtarlarının hiçbiri ikinci satırı engellemiyordu: müşteriye ikinci
-- mesaj, ikinci paralı SMS, ikinci push mümkün hale geliyordu. İşleyicilerin kendi idempotency kapısı yoktur
-- (ör. `services/messaging/sms-send.ts`: normalize → kill-switch → insert → gönder), anahtar TEK çittir.
--
-- ÇÖZÜM: tekillik TAM kalır; "yeniden kurulabilmesi" gereken işleri anahtarın kendisi ayırır — NESİL eki
-- (`…#g<n>`, `apps/api/src/lib/jobs.ts` → `generationKey`; `#` ayracı `cancelJobs` tarafından zaten rezerve):
--   * `alarm:<sipariş>:<adım>` → kalıcı başarısız adımı emniyet cron'u `#g1`, `#g2` … ile yerine koyar; bekleyen
--     ret ertelemesi de her turda bir sonraki nesli açar (eski `…:after:<zaman>` deseni kendi anahtarını eziyordu).
--   * `finalize_rejection:<sipariş>#g<version>` → ret → geri al → yeniden ret her seferinde taze anahtar alır.
-- Nesil alan bu iki iş DIŞARIYA etki üretmez (olay yazar, `transitionOrder` çağırır); dış etki üreten işler nesil
-- ALMAZ, anahtarları ebedîdir ve ikinci satır insert EDİLEMEZ.
--
-- Drizzle karşılığı: packages/db/src/schema/operations.ts → `uniqueIndex('jobs_dedupe_key_uk').on(t.dedupeKey)`
-- (hiç değişmedi; şema ile çalışma zamanı SQL'i yeniden tutuyor).
--
-- ÜRETİMDE NO-OP: indeks zaten tam (`indpred IS NULL`) → koşul tutmaz, kilit alınmaz, indeks yeniden kurulmaz.
-- Yalnız kısmi indeksi olan geliştirici veritabanları onarılır; orada tam unique'i engelleyebilecek çift
-- anahtarlar (kısmi indeks altında doğmuş) en yenisi korunarak `#dup:<id>` ile adlandırılır — satır ve anahtar
-- metni SİLİNMEZ, admin DLQ ekranı okumaya devam eder.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'jobs_dedupe_key_uk' AND i.indpred IS NOT NULL
  ) THEN
    UPDATE jobs j
       SET dedupe_key = j.dedupe_key || '#dup:' || j.id::text
     WHERE j.dedupe_key IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM jobs k
          WHERE k.dedupe_key = j.dedupe_key
            AND k.id <> j.id
            AND (k.created_at, k.id) > (j.created_at, j.id)
       );
    DROP INDEX "jobs_dedupe_key_uk";
    CREATE UNIQUE INDEX "jobs_dedupe_key_uk" ON "jobs" USING btree ("dedupe_key");
  END IF;
END $$;
--> statement-breakpoint
-- Kısmi indeksin yan ürünüydü: durumdan bağımsız anahtar aramasına hizmet eden yardımcı indeks. Tam unique bu
-- sorguları (cron dilimi kontrolü, `cancelJobs` anahtar süzgeci) kendisi karşılar → ikinci indeks gereksiz.
DROP INDEX IF EXISTS "jobs_dedupe_key_idx";
