# 🎯 YEMEK GELSİN — A'DAN Z'YE ÜRETİME ÇIKIŞ DENETİMİ

**Tarih:** 04.10.2026 · **Canlı sürüm:** `cfdec9fe` (HEAD ile aynı, uptime ~10 sa) · **Kapsam:** 16 paralel boyut + eksik-tarama eleştirisi · **Raportörün kendi doğrulamaları aşağıda `✅ ben doğruladım` ile işaretli.**

---

## 1️⃣ İŞLEYİŞ — sistem bugün uçtan uca nasıl çalışıyor

### 🧑 Müşteri (iki akış)

| Akış | Giriş | Yol | Sipariş doğar |
|---|---|---|---|
| **A** | QR / `wa.me` → ortak numara (+1 850 909 9295) | Webhook → `wa_webhook_events`+`jobs` tek transaction → worker → ortak numara yönlendiricisi (0–8 karar sırası) → dükkan botu → karşılama + menü linki `/m/<token>` (2 sa) → `/s/<slug>` vitrin → `/quote` (fiyat yalnız sunucuda) → `/orders` | `status='new'`, `channel='wa_link'` |
| **B** | Doğrudan vitrine girer (link çerezi yok) | Sipariş `awaiting_customer` doğar + 6 haneli kod (küresel tekil, 30 dk) → müşteri kodu WhatsApp'a yazar → `new`. Yedek: SMS OTP | `status='new'`, `verificationMethod='wa_code'` |

- **Sipariş sonrası:** `order_events` + `branch_events` + outbox + `jobs` **hep aynı transaction'da** → alarm zinciri (t=0 push/ses · 60 sn tekrar · 2 dk platform WhatsApp · 5 dk SMS · 10 dk müşteri · 15 dk oto-iptal) + 60 sn debounce (yalnız Akış A).
- **Takip:** `/t/<token>` (HMAC, saklanmaz), 15 sn yoklama, final+7 gün sonra 410. İptal: `new`/`awaiting` → doğrudan; `accepted+` → iptal talebi.
- **Mesaj bütçesi:** sipariş başına ≤4 durum mesajı, **atomik DB sayacıyla** zorlanıyor.

### 🏪 İşletme
Kayıt (`/panel/kayit`, herkese açık) → 14 gün deneme + ortak numaraya otomatik bağlanma + dükkan kodu → 7 adımlı kurulum sihirbazı → **Kapı 1** (4 zorunlu adım → `web_live_at`, vitrin açılır) / **Kapı 2** (+WhatsApp bağlı + test siparişi → `live_at`) → panel: SSE (`branch_events` + LISTEN/NOTIFY + Last-Event-ID) + 45 sn emniyet sorgusu + Web Audio osilatör alarmı (lider sekme, Web Locks) + Web Push.

### 🛵 Kurye
Panelden magic link (15 dk, tek kullanım, SHA-256) → 12 sa oturum → yalnız kendisine atanmış sipariş (`FOR UPDATE`, IDOR testli) → "Yola çıktım" / "Teslim ettim" (+ ödeme yöntemi) → teslimde sipariş listeden tamamen düşer.

### ⚙️ Altyapı
Cloudflare Worker + **TEK container** (PostgreSQL + API + worker + web), yedek 2 dakikada bir R2'ye `pg_dump -Fc`, container diski **geçici**. Dağıtım: dala push → GitHub Actions → `wrangler deploy`. Sağlık: `/health` `{ok, db:up}` · `/health/worker` `{jobLagSec:0, stuckJobs:0}` ✅ ben doğruladım.

---

## 2️⃣ ÜRETİME HAZIR MI

# 🔴 HAZIR DEĞİL

Ürünün **çekirdeği** (durum makinesi, fiyatlama, tenant yalıtımı, kimlik/yetki, KVKK imha motoru, veri modeli, 897 test) üretim kalitesinde — bunlar beklediğimden iyi. Hazır olmayan şey **çevresi**: (a) canlı sitede şu an `[Şahıs şirketi unvanı — teyit edilecek]` künyesi ve "Taslak, hukuki inceleme bekliyor" ibareli mesafeli satış sözleşmesi yayında ✅ ben doğruladım — ilk gerçek siparişte hem 6563 künye hem Mesafeli Sözleşmeler ihlali; (b) dağıtım hattı **monorepo'nun 897 testinin hiçbirini koşmuyor**, ajan dalına atılan her commit kapısız canlıya iniyor ve duman testi kırmızı yansa bile geri dönüş yok ✅ ben doğruladım; (c) yedek zincirinde iki somut veri kaybı yolu var (kapanışta aynı `/tmp/yedek.dump` + hiç doğrulanmayan döküm) ✅ ben doğruladım; (d) hiçbir otomatik uyarı kanalı yok — gece container crash loop'a girse sabaha kadar kimse bilmez; (e) webhook girişinde tampon yok, **her dağıtımda gelen WhatsApp mesajları kalıcı kayboluyor**; (f) deneme bitişini uygulayan hiçbir kod yok ve `read_only` aşaması sipariş almayı durdurmuyor ✅ ben doğruladım → ücretli iş modeli fiilen yok. Teknik borç değil bunlar; ilk hafta içinde ya para ya veri ya hukuk kaybettiren yollar.

> **Şartlı hazır olabilir**: Faz 0 + Faz 1 (aşağıdaki sıralı liste, ~3-5 gün) kapatılırsa **tek pilot restoranla** canlıya çıkılabilir. Çok şubeli veya yoğun satışa bu haliyle hayır.

---

## 📱 WHATSAPP NUMARASI ONAYLI MI? → **DOĞRULANAMADI**

| Soru | Cevap |
|---|---|
| Twilio secret'ları canlıda var mı? | ✅ Var — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WA_PHONE` (28 Eyl'de eklenmiş). Son dağıtım özeti: "WhatsApp: gerçek numara, Twilio (simülatör kapalı)" |
| Numara WhatsApp'ta **onaylı** mı? | ❓ **Kodda görünmez — canlı Twilio durumudur.** Buradan okuyamadım: lokal Twilio kimliği yok (`.env` dosyası hiç yok) ve admin paneline girmek canlı parola gerektiriyor (parola girmem kurallara aykırı). |
| Nasıl öğrenilir? | **Admin › WhatsApp › "Bağlantıyı test et"** → `ready: true` **ve** durum `ONLINE` / `ONLINE:UPDATING` olmalı. |
| Hangi cevap "onaylı değil" demektir? | `PENDING_VERIFICATION` · `VERIFYING` · `TWILIO_REVIEW` · `DRAFT` · `STUBBED` · `OFFLINE` → numara mesaj gönderemez. `PENDING_VERIFICATION`'da Twilio Console'da doğrulama kodu girilmemiş (SMS gelmiyorsa "Phone call" seçeneği). |
| Aynı ekranda ayrıca bakılacak | Webhook Twilio'ya kayıtlı mı · **durum geri bildirimi (status callback) adresi** kayıtlı mı · görünen ad "Yemek Gelsin" mi · deneme (trial) hesabı uyarısı var mı. Üçü birden tam değilse `ready:false` döner. |
| Ek risk | Numara **+1 850 (ABD)**. TR müşterisinin yabancı numaraya yazması güven/spam algısı yaratır; TR numarasına geçiş planı dokümanlarda yok. |
| Sessiz arıza riski | Ortak numara 401 verirse ya da sussa **hiçbir alarm yok** (401 loglanmıyor, `shared` sağlayıcı sessizlik denetiminden çıkarılmış). Tüm dükkanların siparişi durur, kimse bilmez. |

**Chrome MCP notu:** canlı admin paneline girmek için parola yazmam gerekiyor, bu kurallarım gereği yapamadığım bir şey. Bu tek adımı sen 30 saniyede yapıp sonucu söylersen kalan değerlendirmeyi tamamlarım. Chrome'la yaptığım şey: canlı yasal sayfaları ve sağlık uçlarını okudum (aşağıdaki ✅'ler).

---

## 3️⃣ ÇIKMADAN ÖNCE KAPATILMASI ŞART — 🔴 BLOCKER (14)

| # | Konu | Dosya | Durum |
|---|---|---|---|
| B1 | Künye/KVKK metni yer tutucu, **canlıda yayında** | `apps/web/lib/site.ts:89` | ✅ doğrulandı (canlı curl) |
| B2 | Mesafeli satış + ön bilgilendirme "**Taslak**" olarak onaylatılıyor | `store-legal-document.tsx:45`, `enums.ts:423` | ✅ doğrulandı |
| B3 | **DPA ve alt işleyen listesi üründe hiç yok** | `routes/auth.ts:182` | ✅ doğrulandı |
| B4 | CI hiçbir monorepo testi/tür denetimi koşmuyor | `.github/workflows/deploy-dev-cloudflare.yml:113` | ✅ doğrulandı |
| B5 | Ajan dalına her push kapısız canlıya; geri dönüş yok | aynı dosya `:38`, `:328` | ✅ doğrulandı |
| B6 | Yedek: aynı `/tmp/yedek.dump` + doğrulanmamış döküm iyi yedeği eziyor | `deploy/cloudflare/entrypoint.sh:143` | ✅ doğrulandı |
| B7 | Yedek hatası tamamen sessiz; `son.dump` TEK kopya | `entrypoint.sh:106` | ✅ doğrulandı |
| B8 | Webhook girişinde **spool yok** → her dağıtımda sipariş kaybı | `services/messaging/ingest.ts:18` | ✅ doğrulandı |
| B9 | **Hiçbir otomatik uyarı kanalı yok** (Sentry/Slack/mail/webhook = 0) | `deploy/cloudflare/src/index.ts:312` | ✅ doğrulandı |
| B10 | Onay kapısı yok: herkes kaydolup kendi kendine canlıya geçiyor | `routes/auth.ts:152`; `signup-status` → `{open:true}` | ✅ doğrulandı |
| B11 | Onay butonundaki toplam sunucu quote'una bağlı değil | `checkout-page.tsx:177` | rapor edildi |
| B12 | Tüm yasal metinler sabit; secret'la düzeltilemez, kod değişikliği şart | `site.ts:89` | ✅ doğrulandı |
| B13 | **Deneme bitişi hiç uygulanmıyor + `read_only` sipariş almayı durdurmuyor** | `storefront/load.ts:25` → `['suspended','churned']` | ✅ doğrulandı |
| B14 | `DATA_EPOCH` / `VPS_HOST` tek secret ile canlıyı **sessizce sıfırlıyor** | `entrypoint.sh:171-186`, `deploy-production.yml` | rapor edildi |

### Detay (ne / neden / nasıl)

**B1 — Künye yer tutucu, canlıda.** `curl https://yemekgelsin.net/kunye` → 14 kez "teyit edilecek", 4 kez "[Açık adres]". KVKK m.10 veri sorumlusu kimliği hiç verilmemiş + 6563 m.3 künye yok. `destek@yemekgelsin.net` posta kutusu da kodun kendi notuna göre kurulmamış → m.13'teki 30 günlük cevap süresi işler, başvuru hiç ulaşmaz.
→ **Düzeltme:** gerçek unvan/adres/VKN/vergi dairesi/telefonu `LEGAL_ENTITY`'ye yaz, posta kutusunu aç, CI'a "değerlerde `[` varsa üretim derlemesi kırılsın" kontrolü ekle.

**B2 — Taslak sözleşme onaylatılıyor.** Checkout'ta onay kutusu zorunlu ve bağlandığı metinde "Taslak, hukuki inceleme bekliyor" yazıyor; kabul kaydına `2026-09-28-taslak` sürümü kalıcı yazılıyor.
→ **Düzeltme:** avukat onayı → sürümü tarihli yayın sürümüne çevir, taslak bantlarını kaldır. Onaya kadar: sürüm `taslak` içeriyorsa `POST /store/:slug/orders` **fail-closed** reddetsin (taslak metinle kabul kaydı hiç oluşmasın).

**B3 — DPA yok.** Platform, işletmeler adına son müşteri verisi işliyor → veri işleyen. KVKK m.12/2 yazılı sözleşme ister, docs/08 §2.2 bunu 11 maddelik click-wrap DPA olarak tanımlıyor; kayıtta yalnız `abonelik` + `kvkk_aydinlatma` kabul ediliyor.
→ **Düzeltme:** `/yasal/dpa` sürümlü sayfa + `LEGAL_DOCUMENTS`'a `dpa` + kayıtta `legal_acceptances`'a yaz + alt işleyen listesini (Cloudflare, Twilio, FCM/APNs/Mozilla, GitHub) ülke + m.9 dayanağıyla yayınla.

**B4 — CI testleri koşmuyor.** Adımın adı "Bağımlılıklar, tür denetimi ve testler" ama `working-directory: deploy/cloudflare` → yalnız Worker kabuğunun 31 `node:test` vakası koşuyor. 85 Vitest dosyasındaki **897 vaka** ve 9 Playwright senaryosu dağıtımdan önce bir kez bile çalışmıyor. Üstelik `apps/api` ve `packages/db` üretimde `node --import tsx` ile çalışıyor → tür hatası derlemede yakalanmıyor, ilk istekte patlıyor.
→ **Düzeltme:** `services: postgres:16` olan ayrı `testler` job'u + `deploy: needs: [kontrol, testler]` + `pnpm typecheck && pnpm test`.

**B5 — Kapısız dağıtım + geri dönüş yok.** Tetikleyici: `branches: [main, claude/relaxed-pascal-1m775m]`. Yerel HEAD o ajan dalında. Sıra ters: dağıtım (satır ~301) duman testinden (328) ÖNCE; dosyada tek bir `if: failure()` adımı yok.
→ **Düzeltme:** tetikleyiciyi yalnız `main` yap, `environment: production` + required reviewer, `if: failure()` → `wrangler rollback`.

**B6/B7 — Yedek, en çok gerektiği anda bozuluyor.** `backup_now` sabit `dump=/tmp/yedek.dump` kullanıyor; `shutdown` yalnız `kill "$BACKUP_LOOP_PID"` ile alt kabuğu öldürüyor (çocuk `pg_dump` öksüz kalıp yazmaya devam eder), hemen ardından `backup_now force` AYNI dosyaya ikinci `pg_dump` başlatıyor. Döküm hiç `pg_restore --list` ile doğrulanmıyor ve aynı gövde hem `son.dump` hem `gun-<bugün>.dump` olarak yükleniyor → iki kopya birden bozulur. Hata yalnız stdout'a bir satır; `backup_now || true` yutuyor; `/health` yedeğin yaşını bilmiyor. (Not: VPS yolundaki `scripts/backup.sh:84` bu ikisini de **doğru** yapıyor — üretim yolu yapmıyor.)
→ **Düzeltme:** `mktemp` + süreç grubu kill/`flock` + yüklemeden önce `pg_restore --list` + `lastBackupAgeSec` sağlık alanı + 26 saatlik push-monitor.

**B8 — Dağıtım penceresinde sipariş kaybı.** `ingestWebhookPayload` yalnız PostgreSQL'e yazıyor; başka dayanıklı adım yok. Container kapanıp yenisi R2'den geri yükleme + migration ile açılırken (~20-60 sn, dağıtım + her OOM) Worker isteği 150 sn bekletiyor, **Twilio 15 sn'de kesiyor** ve Twilio gelen mesaj webhook'unu yeniden teslim etmiyor → o anki Akış B onay kodu / sipariş mesajı tamamen yok oluyor. Kaydı da yok, "kaç mesaj kaybettik" sorusunun cevabı yok. docs/06 §2 ilke 2 bunu açıkça yasaklıyor.
→ **Düzeltme:** Worker'da `/api/v1/webhooks/wa/*` için R2/Durable Object spool: imzayı doğrula → ham gövdeyi yaz → anında 200 → container hazır olunca idempotent olarak (gövde sha256 UNIQUE) yeniden oynat.

**B9 — Sessizlik.** Depoda Sentry/OTel/Slack/Telegram/SMTP/PagerDuty/logpush **yok**. DB düşmesi, crash loop, kuyruk takılması, yedek hatası, Twilio 401 → hepsi tek bir `console.error`. Haberdar olma yolu: "birisi admin Özet'i açarsa" ya da "işletme telefon ederse".
→ **Düzeltme:** (1) dış izleme (Uptime Kuma / Better Stack) `/health` **ve** `/health/worker` için 1 dk, 3 ardışık hatada telefona çağrı; (2) `apps/api/src/lib/alert.ts` → `ALERT_WEBHOOK_URL`; kalıcı iş hatası, `*_unavailable` notları, yedek hatası, Worker `scheduled` hata dalından çağır.

**B10 — Onaysız kayıt + tek WABA.** Telefon OTP'si, e-posta doğrulaması, işletme türü filtresi ve platform onayı olmadan bir yabancı 1 ürünle `web_live` olup **ortak numaranın dükkan seçicisine** girebiliyor. Platformun TEK WABA'sı olduğu için yasaklı bir dükkan Meta Commerce Policy ihlaliyle **tüm platformun numarasını** kapattırabilir. Commerce Policy beyanı da yalnız tarayıcıda doğrulanıyor, sunucuya hiç gitmiyor, hiçbir kabul kaydı yok.
→ **Düzeltme (hızlı):** canlıda `signup_open` bayrağını kapat, kaydı `/demo` lead formuna yönlendir. **(Kalıcı):** `tenants.approved_at` + `goLive`'da 409 `approval_required` + admin A-04'te gerekçeli "Kaydı onayla" + `commercePolicy: z.literal(true)` sunucuda.

**B11 — Müşteri gördüğünden farklı tutara onay veriyor.** `/quote` başarısız olursa buton açık kalıyor ve toplam `localStorage`'daki **teslimat ücreti içermeyen, bayat** ara toplamdan yazılıyor; 400 ms debounce yüzünden mahalleyi seçip hemen basan müşteri de ücretsiz toplam onaylıyor. Sunucu doğru (yüksek) tutarı kaydediyor; kapıda fiyat tartışması + kabul kaydında tutar hash'i olmadığı için "hangi tutarı onayladı" sorusunun cevabı yok.
→ **Düzeltme:** şemaya zorunlu `expectedTotalKurus` + sunucuda uyuşmazlıkta 409 `cart_changed` + fark listesi; istemcide `quote` yoksa buton pasif ve `cart.subtotalKurus` yedeğini kaldır; `legal_acceptances.amount_hash`.

