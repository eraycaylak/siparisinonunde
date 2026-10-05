# 17 — Olay Müdahale Runbook'u (uygulanabilir sürüm)

> **Bu dosya ne?** [10](10-riskler-operasyon-ve-metrikler.md) §5–§9 olay yönetimini **tasarlar** (SEV sınıfları, nöbet,
> postmortem, iletişim şablonları); orada anlatılan runbook'ların bir kısmı henüz var olmayan altyapıyı (ikinci ingress
> düğümü, Redis, PITR, nöbet ekibi) varsayar. Bu dosya **bugün canlıda gerçekten üretilen sinyallerle** çalışır:
> `ALERT_WEBHOOK_URL`'e giden uyarılar, `/api/v1/health`, `/api/v1/health/worker`, dağıtım kapısı ve R2 yedek zinciri.
> Çelişki olursa **bu dosya geçerlidir**; docs/10 hedef durumu, docs/17 bugünü anlatır.
>
> **Kurulum/işletim komutlarının yeri:** [15](15-kurulum-ve-isletim.md) — §10 İzleme, §13 Canlı ortam (Cloudflare),
> §8 Yedekleme. Bu dosya o bölümlere atıf verir, komutları tekrar etmez.

**Canlı ortamın şekli (tek cümle):** Cloudflare Worker + **tek** container (PostgreSQL + API + worker + web aynı
kutuda) + R2 yedek kovası. Container diski geçicidir, veri R2'deki döküme bağlıdır. **Container'a kabuk erişimi
yoktur** — `docker compose …` ve `psql` komutları yalnız isteğe bağlı VPS yolundadır (docs/15 §14).

| Elindeki tüm teşhis aracı | Nasıl |
|---|---|
| Container + Worker günlüğü | `npx wrangler tail siparisinonunde-dev` (ya da Cloudflare > Workers & Pages > Logs) |
| Süreç + veritabanı | `curl -s https://yemekgelsin.net/api/v1/health` |
| Worker/kuyruk/yedek/disk/bellek | `curl -s https://yemekgelsin.net/api/v1/health/worker` — **`ok`/503 "hizmet verilebiliyor mu"** (db + kuyruk), **`degraded`/`warnings` "eşik aşıldı mı"** (yedek, disk, bellek; durum kodu 200 kalır) |
| Ayrıntılı ölçüm (yedek yaşı, disk, bellek **sayıları**) | `curl -s -H "x-health-metrics-token: $HEALTH_METRICS_TOKEN" …/api/v1/health/worker` — bu alanlar **belirteçsiz yanıtta hiç bulunmaz** (altyapı iç bilgisi, denetim 2026-10-05 bulgu A-2). Belirteç kurulu değilse (bugünkü varsayılan) elinde yalnız `warnings` + `wrangler tail` vardır; kurulumu docs/15 §10 "Ayrıntılı ölçümler" |
| Başarısız işler (DLQ) + yeniden dene | `/admin/isler` · `GET /api/v1/admin/jobs?status=failed` · `POST /api/v1/admin/jobs/:id/retry` |
| WhatsApp hesap sağlığı | `/admin/whatsapp` → "Bağlantıyı test et" |
| Kill-switch'ler | `/admin/bayraklar` |
| Yedek nesneleri + webhook tamponu | Cloudflare > R2 > `siparisinonunde-dev-yedek` > `e3/` |
| Dağıtım geçmişi ve geri alma | GitHub > Actions > "Canlı ortam (Cloudflare)" |

---

## 1. Uyarı türleri: ne demek, ne yapılır