**B13 — Ücretli iş modeli fiilen yok.** `trialEndsAt` yazılıyor, panelde bant gösteriliyor, **bitişi kontrol eden hiçbir cron yok** — kayıtlı 4 cron: `retention`, `sold_out_reset`, `branch_pause_end`, `panel_presence` ✅ doğrulandı. Ayrıca `ORDERING_BLOCKED_STAGES = ['suspended','churned']` → `read_only` listede yok, yani admin elle `read_only` yapsa bile vitrin sipariş almaya devam ediyor. Tahsilat, dunning, fatura üretimi, KDV, kurulum ücreti kodda **hiç yok**; fiyat sayfasında gerçek fiyatlar (990/1.790/2.990 TL) yayında. İlk işletmeden para alındığı gün e-arşiv fatura yükümlülüğü doğar.
→ **Düzeltme:** `read_only`'yi listeye ekle + `cron.trial_watch` (bitişte `read_only`) + fatura/tahsilatı ilk ay elle yap ve bunu yazılı bir işletim adımı olarak kabul et.

**B14 — Tek secret ile canlıyı sıfırlama.** R2'ye ulaşılabiliyor ama `DATA_EPOCH` önekinde nesne yoksa `fresh=1` → boş DB + seed + hemen `backup_now force` → **iyi yedek ezilir**, duman testi yeşil döner, tüm işletmeler ve siparişler yok olur. Aynı şekilde `VPS_HOST` secret'ı eklemek bir sonraki push'ta alan adını **boş veritabanlı** VPS'e taşıyor; "hedef dolu mu" kontrolü hiçbir adımda yok. (`deploy-production.yml` ayrıca root **parolalı SSH** kullanıyor ve host anahtarı yoksa ilk göreni kabul ediyor.)
→ **Düzeltme:** taze açılışta `tenants`/`orders` satır sayısı 0 değilse dur; `fresh=1` dalında ilk `backup_now force`'u **engelle**; `VPS_HOST` için elle onay kapısı.

---

## 4️⃣ İLK HAFTADA PATLAR — 🟠 HIGH (öncelik sırasıyla)

### Sipariş kaçar
| # | Ne | Dosya |
|---|---|---|
| H1 | Bitmiş işin dedupe anahtarı kalıcı → sipariş "bekleyen ret"te **kilitlenir**: ne onay, ne ret, ne 15 dk oto-iptal. `jobs_dedupe_key_uk` kısmi değil, tam unique ✅ doğrulandı | `lib/jobs.ts:87`, `0000_init.sql:817` |
| H2 | `recoverStaleJobs` deneme sayısına **hiç bakmıyor** ✅ doğrulandı → worker'ı çökerten bir iş sonsuza kadar denenir, her turda TÜM container yeniden başlar = sürekli kapanan site | `lib/jobs.ts:232` |
| H3 | `order-new-watch` emniyet cron'u yok → alarm işi `failed` olan sipariş sonsuza kadar `new` kalır | `jobs/cron/index.ts:40` |
| H4 | **Sentetik canary yok** (docs/00 §11 "pilot öncesi ZORUNLU") → SSE/panel teslim yolu sessizce bozulsa kimse anlamaz | `jobs/cron/index.ts:45` |
| H5 | Dayanıklılık 120 sn'lik `pg_dump`'a bağlı, **PITR yok** → OOM'da müşteriye "onaylandı" mesajı gitmiş sipariş yok olur | `entrypoint.sh:14` |
| H6 | Akış B doğrulama ekranı kalıcı adreste değil + sepet temizlenmiş → sekme yenilenince müşteri kodu kaybeder, 30 dk sonra sessiz iptal | `checkout-page.tsx:256` |
| H7 | Ortak numara (Twilio) sussa/401 verse **hiç alarm yok**; 'shared' sağlayıcı sessizlik denetiminden çıkarılmış | `services/admin/wa-health.ts:67` |
| H8 | Twilio kimlik hatası (20003/20005→190) yalnız log satırı: hesap duraklatılmıyor, uyarı gitmiyor | `services/messaging/send.ts:182` |
| H9 | Sağlayıcı geçişinde kuyrukta bekleyen webhook olayları yanlış ayrıştırıcıya düşüp **hatasız "işlendi"** damgalanıyor | `ingest.ts:43` |

### Para / kurye
| # | Ne | Dosya |
|---|---|---|
| H10 | **Kurye teslimde ödeme yöntemini değiştiriyor**, sunucu doğrulamıyor, eski değer hiçbir yere yazılmıyor → P-32 kurye nakit kırılımı istenildiği kadar düşürülebilir, işletme bunu üründen göremez | `routes/courier/index.ts:141` |
| H11 | `/delivered` ödeme yöntemini hiç doğrulamıyor: `online_card`, `pay_at_counter`, **markasız yemek kartı** kabul ediliyor | `routes/courier/index.ts:134` |
| H12 | Checkout butonu quote'a bağlı değil (B11'in operasyonel yüzü): CGNAT arkasında 120/dk limitine takılan müşteri eksik toplam onaylıyor | `checkout-page.tsx:177` |
| H13 | "Teslim edilemedi" akışı **kodda hiç yok** → kurye kapıda müşteri yokken yanlış biçimde "Teslim ettim"e basıyor, müşteriye M10 + değerlendirme isteği gidiyor | `courier-orders.tsx:126` |
| H14 | Sepet değişikliği müşteriye hiç gösterilmiyor (K10/K12 fark listesi yok); tükenen ürünle checkout çıkmaz sokak | `checkout-page.tsx:268` |

### Ortak numara / yalıtım
| # | Ne | Dosya |
|---|---|---|
| H15 | Seçici soğuması **her** platform yanıtına uygulanıyor (`auto` bayrağı yazılıp hiç okunmuyor) → ilk temas eden müşteri 60 sn cevapsız kalıyor | `shared-router.ts:593` |
| H16 | Webhook'ta `phone_number_id` uyuşmazlığı **yalnız `log.warn`**, olay o tenant bağlamında işlenmeye devam ediyor ✅ doğrulandı | `ingest.ts:60` |

### KVKK / hukuk
| # | Ne | Dosya |
|---|---|---|
| H17 | KVKK silme **`sms_messages`'ı kapsamıyor**: telefon 90 gün daha açık, `body` (düz OTP + takip linki) süresiz | `services/customers/index.ts:377` |
| H18 | Personel/kurye aydınlatması hiçbir ekranda yok; FCM/APNs/Mozilla yurt dışı alıcı olarak hiçbir metinde yazılmamış | `app/panel/giris/page.tsx:9` |
| H19 | Yasal metin sürümleme kanıt üretmiyor: `legal_documents` tablosu, içerik hash'i, tutar hash'i yok → eski sipariş güncel metinle çiziliyor | `enums.ts:423` |
| H20 | 5651 trafik/erişim kaydı canlı ortamda **hiç tutulmuyor** (Caddy yalnız kullanılmayan VPS yolunda; logpush yok) | `Caddyfile:51` |

### Operasyon / altyapı
| # | Ne | Dosya |
|---|---|---|
| H21 | DLQ (`failed`) için uyarı yok **ve hiç temizlenmiyor** → müşteri telefonu + düz metin OTP süresiz kalıyor, tablo sınırsız büyüyor | `jobs/system/index.ts:176,178` |
| H22 | Worker sağlık ucunu üretimde kimse yoklamıyor (Worker cron yalnız `/health` çağırıyor) | `deploy/cloudflare/src/index.ts:311` |
| H23 | 1 GiB container'da yalnız Node yığın tavanları **704 MiB** → OOM = tam kesinti + veri kaybı; disk/bellek hiç izlenmiyor | `entrypoint.sh:216`, `routes/health.ts:40` |
| H24 | Rollback mekanizması hiç yok; **aşağı migration da yok** → migrate hata verirse sonsuz yeniden başlatma, çıkış yolu `DATA_EPOCH` artırıp veriyi feda etmek | `workflow:328`, `migrate.ts` |
| H25 | Görseller hiç küçültülmüyor (5 MB'a kadar orijinal, 104 px kutuda) + EXIF/GPS temizlenmiyor | `services/menu/uploads.ts:24` |
| H26 | `jobs` 'failed' saklama adımı atlıyor (PII) / `notifications` hiç silinmiyor / `sms_messages.body` hiç temizlenmiyor | `jobs/system/index.ts:107,170,178` |
| H27 | Migration numaralandırması dilim-bazlı → taze DB ile üretim **farklı sırada** uyguluyor; drizzle-kit meta `0000`'da donmuş, `db:generate` çalıştırılırsa container açılmaz | `migrate.ts:21`, `meta/_journal.json:4` |
| H28 | Admin'de onboarding hunisi yok (`onboarding_step` yazılıyor, hiçbir uçtan okunmuyor) → "takılan işletme" görünümü tamamen kör | `services/onboarding/index.ts:160` |
| H29 | Parolasını unutan işletme sahibini kurtarmanın **hiçbir yolu yok** (self-servis yok, admin aksiyonu yok, container'da kabuk yok) | `docs/15:215` |
| H30 | Destek oturumu müşteri telefonunu **maskesiz** görüyor + işletme destek erişiminden hiç haberdar edilmiyor | `panel-dto.ts:261`, `admin/impersonation.ts:77` |
| H31 | SMS yedeği sağlayıcıyı sormuyor: canlıda `SMS_PROVIDER='mock'` sabit → bayrak açılırsa "kod gönderildi" denip sipariş 30 dk'da düşer | `services/orders/verification.ts:34`, `mode.ts:87` |
| H32 | **E-posta kanalı diye bir şey yok** (SMTP/Resend/SES/nodemailer = 0): demo/lead başvurusu kimseye gitmiyor, KVKK başvuru kutusu yok, fatura yolu yok | `routes/public/index.ts:53` |
| H33 | Vitrin **her zaman varsayılan şubeyi** yüklüyor, müşteri şube seçemiyor + `is_default` varsayılanı `true` ve tek-varsayılan kısıtı yok → çok şubeli paket çalışmıyor | `storefront/load.ts:46`, `platform.ts:157` |
| H34 | Panelin çevrimdışı kabuğu yok (service worker bilerek önbelleksiz) → internet 2 dk giderse panel hiç açılmaz | `public/panel-sw.js:2` |
| H35 | Tailwind 4 / Next 16 → `oklch`/`color-mix` ⇒ **Chrome 111+ / Safari 16.4+** şartı; `browserslist` yok, hedef cihaz kararı yok. iOS'ta Web Push yalnız "Ana ekrana ekle" ile çalışır → alarmın t=0 adımı iPhone'da sessizce hiç gelmez | `apps/web/package.json`, `push-client.ts` |

---

## 5️⃣ TEKNİK BORÇ — 🟡 MEDIUM / ⚪ LOW (kısa liste)

| Küme | Maddeler |
|---|---|
| **Sipariş akışı** | `/undo-reject` sunucuda 30 sn ile sınırlı değil · docs/07 §4.1 "bekleyen ret sırasında oto-iptal önceliklidir" kodda **tersine** · `use_preparing_step` sunucuda denetlenmiyor · `delivered` sonrası ikinci `/delivered` 200 dönüp veriyi sessizce çöpe atıyor |
| **Ortak numara** | Seçilemeyen `#KOD` mesajı hiçbir dükkanın sohbetine girmiyor · `shared_wa_routes` kimlik çatallanması onarılmıyor (360dialog'a geçince yüzeye çıkar) · geri dönüşen telefon numarası önceki sahibinin dükkanlarını gösteriyor · tüm gelen trafik `main` worker şeridinde (retention ile aynı sırada) · dükkan kodu transaction dışında üretiliyor |
| **Para** | Bölge dışı özel ücret `"1.000"` → **1,00 TL** yazıyor · tasarruf raporu girilmemiş %25 komisyonu uydurup somut TL gösteriyor (doc 04 §11.3 yasaklıyor) · sepet 99'a çıkıyor, sunucu 50'de kesiyor → 400 · KDV `1.2` sihirli sayı, iki yerde ayrı · `subtotal_kurus` int4 taşma yolu |
| **Güvenlik** | Canlı yolda **CSP ve HSTS hiç gönderilmiyor** (`/api/*` dahil, yüklenen görsellerde `nosniff` yok) · kendi Meta Cloud hesabında webhook imzası doğrulanmıyor (`WA_APP_SECRET` yalnız ortak numarada zorunlu) · girişte hesap bazlı sınır/kilit yok (yalnız 10/dk/IP), parola alt sınırı 8, işletmede 2FA isteğe bağlı · kendi parolasını değiştiren kullanıcının diğer oturumları kapanmıyor · sağlık ucu commit SHA'sını kimliksiz açıyor · hız sınırı süreç belleğinde (her dağıtımda sıfırlanır) · istemci IP'si kenar durumda taklit edilebilir · yedek ucu (`yedek.internal`) container içinden kimliksiz okunur/yazılabilir |
| **Yalıtım** | Push aboneliği yalnız endpoint'le upsert → bir tenant diğerinin cihaz satırını devralıyor, B'nin alarmı susuyor · `sms_messages` şema yalıtım testinde gerekçesiz istisna · buton kimliğindeki sipariş kimliği tenant kapsamı olmadan okunuyor |
| **WhatsApp** | `wa_pending_statuses` mekanizması kodda hiç yok (wamid yarışında `failed`+63016 kalıcı kaybolur) · Twilio Auth Token biçimi hiç doğrulanmıyor · docs/13 teyit kaydında Twilio hiç geçmiyor (butonlu mesajların tamamı teyit edilmemiş bir belge iddiasına dayanıyor) · docs/16 §2.5 durum eşlemesi kodla uyuşmuyor |
| **Kalite** | **Hiç lint aracı yok** (ESLint/Biome/Prettier = 0) · kapsam (coverage) ölçümü hiç kurulmamış → "FSM+pricing %100 dal" kapısı ölçülemiyor · `apps/web`in 120 testi kök `pnpm test`'in dışında · otomatik IDOR taraması yok (`isolation.test.ts` kendi kurduğu örnek rotayı sınıyor) · konuşma FSM'i ne tablo güdümlü ne test edilmiş (7 durumdan 2'si yazılıyor, hiçbiri okunmuyor) · axe erişilebilirlik denetimi hiçbir katmanda yok · bağımlılık güvenliği (audit/Dependabot/SBOM/CVE) hiç ele alınmamış · yük/kapasite testi yok |
| **Veri modeli** | 3 indekste şema↔DB sapması + sapmayı yakalayan test/CI yok · uygulanmış migration değişirse yalnız uyarı · `lock_timeout`/`statement_timeout`/`CONCURRENTLY` hiç uygulanmamış · 4 kolonda enum CHECK/`$type` yok, kodda enum'da olmayan değerler yazılıyor (`order_code_attempts`, `conversation_handoff`) · R2 yedek nesneleri hiç budanmıyor |
| **Doküman↔kod** | `POST /store/events` sözleşmede var, kodda 404 (huni ölçümü yok) · PIN'li paylaşımlı cihaz oturumu yazılmamış · docs/04 §4.12 "Faz 1" sipariş düzenleme aksiyonlarının hiçbiri yok · docs/14/15 fiilen kullanılan **Twilio yolunu hiç anmıyor** · platform şablon butonu siparişe derin bağlantı vermiyor · alarm sesi şartnamesi (ses dosyası/PWA önbelleği) karşılanmıyor |
| **Diğer** | `initdb --locale=C.UTF-8` → "Çorba/İskender/Şiş" yanlış sıralanır, `ilike` ile `İ/ı` eşleşmez (lead/sipariş/sohbet/menü aramasında `turkishLower` yedeği yok) · raporlar sabit `Europe/Istanbul` · NTP/saat kayması hiç düşünülmemiş (15 dk iptal, saatler, 24 sa pencere container saatine bağlı) · vitrin `sitemap.xml`'de hiç yok ama taslak yasal metinler taranmaya açık · alerjen alanı yok (sorumluluk işletmeye atılmış, uyma imkânı verilmemiş) · takılı `preparing`/`on_the_way` siparişler için süpürücü yok · Twitter/X paylaşım kartı kök düzenden miras (işletmenin linki platformun pazarlama kartını gösteriyor) · `goLive` yaşam döngüsü matrisini atlıyor, `tenant_lifecycle_events` tablosu yok · menü adımı 1 ürünle "tamam" sayılıyor (şartname ≥5 + yasaklı ürün taraması diyor) · kurye giriş linki sistem tarafından hiç gönderilmiyor, yeni link eskisini iptal etmiyor, çevrimdışı kuyruk yok, navigasyonda şehir `"Yozgat"` gömülü · platform yöneticisi parolası her açılışta `DEV_PASSWORD`'e geri yazılıyor |

---

## 6️⃣ ZATEN SAĞLAM OLANLAR (bozmayın)

| Alan | Neden sağlam |
|---|---|
| **Sipariş durum makinesi** | `order-fsm.ts` geçiş tablosu docs/00 §5 ile **birebir**; `orders.status` `transitionOrder` dışında hiçbir yerde yazılmıyor (12 `update(orders)` çağrısının hiçbiri `status:` içermiyor); tablo güdümlü test her (durum, hedef) çiftini sınıyor |
| **Para ve fiyat** | Tek sunucu fonksiyonu (`quoteCart`); sipariş yazan iki yol da aynı zinciri kullanıyor; istemci tutarı zod ile düşüyor **ve bunun aktif testi var**; snapshot gerçek ve tam; DB CHECK'leri ikinci kapı; her yerde integer kuruş; sipariş sonrası para kolonu değiştiren **hiçbir yol yok**; 6493 tarafı gerçekten temiz (hiç ödeme sağlayıcısı yok) |
| **Sipariş numarası + idempotency** | `order_seq` satır kilidiyle atomik + `(tenant_id, number)` unique; `(tenant_id, idempotency_key)` kısmi unique + 23505 yakalama → çift tıklama ikinci sipariş üretmiyor |
| **Mesaj bütçesi** | ≤4 sınırı uygulamada değil **veritabanında** zorlanıyor (koşullu atomik UPDATE) |
| **Tenant yalıtımı** | Tüm panel/kurye uçları rol kapılı, her sorgu `auth.tenantId` ile süzülü, `assertBranchAccess` 403 değil **404** veriyor; çapraz-tenant 404 testleri menü/sipariş/müşteri/personel/bölge/sohbet/push/SSE'de fiilen yazılmış; 50 tabloda `tenant_id NOT NULL` makineyle test ediliyor |
| **Ortak numara şeması** | Dükkan kodu ve bekleyen Akış B kodu **veritabanı düzeyinde küresel tekil** → "kod çarpışması" ve "yanlış dükkan" senaryoları şemada kapatılmış; karar sırası (0–8) şartnameyle satır satır örtüşüyor; kişi başına advisory lock + iki taraflı tekrar-teslim denetimi |
| **Kimlik / yetki** | scrypt + HttpOnly/SameSite=Lax/Secure, DB'de SHA-256 token, girişte oturum rotasyonu, TOTP tekrar-oynatma koruması, destek oturumunda fail-closed salt-okunurluk, 192 bit webhook belirteçleri, magic link tek kullanımlı+atomik, yükleme türü magic bytes'tan, push endpoint beyaz listesi, **ham SQL'in tamamı parametreli**, üretimde `/dev` üç kat kapalı, depoda sızan sır yok |
| **SSE / olay günlüğü** | Şube başına advisory lock ile `seq` commit sırasına çivili; Last-Event-ID tekrar oynatması sayfalama + resync ile doğru; 45 sn emniyet sorgusu **panel kabuğunda** ve arka planda; mutfak rolünde fiyat/kişisel veri REST ve SSE'de tek kaynaktan silinyor |
| **Kuyruk** | `FOR UPDATE SKIP LOCKED` (testli), şeritler ayrı, worker gözetçisi (10 dk tur atmazsa `exit(1)`), cron dilim tekilliği UNIQUE ile, geçici DB hatasında katlanan bekleme, düzgün kapanışta iş kaybı yok |
| **KVKK imha motoru** | 20+ idempotent adım, her biri `retention_runs`'a **imha tutanağı** yazıyor, 48 saat alarmı var, `eraseCustomer` gerçekten anonimleştiriyor, loglarda telefon/URL/belirteç maskeleme kodda, Web Push yükü asgari, özel nitelikli veriden uzak durma uygulanmış, hiç LLM çağrısı yok |
| **Veri modeli** | Ham SQL ↔ Drizzle arasında kolon/tip/NOT NULL/DEFAULT/FK düzeyinde **sapma yok** (50 tablo, 82 FK); tüm zaman damgaları `timestamptz`; tüm para `integer *_kurus` (makineyle test); enum CHECK gövdeleri `enums.ts` ile birebir; durum tutarlılığı da DB'de (`orders_rejection_pending_ck` vb.) |
| **Twilio adaptörü** | İmza adresi `APP_BASE_URL`'den kuruluyor (sahte Host yanıltamaz), sabit zamanlı karşılaştırma, kimlik yalnız Authorization başlığında, 63016→131047→şablona düşme hattı uçtan uca bağlı, `SmsStatus=received` tuzağı kapatılmış, Content kaynağı önbelleği gerçekten idempotent |
| **Altyapı detayları** | Fail-closed açılış (R2'ye ulaşılamazsa boş DB ile açılmıyor), `DATA_EPOCH` yedek yolundan okunuyor, `ENCRYPTION_KEY` bir kez üretiliyor, migration tek transaction + advisory lock + checksum, duman testi sürümü commit SHA'sına çiviliyor, CF token izinleri dağıtımdan önce denetleniyor, WhatsApp yol çatışmasında dağıtım duruyor, container root değil + PID 1 tini |
| **Test gövdesi** | 897 Vitest + 9 Playwright; tür denetimi şu an **temiz** (apps/api, apps/web, packages/core, packages/db, e2e, scripts); alarm zinciri sahte saatle uçtan uca; KVKK süreleri tek tek; e2e'de hiç `waitForTimeout` yok. **Sorun testlerin kalitesi değil, hiçbirinin dağıtım yolunda koşmaması.** |

---

## 7️⃣ BAKILMAMIŞ ALANLAR / AÇIK SORULAR

| # | Soru | Durum |
|---|---|---|
| 1 | **Ortak WhatsApp numarası onaylı mı?** | ❓ **Doğrulanamadı** — yukarıdaki blok. Admin ekranından 30 sn'de öğrenilir. |
| 2 | 24 saatlik konuşma kotası / kalite derecesi / Meta işletme doğrulaması | ❌ Hiç izlenmiyor. Kodda yalnız saniye başına kota (20/sn). Ortak numarada **tüm kiracılar tek WABA kotasını paylaşıyor** → yeni numaranın iş-kaynaklı konuşma tavanı (250/1K) platform genelinde tükenince hiçbir dükkanın durum mesajı gitmez. Kiracı payı/tavan uyarısı yok. |
| 3 | 55 API test dosyası + 9 Playwright senaryosu gerçekten geçiyor mu? | ❓ **Burada koşturulamadı** (yerel PostgreSQL yok). Son dağıtım iş akışında yeşil ama o iş akışı bunları **koşmuyor** (B4). |
| 4 | Yabancı telefonlu müşteri | ❌ `normalizePhone` yalnız +90 kabul ediyor → başka ülke numarası `null` → sipariş düşer. Ortak numaraya yazan yabancı numaralı müşteri çıkmaz sokakta. |
| 5 | Kapasite: kaç işletme, kaç eşzamanlı panel, kaç sipariş/dk? | ❌ Ölçülmüş cevabı hiçbir yerde yok. 1/4 vCPU + 1 GiB, `shared_buffers=48MB`, `max_connections=40`, SSE bağlantısı için üst sınır yok. |
| 6 | Panelin açılacağı gerçek cihaz | ❓ Test edilmedi. Tailwind 4 → Chrome 111+/Safari 16.4+ şartı; restoranın eski Android tableti/iPad'inde panel bozuk açılabilir ve bunu yakalayan hiçbir test yok. |
| 7 | Olay yönetimi (SEV1–4, runbook, postmortem, destek SLA, P1 nöbet hattı) | ❌ docs/10 §5–§9 yazılı, kodda ve işletim listesinde **karşılığı yok**. docs/10 §1 madde 3 "ikinci VM + PITR + kurucuların P1 telefon hattı eksikse pilot başlamaz" diyor; üçü de yok. |
| 8 | Panel ve admin erişilebilirliği | ❌ Hiç denetlenmedi. Sipariş alan ekranın klavye/odak/kontrast/ekran okuyucu durumu bilinmiyor. |
| 9 | Türkiye VPS yolu (`deploy-production.yml`) | ⚠️ Denetim "kullanılmıyor" sayıp geçti ama canlı bir iş akışı; split-brain riski (`APP_BASE_URL` tek) ve root parolalı SSH + TOFU host anahtarı var. |
| 10 | Toplu müşteri/sipariş dışa aktarma | ❌ Kullanım koşullarında taahhüt var, kodda yalnız **tek müşteri** KVKK JSON'u var. |

---

## 8️⃣ SIRALI YAPILACAKLAR

**S** = birkaç saat · **M** = yarım–1 gün · **L** = 2+ gün

### FAZ 0 — Çıkış ön koşulu (hukuk + kapı) · ~2 gün
| # | İş | Boyut |
|---|---|---|
| 0.1 | Admin › WhatsApp › "Bağlantıyı test et" → `ready:true` + `ONLINE` gör. Değilse Twilio doğrulamasını tamamla. **Bu olmadan diğer her şey anlamsız.** | S |
| 0.2 | `LEGAL_ENTITY`'yi gerçek şirket bilgileriyle doldur + `destek@yemekgelsin.net` kutusunu aç + "değerde `[` varsa derleme kırılsın" kontrolü | S |
| 0.3 | Yasal metinleri avukat onayından geçir, `LEGAL_DOCUMENT_VERSION`'ı yayın sürümüne çevir, taslak bantlarını kaldır. **Onaya kadar:** sürüm `taslak` içeriyorsa sipariş ucu fail-closed reddetsin | M |
| 0.4 | DPA (`/yasal/dpa`, 11 madde) + alt işleyen listesi + `legal_acceptances`'a kabul kaydı | M |
| 0.5 | CI kapısı: `services: postgres:16` olan `testler` job'u + `deploy: needs:` + `pnpm typecheck && pnpm test` | S |
| 0.6 | Üretim dalını `main`'e al, ajan dalını tetikleyiciden çıkar, `environment: production` + required reviewer | S |
| 0.7 | `if: failure()` → `wrangler rollback` + `workflow_dispatch`'a `ref` girdisi | S |

### FAZ 1 — Veri kaybını kes · ~2-3 gün
| # | İş | Boyut |
|---|---|---|
| 1.1 | Yedek: `mktemp` + `pg_restore --list` doğrulaması + süreç grubu kill/`flock` + yükleme öncesi doğrulama | S |
| 1.2 | Taze açılış kapısı: `DATA_EPOCH` boşsa satır sayısı kontrolü, `fresh=1` dalında ilk `backup_now force`'u engelle; `VPS_HOST` için elle onay | S |
| 1.3 | `recoverStaleJobs`'a `attempts >= max_attempts` kapısı + claim sorgusuna `attempts < max_attempts` | S |
| 1.4 | `jobs_dedupe_key_uk` → `WHERE status='pending'` kısmi unique (migration) + hayati işlerde null dönüşü sessiz bırakma | M |
| 1.5 | `/health`'e `lastBackupAgeSec` + disk/bellek + dış izleme (1 dk, 3 hatada telefon) | M |
| 1.6 | `apps/api/src/lib/alert.ts` + `ALERT_WEBHOOK_URL`; kalıcı iş hatası, yedek hatası, Worker `scheduled`, `*_unavailable` notlarından çağır | M |
| 1.7 | Worker webhook spool (R2/Durable Object) + container hazır olunca idempotent drain | **L** |
| 1.8 | `cron.order_new_watch` emniyet cron'u | S |
| 1.9 | DLQ uyarısı + `failed` işler için retention (PII maskeleme + 30/90 gün) | S |

### FAZ 2 — Para ve iş modeli · ~2 gün
| # | İş | Boyut |
|---|---|---|
| 2.1 | `read_only`'yi `ORDERING_BLOCKED_STAGES`'e ekle + `cron.trial_watch` (deneme bitişinde `read_only`) | S |
| 2.2 | `expectedTotalKurus` + sunucuda 409 `cart_changed` + istemcide butonu quote'a bağla + `amount_hash` | M |
| 2.3 | Kurye ödeme yöntemi: `payment_method_changed` olayı (eski→yeni), `/delivered`'da `validatePayment`, şemayı 3 değere daralt, markasız yemek kartını reddet, panelde görünür kıl | M |
| 2.4 | Kayıt kapısı: canlıda `signup_open`'ı kapat + lead formuna yönlendir (S) ya da `approved_at` onay akışını yaz (M) | S/M |
| 2.5 | Bölge dışı ücret `parseTlToKurus` + tasarruf raporunda oranı nullable yap ("Oranınızı girin") | S |
| 2.6 | Fatura/tahsilat: ilk ay elle, yazılı işletim adımı olarak kabul et (e-arşiv yükümlülüğü) | S (karar) |

### FAZ 3 — İlk hafta dayanıklılığı · ~2-3 gün
| # | İş | Boyut |
|---|---|---|
| 3.1 | Akış B doğrulama ekranını `/t/<token>`'a taşı (`router.replace`) | S |
| 3.2 | Seçici soğumasını yalnız `decision.auto === true`'ya bağla + regresyon testi | S |
| 3.3 | `phone_number_id` uyuşmazlığında **dur** + orphan işaretle + admin alarmı | S |
| 3.4 | Ortak numara sessizlik dedektörü + webhook 401 loglaması + Twilio kimlik hatasında admin alarmı | M |
| 3.5 | "Teslim edilemedi" ucu + kurye ekranında 5 sn "Geri al" şeridi | M |
| 3.6 | `cron.canary` (tenant canary, 15 dk, `test_kind='canary'`, 60 sn'de ack yoksa resync + 2 hatada alarm) | M |
| 3.7 | KVKK silmeye `sms_messages` + `body` temizliği + `notifications` 90 gün | S |
| 3.8 | HSTS + CSP (Worker `withEnvHeaders`'a, `/api/*` dahil) + duman testine başlık kontrolü | S |
| 3.9 | Görsel yükleme: sharp ile EXIF strip + 320/640/1080 WebP varyant + `srcset` | M |
| 3.10 | Gerçek cihazda panel testi (restoranın tableti/telefonu): Tailwind 4 eşiği + iOS'ta PWA kurulumu olmadan push gelmediğini kullanıcıya anlatan akış | S |
| 3.11 | Admin'e "Parolayı sıfırla" aksiyonu (gerekçeli + audit + oturum kapatma) | S |
| 3.12 | Onboarding hunisi: kayıtta `lifecycleStage:'onboarding'` + admin listesine `onboardingStep` | M |

### FAZ 4 — Pilot sonrası (satmadan önce karar)
| # | İş | Boyut |
|---|---|---|
| 4.1 | **Çok şubeli işletme satmayı ertele** ya da vitrine şube seçimi ekle + `is_default` tek-varsayılan kısıtı | M |
| 4.2 | PITR (WAL arşivi → R2 / pgBackRest) ya da yönetilen Postgres | L |
| 4.3 | İkinci webhook alım düğümü (docs/00 §11 pilot şartı) | L |
| 4.4 | SMS: Netgsm secret'ları + `SMS_PROVIDER` türetmesi — ya da SMS basamağının çalışmadığını yazılı kabul et | M |
| 4.5 | 5651 erişim kaydı (Cloudflare Logpush → R2, 1 yıl, maskeli) | M |
| 4.6 | ESLint + coverage eşiği + otomatik IDOR taraması + axe | M |
| 4.7 | Migration numaralandırmasını tek artan diziye çevir + drizzle-kit yolunu kapat + şema sapma testi | M |
| 4.8 | E-posta kanalı (lead bildirimi, KVKK başvurusu, fatura) + SPF/DKIM/DMARC | M |
| 4.9 | `instance_type: standard-1` ve bellek tavanlarını gerçek bütçeye indir | S |

---

### 📌 Son söz (3 satır)
- **Çekirdek sağlam, çevre hazır değil.** Kod kalitesi beklenenin üstünde; kırılan yer altyapı, dağıtım kapıları, hukuki metinler ve iş modelinin tahsilat tarafı.
- **Bugün canlıya çıkarsan** en olası ilk üç olay: (1) dağıtım anında kaybolan WhatsApp siparişi, (2) taslak sözleşmeyle kurulmuş sipariş, (3) kimse farkına varmadan günlerce yazılamayan yedek.
- **Faz 0 + Faz 1 (~4-5 gün)** sonrası tek pilot restoranla çıkılabilir; o noktada bile en az iki şey elle yapılacak: fatura ve WhatsApp sağlık kontrolü.

---

# EK A — Eksik tarama eleştirisi

## 🎯 Hiç bakılmamış alanlar (16 boyutun tamamen dışında kalanlar)

### A. Paranın geldiği taraf: abonelik, deneme, tahsilat, fatura — SIFIR denetim
Denetim müşterinin ödediği parayı (sipariş tutarı) inceledi; **işletmenin size ödediği parayı hiç incelemedi.** Oysa iş modelinin tamamı bu.

| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 1 | **Deneme bitişini uygulayan hiçbir şey yok.** `trialEndsAt` kayıtta yazılıyor (`apps/api/src/routes/auth.ts:138,180`), panelde bant gösteriliyor, ama hiçbir cron/iş bitişi kontrol etmiyor. Kayıtlı 4 cron: retention, sold_out_reset, branch_pause_end, panel_presence (`grep -rn "registerCron(" apps/api/src`). Deneme bitmiş işletme sonsuza kadar bedava sipariş alır. | `apps/api/src/jobs/*/index.ts`, `apps/api/src/routes/auth.ts:138` |
| 2 | **`read_only` aşaması sipariş almayı DURDURMUYOR.** `ORDERING_BLOCKED_STAGES = ['suspended','churned']` — `read_only` listede yok. Kullanım koşulları "deneme bitiminde online sipariş alma durur" diyor; kod bunu yapmıyor, admin elle `read_only` yapsa bile vitrin sipariş almaya devam eder. | `apps/api/src/services/storefront/load.ts:25,87` |
| 3 | **Tahsilat ve faturalama ürününde hiç yok.** `subscriptions` tablosu yalnız admin tarafından elle yazılıyor (`routes/admin/tenants.ts:290`); ödeme alma, hatırlatma (dunning), fatura üretimi, KDV, kurulum ücreti, kurucu indirimi kodda yok. Fiyat sayfasında gerçek fiyatlar yayında (990/1.790/2.990 TL + kurulum ücreti). İlk işletmeden para alındığı gün **e-arşiv fatura yükümlülüğü** doğar; hiçbir muhasebe/fatura entegrasyonu yok. | `apps/web/lib/plans.ts`, `apps/web/app/(marketing)/fiyatlar/page.tsx`, `apps/api/src/routes/admin/tenants.ts` |
| 4 | **Sözleşmede verilen dışa aktarma taahhüdü kodda yok.** Kullanım koşulları §"Müşteri listesi ve sipariş geçmişi her zaman dışa aktarılabilir" diyor; kodda yalnız tek müşteri için KVKK JSON'u var (`/customers/:id/export`), toplu müşteri/sipariş dışa aktarma ucu yok. | `apps/api/src/routes/panel/customers.ts:86`; `yasal/kullanim-kosullari/page.tsx:94` |

### B. "Zincir" paketi fiilen çalışmıyor
| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 5 | **Vitrin her zaman varsayılan şubeyi yüklüyor; müşteri şube seçemiyor.** `orderBy(desc(branches.isDefault), asc(createdAt))` ile tek şube seçiliyor; çok şubeli işletmede tüm siparişler tek şubeye düşer, ikinci şubenin menüsü/saatleri/bölgeleri müşteriye hiç görünmez. Şube başına 2.990 TL satılan paket bu. (Bilinen "is_default kısıtı yok" bulgusu bunun sadece yarısı.) | `apps/api/src/services/storefront/load.ts:46-48` |

### C. İstemci cihaz/tarayıcı matrisi — hiçbir boyut dokunmadı
Panel = siparişin duyulduğu ekran. Hangi cihazda çalıştığı hiç sorulmamış.

| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 6 | **Tailwind 4 + Next 16 + React 19**, `browserslist` yok, hedef tarayıcı tanımı yok. Tailwind v4 çıktısı `oklch`/`color-mix`/`@property` kullanır → **Chrome 111+ / Safari 16.4+** şartı. Restoranın 2019 model Android tableti ya da eski iPad'inde panel bozuk/kullanılamaz açılır ve bunu yakalayan hiçbir test/karar kaydı yok. | `apps/web/package.json`, `apps/web/app/globals.css:1`, `postcss.config.mjs` |
| 7 | **iOS'ta Web Push yalnız "Ana ekrana ekle" ile çalışır** (iOS 16.4+). Alarm zincirinin t=0 adımı iPhone/iPad'de sessizce hiç gelmez; bunu kullanıcıya anlatan ya da tespit eden akış yok. | `apps/web/components/push/push-client.ts`, `apps/web/app/panel/manifest.webmanifest/route.ts` |
| 8 | **Panelin çevrimdışı kabuğu yok**: service worker bilerek yalnız bildirim işliyor, önbellek yok ("panel her zaman ağdan yüklenir"). Restoranın interneti 2 dakika giderse panel hiç açılmaz — sipariş kaçar. | `apps/web/public/panel-sw.js:2` |

### D. WhatsApp'ın iş/hesap tarafı (sorduğunuz numara onayı dahil)
| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 9 | **Numara onayı kodda görünmez, canlı durumdur — ve hiç çalıştırılmamış.** Tek doğrulama yolu: Admin › WhatsApp › "Bağlantıyı test et". `ready` koşulu: gönderici var + webhook + durum webhook'u + `ONLINE`/`ONLINE:UPDATING`. `PENDING_VERIFICATION`/`VERIFYING` dönerse numara onaylı değildir. **Üretime çıkmadan bu uç `ready:true` dönmeli.** | `apps/api/src/services/admin/wa-setup-twilio.ts:152-155,368,378`; ekran `apps/web/app/admin/whatsapp/page.tsx` |
| 10 | **24 saatlik konuşma kotası / kalite derecesi / Meta işletme doğrulaması hiç izlenmiyor.** Kodda yalnız saniye başına kota var (`NUMBER_RATE_PER_SEC = 20`). Ortak numarada **tüm kiracılar tek WABA kotasını paylaşıyor**: yeni numaranın iş-kaynaklı konuşma tavanı (250/1K) platform genelinde tükenir ve o anda hiçbir işletmenin durum mesajı gitmez. Kiracı başına pay, tavan uyarısı, kalite düşüşü alarmı yok. | `apps/api/src/wa/throttle.ts:5`, `apps/api/src/services/messaging/budget.ts` |
| 11 | **Ortak numara +1 850 (ABD).** TR müşterisinin yabancı numaraya yazması: güven/spam algısı, müşterinin uluslararası mesaj algısı ve "bu kim" sorusu hiç değerlendirilmemiş; TR numarasına geçiş planı yok. | `packages/core/src/shared-wa.ts`, `docs/16-twilio-whatsapp.md` |
| 12 | **Yabancı telefon numaralı müşteri sipariş veremiyor.** `normalizePhone` yalnız +90 kabul ediyor; başka ülke numarası `null` → sipariş düşer. Ortak numaraya yazan yabancı/geçici numaralı müşteri çıkmaz sokakta kalır. | `packages/core/src/phone.ts:12-24` |

### E. Kuyruk/cron boşlukları (bilinen `order-new-watch` dışında)
| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 13 | **Takılı sipariş süpürücüsü yalnız `new` için tartışıldı; `confirmed`/`preparing`/`on_the_way` için hiçbir şey yok.** Akşam "hazırlanıyor"da kalan sipariş sabaha kadar açık kalır, gün sonu kapanışı/zorla kapatma yok, raporlar bu siparişlerle kirlenir. | `apps/api/src/jobs/order/index.ts`, `packages/core/src/order-fsm.ts` |
| 14 | **R2'deki yedek nesneleri hiç budanmıyor.** `wrangler.jsonc`'de yaşam döngüsü kuralı yok, `cron.retention` yalnız veritabanına dokunuyor; günlük döküm kopyaları sınırsız birikir (maliyet + KVKK saklama süresi ihlali: yedekteki kişisel veri süresiz kalır). | `deploy/cloudflare/wrangler.jsonc` (r2_buckets), `apps/api/src/jobs/system/index.ts:171-310` |

### F. Üretimin İKİNCİ hedefi (Türkiye VPS) — hiç incelenmedi
Denetim bu yolu "kullanılmayan" sayıp geçti; oysa canlı bir iş akışı.

| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 15 | **`VPS_HOST` secret'ını eklemek, bir sonraki push'ta alan adını DNS ile boş bir veritabanına taşır.** İş akışının kendi başlığı "Cloudflare'deki canlı veri kendiliğinden TAŞINMAZ" diyor; geçiş öncesi "hedef veritabanı dolu mu" kontrolü hiçbir adımda yok. 5651 logu ya da TR barındırma için bu secret'ı eklemek canlıyı sıfırlar. | `.github/workflows/deploy-production.yml:1-6, 69-90, DNS adımları` |
| 16 | **VPS yolu root parolalı SSH kullanıyor** (`VPS_PASSWORD`, sunucuda parola ile SSH açık) ve host anahtarı verilmezse **ilk görüleni kabul ediyor (TOFU)**. Anahtar tabanlı erişim yok. Güvenlik boyutu yalnız uygulama kimliğine baktı, dağıtım kimliğine hiç bakmadı. | `.github/workflows/deploy-production.yml:15-19`, `scripts/vps/deploy.sh` |
| 17 | **Split-brain riski:** webhook URL'i tek (`APP_BASE_URL`). DNS geçişi yarım kalırsa Twilio mesajları bir ortama, müşteri trafiği diğerine gider; iki ayrı veritabanında iki ayrı sipariş gerçeği oluşur. Bunu engelleyen kilit/bayrak yok. | `deploy/cloudflare/src/index.ts`, `scripts/vps/cloudflare-dns.mjs` |

### G. Veri kaybı yolları (bilinen `/tmp/yedek.dump` ve `createdb` dışında)
| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 18 | **`DATA_EPOCH` yanlış/artırılmış olursa canlı sessizce BOŞ açılır ve hemen boş yedek yazar.** R2'ye ulaşılabiliyor ama o önekte nesne yoksa `rc=2` → `fresh=1` → boş DB + seed + `backup_now force`. Duman testi yeşil döner, site "çalışır", tüm işletmeler ve siparişler yok olur. Satır sayısı kontrolü ya da onay kapısı yok. | `deploy/cloudflare/entrypoint.sh:171-186, 205-210` |
| 19 | **Görsellerin geri yüklenememesi tamamen sessiz:** `fetch_backup_retry uploads` başarısız olursa ne log ne hata; veritabanı dönmüş ama menü görselleri yok halde açılır. | `deploy/cloudflare/entrypoint.sh:188-193` |
| 20 | **`initdb --locale=C.UTF-8`:** veritabanı tarafındaki `order by` ve `ilike` Türkçe'yi bilmiyor. "Çorba/İskender/Şiş" yanlış sıralanır; `ilike` ile `İ/ı` eşleşmez. `turkishLower` yedeği yalnız müşteri aramasında var; lead, sipariş, sohbet ve menü aramasında yok. | `deploy/cloudflare/entrypoint.sh:160`, `apps/api/src/services/customers/index.ts:87` vs `routes/admin/leads.ts:57`, `routes/panel/orders.ts:281`, `routes/panel/conversations.ts:168` |

### H. İnsan/operasyon hazırlığı — docs/10'un pilot kapısı, hiç sorgulanmadı
| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 21 | **docs/10 §1 madde 3 pilot için ZORUNLU sayıyor:** kademeli alarm + sentetik canary + **en az iki ayrı sunucu/VM'de webhook alımı** + **PITR** + **kurucuların üstlendiği P1 telefon hattı**. "Bunlardan biri eksikse pilot başlamaz." Denetim canary ve PITR'ı yakaladı; **ikinci VM ve P1 nöbet hattı hiç konuşulmadı.** | `docs/10-riskler-operasyon-ve-metrikler.md:37` |
| 22 | **Olay yönetimi süreci hiç yok:** SEV1–SEV4 sınıfları, runbook'lar, postmortem, destek SLA'sı, bilgi bankası, sahte sipariş süreci, Meta eskalasyon yolu — docs/10 §5–§9'un tamamı yazılı ama ne kodda ne de bir işletim kontrol listesinde karşılığı var. | `docs/10` §5–§9 |
| 23 | **E-posta kanalı diye bir şey yok.** Depoda tek bir SMTP/Resend/SES/nodemailer bağımlılığı yok. Sonuçları: demo/lead başvurusu kimseye gitmiyor (yalnız admin ekranı açılırsa görülür), işletmeye hiçbir bildirim gidemiyor, KVKK başvuru adresi için posta kutusu yok, faturalama yolu yok, SPF/DKIM/DMARC kaydı da yok. | `apps/api/src/routes/public/index.ts:53-111`, `apps/api/src/services/admin/overview.ts:92` |

### I. Kalite / tedarik zinciri / kapasite
| # | Boşluk | Nereye bakılacak |
|---|--------|------------------|
| 24 | **Bağımlılık güvenliği hiç ele alınmadı:** `pnpm audit` adımı, Dependabot/Renovate, SBOM, lisans taraması, imaj CVE taraması yok. Üretim imajı `postgres:16-bookworm` üstüne kuruluyor ve yalnız dağıtımda yenileniyor. (İyi haber: container `USER postgres` ile çalışıyor, root değil.) | `.github/workflows/*`, `deploy/cloudflare/Dockerfile:71,96` |
| 25 | **Yük/kapasite testi ya da hesabı yok.** 1/4 vCPU + 1 GiB + `shared_buffers=48MB, max_connections=40`; API havuzu 10 + worker 5 + seed/migration. Eşzamanlı SSE bağlantısı için üst sınır yok (`routes/panel/stream.ts`). "Kaç işletme, kaç eşzamanlı panel, kaç sipariş/dk" sorusunun ölçülmüş cevabı hiçbir yerde yok. | `deploy/cloudflare/entrypoint.sh:167`, `packages/db/src/client.ts:28`, `apps/api/src/worker.ts:22`, `apps/api/src/routes/panel/stream.ts` |
| 26 | **Panel ve admin erişilebilirliği hiç denetlenmedi** (yalnız vitrin için axe eksikliği not edilmiş). Sipariş alan ekranın klavye/odak/kontrast/ekran okuyucu durumu bilinmiyor. | `apps/web/app/panel/**`, `apps/web/app/admin/**` |

### J. Daha küçük ama üretim öncesi bakılmalı
- **27 — İstemci IP'si taklit edilebilir (kenar durum):** `trustProxy: true` ve Worker yalnız `cf-connecting-ip` varsa `x-forwarded-for`'u eziyor. Container'a Worker dışından (ya da header gelmezse) ulaşılırsa hız sınırı, denetim kaydı IP'si ve **yasal kabul kaydındaki IP (6563 delili)** istemciye yazdırılabilir. → `apps/api/src/app.ts:71`, `apps/api/src/lib/rate-limit.ts:66`, `deploy/cloudflare/src/index.ts:285-286`
- **28 — Hız sınırı süreç belleğinde:** her yeniden başlatma/dağıtımda tüm kovalar sıfırlanır; kuyruğa alınmış bir kaba kuvvet denemesi dağıtım penceresinde bedavaya gelir. → `apps/api/src/lib/rate-limit.ts:24`
- **29 — Raporlar sabit `Europe/Istanbul` ile hesaplanıyor** (`sql.raw`), şube bazlı saat dilimi alanı varsa gün sınırı kayar; gün sonu ciro tartışması buradan çıkar. → `apps/api/src/services/reports/index.ts:184`
- **30 — Saat kayması (NTP) hiç düşünülmemiş:** 15 dk otomatik iptal, çalışma saatleri, 60 sn debounce, 24 sa pencere — hepsi container saatine bağlı. Container saati kayarsa siparişler yanlış zamanda iptal olur; saat sağlığını kontrol eden hiçbir şey yok. → `deploy/cloudflare/entrypoint.sh` (timezone=UTC), `packages/core/src/hours.ts`
- **31 — Vitrin `sitemap.xml`'de hiç yok:** sitemap yalnız pazarlama sayfalarını listeliyor, `/s/<slug>` hiç yok; işletmenin Google'da bulunması satış argümanı ama kiracı vitrinleri için sitemap/indeksleme akışı yazılmamış. Buna karşılık `/s/<slug>/yasal/<doc>` (hâlâ "taslak" ibareli metinler) taranmaya açık. → `apps/web/app/sitemap.ts`, `apps/web/app/robots.ts:14`
- **32 — Alerjen/besin bilgisi alanı yok:** sorumluluk sözleşmeyle işletmeye atılmış ama menüde alerjen girilecek bir alan hiç yok, yani işletme uymak istese de uyamıyor. → `packages/core/src/menu/*`, `yasal/kullanim-kosullari/page.tsx:72`

## 🎯 Üretime çıkmadan mutlaka yapılacak 5 şey (yukarıdakilerden)
1. **Admin › WhatsApp › "Bağlantıyı test et"** çalıştır, `ready:true` ve durum `ONLINE` olduğunu gör — `PENDING_VERIFICATION` ise numara onaylı değil (`wa-setup-twilio.ts:378`).
2. **`read_only` aşamasını `ORDERING_BLOCKED_STAGES`'e ekle + deneme bitişi cron'u yaz** — yoksa ücretli iş modeli diye bir şey yok.
3. **`DATA_EPOCH` ve `VPS_HOST`'a elle onay kapısı/satır sayısı kontrolü koy** — ikisi de tek secret ile canlıyı sıfırlıyor.
4. **Panelin açılacağı gerçek cihazı test et** (restoranın kendi tableti/telefonu): Tailwind 4 eşiği + iOS'ta PWA kurulumu olmadan push gelmediği.
5. **Çok şubeli işletme satmayı erteleyin** ya da vitrine şube seçimi ekleyin.

---

# EK B — Çürütülen bulgular (doğrulamayı geçemedi)

- **Akis B siparis kodu eslesmesi kilitsiz okumaya dayaniyor; yaris durumunda gecis hatasi tum gelen mesaj transaction'ini geri aliyor ve musterinin WhatsApp mesaji kalici olarak kayboluyor** (siparis-akisi)
  - neden: Yaris penceresi gercek (engine.ts:726-731 kilitsiz SELECT, karar engine.ts:735 `isAwaiting`), ama bulgunun BASLIGI ve tum siddet gerekcesi olan "mesaj kalici olarak kayboluyor / 8 kez ayni deterministik hatayla failed olur" iddiasi kodla yanlislaniyor:

1) apps/api/src/lib/jobs.ts:210-224 — `conflict('invalid_transition')` bir `PermanentJobError` DEGIL, dolayisiyla is kalici basarisiz olmuyor; `ba
- **Hicbir dogrulama kanali yokken storefront yine awaiting_customer siparis olusturuyor; docs/03 §3.2.1 bu durumda siparis alinmamasini sart kosuyor** (siparis-akisi)
  - neden: Kod alıntısı doğru (orders.ts:236-239 ve :268 birebir), ama "kimse haberdar olmaz / sessiz sipariş kaybı" etkisi kodla çürütülüyor — bu yol belgelenmiş ve uçtan uca yazılmış bir düşük-kademe akış:

1. docs/04-isletme-paneli.md:317 bu durumu BİREBİR şart koşuyor: "`awaiting_customer` siparişler 'Yeni' sütununun üstünde soluk, SESSİZ ince satırlar: '#1052 · Web · 285 TL · Müşteri onayı bekleniyor · 
- **Canlı platform yöneticisinin parolası her container açılışında DEV_PASSWORD secret'ına geri eşitleniyor; paneldeki parola değişikliği sessizce geri alınıyor** (guvenlik-auth)
  - neden: Bulgu DOĞRU; alıntılar çarpıtılmamış, zincirin her halkası kodda duruyor.

1) packages/db/src/seed.ts:963-972 (seedAdminOnly) birebir iddia edildiği gibi: var olan platform yöneticisinin özeti SEED_PASSWORD ile eşleşmiyorsa `tx.update(users).set({ passwordHash: await hashPasswordForSeed(password) })` çalışıyor. Fonksiyonun başlık yorumu (seed.ts:66-70) da bunu açıkça yazıyor: "var olan yöneticinin
- **132000 hatasında sağlam ContentSid kaydı siliniyor; 500 kaynak sınırına ulaşıldığında bu kalıcı şablon hatasına dönüşebilir** (whatsapp-saglayici)
  - neden: Alıntılar DOĞRU ama iddia edilen etki iki yerde kırılıyor; bulgu gerçek bir üretim riski değil.

DOĞRULANAN KISIM (çarpıtma yok):
- apps/api/src/wa/providers/twilio.ts:101 → `const STALE_CONTENT_CODES = new Set(['21655', '20404', '132000']);`
- apps/api/src/wa/twilio-api.ts:52-56 → `case '63005': case '63021': case '63036': return '132000';`
- providers/twilio.ts:90 postMessage, GraphApiError'ı EŞ
- **Vitrin ölçüm olayları (POST /api/v1/store/events, olay sözlüğü, analytics_events) hiç yazılmamış: canlıda sipariş hunisi tamamen kör** (storefront-musteri)
  - neden: Bulgunun OLGULARI doğru, ama GEREKÇESİ ve ETKİSİ çürütüldü; MEDIUM üretim bulgusu değil, karara bağlanmış teknik borç.

DOĞRULANAN OLGULAR (çarpıtma yok): apps/api/src/routes/public/index.ts:30-77'de gerçekten yalnız /signup-status, /menu-link/:token, /leads var; apps/api/src/routes/store/storefront.ts + orders.ts uçlarında da /events yok. grep "store/events|sendBeacon|analytics_events|sf_add_to_c
- **Oturumu dolan kurye ekranında "Parolayla giriş" düğmesi var; parolasız oluşturulan kurye için çıkmaz sokak ve 04 §9.1'in "Şifre yok" kuralına aykırı** (kurye)
  - neden: Alıntılar doğru ama "çıkmaz sokak" nitelemesi çarpıtma; kurye için parolayla giriş kasıtlı ve uçtan uca çalışan bir yol.

1) Sunucu tarafı kurye parola girişini özel olarak destekliyor — apps/api/src/routes/auth.ts:244 `const courierOnly = !user.isPlatformAdmin && ms.length > 0 && ms.every((m) => m.role === 'courier');`, satır 247 `if (isTotpEnabled(user) && !courierOnly)` (yalnız kurye hesapların
- **createdb geri yüklemeden ÖNCE çalışıyor ve hata yolunda geri alınmıyor: başarısız bir ilk açılıştan sonra boş veritabanı "geri yüklenmiş" sayılıp 2 dakika içinde R2'deki gerçek veriyi eziyor** (altyapi-deploy)
  - neden: Alinti dogru (entrypoint.sh:171-195 birebir oyle; pg_restore'da --exit-on-error yok, createdb hata yolunda geri alinmiyor, DB_READY=1 satir 195'te if blogunun DISINDA). Ama bulgunun tetikleyicisi "PGDATA'yi koruyan bir yeniden baslatma" ve bu yol bu dagitimda ULASILAMAZ:

1) Betik YALNIZ Cloudflare Containers'da kosuyor: `grep -rn entrypoint.sh` → tek tuketici deploy/cloudflare/Dockerfile:94,98 (t
- **DATA_EPOCH tek karakterlik bir veri silme anahtarı ama hiçbir dağıtım kapısı yok; duman testi boş veritabanında da yeşil veriyor** (altyapi-deploy)
  - neden: Bulgu DOĞRULANDI; alıntılar birebir, tek kusur kısaltılmış yol (gerçeği deploy/cloudflare/scripts/config-modes.mjs).

Doğruladığım kod:
1) deploy/cloudflare/wrangler.jsonc:62-67 — alıntı kelime kelime aynı: yorumda "CANLI VERİ bu dönemdedir: artırmak gerçek veriyi (işletmeler, siparişler) boş veritabanıyla değiştirir", hemen altında `"DATA_EPOCH": "3"`. Uyarı yalnız yorumda.
2) deploy/cloudflare/s
- **Uyanık tutma cron'u yalnız /api/v1/health'i çağırıyor; kuyruk takılmasını yakalayan tek uç (/health/worker) üretimde hiç otomatik kontrol edilmiyor** (operasyon-izleme)
  - neden: Alıntılar doğru, ama asıl iddia ("kuyruk dağıtımdan 10 dk sonra takılırsa HİÇBİR ŞEY fark etmez") bulgunun hiç okumadığı bir gözetçi tarafından çürütülüyor.

DOĞRULANAN KISIMLAR (çarpıtma yok):
- deploy/cloudflare/src/index.ts:311 gerçekten yalnız /api/v1/health çağırıyor, alıntı kelimesi kelimesine doğru.
- apps/api/src/routes/health.ts:33-47 yalnız `select 1` yapıyor; worker ölse de 200 döner.
-
- **Alarm zincirinin 5. dakika SMS halkası canlı ortamda ÇALIŞAMIYOR: SMS_PROVIDER kodda 'mock' olarak sabitlenmiş, yapılandırmayla açılamıyor** (operasyon-izleme)
  - neden: Bulgu DOĞRU, alıntı çarpıtılmamış. Kodu okuyarak doğruladığım zincir:

1) `deploy/cloudflare/src/mode.ts:84` `...waEnv`, `:87` `SMS_PROVIDER: 'mock'` — alıntı harfi harfine doğru, satır numarası tam. `containerEnv` düz bir nesne sabiti döndürüyor ve `env`'i HİÇ yaymıyor (yalnız adı geçen alanları seçiyor); `ContainerInputs` (mode.ts:34-49) içinde ne `SMS_PROVIDER` ne `NETGSM_*` var. Yani hiçbir Wo


---

# EK C — İşleyiş haritası (ham)

## musteri
MÜŞTERİ YOLCULUĞU — WhatsApp'tan teslimata kadar gerçek kod yolu (dosyalar okunarak çıkarıldı)

=== 0) ORTAK OMURGA (her iki akışta aynı) ===
1. Webhook girişi — apps/api/src/routes/webhooks/wa.ts
   - Ortak numara: POST /api/v1/webhooks/wa/shared/:token → sharedTokenOk (PLATFORM_WA_WEBHOOK_TOKEN, safeEqual) → Twilio ise twilioPayload() → verifyTwilioSignature (wa/twilio-signature.ts; imzadaki URL APP_BASE_URL'den kurulur, Host başlığından DEĞİL) → ingestSharedWebhookPayload.
   - İşletmenin kendi numarası: POST /api/v1/webhooks/wa/:webhookToken → waAccounts.webhookToken ile hesap (status='disconnected' ya da provider='shared' → 404) → verifyMetaSignature → ingestWebhookPayload.
2. Alım — services/messaging/ingest.ts: tek transaction'da wa_webhook_events satırı + jobs satırı (queue 'wa-inbound', type 'wa.process_inbound', dedupeKey wa_in:<eventId>, maxAttempts 8) + wa_accounts.lastWebhookAt; sonra hemen 200 döner.
3. Worker — apps/api/src/worker.ts → lib/jobs.ts processDueJobs (FOR UPDATE SKIP LOCKED, backoffMs 5sn→10dk, recoverStaleJobs 5dk) → jobs/wa/index.ts 'wa.process_inbound' → ingest.ts processWebhookEvent → provider.parseWebhook (Twilio'da wa/twilio-parse.ts parseTwilioWebhook) → ortak numara ise shared-router.ts processSharedEvents, kendi numarası ise engine.ts processWaEvents.
4. Giden mesaj outbox'ı — services/messaging/outbound.ts queueOutbound: messages satırı (status 'queued') + brandSpec (ortak numarada dükkan adı başlık olur) + reserveSendSlot (conversation_bot_state.next_send_at, alıcı başına ~6 sn PAIR_INTERVAL_MS) + jobs ('wa.send', queue 'wa-outbound') + branch_events 'conversation.message'.
5. Gönderim — services/messaging/send.ts performWaSend: acquireNumberSlot (ortak numarada tek kova 'platform:shared') → providerForAccount (shared → PLATFORM_WA_PROVIDER) → wa/providers/twilio.ts sendText/sendInteractive/sendTemplate → messages.status='sent', wamid = Twilio sid → rememberSharedTenant.
6. Durum geri bildirimi aynı webhook'tan gelir → shared-router.ts applySharedStatus (dükkan mesajı mı platform mesajı mı ayırır) / engine.ts applyStatus → messages.status monoton (queued<sent<delivered<read; failed yalnız teslimden önce) + BSUID yakalama.

=== AKIŞ A (menü linki / vitrin — sipariş doğrudan 'new') ===
A1. Müşteri QR'dan ortak numaraya yazar. QR metni core/shared-wa.ts sharedPrefillText: "Merhaba, <Dükkan> için sipariş vermek istiyorum. #KOD".
A2. shared-router.ts routeSharedMessage: kişi kilidi (lockKey → pg_advisory_xact_lock), tekrar teslim kontrolü (messages.wamid + shared_wa_messages.wamid), upsertSharedRoute (shared_wa_routes), decide():
    - kural -) request_welcome → silent; 0) DUR/BAŞLAT → alıntılanan/son yazan/güncel dükkan; 1) buton-liste (shop:/shops:page:/shops:m:/review:/wait:/cancel:); 2) sipariş kodu; 3) #KOD → extractHashCodes + tenantByWaCode + tenantSelectableReason → selected=true; 4) "dükkanlar/liste/değiştir"; 5) alıntı; 6) 24 sa içindeki güncel dükkan (SHARED_ROUTE_ACTIVE_MS); 7) ad eşleşmesi (shared-match.ts matchShopsByName); 8) seçici (P01 recentShopsSpec / P02 shopListSpec, 60 sn SHARED_PICKER_COOLDOWN_MS).
    - Platform düzeyi yanıtlar hiçbir dükkanın sohbetine girmez: shared_wa_messages + jobs 'wa.send_shared' → performSharedSend.
A3. engine.ts handleInboundMessage (dükkanın provider='shared' wa_accounts satırıyla): advisory lock (wa:<accountId>:<sender>) → loadTenant/loadBranch → upsertWaCustomer (customers) → upsertConversation (conversations) → messages insert (direction 'in', wamid UNIQUE → 'duplicate') → conversations.lastInboundAt/lastMessagePreview/unreadCount → ensureBotState (conversation_bot_state) → respond() → en sonda branch_events 'conversation.message'.
A4. respond() kanonik sıra (00 §7): opt-out/in → kara liste/askı (M33) → sipariş kodu → butonlar → "yetkili" (M20) → 5b shopSelected (seçildi) → insan modu/opt-out/bot kapalı sessizlik → açık sipariş durum kartı (M26, 15 dk) → şube kapalı (M03, 6 sa)/duraklatıldı (M04, 12 sa) → ses (M29)/desteklenmeyen (M30) → SSS (M28a-d) → karşılama (M01/M02 12 sa, M01K 30 dk).
A5. shopSelected → welcome(force) → m01Welcome (ilk temasta aydınlatma linki /s/<slug>/yasal/aydinlatma) ya da m02Returning + createMenuLink (messaging/context.ts): storefront_link_tokens satırı (sha256(token), conversationId, customerId, MENU_LINK_TTL_MS = 2 sa) → APP_BASE_URL/m/<token>.
A6. Link tıklanır: apps/web/app/m/[token]/page.tsx → lib/menu-link.ts resolveMenuLink → GET /api/v1/public/menu-link/:token (routes/public/index.ts, findMenuLinkSlug, token TÜKETİLMEZ) → redirect /s/<slug>?l=<token>.
A7. Vitrin: components/storefront/use-store-session.ts → POST /store/:slug/session (routes/store/storefront.ts) → findValidLinkToken + markLinkTokenExchanged → sf_link_<slug> HttpOnly çerezi (storefront/cookies.ts setLinkCookie) → customer + lastOrder + prefill; ?l adres çubuğundan silinir. Menü: GET /store/:slug (storefront/load.ts loadStorefront, cache 15 sn).
A8. Sepet istemcide (web/lib/cart.ts); fiyat yalnız sunucuda: POST /store/:slug/quote → services/orders/pricing-context.ts quoteForBranch → packages/core/src/pricing.ts.
A9. Checkout: POST /store/:slug/orders (routes/store/orders.ts) → findByIdempotencyKey (aynı anahtar → aynı yanıt) → readLinkToken + linkTokenUsable (token başına saatte 3 sipariş) → normalizePhone (gel-al'da telefon boşsa link müşterisinin numarası) → tenantOrderingBlocked + computeBranchOrderingState (kapalıysa 409 ordering_closed) → quoteForBranch → validatePayment → transaction: attachCustomerFromLink → rememberAddress (customer_addresses, en çok 5) → insertOrderWithItems (services/orders/create-order.ts): status 'new', channel 'wa_link', verificationMethod 'wa_link', verifiedAt=now, conversationId, linkTokenId, statusNotifyChannel 'whatsapp', kalem+seçenek snapshot'ları, numara = nextOrderNumber(tenants.order_seq) → legal_acceptances (on_bilgilendirme + mesafeli_satis, LEGAL_DOCUMENT_VERSION, IP/UA).
A10. recordOrderCreated (services/orders/transition.ts): order_events 'created' + branch_events 'order.created' + kancalar:
    - jobs/order/index.ts 'orders.lifecycle' → scheduleAlarmChain: push/send.ts enqueueNewOrderPush ('push.send') + planAlarmSteps (orders/alarm-policy.ts) ile 'order.alarm_step' işleri (t=60sn tekrar, 2dk platform.alert, 5dk sms.send sahibe, 10dk müşteriye M13, 15dk otomatik iptal) + bumpCustomer.
    - messaging/order-notify.ts 'messaging.notify' → 'order.received_debounced' işi, delayMs = RECEIVED_DEBOUNCE_MS (60 sn), dedupeKey received_debounced:<orderId>.
A11. Panel: GET /api/v1/panel/stream (routes/panel/stream.ts + lib/sse.ts, branch_events + LISTEN/NOTIFY + Last-Event-ID) ve 45 sn emniyet sorgusu GET /panel/orders/active; web/components/live/live-screen.tsx çalar, isteğe bağlı fiş yazdırır (tarayıcı tarafı).
A12. İşletme onaylar: POST /panel/orders/:id/accept → transitionOrder: satır kilidi, expectedVersion, FSM validateTransition (packages/core/src/order-fsm.ts), STATUS_TIMESTAMP_FIELD.acceptedAt, estimatedReadyAt=roundUpTo5Minutes, order_events 'status_changed', branch_events 'order.updated' → kancalar: cancelAlarmChain; messaging.notify → cancelJobs(received_debounced) → combined=true → 'order.notify_customer' {to:'accepted', combined:true}, dedupeKey notify:<orderId>:accepted.
A13. 'order.notify_customer' → order-notify.ts handleNotifyCustomer → notifyStatus: canary/notify_off kontrolü, isSuperseded, "zaten gitti" kontrolü (messages.payload->>'orderEvent'), resolveTarget, statusEnabled(branches.statusMessages), optedOutForOrder, windowOpen(conv.lastInboundAt, 24 sa) → serbest mesaj (m06AcceptedCombined = M06c) ya da şablon (CUSTOMER_TEMPLATES + templateParams + takip token'lı URL butonu) → reserveStatusBudget (messaging/budget.ts: orders.wa_status_msg_count < 4) → queueOutbound → 'wa.send'.
A14. Sonraki adımlar aynı kanca zinciriyle: preparing M07 (yalnız M06c gittiyse), ready M08 (gel-al), on_the_way M09 (kurye POST /api/v1/courier/orders/:id/on-the-way), delivered M10 + değerlendirme butonları review:<orderId>:good|ok|bad. Her mesajda takip linki: lib/tracking.ts createTrackingToken (base64url(orderId)+HMAC(TRACKING_SECRET)[0..16]), saklanmaz.
A15. Değerlendirme: engine.ts routeButton RE_REVIEW → handleReview → reviews (orderId UNIQUE) → M10a/M10d, kötü ise m10bReviewBad liste mesajı (M10B_REASONS) → handleReviewReason → reviews.comment + m10cReviewThanks.

=== AKIŞ B (#KOD ile ortak numara — sipariş 'awaiting_customer') ===
B1. Müşteri vitrine linksiz girer (sf_link çerezi yok) → POST /store/:slug/orders: token null → loadVerificationChannels (services/orders/verification.ts: wa_accounts status 'connected' + displayPhone; smsAvailable = tenants.sms_fallback_enabled + platform bayrağı sms_fallback) → order status 'awaiting_customer', channel 'web', verificationMethod null, statusNotifyChannel 'whatsapp' | 'sms' | 'none' → createVerificationCode: order_verification_codes (kod alfabesi A-HJ-NP-Z2-9, generateOrderCode en az 1 rakam garantili, TTL VERIFICATION_CODE_TTL_MS = 30 dk; bekleyen kodlar migration 0900 ile TÜM işletmelerde tekil) → yanıt verification {method:'wa_code', code, waLink = buildWaLink → wa.me/<numara>?text=Sipariş kodu: XXXXXX}.
B2. onOrderCreated 'orders.lifecycle' → 'order.awaiting_timeout' işi, delayMs = AWAITING_CUSTOMER_TIMEOUT_MS (30 dk), dedupeKey awaitingTimeoutKey. messaging.notify bu durumda mesaj üretmez.
B3. Ekran: components/storefront/checkout/verification-screen.tsx — kod + "WhatsApp ile onayla" + 3 sn'de bir GET /store/track/:token yoklaması + 30 dk sayaç + "Vazgeçtim" (POST /store/track/:token/cancel).
B4. Müşteri hazır mesajı gönderir → webhook → wa.process_inbound → shared-router decide() kural 2 'order_code': accountOfOrderCode (order_verification_codes JOIN tenants wa_mode='shared', 7 günlük geriye bakış, önce bekleyen kod) → handleInboundMessage(selected=false) → respond() adım 3 matchOrderCode (messaging/text.ts: "Sipariş kodu: XXXXXX" ya da yalın 6 karakter) → linkOrderByCode:
    - kod bulunur, usedAt işaretlenir, transitionOrder → 'new' (actor customer, extra: verificationMethod 'wa_code', customerId, conversationId, statusNotifyChannel 'whatsapp') → order_events + branch_events 'order.updated' → kancalar: cancelJobs(awaiting_timeout), scheduleAlarmChain (alarm zinciri + push), bumpCustomer; messaging.notify to==='new' için erken döner (çift mesaj olmaz).
    - conversations.activeOrderId + state 'order_active', customers.name doldurulur.
    - M05 ANINDA gider (debounce yok): reserveStatusBudget → m05Received (kalemler, toplam, ödeme, takip CTA).
    - Hata dalları: kod yok → codeFailure (conversation_bot_state.codeFailCount, 10 dk içinde 5'ten fazla → sessiz + notifications 'order_code_attempts') + m17bCodeNotFound; süresi geçmiş/iptal → m17cCodeExpired; sipariş zaten onaylı → m17dCodeAlreadyUsed.
B5. WhatsApp yoksa SMS OTP: POST /store/orders/:orderId/sms-otp → otp_verifications (codeHash = hmacSha256Hex(SESSION_SECRET, 'otp:<orderId>:<kod>'), TTL 5 dk, 60 sn yeniden gönderim, telefon başına gün 5, IP başına saat 10) + jobs 'sms.send' (sms01Otp) → sms/index.ts → providers/netgsm.ts | mock. POST /store/orders/:orderId/sms-verify → safeEqual, 5 deneme (code_locked), doğruysa transitionOrder → 'new' (verificationMethod 'sms_otp', statusNotifyChannel 'sms'). Bu modda yalnız kritik durumlar (accepted/rejected/cancelled → SMS_CRITICAL) SMS ile gider (sms02Accepted/sms03aRejected/sms03bCancelled).
B6. Hiçbir kanal yoksa: verification {required:true, smsAvailable:false} → ekran "işletmeyi arayın" der; personel POST /panel/orders/:id/verify ile ("Telefonla doğruladım", verificationMethod 'staff') ilerletebilir; aksi halde runAwaitingTimeout 30 dk sonra cancelled/customer_timeout yapar ve kanca from==='awaiting_customer' olduğu için müşteriye mesaj GİTMEZ.
B7. Akış B'den sonra teslim yolu Akış A ile aynıdır (A12-A15). Tek fark: onayda M06a/M06b gider (M06c değil), bu yüzden M07 "hazırlanıyor" notifyStatus'ta 'preparing_skipped' ile atlanır (tasarım gereği, 03 §9.6 kural 4).

=== TAKİP SAYFASI ===
- apps/web/app/t/[token]/page.tsx → components/orders/tracking-page.tsx → GET /store/track/:token → routes/store/orders.ts loadTracked (parseTrackingToken; geçersiz 404, süresi dolmuş 410 + yalnız işletme bilgisi) → services/orders/tracking-view.ts buildTrackView: buildTimeline (Alındı→Onaylandı→(Hazırlanıyor)→Yolda/Hazır→Teslim), trackingStatusLabel, maskelenmiş telefon/adres, approvalDelay (noticeAt/autoCancelAt), verification, canCancel/canRequestCancel, review.
- Yoklama 15 sn, awaiting_customer'da 3 sn; cache-control no-store + x-robots-tag noindex. Link ömrü: final durum + TRACKING_TTL_AFTER_FINAL_MS (7 gün) → isTrackingExpired → 410.

=== İPTAL / RET YOLLARI ===
- Müşteri (takip sayfası): POST /store/track/:token/cancel → satır kilidi altında karar: awaiting_customer|new → transitionOrder 'cancelled' (cancelledBy 'customer', reason 'customer_request') → M12; accepted|preparing|ready|on_the_way → cancellation_requests + orders.cancelRequestedAt + order_events 'cancel_requested' + branch_events → işletme POST /panel/orders/:id/cancellation-request/:reqId/decide.
- Müşteri (WhatsApp): detectIntent 'cancel' → engine cancelIntent (15 dk soğuma) → new ise m27aCancelConfirm butonları (cancel:<id> / keep:<id>) → handleCancel → cancelled; accepted+ ise requestCancellation → m27bCancelRequested + insan modu 30 dk.
- İşletme reddi: POST /panel/orders/:id/reject → orders.rejectionScheduledAt + order_events 'rejection_scheduled' + jobs 'order.finalize_rejection' (REJECTION_UNDO_WINDOW_MS = 30 sn) → runFinalizeRejection → transitionOrder 'rejected' → M11 (+ sms03aRejected); POST /orders/:id/undo-reject → cancelJobs ile geri alınır. Bekleyen ret varken alarm adımı ertelenir ve M05 gönderilmez ('rejection_pending').
- Sistem: alarm adım 4 → 'order.notify_customer' {event:'approval_delay'} → m13ApprovalDelay (bütçe dışı, butonlar wait:/cancel:); adım 5 → transitionOrder 'cancelled' reason 'tenant_no_response' → M12.
- Opt-out: "DUR" → optOutMarketing/optOutAll (conversation_bot_state.marketingOptOutAt/optedOutAt, conversations.optedOut) → M31/M31a; opt-out'tan ÖNCE verilen siparişin durumları yine gider (optedOutForOrder).

## isletme
## 0) Bu rapor nasıl çıktı
Salt-okunur çalıştım: dosyaları açtım, `pnpm typecheck` (temiz) ve `vitest --project core` (166/166 geçti) koştum, canlı ortamı curl ile yokladım, GitHub Actions secret/log'larını okudum. Yerel PostgreSQL olmadığı için 55 API test dosyası ve 9 Playwright senaryosu BURADA koşturulamadı (son dağıtım iş akışında yeşil).

Canlı durum (04.10.2026, doğruladım):
- `https://yemekgelsin.net/api/v1/health` → `{ok:true, db:"up", version:"cfdec9fe…"}` = HEAD commit ile aynı, uptime ~8 saat.
- `/api/v1/health/worker` → `{ok:true, jobLagSec:0, stuckJobs:0}`.
- `x-yg-ortam: cloudflare`, `/dev/whatsapp` ve `/api/v1/dev/wa/accounts` → 404 (geliştirici araçları kapalı, doğru).
- GitHub secret'ları: `CLOUDFLARE_API_TOKEN`, `DEV_PASSWORD`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WA_PHONE`. Son dağıtım özeti: **"WhatsApp: gerçek numara, Twilio (simülatör kapalı)"**.

---

## 1) İşletme kayıt oluyor
`apps/web/app/panel/kayit/page.tsx` → `POST /api/v1/auth/signup` (`apps/api/src/routes/auth.ts:113`).
- `isFlagEnabled(db,'signup_open')` kapalıysa 403 `signup_closed`. Canlıda `GET /api/v1/public/signup-status` → `{open:true}` (teyit ettim).
- IP başına `RATE_LIMITS.signup`; e-posta/telefon tekilliği (`email_taken` / `phone_taken`); `normalizeTrMobile`, `hashPassword` (scrypt).
- Tek transaction'da: `tenants` (`lifecycleStage:'trial'`, `planCode:'pro'`, `trialEndsAt = now + TRIAL_DAYS(14)`, `waCode = generateWaCode(slug)`, `waMode:'shared'`) → `branches` ("Merkez", `city` varsayılan Yozgat) → 7 günlük varsayılan `openingHours` (10:00–22:00) → `ensureSharedWaAccount(tx, config, tenantId)` → `users` + `memberships(role:'owner')` → `subscriptions(status:'trialing')` → `legalAcceptances` (`abonelik` + `kvkk_aydinlatma`, `LEGAL_DOCUMENT_VERSION`, IP + UA) → `audit('tenant.signup')`.
- Yani işletme **kayıttan itibaren ortak numaraya bağlıdır**; dükkan kodu da o anda üretilir.

## 2) Kurulum sihirbazı (7 adım)
`apps/web/app/panel/kurulum/page.tsx` + `apps/web/components/onboarding/wizard.tsx` → `GET /api/v1/panel/onboarding` → `onboardingStatus()` (`apps/api/src/services/onboarding/index.ts`).

| Adım (`OnboardingStepCode`) | Nerede doldurulur (`STEP_HREF`) | "Bitti" ölçütü |
|---|---|---|
| `business_info` | `/panel/ayarlar/isletme` | `imprintMissing(tenant, branch.addressLine)` boş + şube adresi var |
| `menu` | `/panel/menu` | `activeProductQuery` ≥ 1 (aktif ürün + aktif kategori + `waRestricted=false`) |
| `hours` | `/panel/ayarlar/saatler` | `openingHours` ≥ 1 aralık |
| `zones` | `/panel/ayarlar/bolgeler` | paket servis açıksa ≥1 `deliveryZones` (ya da gel-al), ≥1 `paymentMethods` |
| `whatsapp` | `/panel/ayarlar/whatsapp` | `waAccounts.status='connected'` **veya** `tenantOnboarding.whatsapplessAt` (`POST /onboarding/whatsappless`) |
| `test_order` | `/panel/kurulum` | `orders.testKind='onboarding_test'` kaydı var |
| `go_live` | `/panel/kurulum` | `tenants.webLiveAt` ya da `liveAt` dolu |

İlk dördü `requiredForWeb: true`. `stepCode()` admin hunisi için `tenant_onboarding.step` yazar: `account_created → profile_done → menu_done → ops_done → wa_connected → wa_test_done → web_live → live`.

## 3) WhatsApp bağlama
`apps/web/app/panel/ayarlar/whatsapp/page.tsx` → `apps/api/src/routes/panel/whatsapp.ts` (yalnız **owner**).
- Varsayılan **ortak numara**: `waMode='shared'`, `waAccounts.provider='shared'`, dükkan kodu `tenants.waCode`. Panelde PUT / `disconnect` / `rotate-webhook-token` ortak modda **409 `wa_shared_mode`** döner; kendi numaraya geçiş yalnız admin'in `PATCH waMode`'u ile.
- QR: `GET /panel/whatsapp/qr?format=svg|png` (`qrcode`), bağlantı `sharedWaLink(phone, tenantName, waCode)` → `wa.me/...?text=#KOD` ön dolu metin (`apps/web/components/settings/qr-tools.tsx`).
- Gelen olaylar: `POST /api/v1/webhooks/wa/shared/:token` (`apps/api/src/routes/webhooks/wa.ts`). Twilio yolunda gövde `application/x-www-form-urlencoded`, imza `X-Twilio-Signature` ve **URL `APP_BASE_URL`'den kurulur** (`twilioWebhookUrl`) — sahte Host başlığı imzayı yanıltamaz. Ham olay `wa_webhook_events`'e yazılır, hemen 200, işleme kuyruğa (`wa.process_inbound`).
- Yönlendirme: `ingestSharedWebhookPayload` → `apps/api/src/services/messaging/shared-router.ts` (0–8 numaralı karar sırası: DUR/BAŞLAT → buton/liste → Akış B kodu → `#KOD` → "dükkanlar/değiştir" → alıntı → son 24 saatteki dükkan → ad eşleşmesi → seçici). Dükkan belirlendikten sonra o dükkanın kendi `handleInboundMessage` (`messaging/engine.ts`, 1127 satır) motoru çalışır → tenant yalıtımı korunur.

## 4) Test siparişi
`POST /api/v1/panel/onboarding/test-order` → `createTestOrder()`:
- Açık bir test siparişi varsa onu döner (`created:false`); yoksa ilk aktif ürün ×1 ile `status:'new'`, `channel:'web'`, `fulfillmentType:'pickup'`, `testKind:'onboarding_test'`, `verificationMethod:'staff'`, `paymentMethod:'pay_at_counter'`, not "Kurulum test siparişi".
- `recordOrderCreated()` → `order_events('created')` + `branch_events('order.created')` + `onOrderCreated` kancaları.
- Alarm zinciri **kısaltılmış**: `planAlarmSteps(policy,'onboarding_test')` → yalnız REPEAT (60 sn) + PLATFORM_WA (2 dk). SMS, müşteri bilgisi ve otomatik iptal yok.

## 5) Canlıya geçiş — iki kapı
`POST /api/v1/panel/onboarding/go-live` (yalnız **owner**) → `goLive()`:
- **Kapı 1** `canGoLiveWeb` (4 zorunlu adım) → `tenants.web_live_at`. Eksikse 409 `onboarding_incomplete` + `missingForWeb`.
- **Kapı 2** `canGoLiveFull` (= Kapı 1 + WhatsApp `connected` + test siparişi) → `tenants.live_at`.
- `lifecycleStage` `lead|onboarding` ise aboneliğe göre `trial` ya da `active` olur.
- Vitrin kapısı: `tenantOrderingBlocked()` (`services/orders/store-context.ts:60`) → `!orderingEnabled || lifecycleStage ∈ {suspended,churned} || !webLiveAt` ise sipariş alınmaz.

## 6) Sipariş geliyor (Akış A / Akış B)
- **Akış A (WhatsApp'tan):** müşteri QR/`wa.me` → bot karşılama + "Menüyü aç" → kısa bağlantı `/m/<token>` (`GET /api/v1/public/menu-link/:token` → `findMenuLinkSlug`) → `/s/<slug>` vitrin → `POST /api/v1/store/:slug/quote` (fiyat **yalnız sunucuda**: `quoteForBranch`, `services/orders/pricing-context.ts`) → `POST /api/v1/store/:slug/orders` (`idempotencyKey`; `findByIdempotencyKey` aynı anahtara aynı yanıt). Çerezle tanınan müşteri doğrudan `new`.
- **Akış B (webden, kimlik yok):** sipariş `awaiting_customer` doğar; `createVerificationCode()` 6 karakterlik kod yazar (`order_verification_codes`, TTL 30 dk, **bekleyen kodlar tüm işletmelerde tekil** → ortak numara yönlendiricisi kodu işletmeyi bilmeden bulur). Müşteri kodu WhatsApp'a yazınca `new`. Alternatif: `POST /store/orders/:id/sms-otp` + `/sms-verify` (yalnız `channels.smsAvailable` ise).
- Doğrulanmazsa: `order.awaiting_timeout` işi `AWAITING_CUSTOMER_TIMEOUT_MS` (30 dk) sonra `runAwaitingTimeout()` → `cancelled` / `customer_timeout`.
- Takip: `GET /api/v1/store/track/:token` (`lib/tracking.ts` HMAC token, final + 7 gün `TRACKING_TTL_AFTER_FINAL_MS`), `/track/:token/cancel` (new/awaiting → doğrudan iptal; accepted+ → `cancellation_requests` talebi, satır kilidi altında karar), `/track/:token/review` (yalnız `delivered`, tek sefer).

## 7) Panel açıkken yeni sipariş nasıl duyuluyor
**a) Olay günlüğü → NOTIFY**: `appendBranchEvent()` (`apps/api/src/lib/events.ts`) `branch_events`'e yazar, şube başına `pg_advisory_xact_lock` alır → aynı şubenin olayları commit sırasıyla artan `seq` alır (Last-Event-ID tekrarında atlama olmaz). `NOTIFY 'branch_events'` COMMIT'te tetikleyiciyle gider (`packages/db/migrations/0001_branch_events_notify.sql`).

**b) SSE**: `GET /api/v1/panel/stream?branchId=` (`apps/api/src/routes/panel/stream.ts`) → `openBranchStream()` (`apps/api/src/lib/sse.ts`). Tek `BranchEventHub` LISTEN bağlantısı tüm akışlara dağıtır; `parseLastEventId` + `listBranchEventsAfter` kaçırılanı oynatır; 15 sn ping (`SSE_PING_INTERVAL_MS`); **mutfak rolünde `stripPrices()`** ile `…Kurus` alanları silinir. Akış açılışında ayrıca tek `branch.state` çerçevesi (`computeBranchOrderingState`) gider.

**c) Panel varlığı**: akış açıkken `touchBranchPresence()` dakikada bir yazar (`PANEL_PRESENCE_TOUCH_MS`, 20 sn throttle). Yalnız `PRESENCE_ROLES = owner|manager|cashier` sayılır; mutfak ve destek oturumu (impersonation) sayılmaz. Soket kontrolü (`gone()`) kapanmış ekranın varlık yazmaya devam etmesini engeller.

**d) Tarayıcı tarafı**: `apps/web/lib/sse.ts` (EventSource, geri çekilmeli yeniden bağlanma + `?lastEventId=`, 45 sn bayatlama guard'ı, `useStreamStatus` üst bar göstergesi) → `apps/web/components/panel/stream-provider.tsx` → `apps/web/components/live/new-order-alarm.tsx` (panel **kabuğunda** tek yerde: menü/sohbet/ayar ekranlarında da çalar).

**e) Ses**: `apps/web/components/live/alarm-sound.ts` — ses dosyası yok, Web Audio `OscillatorNode` ile ton üretir (880/1320 Hz). Tarayıcı jest olmadan çalmaz → `ShiftStart` ("Vardiyayı başlat", `shift-start.tsx`) dokunuşunda `unlock()`. Çok sekmede yalnız lider sekme çalar: Web Locks `siparisinonunde-alarm-leader`. `ScreenWake` ekranı uyanık tutar.

**f) Hangi sipariş çalar**: `apps/web/components/live/alarm-state.ts` — `newOrdersOf` (canary hariç), `bandOrdersOf` (ret geri sayımındakiler ve `channel='manual'` telefon siparişleri hariç; **mutfak bant/alarm görmez**), `alarmingOrdersOf` ("Gördüm" ile susturulanlar hariç), `isHighLevel` (`alarmStep>=2` ya da 60 sn → `ALARM_ESCALATE_MS`), `withNewOrderCount` sekme başlığı sayacı, `alarmBadgeText` (yalnız GERÇEKTEN giden bildirimi söyler; yoksa "Uyarı gönderilemedi · Bekliyor").
`POST /panel/orders/:id/ack` → `order_acks` + `orders.first_acked_at` (cihaz gördü kaydı).

**g) Web Push (t=0)**: `scheduleAlarmChain()` içinde `enqueueNewOrderPush()` (`apps/api/src/services/push/send.ts`) `push.send` işini kuyruğa atar → `listPushRecipients` (şubeye erişen kullanıcıların kayıtlı cihazları) → `sendWebPush` (VAPID). Yük asgari: "Yeni sipariş #1051 / 3 ürün · 245,00 TL / /panel"; müşteri adı/telefonu/adresi yok, **mutfakta tutar da yok**. 404/410 → abonelik kapatılır; 5xx/429/ağ → abonelik başına ayrı iş, en çok `PUSH_MAX_ATTEMPTS=3`. Yeniden denemede sipariş `new` değilse gönderilmez. Abonelik kaydı: `apps/api/src/routes/panel/push.ts`, istemci `apps/web/components/push/push-client.ts`, izin vardiya başlatma / "Sesi aç" dokunuşunda istenir.

**h) Kademeli alarm zinciri** (`services/orders/alarm-policy.ts` + `apps/api/src/jobs/order/index.ts` `runAlarmStep`, `jobs` tablosu + `dedupeKey`):