Uyarı kanalı **tek**: `ALERT_WEBHOOK_URL` (Worker secret'ı; docs/15 §13 madde 5). Tanımsızsa uyarılar **yalnız günlüğe**
düşer — o zaman tek haber kaynağı dış izlemenin 503'leri olur.

- **API gövdesi** (`apps/api/src/lib/alert.ts`): `{service:"yemekgelsin-api", env, kind, severity, message, data, at}`.
  Aynı `dedupeKey` için **10 dk soğuma** (aksi yazılmadıkça), `ALERT_MIN_SEVERITY` varsayılanı `warning`.
  Soğuma süreç belleğindedir: container yeniden açılınca sıfırlanır.
- **Worker gövdesi** (`deploy/cloudflare/src/alert.ts`): `{kaynak:"worker", olay, zaman, ayrinti}`.
  Kural olarak **soğuma YOKTUR** — düzelmeyen bir arıza her turda (5 dk) yeniden uyarır. **Tek istisna `yedek_eskidi`
  (U-28): 1 saat soğuma**, damgası Durable Object deposundadır (cron her turda yeni isolate'te koşabildiği için
  modül belleği dizgin olarak güvenilmez).
- **Container açılış gövdesi** (`deploy/cloudflare/entrypoint.sh` `send_alert`): API ile **aynı alanlar**, `service:"yemekgelsin-container"`. Yalnız açılış/yedek zinciri olaylarında üretilir (§1.3), **soğuma yoktur**, kanal yoksa ya da `http`/`https` değilse uyarı yalnız günlüğe düşer ve açılış **durmaz**.

### 1.1 API uyarıları

| # | `kind` | Ağırlık | Ne anlama geliyor | İlk 5 dakika | Nasıl doğrularsın | Nasıl kapatırsın |
|---|---|---|---|---|---|---|
| U-1 | `legal_texts_not_published` | critical (kapı kapalı) / warning | Açılışta yasal metin sürümü/künyesi eksik. **critical ise vitrin sipariş ALMIYOR** | Uyarının `data.reasons` listesini oku; eksik ortam değişkenini düzelt | `pnpm check:legal` (docs/15 §4) | Değeri tamamla → yeniden dağıt. Açılışta bir kez üretilir, soğuma yok |
| U-2 | `wa_webhook_signature_invalid` | critical (ortak numara) / warning (işletme) | Doğru webhook belirteciyle gelen istek **imza** doğrulamasını geçemedi → olay kaydedilmedi, 401. Ortak numarada **tüm** dükkanların mesajı düşüyor | `data.scope` + `data.reason`'a bak. `App Secret` / Auth Token döndü mü? Son dağıtımda WhatsApp secret'ı değişti mi? | `/admin/whatsapp` → "Bağlantıyı test et" | Doğru sırrı Worker secret'ı olarak yaz, dağıt. Meta/360dialog 200 almadığı olayı **yeniden dener**; kayıp değil gecikme |
| U-3 | `wa_webhook_phone_mismatch` | critical | Yükte **başka numaraya** ait olay vardı; tenant yalıtımı için atıldı (ham yük silinmez) | Hangi hesap: `data.accountId`. Aynı belirteç iki hesaba mı tanımlı? | `/admin/whatsapp` hesap listesi | Sağlayıcıda yanlış webhook adresini düzelt. Atılan olay gerekiyorsa ham yükten elle yeniden işlenir |
| U-4 | `shared_wa_account_error` | critical | Ortak numarada kimlik/hesap hatası (token/ödeme/kısıtlama) → **ortak numaranın tüm dükkanları sustu** | `data.code`'u Meta/360dialog hata koduyla eşle (docs/02 §10) | `/admin/whatsapp` → "Bağlantıyı test et"; `ready:false` beklenir | Sağlayıcı tarafında çöz (kart, token, kısıtlama itirazı). Geçici: işletmeler telefonla sipariş alır |
| U-5 | `job_failed_permanent` | critical | Bir iş denemeleri tükenerek **kalıcı** başarısız oldu (DLQ) | `data.type` sipariş yolunda mı (`order.alarm_step`, `wa.*`, `push.send`)? `data.permanent` true ise yeniden denemek boşuna — hata kalıcı sınıfta | `/admin/isler` → "Başarısız" | Kök nedeni düzelt, sonra `data.jobId` ile `POST /api/v1/admin/jobs/:id/retry`. Soğuma iş **türü** başınadır (yük uyarıya yazılmaz) |
| U-6 | `job_stale_exhausted` | critical | `running`'de takılı kalmış işler süpürücü tarafından kalıcı başarısız yapıldı — **worker iş sürerken ölmüş** olabilir | `/api/v1/health/worker` → `stuckJobs`, `jobLagSec`. Container yeni mi açıldı? | `wrangler tail` ile `[baslat]` satırları | Worker ayaktaysa işleri yeniden dene. Tekrarlıyorsa bellek/OOM bak (U-13, §2.6) |
| U-7 | `order_new_watch` | critical | `new` siparişin alarm zinciri **eksikti**, gözcü adımları yeniden kuyruğa attı. Sipariş kaçmadı ama zincir kendi başına bozulmuş | `data.orders` / `data.steps`. Neden eksildi: worker ölümü mü, kalıcı hata mı (U-5 ile birlikte gelir) | `/admin/isler` → `order.alarm_step` | Gözcü zaten onardı; **kök neden** U-5/U-6'dan okunur. Soğuma 10 dk |
| U-8 | `order_new_watch_exhausted` | critical | Aynı siparişin alarm adımı tekrar tekrar başarısız; **otomatik kurtarma durdu** | `data.orderIds`'teki siparişleri panelden kontrol et; gerekiyorsa **işletmeyi telefonla ara** | `/admin/isler`'de o siparişin işleri | Elle müdahale. Bu satır "müşteri bekliyor, kimse haberdar değil" demektir |
| U-9 | `jobs_dlq_threshold` | critical | **Son 24 saatte** kalıcı başarısız olan iş sayısı **10**'u geçti (gözcü 15 dk'da bir bakar, soğuma 60 dk). Eski birikme bu uyarıyı ÜRETMEZ: `data.failed` penceredeki sayı, `data.total` tablodaki tüm `failed` satır — ikisi çok farklıysa yığın eski, `total`'ı admin ekranından boşalt | `data.types` hangi türün biriktiğini söyler (döküm de pencerelidir) | `GET /api/v1/admin/jobs?status=failed` → `counts.failed` (bu sayı PENCERESİZDİR, `data.total` ile karşılaştırılır) | Türü düzelt, yığını yeniden dene. Eşik ve pencere: `DLQ_ALERT_THRESHOLD` / `DLQ_ALERT_WINDOW_MS`, `apps/api/src/jobs/cron/index.ts` |
| U-10 | `image_engine_unavailable` | critical | `sharp` yüklenemedi → **görsel yükleme kapalı** (503). Dağıtım/imaj arızası | Panelde menü görseli yüklemeyi dene; 503 `image_engine_unavailable` bekle | `wrangler tail` açılış satırları | Yeni imaj dağıt (§3). Sipariş akışı etkilenmez; işletmeye "görsel adresi yapıştır" yolu açık |
| U-11 | `shared_wa_silence` | critical (`:never`) / warning (`:window`) | Ortak numaradan hiç/uzun süre webhook gelmiyor | **BUGÜN ÜRETİLMEZ** — kod ve testi var, cron'a bağlı değil (§6 "Düzeltilen/eksik") | — | Önce cron'a bağlanmalı. Şimdilik yerine §2.4 elle kontrolü |
| U-12 | `canary_stale_panel` · `canary_create_failed` | critical | Sentetik sipariş panelde görülmedi / üretilemiyor | **BUGÜN ÜRETİLMEZ** — `CANARY_ENABLED` (+ "bayat panel" için `CANARY_STALE_ALERT`) hiçbir ortamda açık değil. Veritabanındaki `canary` anahtarı **engel değildir**: kaydı yoksa AÇIK sayılır (`lib/flags.ts`) ve `KILL_SWITCHES` listesinde olmadığı için `/admin/bayraklar`'da **görünmez** — deploy'suz acil durdurma ancak `feature_flags`'e `canary` satırı yazılarak yapılır | — | Canary'i açmadan docs/10 §7.3 "canary yeşil" doğrulaması **yapılamaz** |
| U-19 | `sse_connection_limit` | warning | Aynı şubeden/işletmeden açık panel canlı akışı sayısı sınırı aştı (şube **8**, işletme **24**; `SSE_MAX_PER_BRANCH` / `SSE_MAX_PER_TENANT`) ve en eskiler kapatıldı. Sekme yığılması ya da yeniden bağlanma döngüsü | `data.branchOpen` / `data.tenantOpen` sınırın hemen üstünde mi, kat kat üstünde mi? Dükkanda kaç ekran/sekme açık? | Panelde sipariş ekranı çalışmaya devam eder (kapatma `Last-Event-ID` ile telafi edilir) — sipariş kaybı DEĞİL | Fazla sekmeyi kapat. Gerçek ihtiyaç buysa sınırı `SSE_MAX_PER_BRANCH` / `SSE_MAX_PER_TENANT` ile yükselt. Soğuma şube başına 10 dk (`apps/api/src/plugins/sse-limit.ts:128`) |
| U-20 | `waba_conversation_quota` | warning (%70) / critical (%90 ve **tavan DOLU**) | Ortak numaranın 24 saatlik iş-kaynaklı konuşma tavanına yaklaşıldı ya da tavan doldu (varsayılan tavan **250**, `WABA_CONVERSATION_CAP`; sağlayıcı basamağı okunabiliyorsa o geçerli). Tavan dolunca yeni müşteriye hiçbir dükkanın durum mesajı gitmez | `data.level` (`warn`/`critical`/`exhausted`), `data.total`/`data.cap`; `data.tenants` hangi dükkanın tükettiğini söyler | `/admin/whatsapp` → "Bağlantıyı test et" (kalite derecesi + basamak). Gözcü `cron.waba_quota_watch` 5 dk'da bir ölçer | Basamak yükseltmesi Meta tarafındadır; kısa vadede önemsiz durum mesajlarını kıs (son %10 kritik mesaja ayrılır). Soğuma 60 dk, tavan doluyken 15 dk |
| U-21 | `waba_messaging_limit` | critical | Sağlayıcı "mesaj sınırı" hatası döndü (Meta **131048**; Twilio karşılığı buna çevrilir, `apps/api/src/wa/errors.ts:59`). Türetilen sayaç düşük okusa da bu hata tavanın GERÇEĞİDİR | `data.shared` **true** → ortak numara, tüm dükkanların yeni müşteriye giden mesajları durdu; false → yalnız o işletme | `/admin/whatsapp` → "Bağlantıyı test et" | Meta'da messaging limit ve kalite derecesine bak, kısıtlama itirazı aç. Geçici: işletmeler telefonla sipariş alır. Soğuma 15 dk |
| U-22 | `waba_quality_rating` | critical (`RED`) / warning (`YELLOW`, `FLAGGED`, `RESTRICTED`) | Ortak numaranın kalite derecesi düştü; Meta basamağı düşürebilir ya da numarayı kısıtlayabilir | `data.quality`, `data.ready`. İzinsiz/gereksiz mesaj gönderimi ya da şikâyet artışı var mı? | Okuma **saatte bir** yapılır (`WABA_QUALITY_READ_INTERVAL_MS`); elle: `/admin/whatsapp` → "Bağlantıyı test et" | Gereksiz gönderimi durdur, engelleme/şikâyet kaynağını bul. Dereceyi sağlayıcıdan okuyamazsak uyarı **üretilmez** (değer uydurulmaz). Soğuma 60 dk |