| Adım | Varsayılan zaman | Ne olur |
|---|---|---|
| `REPEAT` | 60 sn | `branch_events('order.alarm')` → panelde ses **yükselir** |
| `PLATFORM_WA` | 2 dk | `platform.alert` `new_order_alarm` → sahibine `isletme_yeni_siparis_v1` şablonu |
| `SMS` | 5 dk | `sms.send` → `ownerAlertPhone()` (owner telefonu → şube → işletme telefonu) |
| `CUSTOMER_NOTICE` | `customerNoticeMinutes` (10, iptalden en az 5 dk önceye kıstırılır) | `order.notify_customer` `{event:'approval_delay'}` |
| `AUTO_CANCEL` | `autoCancelMinutes` (10–30 arası, varsayılan 15) | `transitionOrder → cancelled` / `tenant_no_response` |

`normalizeAlarmPolicy()` sınırları zorlar; politika `branches.alarm_policy`, ekran `/panel/ayarlar/alarm`. `channelDelivers(config,…)` ile canlıda taklit kanal varsa adım "…_unavailable" notuyla kaydedilir ve **gönderilmiş sayılmaz**. Bekleyen ret varken zincir durur, adım ret penceresinin (`REJECTION_UNDO_WINDOW_MS`) sonrasına ertelenir; geri alınırsa kaldığı yerden sürer. Sipariş `new` değilse adım no-op. `channel='manual'` (telefon siparişi) için zincir hiç kurulmaz.

**i) Panel çevrimdışı dedektörü**: `cron.panel_presence` (dakikada bir, `apps/api/src/jobs/cron/index.ts`) → `detectOfflinePanels()` (`services/push/presence.ts`): sipariş alan şubede ekran 5 dk görülmediyse (`PANEL_OFFLINE_AFTER_MS`) ya da açılalı ≥10 dk olup hiç görülmediyse (`PANEL_NEVER_SEEN_GRACE_MS`) → `platform.alert` `panel_offline` → `isletme_panel_cevrimdisi_v1`. Şube başına 60 dk'da 1 ve **yerel günde `PANEL_OFFLINE_ALERT_PER_DAY = 1`** (son iki commit bu; önceden günde 24 mesaj gidiyordu). Demo/aday/kurulum/askı/kapanış aşamaları atlanır.

**j) Emniyet yoklaması**: `SAFETY_POLL_INTERVAL_MS = 45_000` — SSE sessiz kalırsa `/panel/orders/active` yeniden çekilir.

## 8) Kabul / ret / hazır / yolda / teslim
Çekirdek: `packages/core/src/order-fsm.ts` — `ORDER_TRANSITIONS` tablosu (`awaiting_customer → new|cancelled`, `new → accepted|rejected|cancelled`, `accepted → preparing|ready|on_the_way|cancelled`, `preparing → ready|cancelled`, `ready → on_the_way|delivered|cancelled`, `on_the_way → delivered|cancelled`, final: `delivered|rejected|cancelled`), `validateTransition` (ret → `rejection_reason`; iptal → `cancelled_by` + `cancel_reason`; sebep `other` ise not zorunlu), `STATUS_TIMESTAMP_FIELD`, `nextActions` (gel-alda `on_the_way` süzülür, `usePreparingStep=false` ise `preparing` gizlenir, bekleyen ret varken `accepted/rejected` gizlenir). 89 birim testi geçiyor.