| U-25 | `backup_stale` | critical | Son **başarılı** veritabanı yedeği `HEALTH_MAX_BACKUP_AGE_SEC`'ten (900 sn) eski: yedek zinciri kopmuş olabilir, canlı veri yalnız **geçici** container diskinde. **Uç 503 DÖNMEZ** (`degraded:true`); tek haber yolu bu uyarıdır | §2.2 | `curl -s /api/v1/health/worker` → `warnings`; sayılar (`lastBackupAgeSec`, `maxBackupAgeSec`) **belirteçle** (§1 tablosu). Uyarının kendi `data` gövdesi de o anın sayılarını taşır | §2.2. Soğuma **30 dk** (iki katman: log satırı eşik düzelince sıfırlanır, **webhook gönderimi sıfırlanmaz**). Yani 30 dk içinde düzelip tekrarlayan bir arıza günlükte hemen görünür ama webhook pencerenin sonunu bekler: **uyarı gelmiyor olması "yedek düzeldi" demek DEĞİLDİR**, §2.2 adım 1 ile doğrula |
| U-26 | `disk_low` | warning | Boş disk `HEALTH_MIN_DISK_FREE_PCT`'in (%15) altında. `/data` hem PostgreSQL verisini hem görselleri tutar | §2.6 | `curl -s /api/v1/health/worker` → `warnings`; `diskFreePct`, `diskFreeMb` **belirteçle** (§1 tablosu) ya da uyarının `data` gövdesinden | §2.6. Soğuma 30 dk |
| U-27 | `memory_high` | critical | API sürecinin yığın kullanımı `HEALTH_MAX_MEM_USED_PCT`'i (%95) aştı: OOM'a yakın, süreç ölürse işler yarıda kalır (U-6 ile birlikte gelebilir) | §2.6 | `curl -s /api/v1/health/worker` → `warnings`; `memUsedPct`, `memRssMb` **belirteçle** (§1 tablosu) ya da uyarının `data` gövdesinden | §2.6. Soğuma 30 dk |

> **Numaralar sabittir:** U-13…U-18 ve U-28 Worker uyarılarıdır (§1.2), U-23/U-24 container açılış uyarılarıdır (§1.3). Yeni türler bir sonraki boş numaradan (U-29) devam eder, böylece §2'deki atıflar kaymaz. **U-19…U-22 ortak numara ve panel akışı uyarılarıdır ve bugün CANLIDA üretilir** (`cron.waba_quota_watch` 5 dk, `services/messaging/send.ts`, `shared-router.ts`, `plugins/sse-limit.ts`); U-20/U-22 yalnız ortak numarada gerçek bir sağlayıcı bağlıyken ölçülür (`PLATFORM_WA_PROVIDER` mock ise ölçüm yok).

### 1.2 Worker uyarıları

| # | `olay` | Ne anlama geliyor | İlk 5 dakika | Nasıl doğrularsın | Nasıl kapatırsın |
|---|---|---|---|---|---|
| U-13 | `container_baslatilamadi` | Uyanık tutma turunda container **hiç açılmadı** | §2.1 | `curl /api/v1/health` zaman aşımı/5xx | §2.1 |
| U-14 | `uyanik_tutma_hatasi` | Container ayakta ama `/api/v1/health` 200 dönmedi ya da yoklama patladı (`ayrinti.durum` / `ayrinti.hata`) | `db:"down"` mı, yoksa hiç yanıt mı? | `curl -i /api/v1/health` | Veritabanı açılışı sürüyorsa kendiliğinden geçer; geçmiyorsa §2.1 |
| U-15 | `webhook_tamponlandi` | Container **alamadı**, gelen webhook R2 tamponuna yazıldı ve sağlayıcıya 200 döndü. **Sipariş/mesaj kaybolmadı, gecikti** | Tekse: dağıtım penceresidir, normal. Akıyorsa container hastadır → §2.1 | R2 `e3/webhook-tampon/` dolu | Container düzelince 5 dk'lık tur boşaltır; hemen istiyorsan `POST /__yg/webhook-drain` (başlık `x-yg-drain-key`) |
| U-16 | `webhook_tampon_yazilamadi` | **En kötü satır:** tampona da yazılamadı, sağlayıcıya 503 döndü | Hemen: R2 bağlaması/kotası ve `DATA_EPOCH` doğru mu? | `wrangler tail` → `webhook TAMPONLANAMADI` | R2'yi düzelt. Twilio gelen mesaj webhook'unu **bir daha teslim etmez** (`deploy/cloudflare/src/webhook-spool.ts:6`) — o mesaj gerçekten kayıptır; Meta 7 güne kadar yeniden dener |
| U-17 | `webhook_drain_reddedildi` | Container kaydı **kalıcı reddetti** (4xx) ya da kayıt okunamadı; kayıt silinmedi, yerinde duruyor | `ayrinti.durum`: `404` = webhook belirteci değişti · `401` = imza sırrı uyuşmuyor (U-2 ile aynı kök) | R2'de kayıt duruyor | Sırrı düzelt → `POST /__yg/webhook-drain` ile turu tetikle (docs/15 §13 sorun giderme) |
| U-18 | `webhook_drain_hatasi` | Boşaltma turu geçici hata verdi; kayıtlar R2'de | Container hasta mı (U-13/U-14 ile birlikte gelir)? | R2 `e3/webhook-tampon/` kayıt sayısı azalıyor mu | Container düzelince kendiliğinden. **Soğuma yok**: her 5 dk tekrar uyarır |
| U-28 | `yedek_eskidi` | Uyanık tutma turunun **yedek gözcüsü** yoklaması `/api/v1/health/worker`'da eşikten eski yedek gördü. U-25'in Worker kanalındaki ikizi: container'ın kendi uyarı yolu kurulu değilse ya da API uyarısı gitmiyorsa haber bu kanaldan gelir. `ayrinti.yasSn` / `ayrinti.esikSn` yedek yaşını ve eşiği saniye olarak taşır | §2.2 | `curl -s /api/v1/health/worker` → `warnings` içinde `backup_stale`; `lastBackupAgeSec` **belirteçle**. Worker belirteci yoksa uyarıda `yasSn`/`esikSn` BULUNMAZ (uydurulmaz) ve karar yine `warnings`'ten verilir — uyarının gelmesi için belirteç gerekmez | §2.2. Soğuma **1 saat** (damga Durable Object deposunda). Yedek yaşı okunamazsa (uç yanıt vermiyor, gövde bozuk) uyarı **üretilmez** — o durumun haberi U-13/U-14'tür |

### 1.3 Container (açılış) uyarıları

Bu iki tür container **açılırken** üretilir ve ikisi de aynı şeyi söyler: *yedek zinciri donduruldu, R2'deki iyi döküm korunuyor, elle müdahale gerekiyor.*