Uygulama: `transitionOrder()` (`apps/api/src/services/orders/transition.ts`) — `SELECT … FOR UPDATE`, `expectedVersion` uyuşmazlığında 409 `version_conflict`, zaman damgası, `order_events('status_changed')`, `branch_events('order.updated')`, `onOrderTransition` kancaları — **hepsi aynı transaction'da**; kanca hata atarsa geçiş geri alınır.

Uçlar (`apps/api/src/routes/panel/orders.ts`, roller: owner/manager/cashier tam, kitchen yalnız okuma + preparing/ready):
- `POST /orders/:id/accept {etaMinutes}` → `accepted`, `estimatedReadyAt = roundUpTo5Minutes(now+eta)`, `acceptedByUserId`. Bekleyen ret varsa **409 `rejection_pending`**.
- `POST /orders/:id/reject {reason,note,soldOutProductIds?,blockCustomer?}` → **hemen reddetmez**: `rejectionScheduledAt` + `order_events('rejection_scheduled')` + `order.finalize_rejection` işi (`REJECTION_UNDO_WINDOW_MS = 30 sn`). `item_unavailable` ise ürünlere `soldOutUntil`; `suspected_fake` + `blockCustomer` ise müşteri bloklanır. Yanıt `undoDeadline` taşır.
- `POST /orders/:id/undo-reject` → `cancelJobs(finalizeRejectionKey)` + alanlar temizlenir, sipariş `new` kalır. `rejected` olduysa 409 `rejection_finalized`.
- `runFinalizeRejection()` → `rejected`; geri alındıysa ya da `scheduledAt` 1 sn'den fazla kaydıysa no-op.
- `POST /orders/:id/advance {to}` → `preparing | ready | on_the_way | delivered`. Mutfak yalnız `preparing/ready` (yoksa 403). Gel-alda `on_the_way` → 409. `delivered` + `unpaid` → `paymentStatus='paid'`, `paidAt`.
- `POST /orders/:id/cancel` → yalnız onay sonrası; `new`/`awaiting_customer` için "reddedin" der (409). `customer_request` sebebi `cancelledBy='customer'` yazar.
- Diğer: `/orders/:id/delay`, `/verify`, `/assign-courier`, `/ack`, `GET /orders/:id/receipt` (fiş), `GET /orders/active`, `/orders`, `POST /orders/manual` (telefon siparişi, `/panel/telefon-siparisi`).
- Müşteri bildirimi: `apps/api/src/services/messaging/order-notify.ts` (590 satır) + mesaj bütçesi `services/messaging/budget.ts` → `STATUS_MESSAGE_BUDGET = 4`, `reserveStatusBudget` atomik `update … where wa_status_msg_count < 4`.