| # | `kind` | Ağırlık | Ne anlama geliyor | İlk 5 dakika | Nasıl doğrularsın | Nasıl kapatırsın |
|---|---|---|---|---|---|---|
| U-23 | `yarim_geri_yukleme` | critical | Açılışta "geri yükleme sürüyor" işareti bulundu: önceki açılışta `pg_restore` **yarıda kalmış**. Veritabanı yarım olabilir; **satır sayısı hiçbir şey kanıtlamaz**. R2'ye yazma container ömrü boyunca **donduruldu** (iyi `son.dump` + `gun-<0–6>.dump` korunuyor); geri yükleme **yeniden denenmez**, ama migration ve seed yarım şema üzerinde çalışır. Site eksik/boş görünebilir, migration yarım şemada patlarsa container çökme döngüsüne girer | **R2'ye dokunma.** `data.gercekVeriSatiri` ve `data.epoch`'u not et → §2.8 | `wrangler tail` → `YARIM GERİ YÜKLEME` satırı + her 2 dk `yedek zinciri DONDURULDU`; `/health/worker` `warnings` → `backup_stale` (sayı için belirteç) | §2.8: **yeni container başlat** (Actions > "Canlı ortam (Cloudflare)"). Temiz diskte işaret yoktur, R2'den tek seferde geri yüklenir |
| U-24 | `geri_yukleme_izi_yazilamadi` | critical | İşaret **yazılamadı** (`PGDATA`'nın yanındaki birim yazılamıyor). Yarım geri yükleme korumasız kalmasın diye zincir önleyici olarak donduruldu — geri yükleme yine de yapıldı | Disk dolu mu / birim salt okunur mu: `/health/worker` `warnings` → `disk_low`; sayı için belirteç (§2.6) | `wrangler tail` → `geri yükleme izi yazılamadı` | Diski/birimi düzelt, yeniden dağıt. Zincir ancak temiz bir açılışta geri açılır |

> **Numaralar sabittir:** U-23/U-24 container açılış uyarılarıdır; §1.1'deki sağlık eşiği türleri **U-25…U-27**, Worker'ın yedek gözcüsü **U-28**'dir (§1.2). Yeni türler U-29'dan devam eder.

---

## 2. Sık senaryolar, adım adım

### 2.1 Container açılmıyor (U-13, U-14, U-15 akışı)
1. `curl -i https://yemekgelsin.net/api/v1/health` — yanıt yok/5xx mü, `db:"down"` mı?
2. `npx wrangler tail siparisinonunde-dev` → `[baslat]` satırlarını oku. Üç tipik sebep:
   - **`Geçersiz üretim yapılandırması: …`** → eksik/yanlış ortam değişkeni (docs/15 §4). Düzelt + dağıt.
   - **`Failed to start container`** → çoğunlukla bellek. `instance_type: basic` (1 GiB) sınırda; `standard-1`'e
     çıkmak maliyeti artırır (docs/15 §13, denetim FAZ 4.9).
   - **`TAZE AÇILIŞ: … altında yedek YOK`** → `DATA_EPOCH` yanlış. **Site boş görünür.** Doğru döneme (`"3"`) dönüp
     push et; eski dönemin nesneleri R2'de duruyor. Bu durumda R2'ye yazma kapalıdır, veri ezilmez (§4 notu).
   - **`geri yükleme başarısız (pg_restore)`** → `son.dump` bozuk. `gun-<0–6>.dump` kopyasıyla §4'ü uygula.
   - **`YARIM GERİ YÜKLEME: önceki açılışta geri yükleme tamamlanmadı`** → önceki `pg_restore` yarıda kesilmiş; yedek zinciri **dondurulmuş**. R2'deki döküm sağlam, container'ı yenilemek yeter → **§2.8**.
3. Gelen webhook'lar bu sürede R2 tamponundadır (U-15) — kayıp değil gecikme. Container ayağa kalkınca
   5 dk'lık tur boşaltır; aceleyse `POST /__yg/webhook-drain`.
4. 15 dk'da düzelmiyorsa: işletmelere "telefonla sipariş alın" duyurusu (docs/10 §6.3 #4) ve son sağlam
   commit'e geri dönüş (§3).

### 2.2 Yedek eskidi (U-25 `backup_stale`, U-28 `yedek_eskidi`; `lastBackupAgeSec` > 900)
> **Bu uç 503 DÖNMEZ.** `/health/worker` yine 200 verir, `degraded:true` + `warnings:["backup_stale"]` yazar. Sebep:
> dağıtımın duman testi bu uca 200 bekliyor ve kırmızısı `wrangler rollback` tetikliyordu — sağlam bir dağıtım yalnızca
> son yedek biraz eski diye geri alınıyordu (denetim 2026-10-05 bulgu A; docs/15 §10). Yani **tek haber yolu uyarı
> kanalıdır**: `ALERT_WEBHOOK_URL` tanımsızsa bu arıza yalnız günlükte görünür.
1. `curl -s /api/v1/health/worker` → `warnings`. Yaş **sayısı** için belirteç gerekir:
   `curl -s -H "x-health-metrics-token: …" …` → `lastBackupAgeSec`, `maxBackupAgeSec` (§1 tablosu).
   `lastBackupAgeSec` `null` ise **alarm değil**: ilk yedek turundan önce ya da durum dosyası yok. Alan
   **hiç yoksa** belirteç geçersiz ya da kurulu değildir — bu da alarm değildir: `warnings` zaten kararı söyler.
2. `wrangler tail` → şu satırları ara: `pg_dump başarısız` · `döküm doğrulanamadı (pg_restore --list)` ·
   `boş yedek gönderilmedi` · R2 PUT hatası.
   **Önce şuna bak:** `yedek zinciri DONDURULDU (yarım geri yükleme)` satırı varsa zincir **bilerek** kapalıdır, arızalı değil → **§2.8**; bu maddenin kalanı geçerli değildir.
3. R2 > `e3/db/son.dump` son değiştirilme zamanına bak. Birkaç dakikadan eskiyse zincir gerçekten kopmuştur.
4. Ayrımı yap: **yazamıyor** (R2 kotası/bağlama/ağ) mı, **üretemiyor** (`pg_dump` hatası = veritabanı hasta) mu?
   İkincisi daha ciddidir: SEV1 adayı, çünkü hem yedek hem canlı veri risk altında.
5. Kapatma: `warnings` boşalana (`/health/worker` `degraded:false`; belirteç varsa `lastBackupAgeSec` eşiğin altına iner) **ve** `wrangler tail`'de
   `veritabanı yedeği R2'ye yazıldı` satırı görülene kadar izle. Durum dosyasının kendisi (`lastResult`) kabuk
   olmadığı için okunamaz; gözlenebilir iki sinyal bunlardır. Eşiği geçici susturmak gerekiyorsa
   `HEALTH_MAX_BACKUP_AGE_SEC=0` (docs/15 §10) — **yalnız yanlış alarmda**, arızayı susturmak için değil.

### 2.3 Kuyruk takıldı (U-6, U-9; `/health/worker` 503)
1. `curl -s /api/v1/health/worker` → `jobLagSec` (eşik 300 sn), `stuckJobs` (10 dk'dan uzun `running`).
2. `/admin/isler` → `pending` / `running` / `failed` sayıları ve hangi tür biriktiği.
3. **Zehirli iş** (tek tür sürekli başarısız): kök nedeni düzelt, sonra yeniden dene. Sipariş akışını durduran
   türler öncelikli: `order.alarm_step`, `wa.*`, `push.send`.
4. **Worker ölmüş** (`stuckJobs` > 0, `jobLagSec` büyüyor): container'ı yeniden dağıtmak worker'ı da yeniler (§3).
   Tek container olduğundan "kopya sayısını artır" seçeneği **yoktur** (docs/10 §6.6 RB-4'teki o adım bu mimaride
   geçersizdir).
5. `jobLagSec` sıfıra inince ve `failed` artmayı bırakınca kapat.

### 2.4 WhatsApp sustu (U-2, U-3, U-4; U-11 üretilmediği için elle)
1. `/admin/whatsapp` → ortak numara kartı: "son webhook" ne kadar eski, sorun satırı var mı?
2. "Bağlantıyı test et" → `ready:true` ve durum `ONLINE` olmalı. `PENDING_VERIFICATION` = numara onaylı değil.
3. Gelen yön ölü mü: ortak webhook doğrulaması (docs/15 §11 "Webhook gelmiyor" madde 2 curl'ü).
4. Giden yön ölü mü: sohbet ekranında hata kodu; `131047` = 24 sa penceresi dışı (şablon gerekir).
5. R2 `e3/webhook-tampon/` dolu mu → sorun WhatsApp'ta değil **container'da** (§2.1).
6. Paralel kol (docs/10 §5.8): işletme WhatsApp'sız moda — telefon + vitrin siparişi. SMS yedeği **mock**'tur
   (docs/15 §13): SMS basamağı canlıda **göndermez**, buna güvenmeyin.
7. Kapatma: yeni bir gelen mesajın `/admin/whatsapp` "son webhook"unu tazelediğini gör.

### 2.5 Dağıtım kırmızı döndü
1. Actions > "Canlı ortam (Cloudflare)" > başarısız çalıştırma > iş özeti. Üç ayrı durum:
   - **Kapı (testler) kırmızı** → hiç dağıtılmadı, canlı el değmemiş. Düzelt, yeniden push et.
   - **`wrangler deploy` kırmızı** → Worker sürümü yüklenmemiş olabilir; iş akışı yine `wrangler rollback` dener.
   - **Duman testi kırmızı** → Worker canlıda değişmiş; otomatik geri alma çalışır (§3).
2. İş özetindeki geri alma bloğunu oku: `wrangler rollback` **başarılı** mı, **BAŞARISIZ** mı?
3. Başarısızsa (Durable Object sınıfı değişti, binding silindi) → §3'teki **tam geri alış**.
4. `curl -s /api/v1/health | jq .version` → canlıdaki sürüm hangi commit?
5. Kapatma: `/api/v1/health` 200 + beklenen `version` + `/api/v1/health/worker` 200. İş akışı özetinde `degraded` uyarısı varsa dağıtım sağlamdır, ayrı bir işletim sorunu vardır (§2.2 / §2.6).

### 2.6 Veritabanı doldu / bellek (U-26 `disk_low`, U-27 `memory_high`; uç 200 + `degraded`)
`/data` hem PostgreSQL verisini (`/data/pg`) hem görselleri (`/data/uploads`) tutar — `diskFreePct` ikisini birden ölçer.
1. Hangi eşik: `warnings` içinde `disk_low` → disk, `memory_high` → OOM'a yakın yığın. **Sayıları** görmek için
   belirteç gerekir (`x-health-metrics-token`, §1 tablosu): `diskFreePct` < 15 → disk, `memUsedPct` > 95 → bellek.
   Belirteç yoksa ölçüm yerine uyarı gövdesine bakın: `alert()` gövdesi (`data`) o anın sayılarını taşır.
2. **Disk:** container diski geçicidir; kalıcı dolma kaynağı görseller ve WAL'dır. Hızlı hamle yeniden dağıtımdır
   (temiz disk + R2'den geri yükleme), ama **yeniden açılış son yedekten sonraki ~2 dakikayı kaybettirir**.
3. **Bellek:** 1 GiB container'da üç sürecin yığın tavanı toplamı 704 MiB (docs/15 §10). Kalıcı çözüm
   `instance_type: standard-1` (maliyet artar) — hangi eşikte büyütülür: docs/15 §16.4.
4. Eşiği `0` ile kapatmak **alarmı** kapatır, sorunu kapatmaz.
5. Kapatma: `/api/v1/health/worker` `degraded:false` ve `warnings` boş (durum kodu bu eşiklerde zaten 200'dür).

### 2.7 Sertifika / alan adı sorunu
1. `curl -sI https://yemekgelsin.net/` → TLS hatası mı, 5xx mi, Cloudflare hata sayfası mı?
2. İlk dağıtımda Custom Domain'in DNS + sertifikası birkaç dakika sürer (duman testi 20 dk bekler).
3. `"Özel alan adı kurulamadı … izni eksik"` → API token'ında Zone > Workers Routes > Edit ve Zone > Zone > Read
   yok (docs/15 §13 kurulum madde 2). Ekle, yeniden çalıştır.
4. `@` / `www` için **elle eklenmiş** A/AAAA/CNAME kaydı Custom Domain'i engeller → DNS > Records'tan sil.
5. Son çare, yalnız SSE kopmaları Cloudflare'den geliyorsa: kök A kaydını geçici "Yalnız DNS" yapmak
   (docs/15 §11 "SSE kopuyor"); sonraki dağıtım proxy'yi geri açar.
6. Kapatma: `curl -sI` → 200 + güvenlik başlıkları (docs/15 §13 canlıya çıkış listesi).

### 2.8 Yarım geri yükleme: yedek zinciri donduruldu (U-23, U-24)
**Ne oldu:** container, R2'den geri yükleme sürerken zorla sonlandı (platform öldürdü, OOM, düğüm arızası). Veritabanı
**yarım** kaldı ve yerinde yeniden başlatmada diskte ayakta kaldı. `pg_restore`'dan önce yazılan kalıcı işaret
(`RESTORE_FLAG_FILE`, varsayılan `/data/geri-yukleme-suruyor`) sayesinde yeni açılış bunu tanıdı ve R2'ye yazmayı
**durdurdu**. Önceki davranışta yarım veritabanı "gerçek veri" sanılıyor ve **120 saniye içinde** R2'deki iyi
`son.dump` ile o günün `gun-<0–6>.dump` kopyası **sessizce** eziliyordu.

**Neden satır sayısına bakılmıyor:** yarım bir döküm de "gerçek veri" gibi görünür (işletme/sipariş tabloları dolmuş,
geri kalanı eksik), çok erken kesilmişse boş görünür. İki durumda da sayı yanlış cevabı verir.

1. **İlk kural: R2'ye DOKUNMA.** `e3/db/son.dump` ve `e3/db/gun-<0–6>.dump` şu an **sağlam** — dondurmanın tek amacı
   buydu. Dökümleri silmeyin, üzerine yazmayın, bu iş çözülmeden `DATA_EPOCH`'u **artırmayın**.
2. **Doğrula** (`npx wrangler tail siparisinonunde-dev`): açılışta bir kez `YARIM GERİ YÜKLEME …` satırı, ardından her
   2 dakikada `yedek zinciri DONDURULDU (yarım geri yükleme)`. Sağlık ucunda yedek yaşı büyür: `curl -s
   /api/v1/health/worker` 15 dk sonra `degraded:true` + `warnings:["backup_stale"]` yazar (**durum kodu 200 kalır**,
   uyarı U-25/U-28); yaşın **sayısını** görmek için belirteç gerekir (§1 tablosu).
   > **Sağlık ucunun sessiz kaldığı hal:** `/tmp` süpürülmüş bir açılışta `lastSuccessUnix` 0 kalır ve
   > `lastBackupAgeSec` **`null`** döner (`apps/api/src/routes/health.ts` `backupAgeSecFrom`) → `backup_stale` da U-28 de
   > üretilmez (`deploy/cloudflare/src/alert.ts` `yedekDurumunuOku`), uç 200 + `degraded:false` görünür. O halde tek haber yolu
   > bu bölümün 1. maddesindeki uyarı ve günlük satırlarıdır; donmuş zinciri sağlık ucuyla **arayarak bulamazsın**.
3. **Çöz: yeni container başlat.** İşaret container diskindedir, container diski ise geçicidir — GitHub > Actions >
   "Canlı ortam (Cloudflare)" > **Run workflow** (ya da herhangi bir push). Temiz diskte işaret yoktur; container
   R2'deki iyi dökümü baştan ve tek seferde geri yükler. **Container'a kabuk erişimi olmadığı için işaret elle
   silinemez; zaten silinmesi de istenmez.**
4. **Kapatma:** günlükte `son yedek geri yükleniyor` **var**, `YARIM GERİ YÜKLEME` **yok**; birkaç dakika içinde
   `veritabanı yedeği R2'ye yazıldı` satırı ve `/api/v1/health/worker` **200 + `degraded:false`**. Vitrinde bir dükkan açıp menü ve
   sipariş akışını gözle doğrula.
5. **Yeniden açılış da yarıda kalıyorsa** (`geri yükleme başarısız (pg_restore)` tekrarlıyor): döküm **bozuk** ya da
   container belleği yetmiyor. `gun-<0–6>.dump` kopyasıyla **§4**'ü (yeni `DATA_EPOCH`) uygula; bellekten
   şüpheleniyorsan `instance_type` yükseltmesini değerlendir (docs/15 §13).
6. **Kayıp:** yarım veritabanındaki değişiklikler R2'ye hiç gitmemişti. Kayıp = son **başarılı** yedekten sonraki süre
   (normalde ≤ 2 dk) — §4'teki kayıp tablosuyla aynı. U-24'te (işaret yazılamadı) geri yükleme başarılı olabilir ama
   zincir kapalıdır: **o açılıştan sonraki tüm yazmalar yedeksizdir**, yeniden dağıtımı geciktirme.
7. **SEV:** yarım/boş vitrin + yedeksiz çalışma → **SEV1** adayı (§5). Zincir donmuş olduğu sürece yeni veri
   korumasızdır.

---

## 3. Geri alma: komut ve sınırlar

| Katman | Nasıl geri alınır | Sınır |
|---|---|---|
| Worker sürümü | Otomatik: duman testi/dağıtım kırmızıysa iş akışı `npx wrangler rollback` çalıştırır | `rollback` **sürüm kimliği almaz** — "son sürümden öncekine" döner. `deploy` hiç sürüm yüklemeden patladıysa sağlam sürümü bir adım geriye almış olabilir; `npx wrangler versions list` ile doğrula |
| Container imajı | **`wrangler rollback` imajı geri ALMAZ.** Tam geri alış: Actions > "Canlı ortam (Cloudflare)" > Run workflow > `ref` = çalışan son commit SHA'sı | O sürümün testleri de kapıdan geçer; imaj yeniden derlenir ve rollout edilir. Süre: yeni bir dağıtımın tamamı |
| Veritabanı şeması | **Aşağı migration YOK.** Geri alınmaz; ileri düzeltme yazılır | Eski kod yeni şemayla çalışmıyorsa tek yol §4 (yedekten dönüş) |
| Veri | §4 (yeni `DATA_EPOCH`) | Son yedekten sonraki siparişler kaybolur |

- `ref` ile elle geri alma dağıtımında duman testi **o sürümü** arar (tetikleyen commit'i değil) — bu bilerek böyledir.
- Geri alma dağıtım kapısını atlamaz: testler yine koşar.

---

## 4. Yedekten geri yükleme provası (ve gerçek dönüş)

Yöntem **dönem (epoch) değiştirmektir**: çalışan container `son.dump`'ı 2 dakikada bir kendi yedeğiyle ezdiği için
üzerine yazmak yasaktır. Ayrıntı: docs/15 §13 "Yedekten geri dönüş".

**A — Prova (canlıya dokunmaz; ayda bir, tarihini ve süresini not et):**

| # | Adım | Komut / yer |
|---|---|---|
| 1 | Son dökümü indir | R2 > `siparisinonunde-dev-yedek` > `e3/db/son.dump` |
| 2 | Yerelde boş veritabanı aç | `createdb siparis_tatbikat` |
| 3 | Yükle | `pg_restore --no-owner -d siparis_tatbikat son.dump` |
| 4 | Doğrula | `psql -d siparis_tatbikat -c "select count(*) from tenants"` · aynısı `orders`, `users` için |
| 5 | Görselleri de dene | `e3/uploads/son.tar.gz` → `tar -tzf` (arşiv okunuyor mu) |
| 6 | Sil | `dropdb siparis_tatbikat` |
| 7 | **Ölçtüğün süreyi ve satır sayılarını not et** | Bu dosyanın altındaki tatbikat kaydı |

**Süre:** indirme + `pg_restore` pilot ölçeğinde (tek restoran, binlerce sipariş) **dakikalar** mertebesindedir; gerçek
sayı ilk provada ölçülür ve buraya yazılır. Tahmin yazmayın, **ölçüp yazın**.

**B — Gerçek dönüş (canlı veriyi değiştirir):**
1. İstenen kopyayı indir: `e3/db/son.dump` ya da `e3/db/gun-<0–6>.dump` (**0 = Pazar, UTC**).
2. Aynı kovaya **yeni dönem** olarak yükle: `e4/db/son.dump` ve `e4/uploads/son.tar.gz`.
3. `deploy/cloudflare/wrangler.jsonc` → `vars.DATA_EPOCH` = `"4"` → push.
4. Yeni container `e4`'ten açılır. Eski dönemin nesneleri R2'de kalır (geri dönüş yolu açık).
5. Doğrula: `/api/v1/health` 200 · `/api/v1/health/worker` 200 · `/admin/isletmeler` dolu ·
   `wrangler tail`'de `TAZE AÇILIŞ … yedek YOK` satırı **yok**.

**Süre (B yolu, koddan türetilen sınırlar):** 1–2. adımlar elle indirme/yükleme (döküm boyutuna bağlı) · 3. adım
bir tam dağıtım turudur ve duman testi yeni sürümü **en çok 20 dk** bekler · container açılışta yedeği çekemezse
6 deneme yapar ve her denemeden sonra bekler (5+10+15+20+25+30 sn ≈ **105 sn**, `entrypoint.sh` `fetch_backup_retry`); yedek hiç yoksa "taze açılış"a düşer, ulaşılamıyorsa container yeniden başlar. Yani push'tan sonra
**20 dakikadan uzun** sürüyorsa bir şey ters gitmiştir: `wrangler tail`'e bakın (§2.1).

**Neyi kaybedersin:**

| Kayıp | Büyüklük |
|---|---|
| Son başarılı yedekten sonraki yazmalar | Normalde ≤ **2 dk** (yedek turu); düzgün kapanışta **0** |
| Yedek zinciri kopmuşsa | `lastBackupAgeSec` kadar — bu yüzden §2.2 bekletilmez |
| `gun-<n>.dump`'a dönersen | O güne kadarki her şey (en çok 7 gün) |
| PITR (saniye hassasiyetinde dönüş) | **YOK** — denetim FAZ 4.2, docs/15 §8 |

> **Tuzak:** `DATA_EPOCH`'u **yedek koymadan** artırmak tüm canlı veriyi boş veritabanıyla değiştirir. Container bu
> durumda R2'ye yazmayı kapatır ve `TAZE AÇILIŞ … yedek YOK` yazar (veri ezilmez) — **ama bir işletme kaydolduğu an
> yazma açılır**. O yüzden yanlış dönem fark edilince hemen geri dönün.

---

## 5. SEV sınıflandırması ve kim aranır (gerçek hâli)

docs/10 §6.1'deki SEV1–SEV4 tanımları geçerlidir; §5.9'daki **nöbet rotasyonu bugün yoktur**. Ekip = **Eray, tek kişi**.
Hayali nöbet ekibi, ikincil nöbetçi ve "IC ile teknik müdahale ayrı kişiler" kuralı bu kadroyla uygulanamaz.

| SEV | Bugünkü karşılığı | Kim, ne zaman |
|---|---|---|
| **SEV1** | Sipariş alma durdu (U-16, U-13 sürekli, U-4 ortak numara, §2.1, §2.2 "üretemiyor" dalı); veri kaybı/ihlali | Eray hemen. Önce **sınırla** (işletmeye "telefonla sipariş alın"), sonra tanı |
| **SEV2** | Sipariş akıyor ama zincir kör (U-8, U-9, §2.3) ya da WhatsApp yönlerinden biri ölü (§2.4) | Eray, aynı gün; yoğun saatteyse hemen |
| **SEV3** | Tek halka bozuk, geçici çözümü var (U-10 görsel yükleme, U-7 gözcü onardı, tek U-5) | Sıradaki çalışma penceresi |
| **SEV4** | Müşteri etkisi yok (tek U-15 dağıtım penceresinde, U-14 açılış sırasında) | Kayıt yeter, müdahale gerekmez |

**Tek kişilik gerçekler:**
- "5 dk'da onayla, 10. dk'da ikincil, 20. dk'da tüm ekip" **yoktur**. Tek sıra: uyarı → Eray → müdahale.
- İkinci kişi olmadığından **iletişim ile müdahale aynı kişidedir**: sınırlama (işletmeye haber) **tanıdan önce**
  gelir; 20 dakikalık bir teşhis sırasında işletme kör kalmasın.
- **Uyarıyı gören kişi = düzeltebilen kişi olmayabilir:** dükkan tarafı arızalarında (sağlayıcı oturumu, Meta
  kısıtlaması) tek yol işletmeyi aramaktır.
- Postmortem (docs/10 §6.5) SEV1/SEV2'de yine zorunludur — tek kişilik ekipte **tek koruma yazılı kayıttır**.
- `ALERT_WEBHOOK_URL` tanımlı değilken yukarıdaki tablonun **hiçbir satırı tetiklenmez**: ilk kurulum adımı budur.

---

## 6. Atıflar ve bu turda düzeltilenler

**Nereye bakılır:**

| Konu | Yer |
|---|---|
| SEV tanımları, postmortem şablonu, iletişim/duyuru metinleri, Meta eskalasyonu | [10](10-riskler-operasyon-ve-metrikler.md) §5.8, §6.1, §6.3, §6.5 |
| SLO/SLI, "kaçan sipariş" tanımı, hata bütçesi | [10](10-riskler-operasyon-ve-metrikler.md) §7 |
| Ortam değişkenleri, izleme komutları, eşikler, sorun giderme | [15](15-kurulum-ve-isletim.md) §4, §10, §11 |
| Yedek zinciri, dönem (epoch), dağıtım, canlıya çıkış listesi | [15](15-kurulum-ve-isletim.md) §8, §13 |
| Uyarı kodu | `apps/api/src/lib/alert.ts` · `deploy/cloudflare/src/alert.ts` |

**docs/10'da düzeltilenler (bu turda):** §6 başına "nöbetteyken docs/17'yi aç" notu · §5.9 nöbet rotasyonu → tek kişi
gerçeği (bu dosya §5) · §6.2 "en az iki kişi" ve `incidents`/`incident_tenants`/`data_breach_incidents` (tablolar
**yok**, [Faz 2]) · §6.6 başına gerçeklik tablosu: `infra/runbooks/` (yok) → docs/17, `/ready` (yok) →
`/api/v1/health`, Redis/Valkey (yok; kuyruk PostgreSQL `jobs` tablosu), "iki ayrı ingress sunucusu" +
`ingress_spool_pending` (yok; tampon R2'de), "kopya sayısını artır" (`max_instances: 1`), PITR/standby (yok) ·
RB-1/RB-3/RB-4/RB-10/RB-11'e bugünkü karşılığının bağlantısı · RB-11'e "SMS sağlayıcısı hiç bağlı değil" notu ·
§7.3'e canary'nin kapalı olduğu notu.

**docs/15'te düzeltilenler:** giriş bloğuna "bozulduysa docs/17'yi aç" satırı · §8 ve §10'daki yedek durum dosyası
sözleşmesi (`BACKUP_STATUS_FILE` + `{"ts":…}` → **`BACKUP_STATE_FILE`** + `lastSuccessUnix`; tek kaynak §13) ·
§10 başına "hangi satır hangi ortamda" notu (`docker compose`/`psql` canlıda **çalışmaz**) · §10'a uyarı kanalı
satırı · §10'daki "nöbetçinin telefonu çalar" → tek kişi · §13 canlıya çıkış listesindeki okunamayan
`/tmp/yedek-durum.json` kontrolü → `lastBackupAgeSec` + günlük satırı · **§4 ortam değişkeni tablosu** (bağımsız inceleme): `BACKUP_STATUS_FILE` + `{"ts":…}` satırı §8/§10 ile çelişmeye devam ediyordu → `BACKUP_STATE_FILE` + `lastSuccessUnix`; `ALERT_WEBHOOK_URL` satırındaki eksik uyarı türü listesi kopya olmaktan çıkarıldı (tek kaynak bu dosyanın §1'i).

**Bağımsız incelemede ayrıca düzeltilenler (bu dosya):** §1.1'e canlıda üretilen ama runbook'suz kalmış dört tür eklendi (U-19…U-22) · U-12'deki "`/admin/bayraklar` → `canary` bayrağı da açık olmalı" yanlıştı (bayrak varsayılan AÇIK ve o ekranda görünmüyor) · U-9'un satır atfı 212 → 215 · §4'teki açılış yeniden deneme süresi ≈75 sn → ≈105 sn (son bekleme de sayılır).

**Dört mercekli son denetimde eklenenler (bu dosya):** §1 giriş bloğuna üçüncü uyarı gövdesi (container açılışı) · yeni **§1.3** container açılış uyarıları (U-23 `yarim_geri_yukleme`, U-24 `geri_yukleme_izi_yazilamadi`) · yeni **§2.8** yarım geri yükleme senaryosu · §2.1'in tipik sebep listesine `YARIM GERİ YÜKLEME` satırı · §2.2'ye "donmuş zincir arıza değildir" ayrımı. Kaynak: `deploy/cloudflare/entrypoint.sh` dördüncü kapı; işletim tarafı [15](15-kurulum-ve-isletim.md) §13 "Yarım geri yükleme".

**Bağımsız doğrulamada düzeltilenler (bu dosya):** U-23 satırındaki "seed denenmedi" yanlıştı — `entrypoint.sh` donmuş açılışta geri yüklemeyi atlar ama **migration ve seed'i çalıştırır** · §2.8 adım 2'ye "sağlık ucunun sessiz kaldığı hal" notu: `/tmp` süpürülmüş açılışta `lastBackupAgeSec` `null` olduğu için `backup_stale` ve U-28 **hiç üretilmez** (`health.ts` `backupAgeSecFrom`, `alert.ts` `yedekDurumunuOku`), dolayısıyla donmuş zincir sağlık ucundan aranarak bulunamaz.

**Sağlık ucu gizliliği turunda değişenler (5 Eki 2026, denetim bulgu A-2 · bu dosya):** §1 teşhis tablosuna
"ayrıntılı ölçüm" satırı · U-25/U-26/U-27/U-28 ve U-23/U-24'ün "nasıl bakılır" hücreleri: `lastBackupAgeSec`,
`diskFreePct`, `memUsedPct` artık **belirteçsiz yanıtta yok** (`x-health-metrics-token`), karar `warnings`'ten
okunur ve uyarının `data` gövdesi o anın sayılarını taşır · §2.2 adım 1 ve 5, §2.6 adım 1 aynı ayrımla yeniden
yazıldı · §2.8 adım 2 · kırılgan satır atıfları (`health.ts:163`, `alert.ts:117`) işlev adlarına çevrildi.
Belirteç **kurulu değilse** (bugünkü varsayılan) ayrıntılar hiç kimseye görünmez, uç 200 döner ve uyarı yolu
çalışmaya devam eder: kurulum ve gerekçe [15](15-kurulum-ve-isletim.md) §10 "Ayrıntılı ölçümler".

**Hâlâ eksik (kod işi, bu dosyanın sahipliği dışında — DIŞ BAĞIMLILIK):**
1. `detectSharedNumberSilence` (`apps/api/src/services/messaging/shared-health.ts:100`) hiçbir cron'a bağlı değil →
   U-11 üretilmiyor. `registerCron({ name: 'shared_wa_silence', … })` gerekiyor.
2. `CANARY_ENABLED` / `CANARY_STALE_ALERT` hiçbir dağıtım yapılandırmasında yok → U-12 üretilmiyor, docs/10 §7.3
   canary doğrulaması yapılamıyor.
3. Worker uyarılarında soğuma **yalnız U-28'de** var (1 saat, damga Durable Object deposunda). U-13…U-18'de
   soğuma yok: düzelmeyen arıza 5 dk'da bir uyarır (bilinçli; kanal köprüsünde susturulabilir).
4. §1 tablosunun koda bağlı kalmasını garantileyen test yok **ve sapma bu turda zaten oldu**: `sse_connection_limit`, `waba_conversation_quota`, `waba_messaging_limit`, `waba_quality_rating` türleri aynı turda canlı koda girdi, §1.1'e elle eklendi (U-19…U-22). Öneri: `alert.ts` çağrı yerlerindeki `kind` sabitlerini
   ve `UyariOlayi` birleşimini tarayıp bu dosyadaki `U-*` satırlarıyla karşılaştıran bir test (yeni uyarı türü
   eklenince runbook'suz kalmasın). Dosya `apps/api/test/` altında olacağı için bu turda yazılmadı.
5. README.md ve docs/00 doküman dizinine `17` eklenmedi (o dosyalar bu turda başka sahiplerde).
6. **Asılmış worker DÖNGÜSÜ kör noktadır** (bağımsız doğrulama, 2026-10-05): süreç ölürse `entrypoint.sh`
   `wait -n` container'ı düşürür ve hâl U-13/U-14'e düşer; ama döngü **asılırsa** süreç yaşar, `/health`
   **200** kalır (uyarı yok) ve arızayı yalnız `/health/worker` **503**'ü (`jobLagSec` > 300 / `stuckJobs`)
   gösterir. Worker'ın yedek gözcüsü bu ucu 5 dk'da bir okur ama **durum kodunu bilerek yok sayar**
   (`deploy/cloudflare/src/index.ts` yedek gözcüsü bloğu): yalnız `backup_stale` arar. Yani bugün bu arızanın
   tek haber yolu **E-2 dış izlemedir**. Kapatmak için ya E-2 kurulur ya o blokta `res.ok` kontrolü +
   yeni bir `UyariOlayi` eklenir (`src/alert.ts` başka sahipte; bu tur kapsamı yalnız bulgu A/B olduğu için
   yeni uyarı türü EKLENMEDİ).

**Eray'ın yapacağı adımlar (dış hesap/abonelik gerekir; kod ve yapılandırma hazır):**

| # | Ne | Neden | Nasıl |
|---|---|---|---|
| E-1 | `ALERT_WEBHOOK_URL`'e bir **alıcı kanal** bağla (Telegram bot ucu, Slack/Discord webhook'u, Better Stack…) | Bu dosyanın §1 tablosunun tamamı buna bağlı: kanal yoksa **hiçbir uyarı sana ulaşmaz** | `npx wrangler secret put ALERT_WEBHOOK_URL` (docs/15 §13 madde 5) |
| E-2 | **Dış izleme** aç: `/api/v1/health` + `/api/v1/health/worker`, 1 dk, 3 ardışık hatada telefon | 503 üreten koşulların (veritabanı, kuyruk) haber yolu budur; ayrıca container'ı uyanık tutar. **Yedek/disk/bellek eşiği 200 döner**: onlar için `"degraded":true` arayan ikinci bir "Keyword" monitörü gerekir ya da `ALERT_WEBHOOK_URL` (U-25…U-28) | Uptime Kuma / Better Stack / benzeri; docs/15 §10 "Dış izleme" |
| E-3 | `WEBHOOK_DRAIN_SECRET` yaz | Tamponu elle boşaltma ucu (U-15/U-17 kapanışı) olmadan 404 döner | `npx wrangler secret put WEBHOOK_DRAIN_SECRET` |
| E-4 | **Netgsm** hesabı + gönderici başlığı | Alarm zincirinin 5. dakika SMS basamağı ve WhatsApp'sız mod OTP'si canlıda **mock**, yani çalışmıyor (denetim FAZ 4.4; docs/15 §7) | Hesap aç → `SMS_PROVIDER=netgsm` + `NETGSM_*` secret'ları |
| E-5 | **PITR** kararı (WAL arşivi ya da yönetilen Postgres) | Bugün kayıp penceresi ~2 dk; saniye hassasiyetinde dönüş yok (denetim FAZ 4.2) | Abonelik kararı; sonra §4 bu dosyada güncellenir |
| E-6 | **E-posta kanalı** + SPF/DKIM/DMARC | Uyarı kanalı tek yollu: webhook köprüsü düşerse yedek bildirim yolu yok (denetim FAZ 4.8) | Alan adı doğrulaması + sağlayıcı |
| E-7 | **Aylık geri yükleme provası**nı takvime koy | §4'teki süre ve kayıp satırları ancak ölçülünce gerçek olur | Takvim hatırlatıcısı; sonucu §6 tatbikat kaydına yaz |

**Tatbikat kaydı** (her geri yükleme provası buraya bir satır):

| Tarih | Tür | Döküm | Süre | Satır sayıları | Sonuç |
|---|---|---|---|---|---|
| — | — | — | — | — | *(ilk prova yapılmadı)* |