## 9) Kurye nasıl devreye giriyor
- **Ekleme**: `/panel/kuryeler` → `POST /api/v1/panel/couriers` (`apps/api/src/routes/panel/staff.ts:89`), `memberships(role:'courier')`.
- **Giriş (parolasız magic link)**: `POST /panel/couriers/:userId/login-link` → `createCourierLoginLink()` (`apps/api/src/services/staff/index.ts`) → `courier_login_links` satırı (`sha256Hex(token)`, `COURIER_LINK_TTL_MS`) ve **URL panele döner** → `/kurye/giris?t=<token>`. WhatsApp `kurye_giris_v1` şablonuyla da gönderilebilir ama zorunlu değil (link kopyalanabilir). `courierLinkAllowed()`: platform yöneticisine asla; parolası olan hesaba yalnız her yerde kurye ise (başka işletmede sahip/personel olanın hesabına parola+TOTP olmadan girilemez).
- **Kullanım**: `POST /api/v1/auth/courier/exchange` → token tek kullanımlık atomik tüketilir (`update … set usedAt=now where usedAt is null and expiresAt > now`), `kind:'courier'` oturumu (`SESSION_TTL.courier`), switch-tenant kapalı.
- **Atama**: `POST /panel/orders/:id/assign-courier {userId, onTheWay?}` → `orders.courierUserId`, `order_events('courier_assigned')`, `branch_events('order.updated', change:'courier')`. Liste: `GET /panel/orders/couriers` (kurye + aktif sipariş sayısı).
- **Kurye ekranı** `/kurye` (`apps/web/app/kurye/page.tsx`) → `apps/api/src/routes/courier/index.ts`:
  - `GET /courier/orders` → **yalnız kendine atanmış açık siparişler** (`accepted|preparing|ready|on_the_way`), `toCourierDtos` ile tam müşteri telefonu + adres + `directions` + `lat/lng` + ödeme/para üstü (`changeKurus`) + ürün listesi; `deliveredToday` sayacı (İstanbul günü).
  - `POST /courier/orders/:id/on-the-way` → gel-alda 409, iptalde 409 `order_cancelled`, `preparing` iken 409 `order_not_ready` ("mutfakta hazırlanıyor").
  - `POST /courier/orders/:id/delivered` → `delivered` + `paymentStatus='paid'` + `paidAt`; `paidWith` farklıysa `paymentMethod`/`mealCardBrand` düzeltilir.
  - `lockAssigned()` → **başka kuryenin siparişi 404** (IDOR). Teslimden sonra adres/telefon listede görünmez.
- Ayrıca `POST /panel/couriers/:userId/logout` kuryenin tüm oturumlarını kapatır.

## 10) Admin paneli neyi yönetiyor
`apps/api/src/routes/admin/index.ts` — tüm uçlarda `requireAdminTotpEnrollment()` hook'u (TOTP kurulmadan **hiçbir** admin ucu çalışmaz, impersonation başlatma dahil) + `cache-control: no-store`. UI `apps/web/app/admin/*`.

| Alan | Uç / dosya | Ne yapar |
|---|---|---|
| Genel bakış | `overview.ts`, `/admin` | huni, sayaçlar (`services/admin/overview.ts`) |
| İşletmeler | `tenants.ts`, `/admin/isletmeler[/[id]]` | liste/detay + `PATCH`: `lifecycleStage` (`canTransitionLifecycle`, `lifecycleTransitionPermission`, `admin/lifecycle.ts`), `trialEndsAt`, `waMode`, `waCode`, askıya alma (`tenants:suspend` izni) |
| Destek oturumu | `impersonation.ts` | `POST /impersonation` + `/end`; `plugins/impersonation-audit.ts` akış açılışını bile loglar |
| WhatsApp | `whatsapp.ts`, `whatsapp-setup.ts`, `/admin/whatsapp` | ortak numara sağlığı (`services/admin/wa-health.ts`) + kurulum: **Bağlantıyı test et / Webhook'u Twilio'ya kaydet / Şablonları gönder / Durumu yenile** (`services/admin/wa-setup-twilio.ts`) |
| İşler | `jobs.ts`, `/admin/isler` | `jobs` kuyruğu, başarısızlar, yeniden deneme |
| Bayraklar | `flags.ts`, `/admin/bayraklar` | `signup_open`, `sms_fallback` |
| Leadler | `leads.ts`, `/admin/leadler` | `/demo` + hesaplayıcı başvuruları |
| Denetim | `audit.ts`, `/admin/denetim` | `audit_log` (2 yıl) |
| Notlar | `notes.ts` | işletme notları |
| Güvenlik | `/admin/guvenlik` | TOTP kurulumu + 8 kurtarma kodu |

Rol matrisi `packages/core/src/admin/permissions.ts` (`platform_owner`, `platform_admin`, `support_agent`, `finance`, `sales_rep`).

## 11) Arka plan / bakım
`apps/api/src/worker.ts` ayrı süreç, aynı kod tabanı. `lib/jobs.ts`: `jobs` tablosu + `LISTEN/NOTIFY`, `dedupeKey`, `runAt`, `maxAttempts`, geri çekilme. Kuyruklar `jobs/{order,notify,wa,system,cron}`. `cron.retention` (`jobs/system/index.ts`) KVKK saklama sürelerini uygular ve her adımı `retention_runs`'a yazar (`branch_events` 7 gün, `wa_webhook_events` 30 gün, WA mesaj metni 6 ay, `audit_log` 24 ay, hareketsiz müşteri 24 ay…). `cron.branch_pause_end` süresi dolan duraklatmayı temizler + `branch.state` yayınlar.

---

## 12) Üretime hazır mı — kısa cevap
**Yazılım tarafı hazır sayılabilir** (tip denetimi temiz, çekirdek testler yeşil, canlı sürüm HEAD ile aynı, worker gecikmesi 0, geliştirici araçları kapalı, FSM/idempotency/tenant yalıtımı/SSE tekrar oynatma gerçekten yazılmış). **Ama "eksik gedik kalmasın" ölçütüne göre HAYIR**: aşağıdaki 12 maddenin 1, 2, 4 ve 6'sı gerçek engelleyici. En kritik ikisi: **SMS kanalı canlıda kod düzeyinde `mock`'a çivilenmiş** ve **tüm yasal metinler hâlâ "taslak" damgalı** (işletme kayıtta bu taslağı click-wrap kabul ediyor).

## 13) WhatsApp numarası onaylandı mı?
**Buradan doğrulayamadım — ve bunu tahminle söylemem.**
- Depoda onay kaydı YOK; durum yalnız Twilio Console'da ve `/admin/whatsapp`'ta yaşıyor.
- Chrome'da açık tek sekme tam da `console.twilio.com/us1/develop/sms/senders/whatsapp-senders` hedefliydi ama **Twilio giriş ekranında** (oturum düşmüş) — parola girip giriş yapmam kuralen yasak, yapmadım.
- **Kesin olan:** `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `WA_PHONE` secret'ları 28.09.2026'da eklenmiş, son dağıtım "WhatsApp: gerçek numara, Twilio (simülatör kapalı)" diyor, yani container `PLATFORM_WA_PROVIDER=twilio` ile çalışıyor ve ortak webhook ayakta.
- **Nasıl bakılır (2 tıklama):** `yemekgelsin.net/admin/whatsapp > WhatsApp kurulumu > "Bağlantıyı test et"` → `GET messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp` ile gönderen durumu, görünen ad ("Yemek Gelsin") ve onayı, kalite, günlük sınır, çevrimdışı sebepleri, kayıtlı webhook ve **deneme hesabı uyarısı** ayrı satırda gelir. Şablon onayları için aynı ekranda **"Durumu yenile"** (`GET /v1/ContentAndApprovals` → `approved/pending/rejected/unsubmitted`).
- İki ayrı şey karıştırılmasın: (a) **gönderen/görünen ad onayı** (Twilio Console + Meta), (b) **şablon onayları** (9 müşteri + 6 platform şablonu). 24 saatlik pencere İÇİNDE serbest metin şablonsuz gider (Akış A'nın karşılaması ve onay mesajı genelde buraya düşer); pencere DIŞINDA onaysız şablon gönderilemez.
- Not: `docs/16 §2.1`'e göre ortak numara **+1 850 909 9295** (ABD hattı) — Türk müşteriye ABD numarasından mesaj gidiyor; bu ticari bir karar ama dönüşümü etkiler.

## sistem
## 🎯 1. İstek yolu (A→Z) — gerçek dosyalarla

| Durak | Dosya / fonksiyon | Ne yapar |
|---|---|---|
| 1. DNS + TLS | `deploy/cloudflare/wrangler.jsonc` → `routes` | `yemekgelsin.net` ve `www.yemekgelsin.net` Worker'a **Custom Domain** olarak bağlı; DNS kaydı + sertifika Cloudflare'de. Wildcard (`*.yemekgelsin.net`) **yok**. |
| 2. Worker `fetch` | `deploy/cloudflare/src/index.ts` (satır ~250 `export default { fetch }`) | Tek giriş kapısı. Sırayla: `redirectFor()` → `isDevToolsPath()` → `requiresAuth()` → container durumu → başlık yazımı → port seçimi. |
| 3. Kanonik yönlendirme | `src/access.ts` `redirectFor()` | `www.*` → kök (GET/HEAD 301, gövdeli 308). `*.workers.dev` sayfa gezinmeleri → alan adı 302; `/api/*` workers.dev'de de çalışır (yedek adres). |
| 4. Geliştirici araçları kapısı | `src/access.ts` `isDevToolsPath()` + `src/mode.ts` `modeSettings().blockDevTools` | `domain` kipinde `/dev*` ve `/api/v1/dev*` **container'a hiç gitmez**, Worker 404 döner. `normalizePathForAuth()` yüzde kodlamasını 3 tur çözer (`/api/v1/%64ev` de yakalanır). |
| 5. Parola kapısı | `src/index.ts` `authorized()` + `requiresAuth()` | Yalnız `staging` kipinde HTTP Basic (parola = `DEV_PASSWORD`, `timingSafeEqual`). `domain` kipinde parola yok. Sağlık uçları her iki kipte açık. |
| 6. Container hazır mı | `AppContainer.ensureReady()` (`startAndWaitForPorts`, 150 sn üst süre) | Sağlıklı değilse: sayfa gezinmesinde `STARTING_PAGE` (HTTP 503 + `retry-after: 5`, 5 sn'de kendini yeniler) döner ve uyandırma `ctx.waitUntil` ile arka planda; API isteğinde senkron bekler, olmazsa 503. |
| 7. Başlık düzeltme | `src/index.ts` (fetch gövdesi) | `authorization` silinir (Basic parola içeriye geçmez), `x-forwarded-for = cf-connecting-ip`, `x-forwarded-proto=https`, `x-forwarded-host` yazılır. |
| 8. Port seçimi | `url.pathname.startsWith('/api/') ? 4000 : 3000` + `switchPort()` | `/api/*` → Fastify (`apps/api/src/server.ts`), diğer her şey → Next.js standalone (`/app/web/apps/web/server.js`). Caddy düzeniyle birebir aynı. |
| 9. Yanıt başlığı | `withEnvHeaders()` | Her yanıta `x-yg-ortam: cloudflare`; `staging`'de ayrıca `x-robots-tag: noindex, nofollow`. |

**Not:** `Caddyfile` ve `docker-compose.yml` **canlı yol değildir** — bunlar isteğe bağlı Türkiye VPS alternatifidir (`docs/15 §14`, `deploy-production.yml`). HSTS, erişim logu (5651), wildcard vitrin ve `hooks.` alt alan adı yalnız o yolda var.

## 🎯 2. İki kip ve nasıl seçilir

- Seçimi iş akışı yapar: `.github/workflows/deploy-dev-cloudflare.yml` `kontrol` job'u → `VPS_HOST` secret'ı **yoksa** `mode=domain` (canlı), **varsa** `mode=staging` (ve push'ta tamamen atlanır).
- `deploy/cloudflare/scripts/prepare-config.mjs` + `scripts/config-modes.mjs` `buildConfig()` → `wrangler.generated.jsonc` yazar (routes, `DEPLOY_MODE`, `SEED_MODE`, `DATA_EPOCH`, `NEXT_PUBLIC_*`).
- Çalışma ayarları Worker'da türetilir: `src/mode.ts` `modeSettings()` → `domain` = `DEPLOY_ENV=production`, `DEV_TOOLS=0`, `ADMIN_TOTP_REQUIRED=true`, `noindex=false`, `blockDevTools=true`.
- `containerEnv()` sırası kritik: WhatsApp ortamı (`...waEnv`) yazıldıktan **sonra** kip ayarları yazılır → WhatsApp yapılandırması geliştirici araçlarını açamaz.

## 🎯 3. Container açılış sırası — `deploy/cloudflare/entrypoint.sh`

1. `DATA_EPOCH` doğrula (`^[0-9]{1,6}$`, değilse **çık**) → yedek yolu `http://yedek.internal/e3/...`
2. `initdb` (ilk kez) + `pg_ctl start` — yalnız `127.0.0.1:5432`, `shared_buffers=48MB`, `max_connections=40`, `TZ=UTC`
3. Veritabanı yoksa: `createdb` → `fetch_backup_retry db` (6 deneme, 5/10/15/20/25/30 sn) → `pg_restore --no-owner --no-privileges`
   - 404 = yedek yok → `fresh=1`, boş veritabanı
   - ağ/sunucu hatası = **container çıkar** (iyi yedeğin üzerine boş veri yazılmasın)
   - ardından `fetch_backup_retry uploads` → `tar -xzf` → `/data/uploads`
4. `node --import tsx packages/db/src/migrate.ts`
5. `node --import tsx packages/db/src/seed.ts` (`SEED_MODE=admin`) — `fresh` değilse hata açılışı durdurmaz, uyarı yazar
6. `fresh=1` ise hemen `backup_now force`
7. Üç süreç paralel: API (`API_PORT=4000`, heap 256MB) + worker (`src/worker.ts`, heap 192MB) + web (`PORT=3000`, heap 256MB)
8. `backup_loop &` → `wait -n` : **herhangi bir süreç düşerse** son yedek alınır ve çıkılır (platform yeniden başlatır)
9. `trap shutdown` (SIGTERM/SIGINT): uygulamalar TERM → beklenir → `backup_now force` → `pg_ctl -m fast stop`

## 🎯 4. jobs kuyruğu + outbox — `apps/api/src/lib/jobs.ts`

- **Outbox ayrı tablo değil**: `jobs` tablosunun kendisi outbox. `enqueueJob(tx, …)` iş verisiyle **aynı transaction**'da çağrılır; yan etki (WhatsApp, SMS, push, yazdırma) ancak commit olursa görünür. (`grep outbox packages/db/migrations` → hiçbir şey; şema `packages/db/src/schema/operations.ts:141`.)
- **Çekme**: `processDueJobs()` → `UPDATE jobs SET status='running' … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)`.
- **Tekillik**: `dedupeKey` UNIQUE (`jobs_dedupe_key_uk`), `onConflictDoNothing`. `cancelJobs()` iptalde anahtarı `…#cancelled:<id>` yapıp serbest bırakır.
- **Geri çekilme**: `backoffMs()` = 5s → 10s → 20s → 40s … en çok 10 dk; `maxAttempts` varsayılan 5; `PermanentJobError` doğrudan `failed`.
- **Şeritler** (`DEFAULT_WORKER_LANES`) — her biri kendi döngüsünde, `pollMs=250`:

| Şerit | Süzgeç | Parti | Housekeeping |
|---|---|---|---|
| `main` | WhatsApp ve SMS dışı her şey | 10 | ✅ cron + takılı iş kurtarma |
| `whatsapp` | `queue in ('wa-outbound','wa-media') or type='platform.alert'` | 5 | — |
| `sms` | `type='sms.send'` | 5 | — |

- **Takılı iş kurtarma**: `recoverStaleJobs()` 60 sn'de bir, `locked_at < now() - 5 dk` → `pending`.
- **Dayanıklılık**: `isTransientDbError()` (PG `42P01`, `57P0x`, `08xxx` + ağ kodları) → çökmez, katlanan beklemeyle (1→5 sn) yeniden dener, dakikada en çok 1 uyarı.
- **Kapanış**: `signal.aborted` → sürmekte olan iş biter, **alınmış ama başlanmamış** işler `attempts-1` ile `pending`e döner.
- **Gözetçi**: `apps/api/src/worker.ts` `WATCHDOG_STALL_MS = 10 dk` — bir şerit 10 dk tur atmazsa `process.exit(1)`, `entrypoint.sh` yedek alıp çıkar, platform yeniden başlatır.
- **DLQ**: `apps/api/src/routes/admin/jobs.ts` → `GET /admin/jobs?status=failed`, `POST /admin/jobs/:id/retry`.

## 🎯 5. LISTEN/NOTIFY — yalnız SSE için

- `apps/api/src/lib/sse.ts` `BranchEventHub`: tek `LISTEN branch_events` bağlantısı, şube dinleyicilerine dağıtım, 15 sn ping, `Last-Event-ID` ile tekrar oynatma.
- Kaynak: `apps/api/src/lib/events.ts` `appendBranchEvent()` — `pg_advisory_xact_lock(hashtextextended('branch_events:'||branchId))` ile şube başına commit sırası = artan `seq` (SSE'de atlama olmaz). NOTIFY, `packages/db/migrations/0001_branch_events_notify.sql` tetikleyicisiyle COMMIT'te gider.
- **jobs kuyruğu NOTIFY kullanmıyor** — 250 ms yoklama (polling).

## 🎯 6. Cron işleri

| Nerede | Ad | Sıklık | Ne yapar |
|---|---|---|---|
| Cloudflare Worker | `wrangler.jsonc` `triggers.crons: ["*/5 * * * *"]` → `src/index.ts` `scheduled()` | **5 dk** | `ensureReady()` + `GET /api/v1/health` (4000). 30 dk'lık `sleepAfter` sayacını sıfırlar → container **hiç uyumaz**. Yalnız `domain` kipinde çalışır. |
| App worker | `cron.branch_pause_end` (`jobs/cron/index.ts`) | 1 dk | Süresi dolan duraklatmaları temizler, `branch.state` yayınlar |
| App worker | `cron.panel_presence` (`jobs/cron/index.ts`) | 1 dk | 5 dk sipariş ekranı görülmeyen şubeye `platform.alert panel_offline` |
| App worker | `cron.sold_out_reset` (`jobs/system/index.ts:343`) | 15 dk | `products.sold_out_until` geçmişse temizler |
| App worker | `cron.retention` (`jobs/system/index.ts:338`) | Günlük **03:00 Europe/Istanbul** | KVKK saklama: `branch_events` 7g, `wa_webhook_events`/`jobs(done,cancelled)` 30g, `messages` metni 6 ay, `audit_log` 24 ay, hareketsiz müşteri 24 ay… her adım `retention_runs`'a yazılır |

Zamanlayıcı: `scheduleCronJobs()` — `main` şeridi 15 sn'de bir `cron:<ad>:<dilim>` tekillik anahtarıyla dilim ekler (kaçırılan dilim tekrar eklenmez).

## 🎯 7. Veritabanı göçü — `packages/db/src/migrate.ts`

- `packages/db/migrations/*.sql`, ad sırası (`^\d{4}_[\w-]+\.sql$`), şu an **13 dosya** (`0000_init` … `0903_wa_provider_twilio_check`). Dilim aralıkları: temel 0000–0099, menü 0100–, sipariş 0200–, whatsapp 0300–, ayarlar 0400–, admin 0500–, kimlik 0600–, bildirim 0700–, saklama 0800–, ortak numara 0900–.
- `_migrations(name, checksum, applied_at)` + `pg_advisory_lock(727274001)` (iki süreç aynı anda göç etmez).
- Her dosya `--> statement-breakpoint` ile parçalanır, **tek transaction** içinde uygulanır.
- Her container açılışında çalışır (idempotent, uygulanmışlar atlanır).

## 🎯 8. Yedek ve geri yükleme

**Yazma yolu:** container → `http://yedek.internal/e3/{db|uploads}` → `AppContainer.outboundByHost` → `handleBackup()` → R2 `siparisinonunde-dev-yedek` (bölge ENAM, ABD doğu).
- Anahtarlar: `e3/db/son.dump`, `e3/db/gun-<0..6>.dump`, `e3/uploads/son.tar.gz` (+ `gun-N.tar.gz`). Dönem **yoldan** okunur (`parseBackupPath()`), Worker'ın o anki `DATA_EPOCH`'undan değil → yeniden dağıtımda kapanan eski container'ın yedeği yeni döneme düşmez.
- `backup_loop`: `BACKUP_INTERVAL_SEC=120`. `db_fingerprint()` = `sum(n_tup_ins+n_tup_upd+n_tup_del)` + tablo sayısı, `pg_stat_user_tables`'tan, **`jobs` hariç** (worker her dakika yazıyor, yoksa boş ortam da sürekli yedek atardı). `uploads_fingerprint()` = dosya adı+boyut+mtime listesinin sha256'sı. **Değişmediyse yüklemez.**
- İz dökümden **önce** okunur, yalnız yükleme başarılıysa saklanır → döküm sırasındaki değişiklik sonraki turda yakalanır.
- `PUT` boş gövdeyi 400 ile reddeder; `upload_backup` boş dosyayı hiç göndermez.
- Zorunlu yedek (`force`): ilk kurulum, SIGTERM (uyku/yeniden dağıtım), bir süreç düşmesi.

**Okuma yolu (otomatik):** yalnız veritabanı yokken (yeni container) → `fetch_backup_retry` → `pg_restore`. Dağıtımda Cloudflare eski container'a SIGTERM atar, çıkmasını bekler, **sonra** yenisini başlatır → düzgün kapanışta veri kaybı yok.

**Geri yükleme (elle, betiksiz — `docs/15 §13 "Yedekten geri dönüş"`):** (1) R2'den `e3/db/son.dump` veya `gun-N.dump` indir, (2) aynı kovaya `e4/db/son.dump` + `e4/uploads/son.tar.gz` olarak yükle, (3) `wrangler.jsonc` `vars.DATA_EPOCH` → `"4"` yap ve push et. Çalışan container'ın `son.dump`'ının üzerine yazmak işe yaramaz (2 dk içinde kendi yedeğiyle ezer).

**Kayıp penceresi:** düzgün kapanış/dağıtım = 0; beklenmedik çökme = son ~2 dakika (+ pg_stat gecikmesi). PITR/WAL arşivi **yok**.

## 🎯 9. Dağıtım adımları — `.github/workflows/deploy-dev-cloudflare.yml`

Tetik: `push` → `branches: [main, claude/relaxed-pascal-1m775m]`, `paths-ignore: docs/**, **/*.md`; ayrıca `workflow_dispatch`. `concurrency: deploy-dev-cloudflare`, `cancel-in-progress: false`. `timeout-minutes: 60`. `defaults.run.working-directory: deploy/cloudflare`.

| # | Adım | Ne yapar |
|---|---|---|
| 0 | `kontrol` job | `VPS_HOST` → kip; `CLOUDFLARE_API_TOKEN` + `DEV_PASSWORD` eksikse push'ta uyarı / elle çalıştırmada hata |
| 1 | Bağımlılıklar, tür denetimi ve testler | `npm ci && npm run typecheck && npm test` — **yalnız `deploy/cloudflare` paketi** (31 test: access, mode, whatsapp-env, config-modes). Yerelde çalıştırdım: **31/31 geçiyor.** |
| 2 | Cloudflare hesabı ve alan adı erişimi | Hesap kimliği (tek hesap değilse hata), workers.dev alt alan adı, `ZONE` için `Zone>Read` + `Zone>Workers Routes>Edit` doğrulaması (yoksa Türkçe `::error::`) |
| 3 | WhatsApp kipi | Secret takımlarına bakar: `D360_API_KEY`→d360, `TWILIO_ACCOUNT_SID+TWILIO_AUTH_TOKEN`→twilio, `META_WA_TOKEN+META_WA_PHONE_NUMBER_ID+META_APP_SECRET`→cloud. Birden çok tam takım → **dağıtım durur**. `WA_PHONE` yoksa mock. Artık secret'lar uyarılır. Değerler loga yazılmaz. |
| 4 | Yapılandırma ve gizli değerler | `prepare-config.mjs "$SITE_URL" --mode $MODE` (+`APP_VERSION=$GITHUB_SHA`) → `wrangler.generated.jsonc`; `wrangler secret list` → `secrets.mjs` eksikleri **bir kez** üretir; boşaltılan WhatsApp secret'ları `wrangler secret delete` ile Worker'dan silinir |
| 5 | Dağıt | `wrangler deploy -c wrangler.generated.jsonc --secrets-file … --containers-rollout=immediate`; `secrets.json` hemen silinir; hata son `[ERROR]` bloğuna göre sınıflandırılır (DNS çakışması / token izni / diğer) |
| 6 | Duman testi | `/api/v1/health` 200 **ve** `version == $GITHUB_SHA` olana kadar en çok 20 dk (eski container yanıt verirken beklenir); sonra 9 yol 200, `/s/bozok-pide` 404, "Demo ortamı" yok, `x-robots-tag` yok, `x-yg-ortam: cloudflare` var, robots.txt açık, `/demo` lead formu + bal küpüyle `POST /api/v1/public/leads` → 204 (canlı veriye yazmaz), `/panel/kayit` açık, `/dev/*` + `/api/v1/%64ev/*` 404, ortak webhook API'ye ulaşıyor (404), `www` → 301, workers.dev API 200 + sayfa 302 |

`wrangler secret` gizli değerleri: `SESSION_SECRET` (48B), `TRACKING_SECRET` (32B), `ENCRYPTION_KEY` (32B base64), `WA_VERIFY_TOKEN` (16B hex), `PLATFORM_WA_WEBHOOK_TOKEN` (24B hex), VAPID çifti (`createECDH prime256v1`) — **var olana dokunulmaz** (`ENCRYPTION_KEY` değişirse yedekteki şifreli alanlar okunamaz). `DEV_PASSWORD` her dağıtımda güncellenir (min 8 karakter denetimi `secrets.mjs`'te).

## 🎯 10. Hangi ortam değişkeni neyi açar (`containerEnv()` + `apps/api/src/config.ts`)

| Değişken | Değer (canlı) | Ne açar/kapar |
|---|---|---|
| `DEPLOY_ENV` | `production` | API üretim açılış denetimi (`productionConfigErrors` → zayıf secret, `DEV_TOOLS=1`, eksik sağlayıcı anahtarı = **süreç başlamaz**) |
| `DEV_TOOLS` | `0` | `/api/v1/dev/*` kayıt edilmez (`app.ts` `devToolsAllowed`); üretimde ancak `DEPLOY_ENV=dev` + tüm sağlayıcılar mock iken açılabilir |
| `ADMIN_TOTP_REQUIRED` | `true` | Platform yöneticisinde 2FA zorunlu; kurulmadan yönetim uçları 403 `totp_enrollment_required` |
| `SEED_MODE` | `admin` | Yalnız `admin@yemekgelsin.net` + üretim bayrakları; demo verisi yok (`demo` kipi üretimde reddedilir) |
| `SEED_PASSWORD` | `=DEV_PASSWORD` | Yönetici parolası her açılışta buna eşitlenir (2FA'ya dokunmaz) |
| `DATA_EPOCH` | `3` | R2 yedek öneki. **Artırmak = canlı veriyi boş veritabanıyla değiştirmek** |
| `PLATFORM_WA_PROVIDER` | `mock`/`d360`/`twilio`/`cloud` | Ortak numara yolu. `mock` + production = **hiçbir WhatsApp gitmez**, vitrinde/QR'da bağlantı gösterilmez (`platformDisplayPhone()` null) |
| `PLATFORM_WA_API_KEY` | d360 anahtarı / Twilio Auth Token / Meta token | Gönderim + (Twilio'da) `X-Twilio-Signature` doğrulaması |
| `PLATFORM_WA_PHONE_NUMBER_ID` | Twilio'da Account SID (`AC…`), cloud'da Graph id | Gönderim adresi; twilio'da `AC`+32 hex değilse **açılış durur** |
| `PLATFORM_WA_WEBHOOK_TOKEN` | 24B hex | `/api/v1/webhooks/wa/shared/<belirteç>`; boşsa ortak webhook 404 |
| `WA_APP_SECRET` | yalnız `cloud` | `X-Hub-Signature-256`; cloud'da zorunlu, d360/twilio'da yok |
| `WA_DEFAULT_PROVIDER` | `mock` | İşletmenin **kendi** numarası — henüz sağlayıcı yok |
| `SMS_PROVIDER` | `mock` | SMS hiç gitmez (yalnız uyarı) |
| `PUBLIC_LEADS_ENABLED` | `1` | `POST /api/v1/public/leads`; `0` → 403 `leads_closed` |
| `VAPID_*` | üretilir | Web Push (alarm t=0); üçü yoksa push kapalı, yalnız uyarı |
| `UPLOAD_DIR` | `/data/uploads` | Görseller; `/api/v1/uploads/*` (fastify-static, `maxAge: 1d`) |
| `NEXT_PUBLIC_DEMO_BANNER` / `_DEV_TOOLS` / `_DEMO_STORE_SLUG` | `0`/`0`/boş | **Derleme zamanı** (`Dockerfile` ARG); `/dev/whatsapp` sayfası canlı imajda derlenmez |
| `NEXT_PUBLIC_ROOT_DOMAIN` | **boş** (`Dockerfile`) | `apps/web/proxy.ts` alt alan adı yazımı devre dışı → `{slug}.yemekgelsin.net` ve `panel.`/`admin.` canlıda **yok** (yalnız Caddy/VPS yolunda) |

## 🎯 11. Sağlık uçları neyi ölçüyor — `apps/api/src/routes/health.ts`

| Uç | 200 koşulu | Ölçtüğü |
|---|---|---|
| `GET /api/v1/health` | `select 1` başarılı | `{ok, db, time, uptimeSec, version}`. `version = APP_VERSION` = dağıtılan commit → duman testi ve "yeni sürüm devreye girdi mi" bununla anlaşılır. Worker cron'u da bunu çağırır. |
| `GET /api/v1/health/worker` | `jobLagSec <= 300` **ve** `stuckJobs == 0` **ve** db up | `jobs` tablosundan: vadesi gelmiş en eski `pending` işin gecikmesi + 10 dk'dan uzun `running` kalan iş sayısı. Takılı worker'ı süreç ayakta olsa bile yakalar; `cache-control: no-store`. |

İkisi de `src/access.ts` `HEALTH_PATHS` içinde → staging'de bile parolasız açık. (`scripts/worker-health.ts` aynı eşikle Docker/VPS healthcheck'i için.)