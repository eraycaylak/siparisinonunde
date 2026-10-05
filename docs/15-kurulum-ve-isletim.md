# 15 — Kurulum ve İşletim Rehberi (geliştirici / operatör)

> **Kime:** Sunucuyu kuran, güncelleyen ve nöbet tutan kişi (00 §12a: sistemi Claude yazar ve bakımını yapar, proje sahibi ürün/saha tarafını yürütür). Esnafa dönük değildir.
> **Bir şey bozulduysa bu dosyayı değil [17 — Olay Müdahale Runbook'u](17-olay-mudahale-runbook.md)'nu aç:** uyarı türleri ve ilk 5 dakika (§1), sık senaryolar (§2), geri alma (§3), yedekten dönüş provası (§4). Bu dosya kurulum ve referanstır, olay anı için fazla uzundur.
> **Bağlayıcı kaynaklar:** [00](00-kararlar-ve-sozluk.md) §10, §12a · [14](14-uygulama-sartnamesi.md) §1, §3, §11 · [08](08-mevzuat-kvkk-odeme-fatura.md) §9 · [13](13-varsayim-ve-teyit-kaydi.md) §2.
> **Dağıtım dosyaları:** canlı ortam `deploy/cloudflare/` (Worker + container + R2) ve `.github/workflows/deploy-dev-cloudflare.yml` (§13); isteğe bağlı VPS yolu `docker-compose.yml`, `Caddyfile`, `docker/*.Dockerfile`, `docker/env.production.example`, `scripts/*`, `.github/workflows/deploy-production.yml` ve `scripts/vps/*` (§14).
> **Canlı ortam (00 §12a madde 10, 27.09.2026):** tamamen **Cloudflare**'de (Worker + tek container + R2; §13), gerçek verilerle, demo verisi yok; kurulum ve güncelleme GitHub Actions ile ("Canlı ortam (Cloudflare)"). Kişisel veri yurt dışındadır: KVKK m.9 standart sözleşmesi + Kurum bildirimi (08 §2.11–§2.12). Türkiye VPS'i yalnız isteğe bağlı alternatiftir ve planlanmıyor (§14); §1–§12'deki Docker Compose / VPS ayrıntıları o yolun ve elle kurulumun başvurusudur.
> "(teyit edilmeli)" ile işaretli her madde üçüncü taraf davranışıdır; canlıya çıkmadan önce sağlayıcının güncel belgesinden ya da denemeyle doğrulanır ve [13](13-varsayim-ve-teyit-kaydi.md)'e işlenir.

## İçindekiler

1. [Mimari özet](#1-mimari-özet)
2. [Gereksinimler](#2-gereksinimler)
3. [Alan adı ve DNS](#3-alan-adı-ve-dns)
4. [Ortam değişkenleri (.env)](#4-ortam-değişkenleri-env)
5. [İlk kurulum](#5-ilk-kurulum)
6. [WhatsApp bağlama: ortak numara (varsayılan) ve kendi numarası](#6-whatsapp-bağlama-ortak-numara-varsayılan-ve-kendi-numarası)
7. [SMS (Netgsm)](#7-sms-netgsm)
8. [Yedekleme ve geri yükleme](#8-yedekleme-ve-geri-yükleme)
9. [Güncelleme](#9-güncelleme)
10. [İzleme](#10-izleme)
11. [Sorun giderme](#11-sorun-giderme)
12. [Canlıya çıkış kontrol listesi](#12-canlıya-çıkış-kontrol-listesi)
13. [Canlı ortam: Cloudflare (Worker + container + R2)](#13-canlı-ortam-cloudflare-worker--container--r2)
14. [İsteğe bağlı: Türkiye VPS'i GitHub Actions ile (planlanmıyor)](#14-isteğe-bağlı-türkiye-vpsi-github-actions-ile-planlanmıyor)
15. [Kalite kapıları: lint, kapsam, erişilebilirlik](#15-kalite-kapıları-lint-kapsam-erişilebilirlik)
16. [Kapasite ve sınırlar](#16-kapasite-ve-sınırlar)

---

## 1. Mimari özet

**Canlı ortam Cloudflare'dedir (§13; 00 §12a madde 10):** tek container içinde PostgreSQL + API + worker + web, önünde Worker, yedekler R2'de. Bu bölümün geri kalanı isteğe bağlı VPS yolunun (§14) ve elle kurulumun düzenidir: tek VPS üzerinde Docker Compose (00 §12a madde 6), önünde yalnız DNS ve proxy olarak Cloudflare (turuncu bulut).

| Servis | İmaj | Görev | Dışarı açık |
|---|---|---|---|
| `caddy` | `docker/caddy.Dockerfile` (Caddy 2 + Cloudflare DNS modülü) | TLS (Let's Encrypt), ters vekil | 80, 443 (TCP+UDP) |
| `web` | `docker/web.Dockerfile` (Next.js 16, standalone) | Pazarlama sitesi, storefront, panel, admin, kurye | Hayır |
| `api` | `docker/api.Dockerfile` (Fastify 5, tsx) | REST `/api/v1`, SSE, WhatsApp webhook, görseller (`/api/v1/uploads`) | Hayır |
| `worker` | aynı API imajı, `src/worker.ts` | `jobs` kuyruğu: WhatsApp gönderimi, alarm zinciri, Web Push, SMS, cron (panel çevrimdışı dedektörü, saklama/imha dahil) | Hayır |
| `migrate` | aynı API imajı, tek seferlik | `packages/db/migrations/*.sql` (ad sırasıyla) | Hayır |
| `postgres` | `postgres:16` | Tek veritabanı (Redis yok; kuyruk + `LISTEN/NOTIFY`) | Hayır |

İstek yönlendirmesi (`Caddyfile`):

- `DOMAIN`, `panel.DOMAIN`, `admin.DOMAIN` → `/api/*` doğrudan `api:4000` (SSE için `flush_interval -1`, sıkıştırmasız); geri kalan her şey `web:3000`. `panel.` ve `admin.` kökü web'deki `proxy.ts` ile `/panel` ve `/admin`'e yazılır; bugün her şey tek alan adında yol tabanlı da çalışır (`DOMAIN/panel`, `DOMAIN/admin`).
- `{slug}.DOMAIN` (wildcard) → web; `proxy.ts` isteği `/s/{slug}` vitrinine yazar (`/t/`, `/api/`, `/_next/` olduğu gibi geçer).
- `www.DOMAIN` → `DOMAIN`'e kalıcı yönlendirme. `hooks.DOMAIN/wa/<token>` → `api /api/v1/webhooks/wa/<token>` (00 §2; isteğe bağlı).

Kalıcı veriler adlandırılmış Docker birimlerindedir: `pgdata` (veritabanı), `uploads` (menü görselleri), `caddy_data` (sertifikalar), `caddy_logs` (HTTP erişim logları, 1 yıl). Yedekleri `scripts/backup.sh` yazar: otomatik kurulumda (§14) `/opt/yemekgelsin/backups` (root, izin `700`), elle kurulumda `./backups` (`siparis` kullanıcısına ait, izin `700`); bu klasör hiçbir konteynere bağlanmaz.

## 2. Gereksinimler

| Kalem | Başlangıç (pilot, ≤ 50 işletme) | Not |
|---|---|---|
| Sunucu | *(yalnız isteğe bağlı VPS yolu; canlı ortam Cloudflare'de, §13)* **Türkiye'de** VPS, 2 vCPU / 4 GB RAM / 80 GB SSD, IPv4 | VPS yolu seçilirse kişisel veri Türkiye'de kalır (08 §2.12). Aday sağlayıcılar: Turkcell Bulut, Türk Telekom, Huawei Cloud İstanbul, Radore, Bulutistan (V-009 teklifleri). ISO 27001 ve DPA belgesi alınır. |
| İşletim sistemi | Ubuntu 24.04 LTS | Otomatik kurulum sunucu saat dilimini Europe/Istanbul yapar (yedek cron'u 03:30 İstanbul). Konteynerler UTC'dir; uygulama İstanbul saatini kendisi hesaplar. |
| Docker | Docker Engine 27+ ve Compose v2.24+ (BuildKit açık) | `docker compose version` |
| Disk | Veritabanı + 14 günlük yedek + görseller için en az 40 GB boş | Yedekler ayrıca ikinci bir Türkiye lokasyonuna kopyalanır (§8). |
| Ağ | Gelen: 22 (otomatik kurulum parola ile bağlanır, fail2ban korur; sonra anahtara geçiş önerilir), 80, 443. Giden: Let's Encrypt, Cloudflare API, Meta Graph API (`graph.facebook.com`) ya da 360dialog, Netgsm, Web Push servisleri (`fcm.googleapis.com`, `web.push.apple.com`, `*.push.services.mozilla.com`) | 80 portu HTTP-01 doğrulaması ve HTTPS yönlendirmesi için açık kalmalı. |
| Hesaplar | Cloudflare (DNS), WhatsApp ortak numarası için 360dialog (varsayılan; Meta Business portföyü kayıt sihirbazında açılır) ya da Meta Business + geliştirici uygulaması, Netgsm, ACME e-postası | §3, §6, §7 |

Ölçeklenme notu: sipariş hacmi büyüdüğünde önce `postgres` ayrı sunucuya taşınır (00 §10: tek sunucu → app + pg primary + pg standby). "Sipariş kaçmaz" paketi için ikinci ucuz VPS'te webhook alımı ve dış izleme pilot öncesi zorunludur (00 §11).

Sunucu hazırlığı (bir kez). Otomatik kurulumda bunları ve fazlasını (fail2ban, Docker log döndürme, saat dilimi) `scripts/vps/bootstrap.sh` yapar (§14); elle kurulum için:

```bash
adduser --disabled-password siparis && usermod -aG sudo,docker siparis    # docker grubu kurulumdan sonra
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
apt-get install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
curl -fsSL https://get.docker.com | sh                                     # Docker Engine + compose eklentisi
```

## 3. Alan adı ve DNS

Alan adı `yemekgelsin.net` Cloudflare'de (Registrar + DNS) yönetilir (00 §10: Faz 1 wildcard alt alan adı; 00 §12a madde 9). Kayıtlar (`203.0.113.10` yerine sunucu IP'si):

> **Bugünkü durum (27.09.2026, kalıcı):** `yemekgelsin.net` ve `www.yemekgelsin.net` canlı ortamın Worker'ına **Custom Domain** olarak bağlıdır (§13; 00 §12a madde 10); aşağıdaki A kayıtları **kullanılmaz**, yalnız isteğe bağlı VPS yolu içindir. O yol seçilirse **geçiş otomatiktir:** VPS iş akışı (§14) VPS'te sağlık denetimi geçince Worker'ın Custom Domain'lerini kaldırır ve aşağıdaki A kayıtlarını proxy'li (turuncu bulut) olarak yazar (`scripts/vps/cloudflare-dns.mjs`; SSL/TLS modu "Flexible" ise önce "Full (strict)" yapar). Elle yapmak gerekirse: Workers & Pages > `siparisinonunde-dev` > Settings > Domains & Routes'tan alan adlarını silin, sonra kayıtları ekleyin. Cloudflare ortamı ayrı bir alt alan adına (ör. `demo.yemekgelsin.net`) taşınacaksa: `wrangler.jsonc`'de `routes` yalnız `{ "pattern": "demo.yemekgelsin.net", "custom_domain": true }` olur (kök ve `www` satırları çıkar), `vars.APP_BASE_URL` ve `image_vars.NEXT_PUBLIC_SITE_URL` bu adrese çevrilir, iş akışındaki `SITE_URL` `https://demo.yemekgelsin.net` yapılır. İş akışındaki `ZONE` `yemekgelsin.net` olarak kalır (token izinleri bu bölge içindir); `www` → kök denetimi `SITE_URL` alt alan adındayken kendiliğinden atlanır.

| Tür | Ad | Değer | Proxy |
|---|---|---|---|
| A | `@` (yemekgelsin.net) | 203.0.113.10 | Proxy'li (turuncu bulut) |
| A | `*` (tüm vitrinler: `{slug}.yemekgelsin.net`) | 203.0.113.10 | Proxy'li |
| A | `www`, `hooks` | 203.0.113.10 | Proxy'li (`panel`, `admin` wildcard'la kapsanır) |
| CAA | `@` | `0 issue "letsencrypt.org"` ve `0 issuewild "letsencrypt.org"` (isteğe bağlı) | — |

İş akışı yalnız bu A kayıtlarını yönetir; aynı adlardaki CNAME/AAAA kayıtlarını siler (Cloudflare proxy'si kaynağa IPv4 ile bağlanır), TXT/MX/CAA gibi diğer kayıtlara dokunmaz.

- **Sertifikaların hepsi DNS-01 ile** alınır (`Caddyfile` global `acme_dns cloudflare`): wildcard bunu zaten ister; kök ve alt alan adları da böylece DNS henüz VPS'i göstermeden (geçişten önce) ve Cloudflare proxy'si arkasında alınır. Caddy imajı Cloudflare DNS modülüyle derlenir (`docker/caddy.Dockerfile`) ve `.env`'de `CLOUDFLARE_API_TOKEN` **zorunludur**. Belirteç: Cloudflare > My Profile > API Tokens > "Edit zone DNS" şablonu, yalnız bu bölge (Zone > DNS > Edit + Zone > Zone > Read). İş akışı sunucuya ayrı, yalnız DNS yetkili bir token vermek için `CADDY_CLOUDFLARE_API_TOKEN` secret'ını kabul eder (§14).
- **Proxy (turuncu bulut) açıktır** (00 §12a madde 10). SSL/TLS modu **Full (strict)** olmalıdır ("Flexible" Caddy'nin HTTPS yönlendirmesiyle sonsuz döngü yapar; iş akışı düzeltir ya da izin yoksa DNS'e dokunmadan durur). `Caddyfile` yalnız Cloudflare IP aralıklarından gelen `X-Forwarded-For`'a güvenir (`trusted_proxies` + `trusted_proxies_strict`) ve API'ye gerçek istemci IP'sini tek başına iletir (`header_up X-Forwarded-For {client_ip}`): hız sınırları ve erişim logu (5651) istemciyi görür, istemcinin kendi yazdığı başlık yok sayılır. Cloudflare IP listesi değişirse `Caddyfile`'da güncellenir. SSE: Cloudflare'in 100 sn boşta kalma sınırını 15 sn'lik ping aşar ve `cache-control: no-cache, no-transform` sıkıştırma/tamponlamayı engeller (canlı ortamda panelle doğrulanmalı — teyit edilmeli).
- **Ayrılmış alt alan adları** vitrin olamaz: `www, api, app, panel, admin, kurye, dev, static, assets, uploads, mail, smtp, help, destek, blog, hooks, status, docs, demo, test, bayi, yardim, siparisinonunde, yemekgelsin, yemek-gelsin` (`packages/core/src/slug.ts`).
- DNS yayıldıktan sonra doğrulama: `dig +short bozok-pide.yemekgelsin.net` sunucu IP'sini döndürmeli.

## 4. Ortam değişkenleri (.env)

Şablon: `docker/env.production.example` → sunucuda depo kökünde `.env` (git'e girmez, izin `chmod 600 .env`). **Otomatik kurulumda (§14) `.env`'i iş akışı yazar** (`scripts/vps/env-merge.mjs`): gizli anahtarlar ilk dağıtımda üretilir ve sonsuza dek korunur, sağlayıcı değerleri her dağıtımda GitHub secret'larından yeniden yazılır; elle düzenlemeyin (bilinmeyen anahtarlar korunur). Compose bu dosyayı hem değişken yerleştirmede (`${DOMAIN}` vb.) hem de `api/worker/migrate` konteynerlerine `env_file` olarak kullanır. Uygulamanın okuduğu değişkenler 14 §3 ile aynıdır; aşağıda üretimdeki anlamları:

| Değişken | Zorunlu | Açıklama | Üretme / örnek |
|---|---|---|---|
| `DOMAIN` | evet | Kök alan adı; `APP_BASE_URL=https://${DOMAIN}` ve web derleme argümanları bundan kurulur | `yemekgelsin.net` |
| `ACME_EMAIL` | evet | Let's Encrypt bildirim e-postası | `destek@yemekgelsin.net` |
| `CLOUDFLARE_API_TOKEN` | evet | Tüm sertifikalar DNS-01 ile (Caddy `acme_dns`); compose boşsa açılmaz | §3 |
| `POSTGRES_USER`, `POSTGRES_DB` | hayır | Varsayılan `siparis` / `siparis` | — |
| `POSTGRES_PASSWORD` | evet | Veritabanı parolası; URL'ye girdiği için yalnız harf/rakam | `openssl rand -hex 24` |
| `DATABASE_URL` | (compose kurar) | `postgres://USER:PASS@postgres:5432/DB`; `.env`'e yazmayın | — |
| `APP_BASE_URL` | (compose kurar) | Linkler, takip sayfası, webhook adresi | `https://yemekgelsin.net` |
| `SESSION_SECRET` | evet | Oturum/çerez imzaları (storefront müşteri çerezi HMAC). Değişirse "Son siparişin" çerezleri geçersizleşir | `openssl rand -base64 48` |
| `TRACKING_SECRET` | evet | Takip linki HMAC'i (14 §7.4). **Değişirse tüm takip linkleri kırılır** | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | evet | WhatsApp/SMS API anahtarlarını şifreler (AES-256-GCM, 32 bayt base64). **Kaybolursa kayıtlı anahtarlar çözülemez**, parola yöneticisinde ve ayrı bir yerde saklayın | `openssl rand -base64 32` |
| `WA_DEFAULT_PROVIDER` | hayır | Yeni hesap varsayılanı: `mock` \| `cloud` \| `d360` (işletme hesabı panelde seçilir) | `d360` |
| `WA_APP_SECRET` | cloud için | Meta Cloud API webhook imzası (`X-Hub-Signature-256`). `PLATFORM_WA_PROVIDER=cloud` iken **zorunlu** (ortak numara webhook'u imzasız olay kabul etmez; boşsa API açılmaz). 360dialog hesaplarında imza denetlenmez (teyit edilmeli) | Meta uygulama gizli anahtarı |
| `WA_VERIFY_TOKEN` | cloud için | Webhook GET doğrulaması (`hub.verify_token`; Meta doğrudan yolda Meta uygulamasının Webhook ayarına da girilir, §6.2c madde 12; üretimde her sağlayıcıda boş/varsayılan olamaz) | `openssl rand -hex 16` |
| `PLATFORM_WA_PROVIDER` | evet | Platform numarasının (= **ortak numara**, 00 §12a madde 8) sağlayıcısı: `d360` (360dialog, varsayılan yol, §6.2) \| `cloud` (Meta Cloud API doğrudan, §6.2b) \| `mock`. İşletmelerin müşteri mesajları ve işletme sahibine giden uyarılar (00 §10 alarm t=2 dk) bu numaradan gider | `d360` (ya da `cloud`) |
| `PLATFORM_WA_API_KEY` | d360/cloud için | Platform numarasının API anahtarı: 360dialog'da numaranın API anahtarı (§6.2 A.4), Cloud API'de kalıcı System User token'ı (§6.2c madde 9) | Meta ya da 360dialog |
| `PLATFORM_WA_PHONE_NUMBER_ID` | cloud için | Platform numarasının Graph `phone_number_id`'si (d360'ta boş) | — |
| `PLATFORM_WA_DISPLAY_PHONE` | d360/cloud için | **Ortak numara** (00 §12a madde 8): platform numarasının E.164 gösterimi; işletme QR'ları, wa.me bağlantıları ve Akış B bunu kullanır. Açılışta işletmelerin ortak numara satırlarına yazılır | `+908501234567` |
| `PLATFORM_WA_WEBHOOK_TOKEN` | d360/cloud için | Ortak numara webhook adresindeki gizli belirteç (`/api/v1/webhooks/wa/shared/<belirteç>`); en az 16 karakter | `openssl rand -hex 24` |
| `SMS_PROVIDER` | evet | `mock` \| `netgsm` | `netgsm` |
| `NETGSM_USERCODE`, `NETGSM_PASSWORD`, `NETGSM_HEADER` | netgsm için | §7 | — |
| `UPLOAD_DIR` | (compose kurar) | `/data/uploads` (`uploads` birimi) | — |
| `ANTHROPIC_API_KEY` | hayır | Faz 2 (AI); boşsa kapalı | — |
| `DEV_TOOLS` | evet | **Üretimde `0`**: `/dev/whatsapp` ve `/api/v1/dev/*` kapalı. Web'e derleme anında gömülür (değişince `docker compose build web`) | `0` |
| `ADMIN_TOTP_REQUIRED` | (compose kurar) | Platform yöneticilerine iki adımlı doğrulama (TOTP) zorunlu. Compose `api` servisinde `true` sabittir; `.env` ile kapatılamaz. Yerelde boşsa kapalıdır (00 §12a madde 7) | `true` |
| `LOG_LEVEL` | hayır | `info` (sorun ararken `debug`) | `info` |
| `ALERT_WEBHOOK_URL` | **önerilir** | Operasyon uyarılarının gittiği tek dış kanal (`apps/api/src/lib/alert.ts`): kalıcı iş hatası, takılı iş, DLQ eşiği, alarm zinciri eksikliği, imza/numara uyuşmazlığı, ortak numara hesap hatası ve kotası, görsel işleyici, yasal metin kapısı, canary… **Türlerin tamamı, anlamları ve ilk 5 dakikası [17](17-olay-mudahale-runbook.md) §1'dedir** (burada kopyası tutulmaz: iki liste ayrışırsa nöbette yanlış olana bakılır). JSON gövdeli POST (`{service, env, kind, severity, message, data, at}`), 5 sn zaman aşımı, aynı uyarı için 10 dk soğuma. **Boşsa uyarı yalnız loga yazılır, uygulama çalışmaya devam eder.** Kişisel veri gönderilmez (telefon benzeri rakam dizileri maskelenir). Slack/Telegram köprüsü ya da Better Stack gibi bir uç nokta olabilir; yalnız `http`/`https` kabul edilir | `openssl` gerekmez — sağlayıcının verdiği adres |
| `ALERT_MIN_SEVERITY` | hayır | Webhook'a gönderilecek en düşük ağırlık: `info` \| `warning` \| `critical`. Varsayılan `warning`. Log'a her ağırlık yazılır, süzgeç yalnız dış kanalı ilgilendirir | `warning` |
| `CANARY_ENABLED` | pilot öncesi **evet** | Sentetik canary (06 §7.10): şubenin açık saatlerinde 15 dk'da bir `test_kind='canary'` sipariş gerçek yoldan geçer, panelde görünmez, ack'te ya da en geç 10 dk'da kalıcı silinir. **Boş/0 = hiç sipariş üretilmez** (yalnız süresi geçmiş kayıtlar temizlenir); paylaşılan geliştirme ve test veritabanlarında kapalı bırakılır. Acil durdurma için `feature_flags` tablosundaki `canary` anahtarı (deploy gerekmez) | `1` (canlı), yerelde boş |
| `CANARY_STALE_ALERT` | hayır | "Bayat panel" uyarısı (`canary_stale_panel`): çevrimiçi panel varken 2 ardışık canary siparişi 60 sn içinde görülmezse uyarı gider. **Panel tarafı sessiz ack eklenene kadar `0`/boş bırakılır** (06 §7.10 "bilinçli sapmalar"), yoksa her turda yanlış alarm üretir. Kapalıyken bayat panel sinyalinin tamamı susar (uyarı + SSE `resync` + hata logu): panel ack atmadığı sürece sonuç kesindir, ölçüm değil gürültü olur. Sipariş üretme yolunun ölçümü (fiyat → DB → olay → SSE; `canary.run` kalıcı hatası → `job_failed_permanent`) bu değişkenden bağımsız sürer | boş |
| `WABA_CONVERSATION_CAP` | hayır | WhatsApp'ın aylık ücretsiz hizmet oturumu tavanı (pozitif tam sayı; `apps/api/src/services/messaging/waba-quota.ts`). Tavana yaklaşınca uyarı gider. **Geçersiz değer (0, negatif, sayı değil) yok sayılır** ve koddaki varsayılan kullanılır: yanlış yapılandırma kotayı sınırsız göstermesin | koddaki varsayılan |
| `WABA_SHED_NONCRITICAL` | hayır | `1`: tavana yaklaşıldığında **yalnız önemsiz** durum mesajları düşürülür (sipariş mesajları düşmez; CLAUDE.md kural 8 mesaj bütçesi). Varsayılan kapalı | boş |
| `DEMO_STORE_SLUG` | hayır | Pazarlama sitesindeki "Demo menüyü aç" vitrini. **Canlı ortamda boş** (demo işletme yok; kart gizlenir) | boş |
| `DEMO_BANNER` | hayır | "Demo ortamı" uyarısı (`NEXT_PUBLIC_DEMO_BANNER`); canlı ortamda `0` | `0` |
| `SUPPORT_WHATSAPP` | önerilir | Platform destek hattı (WhatsApp), rakamlarla. Giriş ekranındaki "Parolamı unuttum" işletme sahibine bu numarayı (WhatsApp + arama) gösterir; boşsa iletişim formuna yönlendirir. Web'e derleme anında gömülür | `905321234567` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | önerilir | Web Push anahtar çifti: yeni sipariş bildirimi panel kapalıyken de cihazlara gider (00 §10 alarm t=0, §10). Boşsa push kapalıdır; API/worker açılır, logda uyarı yazar. **Değişirse** tüm cihazların aboneliği geçersizleşir, cihazlar bir sonraki "Siparişleri almaya başla"da yeniden abone olur | aşağıda |
| `VAPID_SUBJECT` | push için | İtme servislerinin (Google, Apple, Mozilla) sorun olursa ulaşacağı adres; `mailto:` ya da `https://` ile başlamalı | `mailto:destek@yemekgelsin.net` |
| `BACKUP_REMOTE`, `RETENTION_DAYS` | önerilir | Yedeğin ikinci konumu (rclone) ve saklama günü | §8 |
| `BACKUP_DIR` | hayır | Yedek klasörü; otomatik kurulumda `/opt/yemekgelsin/backups` | §8 |
| `BACKUP_PING_URL` | önerilir | Her başarılı yedekten sonra çağrılan dış izleme (push) adresi; 26 saat gelmezse alarm | §8 |
| `LEGAL_ENTITY_NAME` | evet | Künye unvanı (6563 m.3). Şirket belgesindeki unvanla birebir aynı; tahminle doldurulmaz | `ÖRNEK GIDA - AD SOYAD` |
| `LEGAL_ENTITY_TYPE` | evet | Şirket türü | `Şahıs şirketi` |
| `LEGAL_ENTITY_ADDRESS` | evet | Açık adres (mahalle, sokak, no, ilçe / il) | — |
| `LEGAL_ENTITY_PHONE` | evet | Künye telefonu | — |
| `LEGAL_ENTITY_TAX_OFFICE` | evet | Vergi dairesi | — |
| `LEGAL_ENTITY_TAX_NO` | evet | VKN ya da TCKN | — |
| `LEGAL_ENTITY_MERSIS` | hayır | MERSİS no; şahıs şirketinde yoksa boş bırakılır, künyede "Yok" yazar | — |
| `LEGAL_ENTITY_CHAMBER` | hayır | Üye olunan meslek odası; yoksa boş | — |
| `LEGAL_ENTITY_KEP` | hayır | KEP adresi; yoksa boş | — |
| `LEGAL_SUPPORT_EMAIL` | hayır | Künyede ve KVKK başvurusunda gösterilen e-posta. Boşsa marka adresi (`destek@yemekgelsin.net`) kullanılır; **posta kutusu açık olmalıdır** | — |
| `BACKUP_STATE_FILE` | hayır | Yedek döngüsünün **her** turda (hata turunda da) yazdığı tek satır JSON durum dosyası; `/api/v1/health/worker` `lastBackupAgeSec`'i `lastSuccessUnix` alanından hesaplar. Dosya yok, bozuk ya da hiç başarılı tur yoksa alan `null` ve uyarı üretmez. Alanların tamamı §13 "Yedek durumu", sağlık ucu sözleşmesi §10. `BACKUP_STATUS_FILE` yalnız geriye dönük addır (kod ikisini de okur, yenisi önce) | `/tmp/yedek-durum.json` (§10) |
| `RESTORE_FLAG_FILE` | hayır | **Yalnız canlı container.** "Geri yükleme sürüyor" işaretinin yolu. `entrypoint.sh` `pg_restore`'dan **önce** yazar, başarıda siler; açılışta duruyorsa geri yükleme yarıda kalmış demektir (§13 "Yarım geri yükleme"). Varsayılan **bilerek `/tmp` değildir**: `/tmp` yerinde yeniden başlatmada silinebilirken yarım veritabanı `PGDATA` ile ayakta kalır, işaret veriyle **aynı ömürde** olmalıdır. Elle değiştirmeniz gerekmez | `$(dirname $PGDATA)/geri-yukleme-suruyor` (canlıda `/data/geri-yukleme-suruyor`) |
| `HEALTH_MAX_BACKUP_AGE_SEC` | hayır | Son başarılı yedek bu süreden eskiyse `/api/v1/health/worker` yanıtına `degraded:true` + `warnings:["backup_stale"]` yazar ve uyarı kanalına haber verir — **durum kodu 200 kalır** (503 dağıtımı geri aldırıyordu, §10). `0` = eşik kapalı | `900` (§10) |
| `HEALTH_MIN_DISK_FREE_PCT`, `HEALTH_MAX_MEM_USED_PCT` | hayır | Disk/bellek eşikleri (`/api/v1/health/worker` `warnings`: `disk_low`, `memory_high`; durum kodu 200 kalır). `0` = ilgili eşik kapalı | `15` / `95` (§10) |
| `HEALTH_DISK_PATH` | hayır | Boş alanı ölçülecek yol; verilmezse `UPLOAD_DIR`, o da yoksa `/data`. Compose yolunda PostgreSQL **ayrı birimdedir**: veritabanı diskini izlemek için onun yolunu verin | `/data` (§10) |
| `HEALTH_METRICS_TOKEN` | hayır | `/api/v1/health/worker` **ayrıntılı ölçümlerinin** (yedek yaşı, disk, bellek ve eşikleri) belirteci; istek `x-health-metrics-token` başlığıyla sorar. **Verilmezse ayrıntılar hiç kimseye görünmez** ve uç yine 200 döner (sade alanlar + `warnings` açık kalır, uyarı kanalı çalışır). En az **24 karakter**; kısası kurulmamış sayılır ve günlüğe bir kez uyarı yazılır. Cloudflare yolunda ayrıca `src/mode.ts` `PASSTHROUGH_KEYS`'e eklenmelidir (§10) | — (kapalı) |

Tüm gizli anahtarları bir kerede üretmek için:

```bash
printf 'POSTGRES_PASSWORD=%s\nSESSION_SECRET=%s\nTRACKING_SECRET=%s\nENCRYPTION_KEY=%s\nWA_VERIFY_TOKEN=%s\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -base64 48 | tr -d '\n')" "$(openssl rand -base64 32)" \
  "$(openssl rand -base64 32)" "$(openssl rand -hex 16)"
```

**Web Push (VAPID) anahtarları** bir kez üretilir ve saklanır (API imajındaki `web-push` aracıyla; ağ gerekmez). Çıktıdaki "Public Key" `VAPID_PUBLIC_KEY`'e, "Private Key" `VAPID_PRIVATE_KEY`'e yazılır; ardından `docker compose up -d api worker`:

```bash
docker compose run --rm --no-deps api npx web-push generate-vapid-keys
# servisler zaten çalışıyorsa: docker compose exec api npx web-push generate-vapid-keys
```

Özel anahtar gizlidir (parola yöneticisine). Genel anahtar tarayıcıya gider (`GET /api/v1/panel/push/public-key`), gizli değildir.

Web derleme argümanları (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_DEV_TOOLS`, `NEXT_PUBLIC_SUPPORT_WHATSAPP`, `API_INTERNAL_URL`) compose'da `.env`'den türetilir ve **derleme anında** imaja gömülür; `DOMAIN`, `DEV_TOOLS` ya da `SUPPORT_WHATSAPP` değişirse `docker compose build web && docker compose up -d web` gerekir.

**Künye değişkenleri (`LEGAL_*`) iki yerde birden gerekir.**

| Nereye | Ne zaman okunur | Nasıl verilir | Verilmezse |
|---|---|---|---|
| **API** (sipariş kapısı) | çalışma zamanı | VPS: `.env` → `env_file` (api/worker/migrate); Cloudflare: `wrangler.jsonc` `vars` → `deploy/cloudflare/src/mode.ts` `containerEnv` beyaz listesi | canlı dağıtımda **sipariş ucu kalıcı 503** (`apps/api/src/services/orders/legal-gate.ts`; fail-closed, 08 §7.5) — vitrin hiç sipariş almaz |
| **Web** (`/kunye`, `/yasal/*`, altbilgi) | **derleme** (`next build`) | VPS: `docker-compose.yml` `web.build.args` → `docker/web.Dockerfile` `ARG`/`ENV` | sayfalarda `Eksik yapılandırma: LEGAL_ENTITY_*` satırı |

Web tarafı derleme anında okunur çünkü bu sayfalar dinamik API kullanmayan sunucu bileşenleridir: `next build` bunları **statik HTML**'e çevirir ve çalışma zamanında verilen bir ortam değişkeni o HTML'i değiştiremez. Bu yüzden `web` servisine `environment:` ile künye verilmez (yalnız sessiz bir ayrışma üretirdi); `docker/web.Dockerfile` aynı derleme argümanlarını çalışma imajına da `ENV` olarak yazar. **Künye değişirse `docker compose build web && docker compose up -d web` gerekir.**

> ⚠️ **Cloudflare yolunda web tarafı henüz bağlanmadı.** `vars`'a girilen künye container'a (dolayısıyla API kapısına) geçer, ama container imajını üreten `deploy/cloudflare/Dockerfile` künye `ARG`'larını tanımadığı için `/kunye` ve `/yasal/*` sayfaları "Eksik yapılandırma" basmaya devam eder. Kapatmak için ya o Dockerfile'a `ARG`/`ENV` satırları + `wrangler.jsonc` `containers[].image_vars`'a karşılıkları eklenir, ya da `apps/web` bu sayfaları çalışma zamanında okuyacak biçime (dinamik) çevrilir — ikincisi künyeyi yeniden derleme gerektirmeyen tek kaynağa indirir.

Doğrulama:

```bash
# Üretim ortam değişkenleriyle: künye tam mı, sürüm yayınlanmış mı, metinlerde yer tutucu var mı?
node --import tsx scripts/check-legal.ts
# Yalnız kaynak taraması (ortam değişkeni gerekmez; CI'da sır olmadan koşturmak için)
node --import tsx scripts/check-legal.ts --metinler
# Sürüm yükseltirken yeni içerik özetini al (PINNED_TEXT_DIGEST'e yazılır)
node --import tsx scripts/check-legal.ts --ozet
```

Betik hata bulursa çıkış kodu 1 verir ve eksik **değişken adlarını** yazar (değerleri yazmaz).

> **Nerede koşuyor (5 Eki 2026 tarihli gerçek durum; bu paragraf eskiden yanlıştı).** `pnpm check:legal` **yalnız
> dağıtım kapısında** koşar — `.github/workflows/testler.yml`, "Yasal metin denetimi (künye, sürüm, yer tutucu)"
> adımı — ve o adım **`continue-on-error: true`** ile işaretlidir. Yani bulgu dağıtımı **durdurmaz**; adım sarı
> kalır ve iş akışı özetine ne yapılacağını anlatan bir uyarı bloğu yazılır. İki dağıtım iş akışı da kapıyı
> `needs: testler` ile çağırır, ama bu adımın sarısı onları etkilemez. Neden böyle: künye bilgileri (unvan, adres,
> VKN …) henüz girilmediği ve metin sürümü hâlâ taslak olduğu için adım bugün bulgu veriyor; kapıya bağlanmış
> olsaydı **hiçbir** dağıtım yapılamazdı. **Künye girildikten ve metinler avukat onaylı tarihli sürüme
> çevrildikten sonra o `continue-on-error: true` satırı kaldırılır** (iş akışının kendi uyarı bloğundaki 4. madde);
> o andan sonra yasal bulgu dağıtımı gerçekten durdurur.
>
> Yer tutucu künyenin ya da taslak sözleşmenin **canlıda sözleşme kurmasını** engelleyen kapı bu betik değil,
> **çalışma zamanı kapısıdır**: `apps/api/src/services/orders/legal-gate.ts` canlı ortamda (`NODE_ENV=production`
> + `DEPLOY_ENV=production`) sipariş ucunu fail-closed **503** yapar (08 §7.5). Sonuç: taslak metinle sipariş
> ALINMAZ, ama **dağıtım yine yeşil yanar** — vitrin sessizce sipariş almaz (§12 listesindeki ilgili madde).
>
> `scripts/check-config.ts` ile karıştırılmasın: **o** betik, isteğe bağlı VPS yolunda yeni imaj derlendikten
> sonra ve çalışan konteynerlere dokunmadan önce koşar (`scripts/vps/deploy.sh`). Cloudflare yolunda karşılığı
> container açılışındaki üretim denetimidir (aşağıdaki "Hatalı üretim yapılandırmasında API ve worker açılmaz").

**Hatalı üretim yapılandırmasında API ve worker açılmaz.** Compose `NODE_ENV=production` verir; aşağıdakilerden biri varsa süreç başlamaz ve `docker compose logs api` içinde `Geçersiz üretim yapılandırması: …` yazar (`apps/api/src/config.ts`):

- `DEV_TOOLS=1` (`/api/v1/dev/*` kimlik doğrulamasızdır; canlı ortamda `DEPLOY_ENV=production`),
- `SESSION_SECRET` ya da `TRACKING_SECRET` 32 karakterden kısa ya da örnek (`dev-only…`) değer,
- `WA_VERIFY_TOKEN` boş ya da `dev-verify`,
- `SMS_PROVIDER=netgsm` iken `NETGSM_USERCODE`, `NETGSM_PASSWORD` ya da `NETGSM_HEADER` boş,
- `PLATFORM_WA_PROVIDER=d360` ya da `cloud` iken `PLATFORM_WA_API_KEY` boş (`cloud` için ayrıca `PLATFORM_WA_PHONE_NUMBER_ID` ve webhook imzası için `WA_APP_SECRET`), `PLATFORM_WA_DISPLAY_PHONE` boş/E.164 değil ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş/kısa/örnek değer (ortak numara).

Bu kurallar `scripts/check-config.ts` ile API açılmadan da denetlenir; canlı ortam iş akışı yeni imajla bunu çalışan konteynerlere dokunmadan önce yapar (§14). `docker/env.production.example` `SMS_PROVIDER=netgsm` ve `PLATFORM_WA_PROVIDER=d360` ile, anahtarlar boş olarak gelir; bu haliyle API açılmaz. Netgsm ve 360dialog hesapları hazır olmadan kurulum yapılacaksa ikisini geçici olarak `mock` yapın. Süreç açılır, logda uyarı yazar (`SMS_PROVIDER=mock: SMS OTP ve alarm SMS'leri gönderilmez` vb.). Bu durumda SMS ve platform WhatsApp uyarıları **gerçekten gitmez**: WhatsApp'sız moddaki işletmenin müşterisi SMS kodu alamaz ve sahibine alarm gitmez. `PLATFORM_WA_PROVIDER=mock` iken ortak numara da kapalıdır: `PLATFORM_WA_DISPLAY_PHONE` boşsa geliştirme numarası (+90 555 000 00 00) üretimde kullanılmaz; vitrin, QR ve sipariş onayı WhatsApp bağlantısı göstermez (yalnız `DEPLOY_ENV=dev` simülatörü bu numarayı kullanır). Canlıya çıkmadan önce gerçek sağlayıcıya geçin (§6, §7, §12).

Web Push anahtarları (`VAPID_*`) açılış için zorunlu değildir: boşsa API ve worker açılır, logda `Web Push kapalı (VAPID_PUBLIC_KEY, … boş)` uyarısı yazar ve panel kapalıyken cihazlara yeni sipariş bildirimi gitmez (§10). Biçimi bozuk bir anahtar ya da `mailto:`/`https://` ile başlamayan `VAPID_SUBJECT` ise açılışı durdurur (`Geçersiz yapılandırma: VAPID_…`).

## 5. İlk kurulum

**Canlı ortam Cloudflare'dedir (§13):** orada bu bölümdeki adımlar gerekmez; ilk yöneticiyi container seed'i açar. Bu bölüm isteğe bağlı VPS yolu içindir: önerilen yol otomatiktir (§14) — VPS'i alın, GitHub secret'larını ekleyin, "Canlı ortam (Türkiye VPS)" iş akışı sunucuyu hazırlar, kurar, ilk yöneticiyi açar ve alan adını taşır. Aşağısı aynı işlerin elle yapılışıdır.

```bash
sudo mkdir -p /opt/siparisinonunde && sudo chown siparis: /opt/siparisinonunde
git clone <depo-adresi> /opt/siparisinonunde && cd /opt/siparisinonunde
cp docker/env.production.example .env && chmod 600 .env && nano .env      # §4

docker compose build                   # api (api+worker+migrate aynı imaj), web, caddy
docker compose up -d                   # sıra: postgres (sağlıklı) → migrate (bir kez) → api, worker → web → caddy
docker compose ps -a                   # migrate "Exited (0)" (-a olmadan listelenmez), diğerleri "healthy"
docker compose logs migrate            # "Migration tamam: N yeni, 0 zaten uygulanmış."
curl -fsS https://yemekgelsin.net/api/v1/health     # {"ok":true,"db":"up",...}
```

**Demo seed üretimde çalıştırılmaz** (00 §12a madde 10; canlı ortamın Cloudflare container'ı yalnız `SEED_MODE=admin` çalıştırır: platform yöneticisi + üretim bayrakları, §13). `pnpm db:seed` demo işletmeleri ve parolası herkesçe bilinen hesapları (`demo1234`, `admin1234`) oluşturur; yalnız geliştirme içindir ve `NODE_ENV=production` + `DEPLOY_ENV=production` iken kendini reddeder. Canlı veritabanı boş başlar. Bayraklar üretim varsayılanlarıyla bir betikle yazılır (kayıt açık, WhatsApp bağlama açık, kampanyalar ve yapay zeka kapalı, SMS yedeği yalnız Netgsm tanımlıysa açık, platform uyarıları açık; var olan bayrağa dokunmaz):

```bash
docker compose exec api node --import tsx /app/scripts/bootstrap-production.ts
```

İlk platform yöneticisi betikle açılır (otomatik kurulum `admin@yemekgelsin.net`'i `--if-missing` ile açar: yönetici varsa parolasına ve iki adımlı doğrulamasına dokunmaz):

```bash
docker compose run --rm api node --import tsx /app/scripts/create-admin.ts \
  --email yonetici@yemekgelsin.net --name "Platform Yöneticisi"               # rol varsayılan platform_owner
# Parola verilmezse güçlü bir parola üretilip BİR KEZ gösterilir. Kendiniz vermek için (kabuk geçmişine düşmesin;
# `read` değişkeni dışa aktarmaz, export edilmezse konteynere boş gider ve betik sessizce rastgele parola üretir):
#   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD && docker compose run --rm -e ADMIN_PASSWORD api node --import tsx /app/scripts/create-admin.ts --email ... --name ...; unset ADMIN_PASSWORD
# Başka roller: --role platform_admin | support_agent | finance | sales_rep. Mevcut kullanıcının parolası: --reset-password
```

Ardından `https://DOMAIN/admin/giris` ile girin. **İlk girişte iki adımlı doğrulama (TOTP) kurulur** — üretimde zorunludur ve kurulmadan diğer yönetim ekranları açılmaz:

1. Giriş sonrası panel sizi **Yönetim › Güvenlik** (`/admin/guvenlik`) ekranına götürür; **Kurulumu başlat**'a basın.
2. Telefondaki doğrulama uygulamasıyla (Google Authenticator, Microsoft Authenticator ya da parola yöneticinizin kod özelliği) QR kodu okutun; okutamıyorsanız ekrandaki anahtarı elle girin (zamana dayalı, 6 hane).
3. Uygulamadaki 6 haneli kodu yazıp **Doğrula ve aç**'a basın.
4. Ekranda **bir kez** gösterilen 8 kurtarma kodunu kaydedin (parola yöneticisi ya da yazdırıp kasada); **Kodları güvenli bir yere kaydettim** → **Tamam**. Her kod bir kez kullanılır; azalınca aynı ekrandan **Yeni kurtarma kodları** oluşturun.

Sonraki girişlerde parolanın ardından uygulamadaki kod istenir; telefon yanınızda değilse giriş formunda **Kurtarma kodu kullan**'a basıp bir kurtarma kodu yazın.

**Telefon ve kurtarma kodları kaybolduysa** (operatör kurtarması; kişinin kimliğini başka bir kanaldan doğrulamadan yapmayın):

```bash
docker compose run --rm api node --import tsx /app/scripts/create-admin.ts --email yonetici@yemekgelsin.net --reset-totp
# TOTP sırrı ve kurtarma kodları silinir, kullanıcının tüm oturumları kapanır (audit: platform.totp_reset_cli).
# Kişi yeniden girip /admin/guvenlik ekranında kurulumu tekrarlar.
```

Aynı komut, iki adımlı doğrulamayı panelden (Ayarlar › Güvenlik) açmış ve telefonunu kaybetmiş bir işletme kullanıcısı için de çalışır. İşletme kullanıcılarında TOTP isteğe bağlıdır (sahibe önerilir); kurye ve paylaşımlı cihaz oturumları kullanmaz.

**İşletme sahibi parolasını unuttuysa:** panelde parola sıfırlama akışı yoktur. Personelin parolasını işletme sahibi Ayarlar › Personel'den değiştirir. Sahip, giriş ekranındaki "Parolamı unuttum" ile destek hattına (`SUPPORT_WHATSAPP`, §4) yazar; kimliğini kayıtlı telefonundan geri arayarak doğruladıktan sonra:

```bash
docker compose run --rm api node --import tsx /app/scripts/reset-password.ts --email sahip@ornek.com   # ya da --phone "0532 123 45 67"
# Yeni parola BİR KEZ gösterilir (kişiye telefonda söyleyin); tüm oturumları kapanır, audit: user.password_reset_cli.
# Parolayı kendiniz vermek için: read -rs NEW_PASSWORD && export NEW_PASSWORD && docker compose run --rm -e NEW_PASSWORD api ...; unset NEW_PASSWORD
```

Ardından **Bayraklar** ekranında üretim varsayılanlarını görün (`signup_open` açık; `sms_fallback` Netgsm tanımlıysa açık; `campaigns_global`, `llm_parsing` kapalı). İlk işletme `https://DOMAIN/panel/kayit` üzerinden kaydolur ve kurulum sihirbazına (`/panel/kurulum`) iner. Kayıtla birlikte işletmeye dükkan kodu verilir ve işletme **ortak numaraya** bağlanır (§6); sihirbazın WhatsApp adımı kendiliğinden tamamdır ve QR kodunu gösterir. Ortak numara henüz yapılandırılmadıysa (`PLATFORM_WA_*`, §6.4) işletme "WhatsApp'sız başla" ile web siparişi alabilir (SMS doğrulamalı).

Yedek cron'unu kurmayı unutmayın (§8).

## 6. WhatsApp bağlama: ortak numara (varsayılan) ve kendi numarası

00 §12a madde 8 gereği **tüm platformda tek WhatsApp numarası** vardır: "Yemek Gelsin" ortak numarası. Bütün işletmeler varsayılan olarak bu numaradan sipariş alır; işletme sahiplerine giden platform uyarıları (yeni sipariş alarmı, bağlantı sorunu …) da aynı numaradan gider. Yapılandırma tek yerdedir: `PLATFORM_WA_*` değişkenleri (canlı ortamda GitHub secret'larından türetilir, §13). Kod sağlayıcıdan bağımsızdır (`apps/api/src/wa/providers/{mock,cloud,d360,twilio}.ts`); yalnız resmi WhatsApp Business Platform (Cloud API ve resmi BSP'ler) kullanılır.

Numara üç yoldan biriyle bağlanır. **Proje sahibinin kararı 360dialog'du** (27.09.2026, 00 §12a madde 8); 28.09.2026'da düşük hacim için **Twilio** üçüncü yol olarak eklendi (docs/16). Doğrudan Meta yolu alternatif olarak belgelidir.

| | **360dialog** — §6.2 | **Twilio** — §6.2d | **Meta Cloud API doğrudan** — §6.2b |
|---|---|---|---|
| Aylık numara ücreti | "Regular" planı ~49 €/ay (teyit edilmeli) + Meta mesaj ücretleri | Yok; mesaj başına 0,005 $ + Meta mesaj ücretleri | Yok (yalnız Meta mesaj ücretleri) |
| Ne zaman | Aylık ~10.000 mesajın üstünde | Aylık ~10.000 mesajın altında | Meta süreçlerini kendiniz yürütmek isterseniz |
| Meta tarafı | 360dialog'un sihirbazı yürütür | Twilio Console'daki WhatsApp gönderen sihirbazı yürütür | Meta Business + geliştirici uygulaması + sistem kullanıcısı + kalıcı token |
| GitHub secret'ları (canlı ortam) | `D360_API_KEY`, `WA_PHONE` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WA_PHONE` | `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_WABA_ID`, `META_APP_SECRET`, `WA_PHONE` |
| Admin "WhatsApp kurulumu" (§6.2a) | Test → Webhook'u 360dialog'a kaydet → Şablonlar | Test → Webhook'u Twilio'ya kaydet → Şablonlar | Göster (Meta'ya yapıştır) → test → numarayı etkinleştir (PIN) → abonelik → şablonlar |
| Webhook imzası | İmza yok; URL'deki gizli belirteç korur (teyit edilmeli) | `X-Twilio-Signature` (Auth Token) denetlenir | `X-Hub-Signature-256` (`WA_APP_SECRET`) denetlenir |
| Etkileşimli mesaj | Cloud API gövdesi | Content API kaynağı (buton/liste); CTA ve konum isteği düz metne iner (16 §2.3) | Cloud API gövdesi |
| `PLATFORM_WA_PROVIDER` | `d360` | `twilio` | `cloud` |

Birden çok yolun secret'ları birlikte girilirse dağıtım "belirsiz" hatasıyla durur: yalnız birini kullanın. Platformun kendi tek numarası için doğrudan Cloud API kullanmak Meta Tech Provider sürecini (App Review) gerektirmez; o süreç başka işletmelerin numaralarını bağlamak içindir (teyit edilmeli). İşletmenin **kendi numarası** isteğe bağlıdır (üst paket): §6.8.

### 6.1 Ortak numara nasıl çalışır (operatör özeti)

- Her işletmenin kısa bir **dükkan kodu** vardır (`tenants.wa_code`, ör. `BOZOK`; kayıtta slug'dan üretilir). İşletmenin QR'ı ve bağlantısı ortak numaraya kodlu ön-dolu mesaj açar: `https://wa.me/<ortak numara>?text=Merhaba, Bozok Pide Salonu için sipariş vermek istiyorum. #BOZOK`. İşletme sahibi bunları `Panel > Ayarlar > WhatsApp`'ta görür: kod, bağlantı (kopyala), QR (PNG/SVG indir) ve yazdırılabilir A5/A6 masa kartı.
- Ortak numaraya gelen her mesaj tek webhook adresine düşer: `https://DOMAIN/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>`. Ham olay kaydedilir, hemen 200 dönülür; `wa-inbound` işi mesajın dükkanını seçer (14 §8.1): `#KOD` → o dükkan; Akış B sipariş kodu → siparişin dükkanı; buton/yanıt → mesajın dükkanı; son 24 saatte konuşulan dükkan → devam; dükkan adı → eşleşen dükkan; hiçbiri değilse **dükkan seçici** ("Hangi dükkandan sipariş vermek istersin?": son 2 dükkan + "Diğer dükkanlar", ya da dükkan listesi).
- Seçilen dükkanın konuşma motoru aynen çalışır; her mesajın ilk satırı kalın dükkan adıdır. Sohbet, müşteri ve sipariş verisi dükkan başına ayrıdır; sipariş o dükkanın paneline düşer.
- Dükkan kodunu ve modu (ortak numara / kendi numarası) yalnız platform yöneticisi değiştirir: `Admin > İşletmeler > (işletme) > WhatsApp`. Kod değişirse eski QR'lar çalışmaz; işletmeye yenisini bastırmasını söyleyin.
- `Admin > WhatsApp` en üstte **ortak numara** kartını gösterir: numara, sağlayıcı, maskeli webhook adresi, son webhook zamanı, ortak numaradaki ve dükkan listesinde görünen işletme sayısı, son 24 saatte dükkan seçici mesajları ve yapılandırma sorunları.

### 6.2 Gerçek WhatsApp'ı bağlama: 360dialog (varsayılan) — proje sahibi için kısa yol

Beş bölüm, sırayla. 360dialog ve Meta ekranları değişebilir; menü adları İngilizce arayüze göredir, parantez içinde Türkçesi (teyit edilmeli, Eylül 2026).

**Hazırlık**
- WhatsApp'a hiç kayıtlı olmamış **yeni bir hat** (SIM; SMS ya da sesli arama alabilmeli). Hat WhatsApp ya da WhatsApp Business uygulamasında kayıtlıysa önce uygulamadan hesabı silin, yoksa Meta numarayı kabul etmez. Bu hat yalnız platform içindir.
- Şahıs şirketi bilgileri: vergi levhasındaki unvan, adres, vergi numarası, iş e-postası; şirket kartı (360dialog aboneliği için).
- Bir Facebook hesabı (Meta'nın kayıt penceresinde giriş için) ve yayında bir `https://yemekgelsin.net` (Meta görünen adı siteyle karşılaştırır).

**A. 360dialog'da (bir kez, ~20 dakika)**

1. **Hesap:** [hub.360dialog.com](https://hub.360dialog.com) → **Sign up** → e-posta ve parola → e-postadaki doğrulama bağlantısı. Şirket bilgileri: şirket adı (vergi levhasındaki unvan), ülke **Türkiye**, adres, vergi numarası, web sitesi `https://yemekgelsin.net`.
2. **Plan ve kart:** **Regular** planını seçin (~49 €/ay, numara başına; teyit edilmeli) → ödeme yöntemi olarak şirket kartını ekleyin.
3. **Numarayı bağlayın:** **Add number** (ya da **Connect number**) → açılan Facebook penceresinde (Meta'nın gömülü kayıt akışı) Facebook hesabınızla giriş → **Continue**:
   - İşletme portföyü: **Create a business portfolio** → ad **Yemek Gelsin**, iş e-postası, web sitesi, ülke Türkiye (varsa mevcut portföyü seçin).
   - WhatsApp Business hesabı: **Create a new WhatsApp Business account** → **Yemek Gelsin**.
   - Profil: görünen ad (display name) **Yemek Gelsin** — sitedeki marka adıyla birebir; kategori **Restaurant** (Yemek ve içecek); saat dilimi İstanbul.
   - Numara: yeni hat (+90 …) → **Text message (SMS)** ya da **Phone call (Sesli arama)** → gelen 6 haneli kodu girin → izinleri onaylayın → **Finish**.
   Pencere kapanınca numara Hub'da görünür; "Pending" ise birkaç dakika bekleyin.
4. **API anahtarı:** Hub'da numaranın satırı → **API key** (**Generate API key**) → anahtar bir kez gösterilir: doğrudan parola yöneticisine kopyalayın, e-posta/WhatsApp ile taşımayın. Yeni anahtar üretmek eskisini geçersiz kılar ve **360dialog numaranın webhook adresini siler** (sonra C.2'yi tekrarlayın).
5. **İşletme doğrulaması (önerilir):** [business.facebook.com](https://business.facebook.com) → **Settings (Ayarlar) > Security Center (Güvenlik Merkezi) > Start verification** → vergi levhası. Günlük iletişim sınırını yükseltir (§6.7; teyit edilmeli).

**B. GitHub secret'ları ve dağıtım**

GitHub > depo > **Settings > Secrets and variables > Actions > New repository secret** (ad + değer → **Add secret**):

| Secret | Değer |
|---|---|
| `D360_API_KEY` | A.4'teki API anahtarı |
| `WA_PHONE` | numara, ülke koduyla: `+905321234567` (`0532 123 45 67` de olur; dağıtım E.164'e çevirir) |

Sonra **Actions > "Canlı ortam (Cloudflare)" > Run workflow** (secret eklemek dağıtımı kendiliğinden başlatmaz). İş akışı özetinde "WhatsApp: gerçek numara (360dialog)" yazmalı. `META_*` secret'ları da tamsa dağıtım "belirsiz" hatasıyla durur (360dialog kullanıyorsanız onları silin); `WA_PHONE` eksikse uyarı verir, hatalıysa durur — ikisinde de WhatsApp kapalı (mock) kalır. Container'a `PLATFORM_WA_PROVIDER=d360`, `PLATFORM_WA_API_KEY`, `PLATFORM_WA_DISPLAY_PHONE` gider (`deploy/cloudflare/src/whatsapp-env.ts`). İsteğe bağlı Türkiye VPS'inde (§14) aynı iki secret `.env`'e aynı biçimde yazılır.

**C. Admin'de, sırayla** — `/admin/giris` → platform sahibi (`admin@yemekgelsin.net`) → **WhatsApp** → **WhatsApp kurulumu** (yalnız platform sahibi görür; her işlem denetim kaydına yazılır; ekran §6.2a). "Kurulum durumu" kartında sağlayıcı **360dialog**, numara ve "360dialog API anahtarı: Tanımlı ••••1234" görünmeli.

1. **Bağlantıyı test et** → numara, görünen ad ve onayı, Meta'nın gönderim durumu, kalite, günlük sınır ve 360dialog'daki webhook adresi. İlk seferde "Webhook (360dialog): Kayıtlı değil" normaldir. Hata Türkçe yazar (HTTP 401 → anahtar geçersiz: A.4 ve B'yi tekrarlayın).
2. **Webhook'u 360dialog'a kaydet** → sistem ortak webhook adresini (`https://yemekgelsin.net/api/v1/webhooks/wa/shared/<gizli belirteç>`) 360dialog'a yazar; "Webhook kaydedildi" ve maskeli adres görünür. Tekrar basmak zararsızdır (adres doğruysa değiştirmez). Meta yolundaki "Göster → yapıştır" adımı burada yoktur.
3. **Şablonları gönder** → kodun kullandığı tüm şablonlar (sipariş durumu + işletme uyarıları; §6.5) yoksa oluşturulur; var olana dokunulmaz, hiçbir şey silinmez. **Durumu yenile** her şablonu Onaylandı / İncelemede / Reddedildi olarak (ret sebebiyle) gösterir.

**D. Meta onaylarını bekleyin (1–3 gün)**
- **Görünen ad** "Yemek Gelsin" Meta incelemesinden geçer (genelde 1–3 gün). Onaylanana kadar müşteri ad yerine numarayı görebilir; mesajlaşma çalışır. Durum C.1'de "Görünen ad onayı" satırında. Reddedilirse 360dialog Hub ya da WhatsApp Manager üzerinden adı yeniden gönderin (teyit edilmeli).
- **Şablonlar** genelde dakikalar içinde, en geç 1–3 günde onaylanır; onaylanmamış şablon 24 saat penceresi dışında gönderilemez (pencere içindeki yanıtlar etkilenmez).

**E. Deneme** — canlı ortamda demo işletme yoktur: kendi deneme işletmenizi açın (`/panel/kayit`), kurulumu bitirin, **Panel > Ayarlar > WhatsApp**'taki QR'ı kendi telefonunuzla okutun (ya da numaraya dükkan kodunu yazın: `#KOD`) → dükkanın adıyla karşılama ve **Menüyü aç** gelmeli; `Admin > WhatsApp` ortak numara kartında "Son webhook" güncellenir. `/dev/whatsapp` canlı ortamda yoktur (404). Ayrıntılı deneme §6.6.

**Maliyet:** 360dialog aylık ücreti (Regular, ~49 €/ay; teyit edilmeli) + Meta mesaj ücretleri: **1 Ekim 2026'dan itibaren** Meta numara başına ayda ilk 1.000 hizmet (service) mesajından sonrasını ve pencere dışı şablon mesajlarını ücretlendirir (00 §6 madde 5, §6.7). Meta ücretlerinin 360dialog faturasına mı yansıdığı yoksa Meta'ya tanımlı karttan mı çekildiği ve 360dialog'un mesaj başına ek ücret alıp almadığı **teyit edilmeli** (360dialog Hub › Billing).

**Gerçek numarayı kapatmak:** GitHub'da `D360_API_KEY` secret'ını silin → Run workflow; iş akışı Worker'daki eski değeri de siler (mock: canlı ortamda WhatsApp tamamen kapanır). 360dialog aboneliği ayrıca Hub'dan iptal edilir.

**Sorun giderme**
- C.1/C.2 "360dialog API anahtarı geçersiz (HTTP 401)": anahtar yanlış kopyalandı ya da yenisi üretildi → A.4, B, sonra C.2.
- Müşteri mesajları gelmiyor, "Son webhook" eski: C.1'de webhook satırı "Kayıtlı değil" ya da "farklı adres" → C.2. Yeni API anahtarından sonra her zaman C.2.
- "360dialog bu uç noktayı bulamadı (HTTP 404)": 360dialog API'si değişmiş olabilir; §6.3'teki curl komutlarıyla deneyip durumu bildirin (uç nokta yolları `apps/api/src/wa/providers/d360.ts`'tedir).
- "Sistemdeki numara (farklı)": `WA_PHONE` 360dialog'daki numarayla aynı olmalı; QR ve wa.me bağlantıları bu numarayı içerir.

### 6.2a Admin "WhatsApp kurulumu" ekranı (iki yol için)

`Admin > WhatsApp` sayfasındaki "WhatsApp kurulumu" bölümü yalnız platform sahibine görünür (izin `whatsapp:setup`). Her işlem, başarılı ya da başarısız, denetim kaydına yazılır (gizli değer, PIN, webhook adresi/belirteci yazılmaz); gizli değerler ekranda yalnız son 4 karakterle görünür. "Kurulum durumu" kartı hangi değerlerin tanımlı olduğunu ve eksikleri Türkçe gösterir. Adımlar sağlayıcıya göre değişir:

| Sağlayıcı | Adımlar | Sunucunun çağırdığı uçlar |
|---|---|---|
| 360dialog (`d360`, varsayılan; §6.2 C) | 1 Bağlantıyı test et · 2 Webhook'u 360dialog'a kaydet (+ Kayıtlı adresi göster) · 3 Şablonları gönder (+ Durumu yenile) | `https://waba-v2.360dialog.io`, başlık `D360-API-KEY`: `GET /health_status`, `GET/POST /v1/configs/webhook`, `GET/POST /message_templates` (teyit edilmeli) |
| Meta doğrudan (`cloud`; §6.2b C) | 1 Meta'ya girilecek bilgiler (Göster) · 2 Bağlantıyı test et · 3 Numarayı etkinleştir (PIN) · 4 Webhook aboneliğini aç · 5 Şablonları Meta'ya gönder | Graph `v23.0`, `Authorization: Bearer`: `GET /{phone_number_id}`, `POST /{phone_number_id}/register`, `GET/POST /{waba_id}/subscribed_apps`, `GET/POST /{waba_id}/message_templates` |
| Simülatör (`mock`) | 360dialog adımları pasif; sorun satırı eklenecek secret'ları söyler | — |

360dialog'da numara kaydı (PIN) ve webhook aboneliği gerekmez (360dialog yapar); bu düğmeler görünmez, API'si 409 döner. Webhook kaydı bilinçli olarak **düğmedir**: API ve worker açılışta 360dialog'a kendiliğinden yazmaz, proje sahibi ne olduğunu ekranda görür. Şablon kataloğu iki yolda da aynıdır (§6.5).

### 6.2b Alternatif: Meta Cloud API ile doğrudan — kısa yol

**Varsayılan yol 360dialog'dur (§6.2);** bu yol yalnız 360dialog kullanılmayacaksa izlenir. `D360_API_KEY` secret'ı tanımlıysa silin: iki yolun secret'ları birlikte olursa dağıtım durur. Meta'da yalnız tıklama yaparsınız ve **beş değer** kopyalarsınız; gerisini `Admin > WhatsApp > WhatsApp kurulumu`'ndaki düğmeler yapar (§6.2a). Menü adları Meta'nın İngilizce arayüzüne göredir (parantez içinde Türkçesi); Meta ekranları değişebilir (teyit edilmeli, 2026 arayüzü).

**Hazırlık:** WhatsApp'a hiç kayıtlı olmamış yeni bir hat (SMS ya da sesli arama alabilmeli). Hat WhatsApp ya da WhatsApp Business uygulamasında kayıtlıysa önce uygulamadan hesabı silin, yoksa Meta numarayı kabul etmez. Şirket kartı (ödeme yöntemi). `https://yemekgelsin.net` yayında olmalı.

**A. Meta'da (bir kez)**

1. **İşletme portföyü:** [business.facebook.com](https://business.facebook.com) → **Create a business portfolio (İşletme portföyü oluştur)** → ad **Yemek Gelsin**, adınız, iş e-postası → **Create**. **Settings (Ayarlar) > Business info (İşletme bilgileri)**: yasal unvan, adres, telefon, web sitesi `https://yemekgelsin.net`. İşletme doğrulamasını da hemen başlatın: **Settings > Security Center > Start verification** (günlük sınırı yükseltir, §6.7).
2. **Uygulama:** [developers.facebook.com](https://developers.facebook.com) → **My Apps (Uygulamalarım) > Create app (Uygulama oluştur)** → uygulama adı `Yemek Gelsin`, e-posta → **Next** → kullanım amacı **Connect with customers through WhatsApp** (Müşterilerle WhatsApp üzerinden iletişim kurun) → **Next** → işletme portföyü: **Yemek Gelsin** → **Next** → **Create app**. (Eski ekranda uygulama türü **Business**.)
3. **Numarayı ekleyin:** uygulamada sol menü **WhatsApp > API Setup (API Kurulumu)** → **Add phone number (Telefon numarası ekle)** → görünen ad **Yemek Gelsin**, kategori **Restaurant** / yemek, saat dilimi İstanbul → numara (+90 …) → **Text message (SMS)** ya da **Phone call (Sesli arama)** → gelen 6 haneli kodu girin. Meta'nın verdiği deneme (test) numarasını kullanmayın.
4. **Kalıcı token (1. değer):** business.facebook.com > **Settings > Users > System users (Sistem kullanıcıları) > Add (Ekle)** → ad `yemekgelsin-api`, rol **Admin** → **Create**. Sonra:
   - **Assign assets (Varlık ata)** → **Apps**: 2. adımdaki uygulama, **Full control (Tam kontrol)**; **WhatsApp accounts**: Yemek Gelsin hesabı, **Full control** → **Assign**.
   - **Generate token (Token oluştur)** → uygulamayı seçin → süre **Never (Hiçbir zaman)** → izinler **whatsapp_business_messaging** ve **whatsapp_business_management** → **Generate token**. Token bir kez gösterilir: doğrudan parola yöneticisine kopyalayın. API Setup sayfasındaki "temporary token" 24 saatte biter, kullanmayın.
5. **Kimlikler (2. ve 3. değer):** developers.facebook.com > uygulama > **WhatsApp > API Setup** → "From" kutusunda gerçek numaranızı seçin → **Phone number ID** (2. değer) ve **WhatsApp Business Account ID** (3. değer). İkisi de yalnız rakamdır ve birbirinden farklıdır; telefon numarasının kendisi değildir.
6. **App secret (4. değer):** **App settings (Uygulama ayarları) > Basic (Temel) > App secret > Show (Göster)** (Facebook parolası sorulur). Aynı sayfada **Privacy policy URL**: `https://yemekgelsin.net/yasal/gizlilik` → **Save changes**.
7. **Ödeme yöntemi (zorunlu):** business.facebook.com > **WhatsApp Manager > Payment methods (Ödeme yöntemleri) > Add payment method** → şirket kartı. **1 Ekim 2026'dan itibaren** Meta numara başına ayda 1.000'i aşan hizmet (service) mesajlarını da ücretlendirir ve ödeme yöntemi yoksa mesajları teslim etmez; kart yoksa şablon mesajları da gitmez (hata 131042).
8. **Uygulamayı yayınlayın:** uygulama panosunun üstünde **App mode: Development → Live** (ya da **Publish**). Geliştirme modunda gerçek mesaj olayları webhook'a gelmez (teyit edilmeli).

**B. Beş değeri girin**

Canlı ortam (Cloudflare, §13): GitHub > depo > **Settings > Secrets and variables > Actions > New repository secret** (ad + değer → **Add secret**):

| Secret | Değer |
|---|---|
| `META_WA_TOKEN` | 4. adımdaki token |
| `META_WA_PHONE_NUMBER_ID` | Phone number ID |
| `META_WA_WABA_ID` | WhatsApp Business Account ID |
| `META_APP_SECRET` | App secret |
| `WA_PHONE` | numara, ülke koduyla: `+905321234567` |

Sonra **Actions > "Canlı ortam (Cloudflare)" > Run workflow** (secret eklemek dağıtımı kendiliğinden başlatmaz). `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_APP_SECRET` ve `WA_PHONE` birlikte varsa (ve `D360_API_KEY` yoksa) ortak numara gerçek Meta Cloud API ile açılır; iş akışı özetinde "WhatsApp: gerçek numara (Meta Cloud API doğrudan)" yazar. Biri eksikse uyarı verir ve mock kalır (canlı ortamda çalışan WhatsApp yoktur: vitrinde ve QR'da WhatsApp bağlantısı gösterilmez); telefon ya da kimlik biçimi yanlışsa dağıtım Türkçe hatayla durur. `META_WA_WABA_ID` yalnız aşağıdaki 4. ve 5. düğmeler için gerekir.

İsteğe bağlı Türkiye VPS'i (§14): **aynı beş GitHub secret'ı** kullanılır; "Canlı ortam (Türkiye VPS)" iş akışı her dağıtımda bunları `.env`'e yazar (`PLATFORM_WA_PROVIDER=cloud`, `PLATFORM_WA_API_KEY`, `PLATFORM_WA_PHONE_NUMBER_ID`, `PLATFORM_WA_WABA_ID`, `WA_APP_SECRET`, `PLATFORM_WA_DISPLAY_PHONE`; §6.4 Meta doğrudan satırları). Secret değişince iş akışını elle çalıştırın. Elle kurulumda aynı değerler `.env`'e yazılıp `docker compose up -d api worker`.

**C. Admin'de, sırayla** — `/admin/giris` → platform sahibi hesabı → **WhatsApp** → **WhatsApp kurulumu** (yalnız platform sahibi görür; her işlem denetim kaydına yazılır). "Kurulum durumu" kartında beş değer "Tanımlı" görünmeli (gizliler yalnız son 4 karakterle).

1. **Göster** → webhook adresi ve doğrulama belirteci. developers.facebook.com > uygulama > **WhatsApp > Configuration (Yapılandırma) > Webhook > Edit**: **Callback URL** = webhook adresi, **Verify token** = doğrulama belirteci (ikisinde de **Kopyala**) → **Verify and save**. Aynı sayfada **Webhook fields > Manage** → **messages** satırında **Subscribe**. Doğrulama hatası: 404 → adres eksik ya da yanlış kopyalandı; 403 → doğrulama belirteci farklı.
2. **Bağlantıyı test et** → numara, görünen ad ve onayı, Cloud API kaydı, kalite. Yapılacak bir şey varsa altında Türkçe yazar (190 → token geçersiz, izin hatası, yanlış kimlik …).
3. **Numarayı etkinleştir** → 6 haneli PIN'i iki kez girin. Bu PIN numaranın **WhatsApp iki adımlı doğrulama PIN'idir**: siz seçersiniz, parola yöneticisine kaydedin; numarayı yeniden kaydederken gerekir. Sonra 2. düğme "Cloud API'ye kayıtlı" göstermeli.
4. **Webhook aboneliğini aç** → "Abonelik açık".
5. **Şablonları Meta'ya gönder** → kodun kullandığı tüm şablonlar (sipariş durumu + işletme uyarıları; §6.5) Meta'da yoksa oluşturulur; var olana dokunulmaz, hiçbir şey silinmez. **Durumu yenile** her şablonu Onaylandı / İncelemede / Reddedildi olarak (ret sebebiyle) gösterir; utility şablonlar genelde dakikalar içinde onaylanır.

**Deneme:** canlı ortamda (demo işletme yoktur) kendi deneme işletmenizi açın (`/panel/kayit`), kurulumu bitirin ve kendi telefonunuzdan numaraya dükkan kodunu yazın (`#KOD`, panel > Ayarlar > WhatsApp) → dükkanın adıyla karşılama ve **Menüyü aç** gelmeli; `Admin > WhatsApp` ortak numara kartında "Son webhook" güncellenir.

**Görünen ad:** "Yemek Gelsin" adı Meta incelemesinden geçer (genelde 1–3 gün). Onaylanana kadar müşteri ad yerine numarayı görebilir. Reddedilirse WhatsApp Manager > Phone numbers > numara > **Display name > Edit** ile yeniden gönderin; ad sitedeki marka adıyla aynı olmalı. Durum 2. düğmede görünür.

**KVKK (iki yolda da):** canlı ortamın verileri Cloudflare'de, yurt dışındadır (§13; 00 §12a madde 10). Gerçek müşterilere açmadan önce Cloudflare standart sözleşmesi ve Kurum bildirimi yapılmış olmalıdır (08 §2.12); Meta aktarımı (360dialog yolunda 360dialog da alt işleyendir) 08 §2.11'deki eylem planına tabidir. **İsteğe bağlı VPS'e taşınırsa webhook'u yenileyin** (360dialog: yeni sunucunun admin ekranında "Webhook'u 360dialog'a kaydet"; Meta doğrudan: C.1): canlı ortamın webhook belirteci (`PLATFORM_WA_WEBHOOK_TOKEN`) ve doğrulama belirteci (`WA_VERIFY_TOKEN`) Cloudflare'dekilerden farklıdır; Meta doğrudan yolda `https://yemekgelsin.net/admin` > WhatsApp > WhatsApp kurulumu > **Göster** → Meta'da Callback URL ve Verify token'ı yenileyip **Verify and save**. Yapılmazsa gelen mesajlar yeni sunucuya ulaşmaz.

**Gerçek numarayı kapatmak:** GitHub'da `META_WA_TOKEN` secret'ını (ya da dört zorunlu secret'tan birini) silin → Run workflow; iş akışı Worker'daki eski değerleri de siler. Canlı ortamda bu, WhatsApp'ın tamamen kapanması demektir (mock; simülatör yalnız gizli staging'de).

### 6.2c Meta doğrudan — ayrıntılı başvuru ve elle (curl) yol

**Kısa yol: §6.2b.** Orada Meta'da yalnız tıklama yapılır, beş değer GitHub secret'ı (canlı ortam, Cloudflare) ya da `.env` (isteğe bağlı VPS) olarak girilir; numara kaydı, webhook aboneliği ve şablonlar `Admin > WhatsApp > WhatsApp kurulumu` düğmeleriyle yapılır. Bu bölüm ayrıntılı başvuru ve elle (curl) yoldur.

Menü adları Meta'nın arayüz diline göre Türkçe ya da İngilizce görünür; ikisi birlikte yazılmıştır. Meta ekranları sık değişir: her adım canlıya çıkmadan önce güncel belgeyle doğrulanır (teyit edilmeli).

**Hazırlık:** WhatsApp'ta hiç kullanılmamış (ya da WhatsApp/WhatsApp Business uygulamasındaki hesabı silinmiş) bir telefon numarası: SMS ya da sesli arama alabilen bir cep hattı veya sabit/0850 hat. Şirketin resmi bilgileri (unvan, adres, vergi levhası) ve `yemekgelsin.net` sitesinin yayında olması (görünen ad ve işletme doğrulaması siteye bakar).

1. **İşletme portföyü (Business portfolio):** [business.facebook.com](https://business.facebook.com) → **Hesap oluştur (Create account)** → şirket adı, adınız, iş e-postası. Sonra **Ayarlar (Settings) > İşletme bilgileri (Business info)**: yasal unvan, adres, telefon, web sitesi.
2. **İşletme doğrulaması (Business verification):** **Ayarlar > Güvenlik Merkezi (Security Center) > Doğrulamayı başlat (Start verification)** → vergi levhası / ticaret sicil belgesi yükleyin. Doğrulanmamış portföyde günlük iletişim sınırı düşüktür (§6.7) ve görünen ad onayı zorlaşır (teyit edilmeli). Birkaç gün sürebilir; hemen başlatın.
3. **Ödeme yöntemi:** **Ayarlar > Faturalandırma ve ödemeler (Billing & payments)** ya da WhatsApp Manager > **Ödeme yöntemleri (Payment methods)** → şirket kartını ekleyin. Kart yoksa ücretli mesajlar (şablonlar) gönderilmez, hata 131042 döner.
4. **Geliştirici uygulaması:** [developers.facebook.com](https://developers.facebook.com) → aynı Facebook hesabıyla giriş → **Uygulamalarım (My Apps) > Uygulama oluştur (Create app)** → kullanım amacı olarak **"Müşterilerle WhatsApp üzerinden iletişim kurun" (Connect with customers through WhatsApp)** (eski ekranda: **Diğer (Other) > İşletme (Business)**) → uygulama adı `yemekgelsin`, 1. adımdaki işletme portföyünü seçin → **Oluştur**.
5. **WhatsApp ürününü ekleyin:** Uygulama panosunda **WhatsApp > Kur (Set up)** → işletme portföyünü seçin. Meta bir WhatsApp Business hesabı (WABA) ve deneme numarası açar. Sol menüde **WhatsApp > API Kurulumu (API Setup)** sayfası görünür.
6. **Gerçek numarayı ekleyin:** **API Kurulumu > Telefon numarası ekle (Add phone number)** → işletme görünen adı **Yemek Gelsin**, saat dilimi İstanbul, kategori (Yemek ve içecek / Food & beverage), kısa açıklama → numara (ülke kodu +90) → **SMS ya da sesli arama** ile gelen 6 haneli kodu girin.
7. **Görünen ad onayı:** [business.facebook.com](https://business.facebook.com) > **WhatsApp Manager > Telefon numaraları (Phone numbers)** → numaranın yanında görünen ad durumu "Onaylandı (Approved)" olmalı. Ad, sitede ve belgelerde geçen marka adıyla aynı olmalıdır; onay 1–3 gün sürebilir (teyit edilmeli).
8. **Numarayı Cloud API'ye kaydedin (register) ve iki adımlı PIN:** en kolayı `Admin > WhatsApp > WhatsApp kurulumu > Numarayı etkinleştir` (6 haneli PIN, §6.2b). Elle: WhatsApp Manager > Telefon numaraları > numara > **İki adımlı doğrulama (Two-step verification)** → 6 haneli PIN belirleyin, parola yöneticisinde saklayın. Numara API Kurulumu'nda "Bağlı değil (Pending)" görünüyorsa bir kez kaydedin (9. adımdaki token ile):
   ```bash
   curl -X POST "https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/register" \
     -H "Authorization: Bearer <KALICI_TOKEN>" -H "Content-Type: application/json" \
     -d '{"messaging_product":"whatsapp","pin":"<6 haneli PIN>"}'
   ```
9. **Kalıcı erişim anahtarı (System User token):** business.facebook.com > **Ayarlar > Kullanıcılar > Sistem kullanıcıları (System users) > Ekle (Add)** → ad `yemekgelsin-api`, rol **Yönetici (Admin)** →
   - **Varlık ata (Assign assets):** **Uygulamalar**'da 4. adımdaki uygulama (Tam kontrol / Full control), **WhatsApp hesapları**'nda WABA (Tam kontrol).
   - **Yeni token oluştur (Generate new token)** → uygulamayı seçin → süre **Hiçbir zaman (Never)** → izinler: `whatsapp_business_messaging`, `whatsapp_business_management` → **Oluştur**. Token **bir kez** gösterilir; doğrudan parola yöneticisine kopyalayın, e-posta/WhatsApp ile taşımayın. (API Kurulumu sayfasındaki "geçici token" 24 saatte biter; üretimde kullanılmaz.)
10. **Kimlikler ve uygulama gizli anahtarı:** developers.facebook.com > uygulama > **WhatsApp > API Kurulumu**: **Telefon numarası kimliği (Phone number ID)** ve **WhatsApp Business hesap kimliği (WABA ID)**. **Uygulama ayarları > Temel (App settings > Basic) > Uygulama gizli anahtarı (App secret) > Göster (Show)**. Aynı sayfada **Gizlilik politikası URL'si**: `https://yemekgelsin.net/yasal/gizlilik`.
11. **`.env`'i doldurun** (§6.4'teki ortak blok + Meta doğrudan satırları) ve API/worker'ı yeniden başlatın: `docker compose up -d api worker`. Webhook doğrulaması (12. adım) çalışan API'ye ihtiyaç duyar.
12. **Webhook:** developers.facebook.com > uygulama > **WhatsApp > Yapılandırma (Configuration) > Webhook > Düzenle (Edit)**:
    - **Geri çağırma URL'si (Callback URL):** `https://yemekgelsin.net/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>`
    - **Doğrulama belirteci (Verify token):** `.env`'deki `WA_VERIFY_TOKEN`
    - **Doğrula ve kaydet (Verify and save)** → API `hub.challenge`'ı geri döndürür. Hata alırsanız: 404 = belirteç yol ile `.env`'dekinden farklı ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş; 403 = `WA_VERIFY_TOKEN` farklı.
    - Aynı ekranda **Webhook alanları (Webhook fields) > Yönet (Manage)** → **`messages`** alanına abone olun (gelen mesajlar ve teslim/okundu durumları bununla gelir).
    - Uygulamanın WABA'ya abone olduğunu doğrulayın (teyit edilmeli; panodan kurulumda genelde kendiliğinden olur): `Admin > WhatsApp > WhatsApp kurulumu > Webhook aboneliğini aç` ya da `curl -X POST "https://graph.facebook.com/v23.0/<WABA_ID>/subscribed_apps" -H "Authorization: Bearer <KALICI_TOKEN>"`.
13. **Uygulamayı canlı moda alın:** uygulama panosunun üstündeki **Uygulama modu (App Mode): Geliştirme → Canlı (Live)**. Geliştirme modunda webhook yalnız test verisi gönderir (teyit edilmeli).
14. **Şablonlar ve deneme:** §6.5 ve §6.6.

### 6.2d Alternatif: Twilio — kısa yol

Ayrıntılı sözleşme, sınırlar ve hata eşlemesi **docs/16**'dadır. Operatör adımları:

1. **Twilio hesabı:** [console.twilio.com](https://console.twilio.com) → hesap aç, ödeme yöntemi ekle (deneme hesabında yalnız doğrulanmış numaralara mesaj gider ve mesajların başına Twilio uyarısı eklenir).
2. **Numara:** ortak numara Twilio'dan alınabilir (Phone Numbers > Buy a number) ya da var olan hat kullanılır. Numara WhatsApp'a kayıtlı olmamalıdır.
3. **WhatsApp gönderen:** **Messaging > Senders > WhatsApp senders > New sender** → işletme portföyü ve WhatsApp Business hesabı, görünen ad **Yemek Gelsin**, kategori Restaurant, saat dilimi İstanbul. Doğrulama yöntemi: SMS alamayan numaralarda **Phone call** seçin (kod sesli aramayla okunur).
4. **Kimlik bilgileri:** Console ana sayfasında **Account Info** → **Account SID** (`AC…`, 34 karakter) ve **Auth Token**.
5. **GitHub secret'ları:** `Settings > Secrets and variables > Actions` → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WA_PHONE` (E.164). Kullanmadığınız yolların secret'larını (`D360_API_KEY`, `META_*`) silin, yoksa dağıtım "belirsiz" diye durur.
6. **Dağıtım:** `Actions > "Canlı ortam (Cloudflare)" > Run workflow`. Özette **"WhatsApp: gerçek numara, Twilio"** yazmalı.
7. **Admin kurulumu:** `https://yemekgelsin.net/admin/whatsapp > WhatsApp kurulumu` → **Bağlantıyı test et** → **Webhook'u Twilio'ya kaydet** → **Şablonları gönder**. İkinci düğme gönderenin hem gelen mesaj hem durum bildirimi adresini sistemin ortak webhook'una yazar; Console'da elle bir şey girmenize gerek yoktur.
8. **Deneme:** §6.6.

### 6.3b Twilio — elle (curl) başvuru

Olağan yol §6.2d'dir. Aşağıdakiler admin ekranının yaptığını elle yapar (kimlik Basic; kabuk geçmişine düşmesin diye `read -rs`):

```bash
SID='<TWILIO_ACCOUNT_SID>'; read -rs TOK   # Auth Token

# Hesap durumu
curl -s -u "$SID:$TOK" "https://api.twilio.com/2010-04-01/Accounts/$SID.json"

# WhatsApp gönderenleri (durum, kalite, kayıtlı webhook)
curl -s -u "$SID:$TOK" 'https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp'

# Webhook adresini yaz (XE… gönderen kimliği yukarıdaki listeden)
curl -s -u "$SID:$TOK" -X POST 'https://messaging.twilio.com/v2/Channels/Senders/<XE…>' \
  -H 'Content-Type: application/json' \
  -d '{"webhook":{"callback_url":"https://yemekgelsin.net/api/v1/webhooks/wa/shared/<BELIRTEC>","callback_method":"POST","status_callback_url":"https://yemekgelsin.net/api/v1/webhooks/wa/shared/<BELIRTEC>","status_callback_method":"POST"}}'

# Şablon (içerik) durumları
curl -s -u "$SID:$TOK" 'https://content.twilio.com/v1/ContentAndApprovals?PageSize=100'

# Deneme mesajı (yalnız 24 saatlik oturum içindeyken serbest metin gider)
curl -s -u "$SID:$TOK" -X POST "https://api.twilio.com/2010-04-01/Accounts/$SID/Messages.json" \
  --data-urlencode 'From=whatsapp:<ORTAK_NUMARA>' --data-urlencode 'To=whatsapp:<KENDI_NUMARANIZ>' \
  --data-urlencode 'Body=deneme'
```

### 6.3 360dialog — elle (curl) başvuru

Olağan yol §6.2'dir (hesap, numara ve anahtar 360dialog Hub'da; webhook ve şablonlar admin ekranından). Aşağıdaki komutlar admin ekranının yaptığını elle yapar; ekran bir uç noktada 404 verirse ya da isteğe bağlı VPS'te (§14) denemek için kullanılır. Taban adres `https://waba-v2.360dialog.io`, kimlik yalnız `D360-API-KEY` başlığıdır (numara ve WABA anahtara bağlıdır, yolda kimlik yoktur). Yollar 360dialog'un yayımladığı Messaging API tanımına göredir; teyit edilmeli (kodda `apps/api/src/wa/providers/d360.ts`).

```bash
KEY='<PLATFORM_WA_API_KEY>'   # kabuk geçmişine düşmemesi için: read -rs KEY
# Numara ve Meta durumu (zararsız)
curl -s "https://waba-v2.360dialog.io/health_status?fields=health_status,display_phone_number,verified_name,name_status,quality_rating" \
  -H "D360-API-KEY: $KEY"
# Kayıtlı webhook adresi
curl -s https://waba-v2.360dialog.io/v1/configs/webhook -H "D360-API-KEY: $KEY"
# Webhook adresini yaz (ortak numara)
curl -s -X POST https://waba-v2.360dialog.io/v1/configs/webhook \
  -H "D360-API-KEY: $KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://yemekgelsin.net/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>"}'
# Şablon durumları (Graph ile aynı biçim; oluşturma: aynı yola POST, gövde Graph message_templates gövdesi)
curl -s "https://waba-v2.360dialog.io/message_templates?fields=name,status,category,language,rejected_reason&limit=200" -H "D360-API-KEY: $KEY"
```

- 360dialog Meta imzasını (`X-Hub-Signature-256`) göndermez; `PLATFORM_WA_PROVIDER=d360` iken ortak webhook imza denetlemez, URL'deki gizli belirteç korur (teyit edilmeli). Belirteci gizli tutun: loglarda ve ekran görüntülerinde paylaşmayın. Webhook adresinin alan adı alt çizgi (`_`) ya da port (`:8443`) içeremez (360dialog kuralı).
- Yeni API anahtarı üretilince 360dialog numaranın webhook adresini siler: anahtar değişince webhook'u yeniden yazın.
- Eski şablon ucu `v1/configs/templates` 360dialog'da kullanımdan kalkıyor (deprecated); kod `message_templates` kullanır.

### 6.4 Ortam değişkenleri

Canlı ortamda (Cloudflare) bu değişkenler elle yazılmaz: iş akışı GitHub secret'larından türetir (360dialog: `D360_API_KEY`, `WA_PHONE`; Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `WA_PHONE`; Meta doğrudan: `META_*`, `WA_PHONE`; §13). Aşağıdakiler isteğe bağlı VPS ve elle kurulum içindir.

Ortak blok (iki yolda da):

```bash
PLATFORM_WA_DISPLAY_PHONE=+908501234567            # ortak numara, E.164 (QR, wa.me bağlantıları, Akış B)
PLATFORM_WA_WEBHOOK_TOKEN=$(openssl rand -hex 24)  # webhook yolundaki gizli belirteç, ≥ 16 karakter
WA_VERIFY_TOKEN=$(openssl rand -hex 16)            # Meta webhook GET doğrulaması (Meta doğrudan yol; üretimde her durumda zorunlu)
WA_DEFAULT_PROVIDER=d360                           # yalnız kendi numarasına geçen işletmelerin varsayılanı (§6.8)
```

360dialog (varsayılan, §6.2):

```bash
PLATFORM_WA_PROVIDER=d360
PLATFORM_WA_API_KEY=<§6.2 A.4: 360dialog API anahtarı>
PLATFORM_WA_PHONE_NUMBER_ID=                       # boş (numara anahtara bağlı)
WA_APP_SECRET=                                     # boş (360dialog imza göndermez)
```

Twilio (alternatif, §6.2d; docs/16 §3.1):

```bash
PLATFORM_WA_PROVIDER=twilio
PLATFORM_WA_API_KEY=<Twilio Auth Token>            # gönderim + webhook imzası (X-Twilio-Signature)
PLATFORM_WA_PHONE_NUMBER_ID=<Twilio Account SID>   # AC + 32 onaltılık karakter
WA_APP_SECRET=                                     # boş (Meta imzası yoktur)
```

Meta Cloud API doğrudan (alternatif, §6.2b/§6.2c):

```bash
PLATFORM_WA_PROVIDER=cloud
PLATFORM_WA_API_KEY=<§6.2c madde 9: kalıcı System User token>
PLATFORM_WA_PHONE_NUMBER_ID=<§6.2c madde 10: Phone number ID>
PLATFORM_WA_WABA_ID=<§6.2c madde 10: WABA ID>      # isteğe bağlı: admin kurulumu (webhook aboneliği, şablon gönderimi)
WA_APP_SECRET=<§6.2c madde 10: App secret>         # webhook imzası
```

`$(openssl …)` ifadeleri `.env`'e kendiliğinden işlenmez: komutu kabukta çalıştırıp çıktısını yazın. API açılışta eksikleri denetler (§4): gerçek sağlayıcıda `PLATFORM_WA_DISPLAY_PHONE` boş/E.164 değilse ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş, 16 karakterden kısa ya da `dev…` ile başlıyorsa süreç açılmaz. Açılışta ortak numara tüm ortak numara işletmelerinin kayıtlarına yazılır (`syncSharedWaAccounts`); numara değişirse yalnız `.env` güncellenip `docker compose up -d api worker` yapılır, ama **basılı QR'lar eski numarayı içerdiğinden numara değiştirmek bütün işletmelerin QR'larını geçersiz kılar**: numarayı bir kez seçin.

### 6.5 Şablonlar (müşteri ve platform uyarıları)

24 saat penceresi dışındaki durum mesajları ve işletme sahibine giden uyarılar onaylı **utility** şablonlarla gider. Ortak numarada tek WABA olduğu için şablonlar **bir kez**, platform hesabında oluşturulur (işletme başına değil). İki yolda da `Admin > WhatsApp > WhatsApp kurulumu > Şablonları gönder` (Meta doğrudan yolda "Şablonları Meta'ya gönder") hepsini tek seferde oluşturur (eksikleri; var olana dokunmaz) ve durumlarını (onay, ret sebebi, kategori değişimi) gösterir (§6.2a); 360dialog yolunda istekler 360dialog'un `message_templates` ucuna aynı gövdeyle gider, onay yine Meta'dadır. Tek kaynak `apps/api/src/services/messaging/template-bodies.ts` (`WA_TEMPLATE_CATALOG`): gövde metni, konumsal değişkenler (`{{1}}`…, sıra `CUSTOMER_TEMPLATES` / `PLATFORM_TEMPLATES`), örnek değerler ve butonlar; gövdelerin 02 §5.2/§5.3 ile aynı olduğu testle denetlenir. Butonlar: takip şablonlarında "Siparişi takip et" / "Değerlendir" dinamik URL (`APP_BASE_URL/t/{{1}}`, değişken takip token'ı), `yanit_bekliyor_v1`'de "Devam et" hızlı yanıt, platform uyarılarında panelin sabit adresi (gönderen kod buton parametresi vermez), `kurye_giris_v1`'de `/kurye/giris?t={{1}}`. Metin değişikliği yeni sürüm adıyla (`_v2`) yapılır. Elle yol: 360dialog Hub'ın şablon ekranı ya da WhatsApp Manager > **Mesaj şablonları (Message templates) > Şablon oluştur** (gövde koddakiyle birebir olmalı). Dil: Türkçe (`tr`), kategori: Yardımcı program (Utility).

- **Müşteri şablonları:** `siparis_alindi_v1`, `siparis_onaylandi_v2`, `siparis_hazir_v2`, `siparis_yolda_v2`, `siparis_teslim_v1`, `siparis_reddedildi_v1`, `siparis_iptal_v1`, `siparis_iptal_yanitsiz_v1`, `yanit_bekliyor_v1`. Metin ve parametre sırası `packages/core/src/messages/tr.ts` → `CUSTOMER_TEMPLATES`; hepsi işletme adını (`{isletme}`) değişken olarak taşır, müşteri hangi dükkandan mesaj aldığını görür. Şablonlara promosyon ya da indirim kodu eklenmez (İYS, 00 §7).
- **Platform şablonları** (işletme sahibine): `isletme_yeni_siparis_v1`, `isletme_panel_cevrimdisi_v1`, `kurye_giris_v1`, `isletme_baglanti_sorunu_v1`, `isletme_meta_odeme_v1`, `isletme_kalite_uyari_v1` (V-011). `isletme_yeni_siparis_v1` yeni sipariş alarmıdır (t=2 dk, 00 §10). `isletme_panel_cevrimdisi_v1` "panel çevrimdışı" uyarısıdır (06 §7.7): şube sipariş alırken (çalışma saati içinde, duraklatılmamış, sipariş alma açık, web canlı) sipariş ekranı 5 dakikadır açık değilse ya da şube açılalı 10 dakika olduğu hâlde açılıştan beri hiç açılmadıysa işletme sahibine gider; şube başına **günde en çok bir kez** (ve saatte en çok bir kez; `cron.panel_presence`, §10) — sayaç şubenin saat diliminde gün dönünce sıfırlanır. Parametreler: işletme adı (ek şubede "İşletme · Şube") ve dakika. Gerekirse `Admin > Bayraklar > platform_wa_alerts` ile geçici kapatılır.
- İşletme sahibinin uyarı şablonlarına verdiği yanıtlar da ortak webhook'a gelir ve müşteri mesajı gibi yönlendirilir; ayrı destek gelen kutusu henüz yoktur (açık iş).

### 6.6 Deneme ve izleme

1. Kendi telefonunuzla bir işletmenin QR'ını okutun (`Panel > Ayarlar > WhatsApp`, ya da bağlantıyı açın) → mesajı gönderin → o işletmenin adıyla karşılama ve **Menüyü aç** gelmeli; linkten sipariş verin, o işletmenin panelinde sesli uyarıyı görün, onaylayın, "onaylandı" mesajı gelsin.
2. İkinci bir işletmenin QR'ını okutun → ikinci işletmenin adıyla karşılama gelmeli. Ardından kodsuz "merhaba" yazın: son 24 saatteki dükkan devam eder; "değiştir" yazınca dükkan seçici gelir.
3. `Admin > WhatsApp` > **Ortak numara** kartı: "Son webhook" yeni olmalı, sorun satırı olmamalı. Aynı sayfadaki **WhatsApp kurulumu** (platform sahibi): "Bağlantıyı test et" hazır (360dialog'da webhook satırı "doğru"; Meta doğrudan yolda abonelik açık), şablonlar Onaylandı. Paneldeki "Test mesajı gönder" pencere kuralına tabidir: test telefonu son 24 saatte ortak numaraya yazmış olmalıdır.
4. Webhook dışarıdan: `curl -i "https://DOMAIN/api/v1/webhooks/wa/shared/yanlis-belirtec-0000"` → 404 (yol çalışıyor, belirteç yanlış). Doğru belirteçle imzasız `POST` Meta doğrudan yolda 401 döner (imza denetleniyor); 360dialog yolunda imza yoktur, belirteç korur.

### 6.7 Maliyet ve sınırlar

- **Aracı ücreti:** 360dialog yolunda (varsayılan) "Regular" planı numara başına ~49 €/ay (teyit edilmeli); Meta doğrudan yolda yok. Tek numara olduğu için bu ücret işletme sayısıyla artmaz.
- **Meta mesaj ücretleri platform hesabına yansır** (00 §12a madde 8): ücretsiz hizmet (service) mesajı hakkı numara/WABA başınadır ve **tüm dükkanlar tek numarayı paylaştığı için bu hak da paylaşılır**. Proje sahibinin kararında geçen "ayda 1.000 ücretsiz hizmet mesajı" Meta'nın eski (Kasım 2024 öncesi) modelidir; güncel modelde müşterinin başlattığı 24 saat penceresindeki serbest mesajlar ücretsiz, pencere içindeki utility şablonlar da ücretsizdir; ücret pencere dışındaki şablon mesajlarından alınır. 1 Ekim 2026'dan itibaren hizmet mesajları da numara başına ayda 1.000'i aşınca ücretlidir (00 §6 madde 5) (teyit edilmeli — V-001 rate card). 360dialog yolunda Meta ücretlerinin nasıl faturalandığı (360dialog faturası mı, Meta'ya tanımlı kart mı) teyit edilmeli. Ücret, mesaj bazında işletmeye göre izlenir (`messages.tenant_id`); pakete yansıtma açık karar.
- **Günlük iletişim sınırı (messaging limit):** işletmenin başlattığı sohbetler (pencere dışı şablonlar) için 24 saatte ulaşılabilecek kişi sayısı portföy başınadır ve yeni hesapta düşüktür (ör. 250; işletme doğrulaması ve kaliteyle 1.000 → 10.000 … artar — teyit edilmeli). Tüm dükkanlar bu sınırı paylaşır: işletme doğrulamasını (§6.2 A.5) canlıdan önce tamamlayın. Müşterinin başlattığı sohbetler sınıra sayılmaz.
- **Kalite ve engelleme:** müşteriler numarayı engeller ya da şikâyet ederse numaranın kalitesi düşer ve **bütün dükkanlar etkilenir**. Promosyon gönderilmez, mesaj bütçesi (sipariş başına en çok 4 durum mesajı) korunur; `isletme_kalite_uyari_v1` uyarısını ciddiye alın.
- **Hız:** tüm dükkanların gönderimleri tek numaranın hız sınırını paylaşır (uygulama tek sıra tutar; `wa/throttle.ts`).
- **Hesap hataları:** ortak numarada token (190) ya da ödeme (131042) hatası işletmenin kaydını kapatmaz ve işletme sahibine uyarı göndermez; loga yazılır. `Admin > WhatsApp` ortak numara kartını ve `docker compose logs worker | grep 'ortak numara'` çıktısını izleyin.

### 6.8 Kendi numarası (isteğe bağlı, ileri)

Kendi numarasıyla çalışmak isteyen işletme (üst paket; 00 §12a madde 8) önce platform yöneticisince **kendi numarası** moduna alınır: `Admin > İşletmeler > (işletme) > WhatsApp > WhatsApp modu: Kendi numarası` → gerekçe → Kaydet. Ortak numara kaydı kapanır; işletme sahibi kendi numarasını bağlayana kadar WhatsApp'tan sipariş gelmez, web siparişleri SMS ile doğrulanır (WhatsApp'sız mod). Müşteri eski `#KOD`'u yazarsa işletmenin kendi numarası bildirilir. Sonra işletme sahibi:

1. **Hesap ve numara (360dialog, önerilen):** 360dialog Client Hub'da işletme adına hesap → **Numara ekle** (Embedded Signup). Varsayılan yol **Coexistence**'tır: esnaf WhatsApp Business uygulamasındaki numarasını ve telefondan yazmayı korur (00 §6.4; 360dialog'da Coexistence desteği ve kısıtları teyit edilmeli — V-018). Alternatif: yeni numara. Görünen ad (display name) Meta onayından geçer. İşletmenin Meta Business portföyünde geçerli bir ödeme kartı olmalıdır.
2. **API anahtarı:** Client Hub'da numaranın ayarlarından üretilir (bir kez gösterilir — teyit edilmeli). Anahtarı yalnız güvenli kanaldan alın.
3. **Panelde (yalnız işletme sahibi):** `Panel > Ayarlar > WhatsApp` (`/panel/ayarlar/whatsapp`): Sağlayıcı **360dialog** (ya da Meta Cloud API: Phone number ID + erişim anahtarı), "WhatsApp numarası", API anahtarı → **Kaydet**. Anahtar `ENCRYPTION_KEY` ile şifrelenip saklanır; ekranda maskeli görünür.
4. **Webhook adresi:** aynı sayfadaki "Webhook adresi" kartında işletmeye özel adres görünür: `https://DOMAIN/api/v1/webhooks/wa/<gizli-belirteç>`. 360dialog'a API ile tanımlanır (§6.3'teki webhook yazma komutu, işletmenin anahtarı ve bu adresle); Meta Cloud API'de uygulamanın Webhook ayarına girilir. Adres "Webhook adresini yenile" ile değiştirilebilir (eski adres hemen geçersizleşir).
5. **Şablonlar:** müşteri şablonları (§6.5) **işletmenin kendi WABA'sında** ayrıca oluşturulup onaylatılır (teyit edilmeli).
6. **Deneme:** işletme numarasına "merhaba" → karşılama ve **Menüyü aç**; panelde "Test mesajı gönder" (test telefonu son 24 saatte işletme numarasına yazmış olmalı). Sağlık: `Admin > WhatsApp` (son webhook zamanı, son 24 saat hata).

Kendi numaranın bağlantısı koparsa (hesap `error`, token/ödeme hatası) işletme otomatik olarak **WhatsApp'sız moda** düşer: Akış B SMS OTP ile doğrulanır, onay/ret/iptal SMS ile bildirilir (00 §4, §7). Ortak numaraya geri dönmek için yönetici modu yeniden **Ortak numara** yapar (kayıtlı API anahtarı silinir, sohbet ve sipariş geçmişi korunur).

## 7. SMS (Netgsm)

SMS OTP (WhatsApp'sız mod), kritik durum SMS'leri ve 5. dakika alarm SMS'i platform maliyetidir (00 §4 kotalar: Esnaf 100, Pro 300 SMS/ay).

1. Netgsm kurumsal hesabı açılır; **API kullanıcısı** tanımlanır ve API erişimi açılır. Netgsm panelinde API erişimi IP kısıtlıysa sunucunun çıkış IP'si eklenir (teyit edilmeli).
2. **Gönderici başlığı:** platformun onaylı alfanümerik başlığı (≤ 11 karakter, ör. `YEMEKGELSIN`); onay süresi pilot öncesine sığmalı (V-020, teyit edilmeli). Mesaj gövdesinde işletme adı geçer.
3. SMS'ler "bilgilendirme" türüyle gönderilir, İYS onayı gerektirmez (V-023, teyit edilmeli); SMS metinlerine promosyon eklenmez.
4. `.env`: `SMS_PROVIDER=netgsm`, `NETGSM_USERCODE`, `NETGSM_PASSWORD`, `NETGSM_HEADER` → `docker compose up -d api worker`.
5. Deneme: WhatsApp'ı bağlı olmayan bir deneme işletmesinin vitrininden sipariş verin → doğrulama ekranı "SMS ile doğrulayın" açılmalı; kod telefonunuza gelmeli. Gönderim hataları `sms_messages.error` ve worker loglarında görünür (Netgsm hata kodları `apps/api/src/sms/providers/netgsm.ts`).
6. SMS pompalama saldırısında `Admin > Bayraklar > sms_fallback` kapatılır; SMS yedeği tamamen durur, Akış B yalnız WhatsApp ile çalışır (00 §4).

## 8. Yedekleme ve geri yükleme

> **Canlı ortam (Cloudflare, §13):** yedek R2'dedir ve otomatiktir: container veritabanını **2 dakikada bir (yalnız değişiklik varsa)**, her düzgün kapanışta (uyku, yeniden dağıtım) ve bir süreç düştüğünde `pg_dump` ile R2'ye yazar; görseller de değiştikçe. Anahtarlar `e<dönem>/db/son.dump` (son) ve `e<dönem>/db/gun-<0–6>.dump` (haftanın her günü için bir kopya, 7 gün). Container her açılışta son yedekten geri yüklenir. Yedek döngüsü **her** turda (hata turunda da) `BACKUP_STATE_FILE`'a (varsayılan `/tmp/yedek-durum.json`) tek satır JSON yazar; `lastSuccessUnix` alanı yalnız **başarılı** turda tazelenir ve `/api/v1/health/worker` `lastBackupAgeSec`'i buradan hesaplar — yedek 15 dakikadır yazılamıyorsa uyarı kanalına `backup_stale` / `yedek_eskidi` uyarısı gider ve uç `degraded:true` döner — **durum kodu 200 kalır** (sözleşmenin tamamı §10'da). "Değişiklik yok" turu başarılıdır ve yaşı sıfırlar; `pg_dump`/yükleme hatası yaşı büyütür. Düzgün kapanış veri kaybettirmez; beklenmedik çökme son ~2 dakikayı kaybettirebilir. Elle geri dönüş ve tatbikat için §13 "Yedekten geri dönüş", adım adım prova ve kayıp tablosu için [17](17-olay-mudahale-runbook.md) §4. Aşağısı isteğe bağlı VPS yolu içindir.

**Otomatik kurulumda (§14)** yedek cron'unu iş akışı kurar: `/etc/cron.d/yemekgelsin-backup`, root, **her gece 03:30 (Europe/Istanbul)** → `/opt/yemekgelsin/backups` (izin 700/600, 14 gün), günlük `/var/log/yemekgelsin-backup.log` (haftalık döndürülür). Ayrıca her dağıtımdan önce (veritabanı varsa) **yalnız veritabanının** bir dökümü alınır (`backup.sh --pre-deploy` → `pre-deploy-db-*.dump`; yaşa göre değil sayıya göre, **son 5** saklanır; ikinci konuma kopyalanmaz, `BACKUP_PING_URL` çağrılmaz); alınamazsa dağıtım durur. Böylece sık dağıtım diski doldurmaz (dağıtım ayrıca %15'ten az boş yerde durur, §14.3). **Yedekler Türkiye'deki bu sunucuda kalır**; henüz ikinci bir konum yoktur. Sunucu kaybına karşı ikinci bir Türkiye lokasyonu (aşağıda "İkinci konum") en kısa sürede eklenmelidir. Aşağıdaki `siparis` kullanıcılı düzen elle kurulum içindir.

**Günlük yedek** (`scripts/backup.sh`): `pg_dump -Fc` (sıkıştırılmış, doğrulanmış) + `uploads` biriminin tar arşivi `BACKUP_DIR` klasörüne (elle kurulumda `./backups`); **14 günden eskiler silinir**. Döküm `docker compose exec` ile akıtılır; klasörü betik ilk çalışmada `700` izniyle oluşturur, dosyalar `600`'dür. Cron, depoyu ve compose'u yöneten **`siparis` kullanıcısının** crontab'ına kurulur (root'un değil: root'un aldığı dökümleri `siparis` olarak çalışan `restore.sh` okuyamaz). Log kullanıcının ev dizinine yazılır (`/var/log` altına normal kullanıcı yazamaz):

```bash
sudo -iu siparis crontab -e
15 3 * * * cd /opt/siparisinonunde && ./scripts/backup.sh >> "$HOME/siparis-backup.log" 2>&1
```

İlk kurulumda bir kez elle çalıştırıp dosyanın oluştuğunu görün: `./scripts/backup.sh && ls -l backups/`. Klasör root'a aitse (ör. eski bir compose sürümü oluşturduysa) betik yazmaya başlamadan durur ve düzeltme komutunu yazar: `sudo chown -R siparis: backups && chmod 700 backups`.

**Yedek alınamazsa sessiz kalmaz:** betik sıfır dışı kodla çıkar, `~/siparis-backup.log`'a ve syslog'a yazar (`journalctl -t siparis-backup`). Cron'un e-postası çoğu sunucuda gitmediği için asıl uyarı dış izlemedir: Uptime Kuma'da (ikinci VPS, §10) **Push** türünde, 26 saat aralıklı bir monitör açın ve adresini `.env`'e `BACKUP_PING_URL=https://…/api/push/<anahtar>` olarak yazın. Betik her başarılı yedekten sonra bu adresi çağırır; 26 saat çağrı gelmezse nöbetçiye P2 alarmı gider (06 §14.1: yedek yaşı > 26 sa).

**İkinci konum (zorunlu, henüz yok):** Yedeğin bir kopyası başka bir Türkiye lokasyonunda tutulur (00 §10; kişisel veri yurt dışına çıkmaz). `rclone` kurun (otomatik kurulumda kuruludur), yurt içi S3 uyumlu depoyu sunucuda root olarak `rclone config` ile tanımlayın ve `.env`'e `BACKUP_REMOTE=yedek-ankara:siparis-yedek` yazın (otomatik kurulumda: sunucudaki `.env`'in "Yedekleme" bölümüne; iş akışı korur). Uzak konum tanımlı ama çalışmıyorsa gecelik yedek hata verir (güncelleme öncesi döküm uzağa kopyalanmadığı için dağıtımı durdurmaz); betik her gece son 48 saatin dosyalarını kopyalar ve uzakta da 14 günü aşanları siler. `BACKUP_REMOTE` boşsa betik her çalıştığında uyarı yazar. Yedek dosyaları kişisel veri içerir: klasör izni `700`, uzak depoda şifreleme (rclone `crypt`) önerilir.

**Geri yükleme** (`scripts/restore.sh`):

```bash
# Aylık tatbikat (canlıya dokunmaz): ayrı veritabanına yükler, tablo sayılarını yazar
./scripts/restore.sh --target siparis_tatbikat backups/db-siparis-20261001T031500Z.dump
docker compose exec postgres dropdb -U siparis siparis_tatbikat

# Gerçek geri dönüş: api/worker/web durur, önce mevcut durumun dökümü alınır (backups/pre-restore-*.dump),
# veritabanı yeniden oluşturulur, döküm yüklenir, migration çalışır, servisler başlar
./scripts/restore.sh --uploads backups/uploads-20261001T031500Z.tar.gz backups/db-siparis-20261001T031500Z.dump
```

`restore.sh` de `siparis` kullanıcısıyla çalıştırılır. Servisleri durdurmadan önce dökümün okunabildiğini ve `backups/` klasörüne yazılabildiğini denetler. Güvenlik dökümü alınamazsa veritabanına dokunmadan servisleri yeniden başlatır; geri yükleme yarıda kalırsa servisler kapalı kalır ve önceki hâle dönüş komutunu (`./scripts/restore.sh --yes backups/pre-restore-….dump`) yazar.

Kısıtlar: `pg_dump` günlük anlık görüntüdür, son yedekten sonraki siparişler geri dönüşte kaybolur. Saniye hassasiyetinde dönüş (PITR) için WAL arşivleme (pgBackRest ya da WAL-G, ikinci lokasyona) **pilot öncesi zorunlu paketin** parçasıdır (00 §11) ve ayrıca kurulmalıdır. Aylık geri yükleme tatbikatının tarihi ve sonucu bir yere not edilir.

## 9. Güncelleme

**Canlı ortam (Cloudflare, §13):** `main` ya da çalışma dalına her push (yalnız `docs/**` ve `*.md` değişiklikleri hariç) "Canlı ortam (Cloudflare)" iş akışını çalıştırır: Worker'ı ve container imajını dağıtır, eski container son yedeği yazıp kapanır, yenisi yedekten açılır, migration'ları uygular, duman testi yeni sürümü doğrular. Aşağısı isteğe bağlı VPS yolu içindir.

**Otomatik (isteğe bağlı VPS, §14):** `main` ya da çalışma dalına her push (yalnız `docs/**` ve `*.md` değişiklikleri hariç) "Canlı ortam (Türkiye VPS)" iş akışını çalıştırır: tam o commit'i sunucuya getirir, derler, yapılandırmayı denetler, yedek alır, migration'ları uygular, servisleri yeniler ve sağlık/duman testlerini yapar. **Geri alma:** Actions > "Canlı ortam (Türkiye VPS)" > Run workflow > `ref` = önceki commit SHA'sı. Elle güncelleme:

```bash
cd /opt/siparisinonunde
./scripts/backup.sh                          # migration'lar yalnız ileri yönlüdür; önce yedek
git fetch && git log --oneline HEAD..origin/main   # neler geliyor
git pull --ff-only
docker compose build                         # değişen imajlar
docker compose run --rm migrate              # yeni migration'lar (up -d de otomatik çalıştırır)
docker compose up -d                         # değişen servisler yeniden başlar
docker compose ps && curl -fsS https://yemekgelsin.net/api/v1/health
```

- Yeniden başlatma birkaç saniye sürer; panel SSE bağlantısı `Last-Event-ID` ile kaldığı yerden devam eder ve 45 sn'lik emniyet sorgusu eksikleri toplar (14 §7.1). Yine de güncellemeyi yoğun saatlerin (öğle, akşam) dışında yapın.
- Worker `SIGTERM`'de elindeki işi bitirip kapanır (`stop_grace_period: 30s`).
- **Geri alma:** `git checkout <önceki-sürüm-etiketi> && docker compose build && docker compose up -d`. Yeni sürüm bir migration uyguladıysa ve eski kod yeni şemayla çalışmıyorsa önceki yedekten `restore.sh` gerekir; bu yüzden her sürüm etiketlenir ve migration notu sürüm açıklamasına yazılır.
- `.env` değişikliği yalnız `docker compose up -d` ister; `DOMAIN`/`DEV_TOOLS` değişikliği web'in yeniden derlenmesini ister (§4).

## 10. İzleme

> **Hangi satır hangi ortamda?** Canlı ortam Cloudflare'dir (§13) ve **container'a kabuk erişimi yoktur**: aşağıdaki `docker compose …` / `psql` komutları yalnız yerel geliştirme ile isteğe bağlı VPS yolunda (§14) çalışır. Canlıda karşılıkları şunlardır: günlükler `npx wrangler tail siparisinonunde-dev`, kuyruk ve DLQ `/admin/isler` (`GET /api/v1/admin/jobs?status=failed`), sağlık uçları aynı adreslerde, yedek nesneleri Cloudflare > R2 > `siparisinonunde-dev-yedek`. Uyarı geldiğinde ne yapılacağı [17](17-olay-mudahale-runbook.md)'dedir.

| Ne | Nasıl |
|---|---|
| Operasyon uyarıları | `ALERT_WEBHOOK_URL` (Worker secret'ı, §13 madde 5) — API ve Worker kritik olayları buraya JSON POST eder; tanımsızsa uyarılar **yalnız günlüğe** düşer. Üretilen uyarı türlerinin tamamı ve her biri için ilk 5 dakika: [17](17-olay-mudahale-runbook.md) §1 |
| Servis durumu | `docker compose ps` — `api`, `web`, `worker` (vadesi 5 dk'yı geçmiş bekleyen iş varsa sağlıksız, `scripts/worker-health.ts`), `postgres` sağlık denetimleri |
| Sağlık ucu | `GET /api/v1/health` → `{"ok":true,"db":"up"}`; veritabanı yoksa 503. Dışarıdan (Uptime Kuma vb.) 1 dk aralıkla izlenir ve P1 bildirimi gönderir. **Nöbet ekibi yoktur**, bildirim tek kişiye (proje sahibi) gider: [17](17-olay-mudahale-runbook.md) §5 |
| Worker sağlık ucu | `GET /api/v1/health/worker` → `{"ok":true,"degraded":false,"warnings":[],"jobLagSec":0,"stuckJobs":0,…}`; ayrıntılı ölçümler (`lastBackupAgeSec`, `diskFreePct`, `memUsedPct` …) **yalnız belirteçle** gelir (aşağıdaki "Ayrıntılı ölçümler"). **İKİ AYRI SİNYAL:** `ok` + durum kodu "hizmet verilebiliyor mu", `degraded` + `warnings` "bir eşik aşıldı mı". **503** (`ok:false`) yalnız şu üç durumda: veritabanı düşmüş · vadesi gelmiş bekleyen iş 300 sn'den fazla gecikmiş · 10 dk'dan uzun `running` iş var. Yedek yaşı, disk ve bellek eşikleri **200 döndürür** ve `warnings` ile uyarı kanalına gider (`backup_stale`, `disk_low`, `memory_high`). Worker süreci ayakta ama takılıysa yalnız bu uç yakalar (alarm zinciri, WhatsApp/SMS gönderimi işlerdedir); dış izlemeye `/api/v1/health` ile birlikte eklenir, P1. Ayrıntı: aşağıdaki "Yedek yaşı ve kaynak eşikleri" |
| Loglar | `docker compose logs -f --since 15m api worker` (JSON; telefon/adres maskeli). Konteyner logları 5×20 MB ile sınırlıdır |
| Erişim logları | Caddy her isteği JSON olarak iki yere yazar: `docker compose logs caddy` (son günler, sorun giderme) ve `caddy_logs` birimindeki `/var/log/caddy/access.log` (100 MB'ta döner, **366 gün** saklanır; 5651 trafik kaydı, 08 §2.8 satır 10). Okuma: `docker compose exec caddy tail -f /var/log/caddy/access.log`. Yoldaki gizli belirteçler (webhook, takip linki, kurye girişi `?t=`) `***` olarak yazılır; çerez ve `Authorization` başlıkları maskelidir. Disk: 1 yılda birkaç GB; `docker system df -v` ile izleyin |
| Admin paneli | `Özet` (lifecycle'a göre işletmeler, bugünkü sipariş, açık alarm, başarısız iş, **saklama işi**: son koşu 48 saatten eskiyse "Gecikti", hatalıysa "Hata"), `İşler` (`/admin/isler`: başarısız işler = DLQ, tek tıkla yeniden dene), `WhatsApp` (hesap sağlığı; kırmızılar üstte), `Bayraklar` (kill-switch'ler), `Denetim` (audit log) |
| Veritabanı | 500 ms'yi aşan sorgular postgres loguna düşer (`log_min_duration_statement`). Disk: `docker system df`, `df -h` |
| Kuyruk | `docker compose exec postgres psql -U siparis -c "select status, count(*) from jobs group by 1"` |
| Saklama ve imha (08 §2.8) | `cron.retention` her gün 03:00'te (İstanbul) çalışır; her adım `retention_runs`'a bir satır yazar (iş adı, tenant, etkilenen kayıt sayısı, süre, hata; imha tutanağı, ≥ 3 yıl, silinmez). Son koşu: `docker compose exec postgres psql -U siparis -c "select job_name, tenant_id, affected_count, duration_ms, error from retention_runs where started_at > now() - interval '1 day' order by started_at"`. Hatalı adım diğerlerini durdurmaz; iş yeniden denenir, denemeler biterse `Admin > İşler`'de görünür |

**Yedek yaşı ve kaynak eşikleri (`/api/v1/health/worker`).** Yedek yazılamaması, dolan disk ve OOM'a giden bellek
eskiden hiçbir yerde görünmüyordu; artık bu uç raporlar. Eşik aşımı `degraded:true` + `warnings:[…]` üretir ve
**durum kodu 200 kalır** — haber yolu uyarı kanalıdır:

| Alan | Ne ölçer | `warnings` kodu | Eşik (ortam değişkeni, varsayılan) |
|---|---|---|---|
| `lastBackupAgeSec` | Son **başarılı** yedek turunun üzerinden geçen süre (sn). Durum dosyası yoksa `null` — ilk yedek turundan önce uyarı üretmez | `backup_stale` (critical) | `HEALTH_MAX_BACKUP_AGE_SEC` = `900` (2 dk'lık turun ~7 kez kaçırılması) |
| `diskFreePct`, `diskFreeMb` | `HEALTH_DISK_PATH` (varsayılan `UPLOAD_DIR`, yoksa `/data`) yolundaki boş alan; yol okunamazsa `null` | `disk_low` (warning) | `HEALTH_MIN_DISK_FREE_PCT` = `15` (§14.3 dağıtım kapısı ve 06 §14.1 "Disk > %85 → P2" ile aynı) |
| `memUsedPct`, `memRssMb` | API sürecinin yığın kullanımının kendi tavanına (`--max-old-space-size`) oranı ve yerleşik belleği | `memory_high` (critical) | `HEALTH_MAX_MEM_USED_PCT` = `95` |

**Ayrıntılı ölçümler belirteç ister (denetim 2026-10-05 bulgu A-2).** Bu uç **kimlik doğrulamasızdır** ve
Worker'daki parola kapısının dışındadır (gizli staging'de bile açıktır): dış izleme ve dağıtımın duman testi
oraya belirteçsiz bakar. Bu yüzden yanıt iki parçaya ayrıldı:

| | Alanlar | Kim görür |
|---|---|---|
| **Sade (sözleşme, değişmez)** | `ok`, `degraded`, `warnings`, `db`, `jobLagSec`, `stuckJobs`, `maxLagSec`, `time` | herkes |
| **Ayrıntılı ölçüm** | `lastBackupAgeSec`, `maxBackupAgeSec`, `diskFreePct`, `diskFreeMb`, `minDiskFreePct`, `memUsedPct`, `memRssMb`, `maxMemUsedPct` | yalnız `x-health-metrics-token` başlığı doğru olan istek |

- **Neden:** bu sayılar altyapının iç durumudur ve saldırgana **zamanlama** bilgisi verir — yedeğin ne zaman
  alındığı ("son tur 110 sn önce"), diskin ne zaman dolacağı, belleğin OOM'a ne kadar yakın olduğu. Arızanın
  **sınıfı** (`warnings`) açık kaldı çünkü haber yolu odur; **miktarı ve anı** gizlendi.
- **Belirteç verilmezse ayrıntılar hiç kimseye görünmez ve uç yine 200 döner.** Karar bilinçlidir: ters karar
  ("belirteç yoksa herkese açık") açığı varsayılan yapardı. Gizlemenin bedeli küçüktür — eşik aşımının haber
  yolu zaten `warnings` + uyarı kanalıdır ve ikisi de açık kalır; Worker'ın yedek gözcüsü de kararını
  `warnings`'ten verir, yalnız `yedek_eskidi` uyarısının gövdesindeki `yasSn`/`esikSn` eksilir. 401/503 dönmek
  ise container healthcheck'ini, duman testini ve dış izlemeyi kırardı.
- **Okuma:**

  ```bash
  # Sade (her yerden): hizmet verilebiliyor mu + eşik aşıldı mı
  curl -s https://yemekgelsin.net/api/v1/health/worker | jq '{ok, degraded, warnings, jobLagSec, stuckJobs}'
  # Ayrıntılı (belirteçle): yedek yaşı, disk, bellek
  curl -s -H "x-health-metrics-token: $HEALTH_METRICS_TOKEN" https://yemekgelsin.net/api/v1/health/worker | jq
  ```

- **ERAY'IN YAPACAĞI ADIM (ayrıntıları açmak; isteğe bağlı, 3 dk).** Ayrıntılar bugün **kapalıdır**:
  1. Belirteç üret: `openssl rand -hex 24` (48 karakter; **24 karakterden kısası kurulmamış sayılır** — uç
     kimlik doğrulamasız olduğu için kısa belirteç kaba kuvvetle bulunur. Kısa değer verilirse uç ilk yoklamada
     günlüğe bir kez uyarı yazar).
  2. Worker'a secret olarak ver: `cd deploy/cloudflare && npx wrangler secret put HEALTH_METRICS_TOKEN`
     (iş akışının `--secrets-file` listesi isteğe bağlı secret'lara dokunmaz, kalıcı olur — §13 madde 5).
  3. **DIŞ BAĞIMLILIK (kod değişikliği):** değerin container'a geçmesi için `deploy/cloudflare/src/mode.ts`
     içindeki `PASSTHROUGH_KEYS` listesine `'HEALTH_METRICS_TOKEN'` eklenmeli (`ALERT_WEBHOOK_URL` ile aynı
     desen) **ve** `deploy/cloudflare/scripts/mode.test.mjs` `SCOPE_OUT` listesinden silinmeli. O satır
     yazılmadan secret verilse bile API beklenen değeri bilmez: Worker başlığı gönderir, ayrıntı gelmez.
  4. Aynı değeri parola yöneticisine yazın; dış izlemeye ayrıntı gerekmiyorsa (gerekmez) yalnız elle teşhiste
     kullanılır.

- **"Çalışıyor mu" ile "sağlıklı mı" ayrıdır (denetim 2026-10-05 bulgu A).** Bu eşikler ilk yazıldığında `ok:false` + 503 üretiyordu; dağıtımın duman testi bu uca 200 bekliyor ve kırmızısı `wrangler rollback` tetikliyor (§13 madde 6) — yani **sağlam bir dağıtım, yalnızca son yedek biraz eski diye otomatik geri alınıyordu**. Yedek eskimesi bir dağıtım hatası değildir, geri alma onu düzeltmez, üstüne yeni container açılışı son yedekten sonraki ~2 dakikayı kaybettirir. Artık eşik aşımı dağıtımı ve container'ı değil **nöbetçiyi** rahatsız eder: `warnings` + uyarı kanalı.
- **Eşik aşımının haber yolu uyarı kanalıdır** (`ALERT_WEBHOOK_URL`), iki katmandan:
  - **API:** `/health/worker` her yoklandığında eşik aşımı varsa `alert()` çalışır (`kind` = `warnings` kodu, aynı kod için **30 dk** soğuma — iki katman: log satırının dizgini eşik düzelince sıfırlanır, **webhook gönderiminin dizgini sıfırlanmaz**, yani 30 dk içinde düzelip tekrarlayan arıza günlükte hemen görünür ama webhook pencerenin sonunu bekler). Runbook satırları [17](17-olay-mudahale-runbook.md) §1.1 **U-25…U-27**.
  - **Worker:** 5 dakikalık uyanık tutma turu artık `/health/worker`'ı da yoklar (yalnız `/health`'i yokluyordu, yani yedek yaşını **hiçbir yoklama görmüyordu**) ve yedek eskiyse `yedek_eskidi` uyarısı gönderir; soğuma **1 saat**, damga Durable Object deposunda (cron her turda yeni isolate'te koşabilir). Runbook: [17](17-olay-mudahale-runbook.md) §1.2 **U-28**.
- **Dış izlemede eşik aşımını görmek için gövdeye bakın:** durum kodu 200 kaldığı için yalnız HTTP koduna bakan bir monitör eşik aşımını göremez. Uptime Kuma'da `/api/v1/health/worker` için **ikinci** bir monitör açıp "Keyword" tipiyle `"degraded":true` arayın (ters eşleşme) ya da uyarı kanalına güvenin. `degraded` ve `warnings` **sade alanlardır**, yani monitöre belirteç girmek gerekmez (girilmesin: belirteç izleme sağlayıcısına yazılmış bir sır olurdu).
- **Eşiği `0` yapmak o eşiği kapatır** (ölçüm yapılmaya devam eder ve belirteçli yanıtta görünür, yalnız uyarı üretmez): yanlış alarm veren bir eşik dağıtım beklemeden susturulabilir.
- Bellek oranı cgroup'un `memory.current`'ından **değil** V8 yığın tavanından hesaplanır: `memory.current` geri kazanılabilir sayfa önbelleğini de sayar, dolu önbellekli container'da sürekli yanlış alarm olurdu. 1 GiB container'da üç sürecin yığın tavanı toplamı 704 MiB'dır (§16.2), yani OOM'u önce bu oran haber verir.
- **Bu eşikler bilerek `/api/v1/health`'te değildir:** o uç container healthcheck'i, Worker'ın canlılık cron'u ve dağıtımın sürüm kapısıdır; orada 503 dönmek container'ı yeniden başlatır (çökme son ~2 dakikayı kaybettirir) ve dağıtımı bloke eder. "Disk doluyor" halinde yeniden başlatma döngüsü sorunu büyütür. `/health`'in alanları ve anlamları değişmemiştir.
- **Dış izleme:** `/api/v1/health` ve `/api/v1/health/worker` **1 dakika** aralıkla yoklanır, **3 ardışık hatada** telefon çalar (P1 — tek kişi, [17](17-olay-mudahale-runbook.md) §5). `/health/worker` dağıtımın duman testinde de 200 beklenir; eşik aşımı 200'ü bozmadığı için dağıtımı **durdurmaz**, yalnız iş akışı özetine `degraded` uyarısı basılır.
- Bu eşik **container yolunun** (§13, 2 dakikada bir yedek) eşiğidir. VPS yolundaki gecelik yedeğin karşılığı `BACKUP_PING_URL` + 26 saatlik push monitörüdür (§8, 06 §14.1); ikisi birbirinin yerine geçmez.
- **Yedek durum dosyası (sözleşme):** yolu **`BACKUP_STATE_FILE`** belirler (varsayılan `/tmp/yedek-durum.json`; `BACKUP_STATUS_FILE` yalnız geriye dönük addır). Dosyayı **yalnız** `deploy/cloudflare/entrypoint.sh` (`backup_state_write`) yazar — **her** turda, hata turunda da; yaş `lastSuccessUnix` alanından hesaplanır ve o alan yalnız **başarılı** turda tazelenir. "Değişiklik yok, yüklemedim" turu başarılıdır ve yaşı sıfırlar (yoksa siparişsiz bir gece yanlış alarm verir); `pg_dump`/doğrulama/yükleme hatasında tazelenmez, böylece yazamayan yedek yaş olarak görünür. Dosya yok, bozuk ya da hiç başarılı tur olmamış (`lastSuccessUnix: 0`) → `null`, uyarı üretmez. **Alanların tamamı ve anlamları §13 "Yedek durumu" maddesindedir** (tek kaynak orası; burada yalnız sağlık ucunun okuduğu kadarı var). Kabuk erişimi olmadığı için dosya elle okunamaz: gözlenebilir sinyaller `warnings` (herkese açık), `lastBackupAgeSec` (**belirteçle**, §10 "Ayrıntılı ölçümler") ve container günlüğüdür.

**Panel dışı uyarılar (00 §10 alarm zinciri).** Panelde ses ve kırmızı bant (t=0, 60 sn) dışında şu halkalar sunucu tarafında çalışır; hepsi worker işleridir:

- **Web Push (t=0, `push.send`):** Sipariş `new` olunca şubeye erişen sahip, yönetici, kasiyer ve mutfak kullanıcılarının kayıtlı cihazlarına bildirim gider: "Yeni sipariş #1051 · 3 ürün · 245,00 TL" (mutfakta tutar yok; müşteri adı, telefonu, adresi hiçbir zaman yok). Telefon siparişi ve canary göndermez; kurulum testi "TEST #" etiketiyle gider. Cihaz, "Siparişleri almaya başla" dokunuşunda izin verip abone olur; durum ve aç/kapa `Panel › Ayarlar › Bu cihazda bildirimler` (`/panel/ayarlar/bildirimler/cihaz`; kasiyer/mutfak için telefonda "Diğer" menüsünde, masaüstünde kullanıcı menüsünde) ekranındadır, oradan test bildirimi de gönderilir. Çıkış yapılınca o cihazın kaydı silinir. İtme servisi aboneliği silmişse (404/410) kayıt kapatılır; geçici hatalar o abonelik için 3 denemeye kadar yeniden denenir. `VAPID_*` boşsa bu halka kapalıdır (§4).
  - **iPhone/iPad:** Web Push yalnız **ana ekrana eklenmiş** panelde ve **iOS/iPadOS 16.4+** ile çalışır (Safari › Paylaş › Ana Ekrana Ekle; paneli ana ekrandaki "Siparişler" simgesinden açıp giriş yapın, vardiyayı başlatın). Safari sekmesinde bildirim izni hiç sorulmaz. Kilit ekranında görünür; ses/titreşim iOS bildirim ayarlarına bağlıdır, tekrarlayan alarm sesi yoktur.
  - **Android/masaüstü:** Chrome, Edge, Firefox. Android'de Chrome'un bildirim sesi açık olmalı, pil tasarrufu Chrome'u kısıtlamamalı; masaüstünde bildirim dokunulana kadar ekranda kalır. Gizli sekmede push çalışmaz.
  - Push, açık paneldeki alarm sesinin yerini tutmaz: sekme kapalıyken sesli döngü yoktur, tek bildirim gelir. Asıl güvence 2 dk platform WhatsApp ve 5 dk SMS halkalarıdır; bu yüzden `PLATFORM_WA_PROVIDER` ve `SMS_PROVIDER` üretimde gerçek sağlayıcı olmalıdır (§4).
- **Panel çevrimdışı dedektörü (`cron.panel_presence`, dakikada bir):** Sipariş ekranının canlı akışı (SSE) açıkken şube dakikada bir "görüldü" yazılır (`branch_panel_presence`; yalnız sahip/yönetici/kasiyer ekranları sayılır, mutfak ekranı ve destek görünümü sayılmaz). Şube sipariş alırken ekran 5 dk'dır görülmüyorsa ya da açılıştan beri hiç görülmeyip açılış 10 dk'yı geçtiyse sahibine platform WhatsApp'tan `isletme_panel_cevrimdisi_v1` gider (§6.5); şube başına 60 dk'da en çok 1 **ve yerel günde en çok 1** (`offline_alert_count`; gün dönünce sıfırlanır). Böylece paneli hiç açılmayan şube günde tek mesaj alır, ertesi gün uyarı yine çalışır; gün içinde panel açılıp yine kapanırsa ikinci mesaj gitmez. Çalışma saati dışında, duraklatılmış şubede, `ordering_enabled` kapalı, web'de canlı olmayan, aday/kurulumdaki/salt-okunur/askıdaki/kapanmış ve demo işletmelerde çalışmaz. Bu sürümde SMS ve "storefront'u otomatik durdur" seçeneği (04 §7.4) yoktur.
- **Sonraki halkalar:** 2 dk platform WhatsApp uyarısı, 5 dk SMS, 10 dk müşteriye bilgi ve 15 dk otomatik iptal panelden bağımsız çalışır (`order.alarm_step`).

İzleme sorguları:

```bash
# Web Push: etkin/kapatılmış abonelik ve son hatalar
docker compose exec postgres psql -U siparis -c "select count(*) filter (where disabled_at is null) as etkin, count(*) filter (where disabled_at is not null) as kapali, max(last_success_at) as son_basari from push_subscriptions"
docker compose exec postgres psql -U siparis -c "select status, count(*) from jobs where type = 'push.send' and created_at > now() - interval '1 day' group by 1"
# Panel varlığı: son görülme ve son çevrimdışı uyarısı
docker compose exec postgres psql -U siparis -c "select b.name, p.last_seen_at, p.offline_alerted_at, p.offline_alert_count from branch_panel_presence p join branches b on b.id = p.branch_id order by p.last_seen_at nulls first"
```

## 11. Sorun giderme

**Sipariş düşmüyor**

1. Vitrinde "sipariş almıyor" bandı var mı? `curl -s https://DOMAIN/api/v1/store/<slug> | jq .branch.orderingState` → `closed` (çalışma saatleri/özel gün), `paused` (panelden durdurulmuş ya da `ordering_enabled=false`, askıya alınmış işletme). Admin > İşletme detayında lifecycle ve `ordering_enabled`'a bakın.
2. Sipariş `awaiting_customer`'da mı kalıyor? Akış B doğrulaması tamamlanmamıştır: WhatsApp kod mesajı gelmiyorsa aşağıdaki "Webhook gelmiyor" adımları; SMS yedeği açık mı (`sms_fallback` bayrağı + işletme izni). 30 dk sonra sipariş `customer_timeout` ile iptal olur.
3. Sipariş `new` ama panelde yok: paneldeki bağlantı bandına bakın (SSE); sayfayı yenileyin (`GET /panel/orders/active` her 45 sn'de de çalışır). Doğru şube/işletme seçili mi?
4. Alarm zinciri çalışmıyor (platform WhatsApp uyarısı, SMS): worker çalışıyor mu (`docker compose ps worker`, `logs worker`), `Admin > İşler`'de başarısız iş var mı?

**Webhook gelmiyor (müşteri yazıyor, bot yanıt vermiyor)**

1. `Admin > WhatsApp` → **ortak numara** kartında "son webhook" eski mi, sorun satırı var mı? 360dialog yolunda: `WhatsApp kurulumu > Bağlantıyı test et` webhook satırı "doğru" mu? Değilse "Webhook'u 360dialog'a kaydet" (§6.2 C.2; yeni API anahtarından sonra her zaman). Meta doğrudan yolda: uygulamanın Webhook ayarındaki adres `https://DOMAIN/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>` ile birebir aynı mı, `messages` alanına abonelik ve uygulama canlı modda mı (§6.2c madde 12–13)? Kendi numaralı işletmede: işletmenin satırında "son webhook" ve sağlayıcıya tanımlı adres paneldeki adresle aynı mı (§6.8)?
2. Ortak numara dışarıdan: `curl -i "https://DOMAIN/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>?hub.mode=subscribe&hub.verify_token=<WA_VERIFY_TOKEN>&hub.challenge=42"` → `42` (404 = belirteç `.env`'dekinden farklı ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş; 403 = `WA_VERIFY_TOKEN` farklı). Kendi numaralı işletme: `curl -i -X POST https://DOMAIN/api/v1/webhooks/wa/<belirteç> -H 'Content-Type: application/json' -d '{}'` → 200 beklenir (400 = gövde geçersiz ama yol çalışıyor; 404 = belirteç yanlış, adres panelden yenilenmiş (Ayarlar > WhatsApp bağlantısı > "Webhook adresini yenile": eski adres hemen geçersizleşir, yenisi sağlayıcı paneline girilmeli) ya da WhatsApp bağlantısı kesilmiş (kesik hesabın adresi olay kabul etmez; kesme işlemi adresi de yeniler, yeniden bağlarken paneldeki yeni adres girilmeli); 401 `invalid_signature` = cloud hesabında `WA_APP_SECRET` uyuşmuyor).
3. Caddy erişim loglarında istek görünüyor mu? `docker compose logs --since 1h caddy | grep 'webhooks/wa'` (belirteç `***` olarak yazılır; `status` alanı yanıt kodudur). Görünmüyorsa DNS/TLS ya da sağlayıcı tarafı; görünüyorsa API loglarına bakın.
4. Olay kaydedildi ama işlenmedi: `select count(*) from wa_webhook_events where processed_at is null` → worker'ı ve `wa-inbound` işlerini kontrol edin.
5. Giden mesaj `failed`: sohbet ekranında hata kodu; 131047 = 24 saat penceresi dışı (şablon gerekir), token/ödeme hataları hesabı `error`'a çeker ve işletme WhatsApp'sız moda düşer.

**SSE (canlı ekran) kopuyor**

1. Panelde "Yeniden bağlanıyor" bandı sık mı görünüyor? Tarayıcı geliştirici araçlarında `/api/v1/panel/stream` isteğinin 15 sn'de bir `ping` aldığını doğrulayın.
2. Araya giren vekiller: canlı ortamda Cloudflare proxy'si (turuncu bulut) açıktır (00 §12a madde 10); API `cache-control: no-cache, no-transform` gönderir ve 15 sn'de bir ping atar, Caddy `/api/*` için `flush_interval -1` ile sıkıştırmasız iletir. Kopmalar Cloudflare'den geliyorsa önce Cloudflare > Rules'ta `/api/v1/panel/stream` için önbellek/sıkıştırma kuralı olmadığını denetleyin; son çare kök alan adının A kaydını geçici olarak "Yalnız DNS" (gri bulut) yapmaktır (canlı ortam iş akışı sonraki dağıtımda proxy'yi yeniden açar; kalıcı karar 00 §12a'ya yazılır). Kurumsal ağ vekilleri de tamponlayabilir; başka bir nginx eklenirse `proxy_buffering off` ve `X-Accel-Buffering: no` gerekir.
3. Tablet uykuya geçiyor: "Vardiyayı başlat" Wake Lock ister; cihazın güç tasarrufu ayarını kapatın.
4. Kopmalar sunucu yeniden başlatmalarıyla aynı anda mı? Güncellemeleri yoğun saat dışına alın (§9). Kaçan olaylar `Last-Event-ID` ile yeniden oynatılır; 1000'den fazla olay kaçarsa panel tam yenilenir (resync).

**Yeni sipariş bildirimi (Web Push) gelmiyor**

1. Açılış logunda `Web Push kapalı` uyarısı var mı? `docker compose exec api printenv VAPID_PUBLIC_KEY` boşsa §4'teki gibi anahtar üretin. `curl -s -b <panel çerezi> https://DOMAIN/api/v1/panel/push/public-key` → `"enabled":true` olmalı.
2. Cihazda `Ayarlar › Bu cihazda bildirimler`: "Bildirim izni: Engellendi" ise tarayıcı/cihaz ayarından izin verilir; "Bu cihazın kaydı: Kayıtlı değil" ise anahtar açılır. "Test bildirimi gönder" gelmiyorsa sorun cihaz tarafındadır (rahatsız etme modu, Chrome bildirim sesi, pil tasarrufu).
3. iPhone/iPad'de panel Safari sekmesinden değil ana ekrandaki simgeden açılmalı (iOS 16.4+, §10).
4. `select last_error, disabled_at, last_success_at from push_subscriptions where user_id = …`: `HTTP 410/404` → itme servisi aboneliği sildi (uygulama silinmiş, tarayıcı verisi temizlenmiş); cihazda anahtarı kapatıp açın ya da vardiyayı yeniden başlatın. `HTTP 403/401` → VAPID anahtarları değişmiş olabilir; cihazlar yeniden abone olmalı.
5. `Admin › İşler`'de başarısız `push.send` var mı? Sunucunun `fcm.googleapis.com`, `web.push.apple.com`, `*.push.services.mozilla.com` adreslerine 443 üzerinden çıkışı açık olmalı.

**Diğer**

- *Sertifika alınamıyor:* `docker compose logs caddy | grep -i -E 'error|acme'`. Wildcard için `CLOUDFLARE_API_TOKEN` yetkisi; 80/443 açık mı; Let's Encrypt oran sınırına takıldıysa bekleyin.
- *Giriş yapılıyor ama oturum düşüyor:* üretimde çerez `Secure`'dur; site mutlaka `https://` ile açılmalı, `APP_BASE_URL` https olmalı.
- *İki adımlı doğrulama kodu hep "hatalı":* kodlar zamana dayalıdır, ±30 sn tolerans vardır. Telefonun saati "otomatik" olmalı; sunucu saatini `timedatectl` ile denetleyin (NTP senkron). Aynı kod ikinci kez kabul edilmez; 10 dk'da 5'ten fazla deneme 429 döner, birkaç dakika bekleyin. Hesap kilitliyse kurtarma kodu ya da `create-admin.ts --reset-totp` (§5).
- *Yönetim ekranı açılmıyor, hep Güvenlik'e dönüyor:* platform yöneticisinin iki adımlı doğrulaması kurulmamış (API `403 totp_enrollment_required`); §5'teki adımlarla kurun.
- *Takip linkleri "süresi doldu" diyor:* teslimden 7 gün sonra normaldir (00 §7); tümü birden bozulduysa `TRACKING_SECRET` değişmiştir.
- *"WhatsApp/SMS anahtarı çözülemedi":* `ENCRYPTION_KEY` değişmiş ya da kaybolmuştur; eski anahtarı geri koyun ya da işletmeler anahtarlarını panelden yeniden girer.

## 12. Canlıya çıkış kontrol listesi

> Canlı ortam Cloudflare'dedir (§13). Aşağıdaki maddelerden sunucuya (`.env`, UFW, fail2ban, Caddy logu, yedek cron'u, `docker compose`) ait olanlar yalnız isteğe bağlı VPS yolunda geçerlidir; Cloudflare karşılıkları §13 "Canlıya çıkış (Cloudflare)" listesindedir.

**Teknik**

- [ ] `SUPPORT_WHATSAPP` dolu ve web bu değerle derlendi: `/panel/giris` › "Parolamı unuttum" destek numarasını gösteriyor. İşletme sahibinin parolası, kimlik başka kanaldan doğrulandıktan sonra admin panelinden sıfırlanır.
- [ ] `.env`'de `DEV_TOOLS=0` ve web bu değerle derlendi: `curl -o /dev/null -w '%{http_code}' https://DOMAIN/dev/whatsapp` → 404, `https://DOMAIN/api/v1/dev/wa/accounts` → 404.
- [ ] Demo verisi yok (00 §12a madde 10): `select email from users where email in ('demo@yemekgelsin.net','mudur@yemekgelsin.net','kasa@yemekgelsin.net','mutfak@yemekgelsin.net','kurye@yemekgelsin.net','doner@yemekgelsin.net')` boş; `select slug from tenants where is_demo` boş (önyükleme betiği demo işletme görürse uyarır). `admin@yemekgelsin.net` canlı ortamın gerçek platform yöneticisidir: iş akışı `ADMIN_PASSWORD` ile açar, parolası yerel geliştirme parolası (`admin1234`) değildir ve iki adımlı doğrulaması kuruludur.
- [ ] Gizli anahtarlar rastgele üretildi (§4) ve `ENCRYPTION_KEY`, `TRACKING_SECRET` parola yöneticisinde + ayrı bir güvenli yerde saklı.
- [ ] Platform yöneticileri `create-admin.ts` ile açıldı ve her biri **iki adımlı doğrulamayı (TOTP) kurdu** (00 §12a madde 7, 14 §5): girişte `/admin/guvenlik` → QR'ı okut → 6 haneli kodla aç → 8 kurtarma kodunu kaydet (§5). Kontrol: `docker compose exec api printenv ADMIN_TOTP_REQUIRED` → `true`; `select email from users where is_platform_admin and totp_enabled_at is null` boş; kurtarma kodlarıyla giriş bir kez denendi (kullanılan kod yenilenerek yerine konur).
- [ ] Yedek cron'u `siparis` kullanıcısının crontab'ında kurulu, ilk elle çalıştırmada `backups/` altında `600` izinli döküm oluştu, `BACKUP_REMOTE` ikinci Türkiye lokasyonuna kopyalıyor, `BACKUP_PING_URL` dış izlemede 26 saatlik push monitörüne bağlı, bir geri yükleme tatbikatı (`restore.sh --target`) başarıyla yapıldı; PITR (WAL arşivleme) kuruldu (00 §11).
- [ ] Caddy erişim logu dosyaya yazılıyor: `docker compose exec caddy ls -l /var/log/caddy/` (5651, 1 yıl).
- [ ] Dış izleme `GET /api/v1/health` ve `GET /api/v1/health/worker`'ı 1 dk aralıkla izliyor, 3 ardışık hatada P1 bildirimi nöbetçiye gidiyor; `Admin > İşler`'de başarısız iş yok. `/health/worker` yanıtında `degraded` **false** ve `warnings` **boş** (§10). Eşik aşımı 503 ÜRETMEZ: ikinci bir "Keyword" monitörü `"degraded":true` arıyor ya da `ALERT_WEBHOOK_URL` tanımlı (§10). Monitörlere belirteç GİRİLMEZ: `degraded`/`warnings` sade alanlardır.
- [ ] Yedek yaşı gerçekten ölçülüyor: `HEALTH_METRICS_TOKEN` kuruluysa `curl -s -H "x-health-metrics-token: …" …/api/v1/health/worker` yanıtında `lastBackupAgeSec` **sayı** (`null` ise yedek yaşı hâlâ kör — durum dosyası yazılmıyor, §13 "Yedek durumu"). Belirteç kurulmadıysa (varsayılan) bu alan yanıtta **hiç bulunmaz**: o zaman kanıt `warnings` boşluğu + container günlüğündeki `veritabanı yedeği R2'ye yazıldı` satırıdır (§10 "Ayrıntılı ölçümler", §13).
- [ ] Sağlayıcılar gerçek: `docker compose exec worker printenv SMS_PROVIDER PLATFORM_WA_PROVIDER WA_DEFAULT_PROVIDER` çıktısında `mock` yok (§4).
- [ ] Web Push açık: `VAPID_*` dolu, açılış logunda `Web Push kapalı` uyarısı yok; bir Android tablette ve ana ekrana eklenmiş bir iPhone'da "Siparişleri almaya başla" → izin → `Ayarlar › Bu cihazda bildirimler › Test bildirimi gönder` geldi; panel sekmesi kapalıyken verilen deneme siparişinde "Yeni sipariş #…" bildirimi geldi (§10).
- [ ] Panel çevrimdışı uyarısı denendi: açık saatte paneli kapatıp 5 dk bekleyince sahibin telefonuna `isletme_panel_cevrimdisi_v1` geldi (`notifications` tablosunda `kind = 'panel_offline'`).
- [ ] Sunucu: UFW açık (22/80/443), fail2ban sshd jail'i açık (`fail2ban-client status sshd`), otomatik güvenlik güncellemeleri açık, `.env` izni 600. İş akışı parola ile bağlandığından SSH parolası uzun ve rastgele; mümkünse `VPS_HOST_KEY` sabitlendi (§14).
- [ ] Ortak numara bağlı (§6.2 360dialog ya da §6.2b Meta doğrudan): görünen ad "Yemek Gelsin" onaylı, işletme doğrulaması tamam, ödeme yöntemi tanımlı, `PLATFORM_WA_DISPLAY_PHONE` ve `PLATFORM_WA_WEBHOOK_TOKEN` dolu, webhook tanımlı (`Admin > WhatsApp` ortak numara kartında sorun satırı yok; **WhatsApp kurulumu**nda "Bağlantıyı test et" hazır — 360dialog'da webhook satırı "doğru", Meta doğrudan yolda "Aboneliği kontrol et" açık —, tüm şablonlar Onaylandı). İki farklı işletmenin QR'ı gerçek telefonla okutuldu: her birinde o işletmenin adıyla karşılama → "Menüyü aç" → sipariş → doğru işletmenin panelinde alarm → onay mesajı; kodsuz yazınca dükkan seçici geldi. Müşteri ve platform şablonları onaylı (V-011).
- [ ] Netgsm başlığı onaylı, OTP ve "onaylandı" SMS'i gerçek telefona geldi (V-012, V-020, V-023).
- [ ] `pnpm test` ve `pnpm e2e` yeşil (yayınlanan sürüm etiketinde); "Canlı ortam (Cloudflare)" iş akışının son çalışması yeşil (duman testi gerçek alan adında geçti).

**Hukuki / operasyonel** — [08](08-mevzuat-kvkk-odeme-fatura.md) §9.1 "MVP öncesi zorunlu" setinin tamamı; özellikle:

- [ ] Şirket, vergi levhası, e-Tebligat; marka başvurusu ve alan adları (V-002).
- [ ] Kurumsal aydınlatma metni, gizlilik ve çerez politikası; abonelik sözleşmesi + kullanım koşulları + DPA + alt işleyen listesi (click-wrap, sürümlü); son müşteri aydınlatma, ön bilgilendirme ve mesafeli satış şablonları avukat onaylı ve `/yasal/*` sayfalarındaki "Hukuki inceleme bekliyor" etiketleri kaldırıldı.
- [ ] Site künyesi gerçek bilgilerle dolduruldu: `LEGAL_ENTITY_*` değişkenleri şirket belgelerinden girildi **hem API'nin okuduğu yere** (VPS: `.env`; Cloudflare: `wrangler.jsonc` `vars`) **hem de web derlemesine** (VPS: `docker compose build web`), `node --import tsx scripts/check-legal.ts` **çıkış kodu 0** verdi, `/kunye` sayfasında "Eksik yapılandırma" satırı yok **ve** canlı adreste bir vitrinden gerçek bir sipariş geçti (503 `ordering_unavailable` dönmüyor — zorunlu künye alanı eksikse sipariş ucu kapalıdır, §4); vitrinde işletme künyesi alanları zorunlu.
- [ ] `LEGAL_DOCUMENT_VERSION` tarihli yayın sürümüne çevrildi ve içerik özeti **iki yere birden** sabitlendi: `scripts/check-legal.ts` `PINNED_TEXT_DIGEST` ve `apps/api/src/services/orders/legal-gate.ts` `LEGAL_TEXT_DIGESTS` (`node --import tsx scripts/check-legal.ts --ozet` çıktısı). Fail-closed kapı **çalışır durumdadır** (08 §7.5): taslak sürüm, eksik künye ya da sabitlenmemiş içerik özetinden biri varsa canlı dağıtımda sipariş ucu 503 `ordering_unavailable` döner. Yani bu madde atlanırsa vitrin sessizce sipariş almaz — dağıtım yine yeşil yanar.
- [ ] `/yasal/dpa` (11 madde) ve `/yasal/alt-isleyenler` yayında; alt işleyen listesi üründe gerçekten kullanılan sağlayıcılarla birebir (08 §2.11).
- [ ] `LEGAL_SUPPORT_EMAIL` (ya da `destek@yemekgelsin.net`) posta kutusu gerçekten açık: deneme e-postası gönderildi ve okundu (KVKK m.13, 30 gün).
- [ ] **Cloudflare aktarımı (00 §12a madde 10; 08 §2.12):** Cloudflare ile KVKK standart sözleşmesi imzalandı, **5 iş günü içinde Kurum'a bildirildi**; VERBİS gerekiyorsa/varsa güncellendi; aktarım envanteri (Cloudflare, 360dialog/Meta, Netgsm …) ve Meta aktarımı için yazılı risk değerlendirmesi (V-026).
- [ ] Veri ihlali müdahale planı (işletmeye 24 saat, Kurul'a 72 saat), saklama-imha politikası, ilgili kişi başvuru kanalı.
- [ ] Fatura düzeni (Paraşüt / e-Arşiv) ilk ücretli işletmeden önce hazır; fişteki "mali değeri yoktur" ibaresi teyitli (V-024, V-025).

**[13](13-varsayim-ve-teyit-kaydi.md) §2 engelleyici teyitler** — P0 (pilot) kapısındaki maddeler `teyitli` durumda olmalı ya da kapı kararına "şu maddeye rağmen şu gerekçeyle" notu yazılmalı: V-001 (rate card), V-009 (barındırma; Cloudflare kararıyla yerini Cloudflare standart sözleşmesi aldı), V-011 (platform şablonları), V-012 (SMS fiyatı), V-018 (Coexistence), V-020 (SMS başlığı), V-021 (canary), V-022 (harita kotaları), V-023 (SMS İYS sınıfı), V-024 (fiş ibaresi), V-025 (e-Arşiv), V-026 (Meta aktarımı risk değerlendirmesi). 00 §12a'daki BSP yolu nedeniyle Tech Provider'a özgü maddelerin (V-005, V-010, V-015, V-016, V-019) yerine ortak numaranın bağlandığı yolun (Meta Cloud API ya da 360dialog) API uç noktası, webhook tanımı ve imza davranışı (§6) teyit edilir.

---

## 13. Canlı ortam: Cloudflare (Worker + container + R2)

Proje sahibinin kararı (00 §12a madde 10, 27.09.2026): **canlı ortam tamamen Cloudflare'dedir**, VPS yoktur. `https://yemekgelsin.net` gerçek verilerle Cloudflare Workers + Containers üzerinde tek container'lı ortamda çalışır (`deploy/cloudflare/`, iş akışı `.github/workflows/deploy-dev-cloudflare.yml`, adı "Canlı ortam (Cloudflare)"). Dosya, Worker (`siparisinonunde-dev`) ve R2 kovası adları iç tanımlayıcıdır, değişmez (00 §12a madde 9).

**Kişisel veri yurt dışındadır.** Veritabanı container'da (Cloudflare'in ağında), yedekler R2'de (`siparisinonunde-dev-yedek`, ENAM — Kuzey Amerika doğusu). Dayanak KVKK m.9 standart sözleşmesidir: Cloudflare ile imzalanır, **5 iş günü içinde Kurum'a bildirilir**; aktarım platformun ve işletmelerin aydınlatma metinlerinde Cloudflare, Inc. adıyla yazılır (08 §2.11–§2.12). Sözleşme, bildirim ve (gerekirse) VERBİS güncellemesi proje sahibinin yapılacaklarıdır; gerçek müşteriler gelmeden önce tamamlanmalıdır.

İki kip vardır; kipi iş akışı `VPS_HOST` secret'ına bakarak seçer. Olağan durum alan adı kipidir (= canlı ortam); gizli staging yalnız isteğe bağlı Türkiye VPS'i canlıya alınırsa (§14) kullanılır.

| | **Alan adı kipi = canlı ortam** | **Gizli staging** (yalnız isteğe bağlı VPS canlıdayken) |
|---|---|---|
| Ne zaman | `VPS_HOST` secret'ı yok (olağan) | `VPS_HOST` secret'ı var |
| Tetikleyici | her push + elle | yalnız elle (Run workflow); push'ta atlanır |
| Adres | `https://yemekgelsin.net` (Custom Domain; `www` → kök 301) + workers.dev yedek | yalnız `https://siparisinonunde-dev.<hesap>.workers.dev`; özel alan adı eklenmez |
| Erişim | herkese açık, parola yok; geliştirici araçları (`/dev/*`, `/api/v1/dev/*`) Worker'da **404** | tüm site parolalı (kullanıcı adı serbest, parola `DEV_PASSWORD`); yalnız `/api/v1/health` ve `/api/v1/health/worker` açık |
| Çalışma kipi | **üretim**: `NODE_ENV=production`, `DEPLOY_ENV=production` (API üretim açılış kurallarıyla çalışır), `DEV_TOOLS=0`, platform yöneticisi için **iki adımlı doğrulama zorunlu** (`ADMIN_TOTP_REQUIRED=true`) | `DEPLOY_ENV=dev` (simülatör; tüm sağlayıcılar mock), `DEV_TOOLS=1`, 2FA isteğe bağlı |
| Arama motorları | **açık** (`x-robots-tag` yok; `robots.txt` yalnız panel/admin/API yollarını kapatır) | kapalı (`x-robots-tag: noindex, nofollow`) |
| Veri | **gerçek; demo yok**: seed yalnız platform yöneticisi (`admin@yemekgelsin.net`, parola `DEV_PASSWORD`) ve üretim bayrakları (`SEED_MODE=admin`); demo seed kod düzeyinde reddedilir | demo işletmeler ve hesaplar (`SEED_MODE=demo`, parola `DEV_PASSWORD`) |
| Veri dönemi | `vars.DATA_EPOCH` ("3"; **canlı veri bu dönemdedir**) | `vars.STAGING_DATA_EPOCH` ("901"; farklı olmalı) |
| "Demo ortamı" uyarısı | yok (`NEXT_PUBLIC_DEMO_BANNER=0`) | var |
| Yeni işletme kaydı | **açık** (`signup_open`); platform yöneticisi `/admin/bayraklar`'dan kapatabilir, dağıtımlar bu karara dokunmaz | kapalı |
| `/demo` lead formu | **açık** (`NEXT_PUBLIC_LEAD_FORM=1`, `PUBLIC_LEADS_ENABLED=1`) | açık (yalnız ekip dener) |
| WhatsApp | `D360_API_KEY` + `WA_PHONE` (360dialog, varsayılan) ya da `META_*` + `WA_PHONE` (Meta doğrudan) tamsa gerçek numara; değilse mock = **çalışan WhatsApp yok** (vitrinde, QR'da ve Akış B'de bağlantı gösterilmez; panel "Ortak numara henüz yapılandırılmadı" der; alarm zinciri taklit kanala göndermez, sipariş kartı "Uyarı gönderilemedi" der; hiçbir ekran mesaj gönderildiğini söylemez) | her zaman simülatör (canlı numara kullanılmaz; iş akışı WhatsApp secret'larını yüklemez, Worker'dakileri siler) |
| SMS | mock: SMS gönderilmez, SMS yedeği (`sms_fallback`) kapalı başlar; WhatsApp da yoksa web siparişinin doğrulaması "işletmeyi arayın" der | mock |

Worker her yanıta `x-yg-ortam: cloudflare` başlığını ekler (isteğe bağlı VPS iş akışı DNS geçişinden sonra trafiğin artık Worker'dan gelmediğini bununla anlar).

**Yapı:** tek bir Worker ve Workers Paid planının Containers özelliğiyle çalışan tek container örneği (`basic`: 1/4 vCPU, 1 GiB).
- Kip `scripts/config-modes.mjs` ile `wrangler.generated.jsonc`'ye yazılır (`scripts/prepare-config.mjs <adres> --mode domain|staging`): `routes` (yalnız alan adı kipi), `DEPLOY_MODE`, `SEED_MODE`, `DATA_EPOCH`, `APP_BASE_URL` ve web derleme değişkenleri (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_DEMO_BANNER`, `NEXT_PUBLIC_DEMO_STORE_SLUG`, `NEXT_PUBLIC_LEAD_FORM`, `NEXT_PUBLIC_DEV_TOOLS`, `NEXT_PUBLIC_SUPPORT_WHATSAPP` — ortamdan `SUPPORT_WHATSAPP`, yalnız alan adı kipi). Container'ın çalışma ayarları kipten Worker'da türetilir (`src/mode.ts`: `modeSettings`, `containerEnv`); `apps/api/test/production-env.test.ts` bu ortamın API'nin üretim açılış denetiminden geçtiğini sınar. `wrangler.jsonc` alan adı kipini tanımlar.
- **Alan adı:** `yemekgelsin.net` ve `www.yemekgelsin.net` Worker'a **Custom Domain** olarak bağlıdır; DNS kaydını ve sertifikayı Cloudflare oluşturur. `www` köke kalıcı yönlenir (301; gövdeli istekte 308). workers.dev yedek adresinde API ve webhook istekleri çalışır, tarayıcı gezinmeleri alan adına 302 ile yönlenir. Kurallar: `deploy/cloudflare/src/access.ts` (testleri `npm test`). Staging'de `wrangler deploy` Custom Domain eklemez; var olanları da kaldırmaz — alan adını VPS iş akışı taşır (§14). Bu yüzden staging, alan adı hâlâ Worker'a bağlıyken çalışmayı reddeder.
- Container içinde PostgreSQL 16, API, worker ve web birlikte çalışır; imaj depo kökünden derlenir (`deploy/cloudflare/Dockerfile`). Worker `/api/*` isteklerini API'ye (4000), diğerlerini web'e (3000) aktarır.
- Container diski geçicidir. `entrypoint.sh` her açılışta boş bir veritabanı kurar, son yedeği R2'den (Worker'ın `yedek.internal` çıkış işleyicisiyle) geri yükler, migration'ları uygular ve seed'i `SEED_MODE` ile çalıştırır. Seed idempotenttir: admin kipinde var olan yöneticinin parolasını `DEV_PASSWORD`'e eşitler (iki adımlı doğrulamasına dokunmaz), bayrakları üretim varsayılanlarıyla garanti eder (var olana dokunmaz; yalnız hiç elle değiştirilmemiş `signup_open` ve `sms_fallback` ortamın varsayılanını izler — önceki dönemden kalan "kayıt kapalı" değeri böylece açılır); demo kipinde var olan demo işletmeyi atlar.
- **Veri dönemi (`DATA_EPOCH`):** R2 anahtarları dönemle öneklenir (`e3/db/son.dump`, `e3/uploads/son.tar.gz`, `e3/db/gun-<0–6>.dump`). Dönem container **açılırken** alınır ve ömrü boyunca sabittir (`entrypoint.sh` yedek yoluna yazar, Worker anahtarı yoldan kurar: `src/access.ts` `parseBackupPath`); yeniden dağıtımda kapanan eski container'ın son yedeği yeni döneme düşmez. `"3"` canlı verinin dönemidir; `e2/…` ve öncesi eski demo verisidir (R2'den silinebilir). Staging kendi dönemini kullanır (`e901/…`). Geçersiz değer dağıtımdan önce reddedilir.
- **Yedek ve dayanıklılık:** `entrypoint.sh` **2 dakikada bir** (`BACKUP_INTERVAL_SEC=120`) veritabanında ya da görsellerde değişiklik olup olmadığına bakar ve **yalnız değiştiyse** yükler (iz: `pg_stat_user_tables` sayaçları — worker'ın her dakika yazdığı `jobs` tablosu sayılmaz — ve görsel dosya listesi); boştaki ortam R2'ye yazmaz. Düzgün kapanışta (SIGTERM: uyku, yeniden dağıtım) ve bir süreç düştüğünde yedek **her durumda** alınır. Haftanın her günü için bir kopya tutulur (7 gün). R2'ye ulaşılamazsa container boş veritabanıyla açılmaz, çıkar. Dağıtımda Cloudflare eski container'a SIGTERM gönderir, çıkmasını bekler (en çok 15 dk) ve yenisini **ondan sonra** başlatır; yeni container eski container'ın son yedeğinden açılır. **Sınırlar:** düzgün kapanış ve dağıtım veri kaybettirmez; beklenmedik çökmede (container'ın zorla sonlanması) **son ~2 dakikalık** değişiklik (istatistik gecikmesiyle birkaç saniye fazlası) kaybolabilir. Tek container tek hata noktasıdır; saniye hassasiyetinde dönüş (PITR) yoktur.
- **Yedek zincirinin dört kapısı (04.10.2026 denetimi, B6/B7/B14 + dört mercekli son denetim):**
  1. **Tek yazıcı.** Her döküm kendi geçici dosyasına yazılır (`mktemp`) ve aynı anda iki yedek çalışmaz (`flock`; yoksa `mkdir` kilidi). Kapanışta döngü **önce** durdurulur ve süren yedeğin bitmesi beklenir (en çok `BACKUP_QUIESCE_SEC`=120 sn), ancak ondan sonra kapanış yedeği alınır. Öncesinde kapanış yedeği ile döngü yedeği aynı `/tmp/yedek.dump` dosyasına yazıyordu. Açılışta önceki turdan kalan geçici dökümler ve takılı kilit süpürülür (yerinde yeniden başlatmada `/tmp` ayakta kalabilir); durum dosyası korunur.
  2. **Yüklemeden önce doğrulama.** Döküm `pg_restore --list`, görsel arşivi `tar -tzf` ile okunuyor mu diye denetlenir; okunmuyorsa **R2'ye yazılmaz** ve `[ERROR]` ile loglanır. Worker aynı gövdeyi hem `son.dump` hem `gun-<0–6>.dump` olarak yazdığı için, doğrulanmamış bir döküm iki kopyayı birden bozardı. Geri yüklemede de **indirilen** döküm önce doğrulanır; `pg_restore` artık `--exit-on-error` ile çalışır (sessizce atlanan nesne kalmaz) ve başarısız olursa yarım veritabanı düşürülüp container sıfır dışı kodla çıkar (platform yeniden başlatır, sonraki deneme temiz başlar). **Migration hatası da ölümcüldür:** yarım şemayla açılmak, döngünün 2 dakika içinde R2'deki iyi yedeğin üzerine yarım veri yazması demektir.
  3. **Taze açılış "silahsız"dır.** Yedek bulunamazsa (404) container açılır ama **R2'ye hiçbir şey yazmaz** — kapanış yedeği (`force`) bile yazamaz. Yazma ancak gerçek veri gelince açılır; ölçü `tenants + orders + leads + 2FA'sını kurmuş kullanıcı` sayısıdır (seed'in admin kipinde kurduğu tek yönetici ve bayraklar **sayılmaz**). Veritabanı duruyor ve içinde gerçek veri varsa üzerine ne geri yükleme ne seed gider; sorgu okunamazsa "veri var" sayılır. Böylece yanlış verilmiş bir `DATA_EPOCH` ya da R2'nin boş 404'ü canlı veriyi **ezemez**: doğru döneme geri dönmek yeter. Taze açılışta eskiden hemen alınan zorlamalı ilk yedek kaldırıldı.
  4. **Yarım geri yükleme zinciri DONDURUR.** `pg_restore`'dan **önce** kalıcı bir "geri yükleme sürüyor" işareti yazılır (`RESTORE_FLAG_FILE`, varsayılan `PGDATA`'nın yanı — `/tmp` **olmaz**, çünkü container yerinde yeniden başlarken `/tmp` silinebilirken yarım veritabanı ayakta kalır), başarıda silinir. Açılışta işaret duruyorsa **satır sayısına bakılmadan** "yarım" kabul edilir: R2'ye yazma container ömrü boyunca durdurulur (`BACKUP_FROZEN`; gerçek veri görülse de açılmaz), `[ERROR] … YARIM GERİ YÜKLEME` satırı yazılır, durum dosyasına `note: yarim-geri-yukleme` işlenir ve `ALERT_WEBHOOK_URL`'e `yarim_geri_yukleme` uyarısı gider; geri yükleme **yeniden denenmez**. Migration ve seed akışı bilerek değiştirilmedi, yani yarım şema üzerinde çalışmaya devam ederler (seed hatası açılışı durdurmaz) — korunan şey veritabanı değil, **R2'deki döküm**. Öncesinde `pg_restore` sürerken ölen container açılışta yarım veritabanını "gerçek veri" sanıyor ve 120 saniye içinde R2'deki iyi `son.dump`'ın **ve** o günün kopyasının üzerine **sessizce** yazıyordu. Nasıl anlaşılır ve nasıl çözülür: aşağıdaki "Yarım geri yükleme" maddesi + [17](17-olay-mudahale-runbook.md) §2.8. Ayrıca "veritabanı var ama 0 satır" dalında veritabanı artık `dropdb` + `createdb` ile sıfırdan kurulup geri yüklenir: şema kalıntısı `--exit-on-error` ile çakışıp container'ı bir tur çökertmez.
- **Yedek durumu (`/tmp/yedek-durum.json`):** her denemeden sonra container içinde tek satırlık JSON yazılır (atomik: `mktemp` + `mv`; sahibi `postgres`, 0600 — API aynı kullanıcıyla çalıştığı için okur). Alanlar: `lastSuccessUnix` (son **başarılı** yedek, 0 = hiç), `lastAttemptUnix`, `consecutiveFailures`, `lastResult` (`ok` | `hata` | `bos` | `atlandi`), `note` (`yuklendi`, `degismedi`, `acilista-geri-yuklendi`, `taze-acilis-veri-yok`, `kilit-alinamadi`, `yedek-hatasi`, `veri-sayisi-okunamadi`, `yarim-geri-yukleme`), `epoch`. Sağlık ucu `lastBackupAgeSec = now - lastSuccessUnix` olarak hesaplar. **Değişiklik yoksa da `ok` yazılır** (`note: degismedi`): R2 veritabanıyla eşit olduğu için boştaki ortamda yedek yaşı boşuna büyümez. `lastResult: bos` "henüz yedek yok, gerçek veri de yok" demektir (taze açılış) — alarm değil, ama bir işletme kaydolduktan sonra sürüyorsa alarmdır. Yedek hataları ayrıca container günlüğüne `[ERROR] [baslat] …` satırı olarak düşer.
- **Yarım geri yükleme (nasıl anlaşılır, nasıl çözülür):** `pg_restore` sürerken container zorla sonlanırsa (platform öldürür, OOM, düğüm arızası) veritabanı **yarım** kalır ve yerinde yeniden başlatmada `PGDATA` ile birlikte ayakta kalır. Yarım veritabanının satır sayısı **hiçbir şey kanıtlamaz**: yarım döküm "gerçek veri" gibi görünür, çok erken kesilmişse boş görünür. Bu yüzden ölçü satır sayısı değil, `pg_restore`'dan önce yazılan kalıcı işarettir (`RESTORE_FLAG_FILE`).
  - **Belirtiler (üçü birlikte gelir):** container günlüğünde (`npx wrangler tail siparisinonunde-dev`) `[ERROR] [baslat] … YARIM GERİ YÜKLEME: önceki açılışta geri yükleme tamamlanmadı …` satırı; her yedek turunda (2 dk) `yedek zinciri DONDURULDU (yarım geri yükleme)` satırı; `ALERT_WEBHOOK_URL` tanımlıysa `kind: yarim_geri_yukleme` uyarısı. Durum dosyasında `lastResult: atlandi`, `note: yarim-geri-yukleme` kalır. **Sağlık ucu bu arızanın haber yolu DEĞİLDİR:** yedek yaşı eşiği 503 üretmez (yalnız `degraded:true` + `warnings:["backup_stale"]`, §10) ve `/tmp` süpürülmüş bir açılışta `lastSuccessUnix` 0 kaldığı için `lastBackupAgeSec` **`null`** döner (`apps/api/src/routes/health.ts:163`) — o durumda ne `backup_stale` uyarısı ne Worker'ın `yedek_eskidi`'si (`deploy/cloudflare/src/alert.ts:117`) üretilir, uç 200 + `degraded:false` kalır. Yani donmuş zincirin tek güvenilir haber yolu **uyarı kanalı + container günlüğüdür**; `ALERT_WEBHOOK_URL` tanımsızsa arıza yalnız `wrangler tail`'de görünür ([17](17-olay-mudahale-runbook.md) §1 E-1).
  - **Bu durumda sistem ne yapar:** R2'ye **hiçbir şey yazmaz** — kapanış yedeği (`force`) bile. Yani R2'deki `e3/db/son.dump` ve `e3/db/gun-<0–6>.dump` **el sürülmemiş** durumdadır; dondurmanın tek amacı budur. Geri yükleme **yeniden denenmez**; buna karşılık migration ve seed akışı değişmedi ve yarım şema üzerinde çalışırlar (migration patlarsa açılış durur, seed hatası yalnız loglanır). Yani yarım **veritabanı** dokunulmaz değildir; dokunulmaz olan R2'deki dökümdür. Site bu sırada **eksik ya da boş** görünebilir ve migration yarım şemada patlarsa container çökme döngüsüne girer — bu da bilerek böyledir, R2 her durumda korunur.
  - **Çözüm (kabuk erişimi gerekmez):** işaret container diskinde durur, container diski ise **geçicidir** — yani çözüm **yeni bir container başlatmaktır**: GitHub > Actions > "Canlı ortam (Cloudflare)" > Run workflow (ya da herhangi bir push). Yeni container temiz diskle açılır, işaret yoktur, R2'deki iyi `son.dump` baştan ve tek seferde geri yüklenir. **Doğrulama:** günlükte `son yedek geri yükleniyor` var, `YARIM GERİ YÜKLEME` **yok**; birkaç dakika içinde `veritabanı yedeği R2'ye yazıldı` satırı ve `/api/v1/health/worker` 200.
  - **Kayıp:** yarım veritabanındaki değişiklikler zaten R2'ye hiç gitmemişti; kayıp, son **başarılı** yedekten sonraki süredir (normalde ≤ 2 dk). Yeniden açılışta `geri yükleme başarısız (pg_restore)` tekrarlıyorsa `son.dump`'ın kendisi bozuktur: "Yedekten geri dönüş" yöntemiyle `gun-<0–6>.dump` kopyasını yeni bir döneme yükleyin ([17](17-olay-mudahale-runbook.md) §4). **İşareti elle silmeye çalışmayın** (container'a kabuk erişimi yoktur) ve çözülmeden `DATA_EPOCH`'u artırmayın: dondurulmuş zincir zaten tek koruma katmanıdır.
- **Gelen webhook tamponu (container erişilemezken):** Container kapanıp yenisi R2'den geri yükleme + migration ile açılırken (dağıtım, yeniden başlatma, çökme; ~20–60 sn) gelen WhatsApp webhook'u daha önce kalıcı olarak kayboluyordu — **Twilio gelen mesaj webhook'unu yeniden teslim etmez** ve kaybın kaydı da kalmıyordu (docs/06 §2 ilke 2 "önce kalıcı yaz"ın Cloudflare'deki karşılığı). Artık Worker, container'a iletemediği **webhook isteklerini** (`POST /api/v1/webhooks/**`; yalnız bu yollar, her istek değil) R2'ye yazar ve sağlayıcıya **200** döner (`deploy/cloudflare/src/webhook-spool.ts`).
  - Tampona düşme sebepleri: container başlatılamadı, container 5xx döndü, istek hiç gidemedi. **401 (imza geçersiz) ve 404 (bilinmeyen belirteç) tamponlanmaz**, olduğu gibi sağlayıcıya döner. `GET /api/v1/webhooks/**` (Meta doğrulaması) canlı yanıt gerektirir, tamponlanmaz.
  - Kayıtta ham gövde (base64), **imza başlıkları aynen** (`X-Twilio-Signature`, `X-Hub-Signature-256`), istemci IP'si, çağrılan yol ve alınma zamanı durur. Çerez ve `authorization` başlıkları saklanmaz. İmzayı container doğrular: tampon, doğrulamayı atlatan bir arka kapı değildir.
  - Anahtarlar: `e<dönem>/webhook-tampon/<alınma ms>-<gövde özeti>.json` — **sıralı** (R2 listesi anahtar sırasında döner, kayıtlar geliş sırasında boşaltılır; WhatsApp sohbet durumu sıraya duyarlıdır) ve **tekil**. `e<dönem>/webhook-tampon-imza/<özet>` mührü aynı gövdenin ikinci kez yazılmasını engeller (sağlayıcı tekrarı) ve kayıt boşaltılınca silinir. Dönem öneki şarttır: gizli staging ile canlı ortam aynı kovayı paylaşır.
  - **Tampona yazılamazsa 200 DÖNÜLMEZ** (503 döner): kaydı olmayan bir kayba onay vermemek için.
  - Gövde sınırı 1 MiB. Kayıtlar müşteri telefonunu ve mesaj metnini taşır; veritabanı yedeğiyle aynı kovada ve aynı KVKK saklama kurallarına tabidir (08 §2.8) — boşaltılan kayıt hemen silinir, boşaltılamayan kayıt elle bakılana kadar durur.
- **Tamponu boşaltma (drain):** container ayaktayken kayıtlar sırayla container'a POST edilir; **kabul edileni (2xx) silinir, edilmeyeni yerinde bırakılır**. Geçici hatada (5xx/ağ) tur durur (sıra bozulmasın), kalıcı rette (4xx) ya da okunamayan kayıtta uyarı verilip sıradakine geçilir. Hiçbir kayıt kendiliğinden silinmez ("sipariş kaçmaz"): operatör bakana kadar her turda uyarı üretir. Tetikleyiciler:
  1. **Worker Cron Trigger** (5 dk; uyanık tutma turunun sonunda) — en kötü durumda kayıt 5 dakika bekler, kaybolmaz.
  2. **Container yeni ayağa kalktığında** ilk istekte (o istek de kuyruğun sonuna eklenir, böylece mesaj sırası korunur).
  3. **`POST /__yg/webhook-drain`** — elle/dışarıdan tetikleme. **Paylaşılan sır zorunludur:** `WEBHOOK_DRAIN_SECRET` secret'ı ve aynı değerli `x-yg-drain-key` başlığı. Sır tanımsız ya da yanlışsa uç **404** döner (varlığı bile belli olmaz). Aynı sır, tampondan geri verilen isteğe de eklenir: container "bu istek Worker'ın tamponundan geldi" diyebilir (`x-yg-webhook-replay` = kaydın alınma zamanı). Değeri kaynak koda yazılmaz; bir kez `npx wrangler secret put WEBHOOK_DRAIN_SECRET` ile verilir (iş akışının `--secrets-file`'ı eksik secret'ı silmez, kalıcı olur).
  - Aynı anda iki tur çalışmaz: boşaltma, tek container örneğinin (`AppContainer`, "main") kilidinden geçer. Bir tur en çok 25 kayıt alır, kalanı sonraki tur boşaltır.
  - Elle bakma: Cloudflare > R2 > `siparisinonunde-dev-yedek` > `e3/webhook-tampon/` altında kayıt var mı. Boş olmalı. Dolu kalıyorsa kayıtlar container tarafından reddediliyor demektir (çoğunlukla imza anahtarı değişmiş ya da webhook belirteci dönmüş); kaydı indirip gövdeye bakın, gerekiyorsa işlendikten sonra elle silin.
- **Uyarılar (`ALERT_WEBHOOK_URL`, isteğe bağlı):** tanımlıysa Worker şu olaylarda kısa bir JSON gönderir: `webhook_tamponlandi`, `webhook_tampon_yazilamadi`, `webhook_drain_hatasi`, `webhook_drain_reddedildi`, `container_baslatilamadi`, `uyanik_tutma_hatasi` (gövde: `{kaynak:'worker', olay, zaman, ayrinti}`). Kişisel veri ve belirteç gönderilmez (yol maskelidir). **apps/api ile aynı ortam değişkeni adı** kullanılır; değeri koda yazılmaz, `npx wrangler secret put ALERT_WEBHOOK_URL` ile verilir. Tanımlı değilse uyarılar yalnız Worker günlüğünde kalır (`npx wrangler tail`). Container düştüğünde her istek için uyarı gönderilmez (kanal boğulmasın): o durumu 5 dakikalık uyanık tutma turu bildirir.
- **Güvenlik başlıkları (canlı yolda, `/api/*` dahil):** Worker her yanıta `Strict-Transport-Security: max-age=31536000; includeSubDomains` (yalnız https; `preload` bilerek yok), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(), usb=()` ve bir `Content-Security-Policy` yazar (`deploy/cloudflare/src/security-headers.ts`). Burada yazılmasının sebebi: Next.js kendi başlıklarını yalnız web (3000) yanıtlarına yazar, `/api/*` JSON uçları ve **yüklenen görseller** (`/api/v1/uploads/*`) doğrudan Fastify'dan döner ve başlıksız kalıyordu.
  - CSP'de `script-src 'self' 'unsafe-inline'` var: Next.js tema başlatma script'ini ve JSON-LD'yi satır içi gönderiyor, Worker da Next'in ürettiği nonce'ı bilemiyor. `'unsafe-eval'` **yok**. Nonce'a geçmek Next tarafında bir middleware ister (açık iş; o zamana kadar satır içi script'ler serbest kalır). Harita altlığı için `connect-src`/`worker-src` açıktır (`https://tiles.openfreemap.org`, `blob:`), ürün görseli işletmenin girdiği serbest adres olabildiği için `img-src … https:` kabul eder (`http:` engelli).
  - **İlk yayın:** kırılan bir şey var mı diye `wrangler.jsonc` `vars.CSP_REPORT_ONLY` `"1"` yapılıp dağıtılabilir — tarayıcı kuralı uygulamaz, yalnız konsola yazar (`Content-Security-Policy-Report-Only`). Panel, vitrin, harita ve kurye ekranı konsolu temiz kaldıktan sonra `"0"`a çevirin.
- **Container canlı ortamda uyumaz (29.09.2026):** Worker'ın Cron Trigger'ı (`wrangler.jsonc` `triggers.crons` `*/5 * * * *`, `src/index.ts` `scheduled`) 5 dakikada bir container'a sağlık isteği gönderir; her istek 30 dakikalık uyku sayacını sıfırlar. Gerekçe: uyuyan container'ın uyanışı (R2'den geri yükleme + migration, ~20–60 sn) ilk WhatsApp yanıtını geciktiriyordu (canlıda 20–25 sn görüldü), Twilio webhook'u 15 sn'de keser (uzun uyanışta mesaj kaybolur) ve arka plan işleri (alarm, zaman aşımı iptali, saklama) ancak container ayaktayken çalışır. Maliyet (basic: 1 GiB bellek, 4 GB disk sağlanan kaynağa, CPU yalnız kullanıma göre ücretlenir): sürekli açıkken ≈ 7 $/ay (Workers Paid'in dahil kotası düşülmüş). Gizli staging'de tetikleyici yoktur, orada container 30 dk sonra uyur ve uyanış ~30–60 sn sürer ("Sistem başlatılıyor" sayfası).
- Canlı ortamda API `DEPLOY_ENV=production` ile açılır: `DEV_TOOLS=1`, zayıf gizli anahtar ya da eksik gerçek sağlayıcı anahtarı açılışı durdurur (`apps/api/src/config.ts` `productionConfigErrors`); mock sağlayıcılar yalnız uyarı yazar. Mock WhatsApp'ta geliştirme numarası (+90 555 000 00 00) canlıda gösterilmez (`platformDisplayPhone`).

**Kurulum (bir kez):**
1. Cloudflare hesabında **Workers Paid** planını açın (aylık 5 $; Containers bu planla gelir).
2. Cloudflare > My Profile > API Tokens > **Create Token** > **"Edit Cloudflare Workers"** şablonu. **Özel alan adı için** token'da `yemekgelsin.net` bölgesinde (Zone Resources: Include > Specific zone > `yemekgelsin.net`): **Zone > Workers Routes > Edit** ve **Zone > Zone > Read**. Eksikse iş akışı dağıtımdan önce durur ve eksik izni adıyla yazar. `@` ya da `www` için elle eklenmiş A/AAAA/CNAME kaydı varsa Custom Domain eklenemez; DNS > Records'tan silin.
3. GitHub > **Settings > Secrets and variables > Actions > New repository secret**: `CLOUDFLARE_API_TOKEN`, `DEV_PASSWORD` (platform yöneticisinin parolası; en az 8, **önerilen en az 12 karakter**, parola yöneticisinde saklayın), gerekirse `CLOUDFLARE_ACCOUNT_ID`; isteğe bağlı `SUPPORT_WHATSAPP` (destek hattı: "Parolamı unuttum" bunu gösterir); isteğe bağlı gerçek WhatsApp için `D360_API_KEY` ve `WA_PHONE` (360dialog, varsayılan yol, §6.2) ya da `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_WABA_ID`, `META_APP_SECRET`, `WA_PHONE` (Meta doğrudan, §6.2b) — ikisi birlikte değil. **`VPS_HOST` eklemeyin** (§14).
4. **Actions > "Canlı ortam (Cloudflare)" > Run workflow.** Sonraki her push ortamı kendiliğinden günceller.

**İlk dağıtımdan sonra:**
1. **Yönetici girişi ve iki adımlı doğrulama (zorunlu):** `https://yemekgelsin.net/admin/giris` → `admin@yemekgelsin.net`, parola `DEV_PASSWORD`. İlk girişte yalnız **Yönetim › Güvenlik** (`/admin/guvenlik`) açılır; diğer yönetim uçları 403 `totp_enrollment_required` döner. QR'ı doğrulama uygulamasıyla okutun, 6 haneli kodla açın, **8 kurtarma kodunu** parola yöneticisine kaydedin (00 §12a madde 7). Container'a kabuk erişimi olmadığından kurtarma kodları kritik önemdedir: telefon ve kodlar birlikte kaybolursa sıfırlama yalnız yedeğin elle düzeltilmesiyle (aşağıda "Yedekten geri dönüş" yöntemiyle yeni döneme yükleyip `scripts/create-admin.ts --reset-totp`) yapılabilir.
2. **KVKK (proje sahibi):** Cloudflare ile standart sözleşme, 5 iş günü içinde Kurum bildirimi, gerekirse VERBİS (08 §2.12). Yasal metinlerdeki aktarım paragrafları taslaktır, avukata gösterin.
3. **Gizli değerler:** `SESSION_SECRET`, `TRACKING_SECRET`, `ENCRYPTION_KEY`, webhook ve VAPID anahtarları ilk dağıtımda Worker secret'ı olarak üretildi (`scripts/secrets.mjs`) ve Cloudflare'den geri okunamaz. Worker'ı silmeyin: `ENCRYPTION_KEY` olmadan yedekteki şifreli alanlar (TOTP sırları, WhatsApp anahtarları) okunamaz.
4. İsteğe bağlı: gerçek WhatsApp (§6.2), dış izleme (`/api/v1/health` ve `/api/v1/health/worker`, 1 dk; bu, container'ı uyanık tutar — müşteri bekleme sayfası görmez, container sürekli çalışır). Eşik aşımı (yedek/disk/bellek) 200 döndüğü için koda bakan monitöre düşmez: `ALERT_WEBHOOK_URL` tanımlıysa Worker turu ve API uyarı gönderir (§10).
5. İsteğe bağlı Worker secret'ları (bir kez, elle; iş akışı bunları üretmez ve silmez): `npx wrangler secret put ALERT_WEBHOOK_URL` (uyarıların gideceği adres; apps/api ile aynı ad) ve `npx wrangler secret put WEBHOOK_DRAIN_SECRET` (webhook tamponunu elle boşaltma ucunun paylaşılan sırrı; verilmezse uç 404 döner, tampon yalnız 5 dakikalık turla boşalır). Değerler depoda tutulmaz.

**İş akışı:**
1. Kip seçimi: `VPS_HOST` yoksa alan adı kipi (canlı ortam); varsa push'ta bilgi notuyla atlanır, elle çalıştırılınca staging.
2. Tür denetimi ve testler (`npm run typecheck`, `npm test`: erişim kuralları, kip ayarları ve container ortamı, WhatsApp kipi, yapılandırma).
3. Hesap ve erişim: alan adı kipinde token'ın `ZONE` bölgesine erişimi (Zone Read, Workers Routes); staging'de workers.dev alt alan adı zorunludur ve `yemekgelsin.net`'in artık bu Worker'a bağlı olmadığı doğrulanır (`scripts/vps/cloudflare-dns.mjs status`).
4. Yapılandırma (`prepare-config.mjs --mode …`) ve gizli değerler (`scripts/secrets.mjs`): eksikler bir kez üretilir (`SESSION_SECRET`, `TRACKING_SECRET`, `ENCRYPTION_KEY`, `WA_VERIFY_TOKEN`, `PLATFORM_WA_WEBHOOK_TOKEN`, VAPID çifti), `DEV_PASSWORD` her dağıtımda güncellenir; WhatsApp secret'ları yalnız alan adı kipinde ve doluysa yüklenir, boşaltılanlar (staging'de hepsi) Worker'dan silinir.
5. `wrangler deploy --containers-rollout=immediate` (alan adı kipinde Custom Domain'lerle); Custom Domain izin/DNS çakışması hataları Türkçe `::error::` ile açıklanır.
6. Duman testi — **canlı ortam:** `/api/v1/health` 200 ve sürüm bu commit (en çok 20 dk; eski container yanıt verirken beklenir); `/`, `/panel/giris`, `/admin/giris`, `/panel/kayit`, `/demo`, `/yasal/gizlilik`, `/yasal/kvkk-aydinlatma`, `/api/v1/health/worker`, `/robots.txt` 200; `/s/bozok-pide` ve `/s/camlik-doner` **404** (demo verisi yok); ana sayfada "Demo ortamı" uyarısı, `x-robots-tag` ve robots `noindex` **yok**, `x-yg-ortam: cloudflare` var; `robots.txt` siteyi kapatmıyor; `/demo` lead formunu gösteriyor ve demo vitrin bağlantısı yok; `POST /api/v1/public/leads` bal küpüyle 204 (canlı veriye kayıt yazılmaz); `/panel/kayit` kayıt formunu ("İşletme hesabını aç") gösteriyor, `/api/v1/public/signup-status` açık; `/dev/whatsapp` ve `/api/v1/dev/*` parolasız ve parolayla **404**; ortak webhook yolu API'ye ulaşır (404); `www` → kök 301; workers.dev'de API 200, sayfa → alan adı 302. **Staging:** sağlık uçları parolasız 200, diğer yollar parolasız 401; parolayla `/`, `/s/bozok-pide`, `/s/camlik-doner`, `/panel/giris`, `/admin/giris`, `/dev/whatsapp`, `/api/v1/dev/wa/accounts` 200; "Demo ortamı" uyarısı var; `x-robots-tag: noindex`.

**Kullanım:** https://yemekgelsin.net · Admin: `/admin/giris` (`admin@yemekgelsin.net`, parola `DEV_PASSWORD`, iki adımlı doğrulama zorunlu). İşletmeler `/panel/kayit`'tan kaydolur. **Staging** (yalnız VPS yolunda): workers.dev adresi, tarayıcı parola sorar (kullanıcı adı `dev`); demo hesapları README'deki e-postalar, parola `DEV_PASSWORD`; vitrinler `/s/bozok-pide` (`#BOZOK`), `/s/camlik-doner` (`#DONER`); simülatör `/dev/whatsapp`.

**Gerçek WhatsApp (isteğe bağlı, yalnız alan adı kipi):** GitHub secret'ları eklenip iş akışı çalıştırılır; Worker (`src/whatsapp-env.ts`) ve iş akışının "WhatsApp kipi" adımı aynı kuralı uygular:
- `D360_API_KEY` + `WA_PHONE` (360dialog, varsayılan, §6.2) → container'a `PLATFORM_WA_PROVIDER=d360`, `PLATFORM_WA_API_KEY` (= `D360_API_KEY`), `PLATFORM_WA_DISPLAY_PHONE` (E.164'e çevrilmiş `WA_PHONE`). `WA_APP_SECRET` verilmez (360dialog imza göndermez); `WA_DEFAULT_PROVIDER` değişmez.
- `META_WA_TOKEN` + `META_WA_PHONE_NUMBER_ID` + `META_APP_SECRET` + `WA_PHONE` (Meta doğrudan, §6.2b) → `PLATFORM_WA_PROVIDER=cloud`, `PLATFORM_WA_API_KEY`, `PLATFORM_WA_PHONE_NUMBER_ID`, `PLATFORM_WA_WABA_ID` (varsa), `WA_APP_SECRET`, `PLATFORM_WA_DISPLAY_PHONE`.
- İkisi birlikte (`D360_API_KEY` + tam `META_*` seti) → dağıtım "belirsiz" hatasıyla durur (Worker da bu durumda gerçek numarayı açmaz). Hiçbiri tam değilse mock (çalışan WhatsApp yok; gösterim numarası da verilmez). Boşaltılan WhatsApp secret'ları Worker'dan da silinir.
Geliştirici araçları her durumda kapalıdır. API açılışta gerçek sağlayıcıda `PLATFORM_WA_API_KEY`, `PLATFORM_WA_DISPLAY_PHONE` ve `PLATFORM_WA_WEBHOOK_TOKEN`'ı (secrets.mjs üretir) zorunlu tutar (§4).

**Yedekten geri dönüş (elle):** container çalışırken `son.dump`'ın üzerine yazmayın (çalışan container 2 dakika içinde kendi yedeğiyle ezer). Bunun yerine yeni bir dönem kullanın: (1) Cloudflare > R2 > `siparisinonunde-dev-yedek` > `e3/db/` altından istenen kopyayı (`son.dump` ya da `gun-<0–6>.dump`; 0 = Pazar, UTC) ve `e3/uploads/son.tar.gz`'yi indirin; (2) aynı kovaya `e4/db/son.dump` ve `e4/uploads/son.tar.gz` olarak yükleyin; (3) `wrangler.jsonc`'de `vars.DATA_EPOCH`'u `"4"` yapıp push edin. Yeni container `e4`'ten açılır; eski dönemin nesneleri R2'de kalır. **Aylık tatbikat:** son dökümü indirip yerelde `createdb siparis_tatbikat && pg_restore --no-owner -d siparis_tatbikat son.dump` ile açın, tablo sayılarına bakın ve silin.

> **Günlükte `TAZE AÇILIŞ: … altında yedek YOK` satırını görürseniz** container o dönemde (`e<n>`) hiç yedek bulamamıştır ve **R2'ye yazmayı kapatmıştır**. Yanlışsa panik yok: eski dönemin nesneleri R2'de olduğu gibi duruyor, `vars.DATA_EPOCH`'u doğru değere çevirip push etmek yeter. Ama bu durumda **site boş görünür** ve bir işletme kaydolduğu an yazma açılır (o andan sonra yeni dönem canlı veri taşımaya başlar), bu yüzden döneme hemen dönün.

**Sıfırlama (dikkat: canlı veri):** `vars.DATA_EPOCH`'u artırıp yeni dönemde yedek koymadan dağıtmak **tüm canlı veriyi** (işletmeler, siparişler, müşteriler) boş veritabanıyla değiştirir; yalnız bilinçli bir kararla yapın. Staging için `vars.STAGING_DATA_EPOCH` kullanılır; iki değer hiçbir zaman aynı olmamalıdır. Eski dönemlerin nesneleri R2'de kalır ve KVKK saklama sürelerine (08 §2.8) göre elle silinmelidir; `e2` ve öncesi eski demo verisidir.

**Container'ın ortamı KAPALI bir beyaz listedir (önemli).** Worker'ın `vars` ve secret'larından container'a yalnız `deploy/cloudflare/src/mode.ts` `containerEnv` içinde (`PASSTHROUGH_KEYS` ya da gövde) **adıyla yazılanlar** geçer. Listeye eklenmemiş bir değişken canlıda tanımsız kalır ve `npx wrangler secret put …` ile değer vermek bile işe yaramaz. Bu sessiz sapma bir kez gerçekleşti: Faz 0–4'te eklenen künye, canary ve WhatsApp kotası değişkenleri listede yoktu, künye eksik kaldığı için sipariş ucu kalıcı 503 döndü ve duman testi sipariş ucunu denemediği için **dağıtım yeşil yanarken vitrin hiç sipariş almadı**. Kapı: `deploy/cloudflare/scripts/mode.test.mjs` "beyaz liste kapısı" vakaları — `apps/api`'nin okuduğu her ortam değişkeni ya `containerEnv` çıktısında olmalı ya da testteki `SCOPE_OUT` listesinde **gerekçesiyle** yer almalıdır (`npm test`, dağıtım iş akışının 2. adımı).

**Canlıya çıkmadan önce `wrangler.jsonc` `vars`'a girilecek değerler.** Dosyada anahtarlar hazır ve **boş** durur; değerler depoya yazılmaz, proje sahibi doldurur. Gizli değildirler (künye kanunen kamuya açıktır), bu yüzden secret değil `vars`'tır — değişmesi için yeni dağıtım yeter.

| Değişken | Kim doldurur / nereden | Girilmezse ne olur |
|---|---|---|
| `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_TYPE`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_ENTITY_PHONE`, `LEGAL_ENTITY_TAX_OFFICE`, `LEGAL_ENTITY_TAX_NO` | şirket belgelerinden birebir (6563 m.3; §4 tablosu) | **sipariş ucu kalıcı 503** — vitrin hiç sipariş almaz (fail-closed) |
| `LEGAL_ENTITY_MERSIS`, `LEGAL_ENTITY_CHAMBER`, `LEGAL_ENTITY_KEP` | varsa; şahıs şirketinde genelde yok | künyede "Yok" yazar (uydurulmaz) |
| `LEGAL_SUPPORT_EMAIL` | boş bırakılabilir | marka adresi (`destek@yemekgelsin.net`) kullanılır; posta kutusu açık olmalı (KVKK m.13) |
| `CANARY_ENABLED` | pilot öncesi `"1"` (06 §7.10) | sentetik canary hiç çalışmaz: sipariş yolunun sessiz bozulması ölçülmez |
| `CANARY_STALE_ALERT` | **boş bırakılır** (panel sessiz ack'i gelene kadar) | doğru davranış; `"1"` yapılırsa her turda yanlış alarm |
| `WABA_CONVERSATION_CAP`, `WABA_SHED_NONCRITICAL` | isteğe bağlı (§4) | koddaki varsayılan tavan; kota kısması kapalı |

Secret olarak verilenler ayrıca §13 "Kurulum" 5. maddesindedir (`ALERT_WEBHOOK_URL`, `WEBHOOK_DRAIN_SECRET`). ⚠️ Künyenin **web tarafı** bu `vars` ile çözülmez (statik sayfalar derleme anında okunur) — §4'teki uyarıya bakın.

**Canlıya çıkış (Cloudflare):**
- [ ] `wrangler.jsonc` `vars` içindeki künye alanları (zorunlu altısı) dolu ve **canlı adreste gerçek bir sipariş geçti**: `POST /api/v1/store/<vitrin-slug>/orders` 503 `ordering_unavailable` dönmüyor (müşteri ekranında "Şu an sipariş alamıyoruz"). Duman testi bu ucu denemez, bu yüzden elle doğrulanır (§4, 08 §7.5).
- [ ] `vars.CANARY_ENABLED` pilot öncesi `"1"`; ilk turdan sonra `Admin > İşler`'de `canary.run` kalıcı hatası yok ve panelde canary siparişi görünmüyor (06 §7.10).
- [ ] Son "Canlı ortam (Cloudflare)" çalışması yeşil (duman testi yukarıdaki maddelerle geçti).
- [ ] Platform yöneticisi iki adımlı doğrulamayı kurdu, kurtarma kodları parola yöneticisinde; `DEV_PASSWORD` en az 12 karakter.
- [ ] KVKK: Cloudflare standart sözleşmesi imzalandı ve 5 iş günü içinde Kurum'a bildirildi; VERBİS gerekiyorsa güncellendi; aydınlatma metinleri avukattan geçti (08 §9.1).
- [ ] WhatsApp: gerçek numara bağlı (§6.2, 360dialog) ya da bilerek yok (vitrinde WhatsApp bağlantısı görünmez).
- [ ] R2'de `e3/db/son.dump`'ın son değiştirilme zamanı güncel (son değişiklikten en çok birkaç dakika sonra); `e3/db/gun-<0–6>.dump` kopyalarından en az ikisi birkaç gün geriye gidiyor; bir aylık tatbikat yapıldı.
- [ ] Container günlüğünde (`npx wrangler tail`) `[ERROR]` satırı yok; ilk siparişten sonra `veritabanı yedeği R2'ye yazıldı` satırı görüldü ve `curl -s https://yemekgelsin.net/api/v1/health/worker` `degraded`'ı **false**, `warnings`'ı **boş** döndürüyor. Yedek yaşının **sayısı** ayrıntılı ölçümdür ve belirteç ister (§10 "Ayrıntılı ölçümler"): `HEALTH_METRICS_TOKEN` kuruluysa `curl -s -H "x-health-metrics-token: …" …` yanıtında `lastBackupAgeSec` **sayı** olmalı (`null` ise R2'ye hiç yazılmıyor, yani durum `"bos"` kalmış demektir); belirteç kurulmadıysa (varsayılan) alan yanıtta **hiç bulunmaz** ve kanıt yalnız günlük satırı + boş `warnings`'tır. Durum dosyası container içindedir ve kabuk erişimi olmadığı için elle okunamaz.
- [ ] Dış izleme `/api/v1/health` ve `/api/v1/health/worker`'ı izliyor.
- [ ] Güvenlik başlıkları canlıda görünüyor: `curl -sI https://yemekgelsin.net/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type'` ve aynı kontrol `/api/v1/health` için de geçiyor; CSP rapor kipinden çıkarıldı (`CSP_REPORT_ONLY="0"`).
- [ ] R2'de `e3/webhook-tampon/` boş (tamponda bekleyen gelen webhook yok); `ALERT_WEBHOOK_URL` tanımlı ya da uyarıların yalnız günlükte kalacağı bilinçli olarak kabul edildi.

**Sorun giderme:**
- Container günlükleri: Cloudflare > Workers & Pages > `siparisinonunde-dev` > Logs ya da `npx wrangler tail siparisinonunde-dev`. Açılış satırları `[baslat]` önekiyle (seed kipi, yedek yazımları dahil); Worker açılışta kipi ve WhatsApp durumunu yazar.
- Açılışta `Geçersiz üretim yapılandırması: …`: API üretim kurallarından birini sağlamıyor (§4); ileti hangisi olduğunu yazar.
- Yönetim ekranları 403 `totp_enrollment_required`: iki adımlı doğrulama henüz kurulmadı; `/admin/guvenlik`.
- `/panel/kayit` "Kayıtlar çok yakında açılıyor" diyor: platform yöneticisi kaydı `/admin/bayraklar`'dan kapatmış (bilinçli karar; dağıtım açmaz).
- İlk dağıtımda Custom Domain'in DNS kaydı ve sertifikası birkaç dakika sürebilir; duman testi en çok 20 dakika bekler.
- "Özel alan adı kurulamadı … izni eksik": Kurulum 2. adımdaki izinleri ekleyip yeniden çalıştırın.
- Staging "hâlâ bu Worker'a bağlı" hatası: VPS iş akışı DNS geçişini tamamlamadı (§14); Cloudflare'de canlı kalmak istiyorsanız `VPS_HOST` secret'ını silin.
- "Failed to start container" çoğunlukla bellek yetmediğini gösterir: `instance_type` → `standard-1` (4 GiB; maliyet artar). Büyütme kararını ölçümle verin: §16.
- **R2'de `e3/webhook-tampon/` dolu kalıyor** (gelen webhook container'a verilemiyor): `npx wrangler tail` ile `webhook drain:` satırlarına bakın. `durum 404` = webhook belirteci değişmiş ya da ortak numara belirteci (`PLATFORM_WA_WEBHOOK_TOKEN`) tanımsız; `durum 401` = imza anahtarı (`META_APP_SECRET` / Twilio Auth Token) artık uyuşmuyor. Kayıt silinmez; sebep düzeltilip `POST /__yg/webhook-drain` (başlık `x-yg-drain-key: <WEBHOOK_DRAIN_SECRET>`) ile tur yeniden tetiklenir.
- **Sayfa boş geliyor, tarayıcı konsolunda `Refused to … because it violates the following Content Security Policy directive`**: yeni bir dış kaynak (yazı tipi, harita, analitik) eklendi ama CSP'ye yazılmadı. Kuralı `deploy/cloudflare/src/security-headers.ts` `CSP_DIRECTIVES`'e ekleyin; acil durumda `vars.CSP_REPORT_ONLY` `"1"` yapıp dağıtmak kuralı geçici olarak gözlem kipine alır.

## 14. İsteğe bağlı: Türkiye VPS'i GitHub Actions ile (planlanmıyor)

**Canlı ortam Cloudflare'dedir (§13; 00 §12a madde 10) ve VPS planlanmıyor.** Aşağıdaki yol, önceki kararın ("canlı ortam Türkiye VPS'i") otomasyonudur; çalışır hâlde durur ve kişisel verinin Türkiye'de tutulması istenirse seçilebilir. Kurulum ve her güncelleme `.github/workflows/deploy-production.yml` ("Canlı ortam (Türkiye VPS)") ile yapılır; `VPS_HOST` secret'ı yokken her push'ta bilgi notuyla atlanır.

> **Uyarı — veri taşınmaz:** `VPS_HOST` (+ `VPS_PASSWORD`) eklendiği anda iş akışı push'ta çalışır, VPS'i **boş veritabanıyla** kurar ve sağlık denetimi geçince alan adını VPS'e taşır (Cloudflare ortamı gizli staging olur). Cloudflare'deki canlı veri (işletmeler, siparişler, müşteriler) kendiliğinden taşınmaz. Bu yol seçilirse taşıma ayrıca planlanır: yazmalar durdurulur, R2'deki son yedek (`e3/db/son.dump`, `e3/uploads/son.tar.gz`) indirilip VPS'te `scripts/restore.sh` ile yüklenir, sonra DNS geçişi yapılır (Run workflow > `only_dns`). Bilinçli bir taşıma kararı olmadan `VPS_HOST` eklemeyin.

### 14.1 Hangi VPS

- **Türkiye'de** bir veri merkezi (bu yolun amacı: kişisel veri yurt dışına çıkmaz; 08 §2.12), **Ubuntu 24.04 LTS**, **2 vCPU / 4 GB RAM / 80 GB SSD**, sabit **IPv4**, root erişimi. Aday sağlayıcılar: Turkcell Bulut, Türk Telekom Bulut, Huawei Cloud İstanbul, Radore, Bulutistan, yerli VPS sağlayıcıları (fiyat ve belge teyidi V-009). ISO 27001 ve DPA (veri işleme sözleşmesi) belgesi istenir.
- Kurulumda **root parolası** seçin (uzun, rastgele; parola yöneticisine kaydedin) ve **parola ile SSH girişinin açık** olduğundan emin olun (bazı imajlarda `PasswordAuthentication no` gelir; sağlayıcı panelinden ya da konsoldan açın). İş akışı `sshpass` ile parola kullanır.
- 80 ve 443 portları dışarıdan erişilebilir olmalı (sağlayıcının güvenlik grubu/güvenlik duvarı varsa açın); SSH portu varsayılan 22 değilse `VPS_PORT` secret'ı verilir.

### 14.2 GitHub secret'ları

Settings > Secrets and variables > Actions > New repository secret:

| Secret | Zorunlu | Açıklama |
|---|---|---|
| `VPS_HOST` | evet | Sunucunun IPv4 adresi (ya da IPv4'e çözülen ad). **Eklendiği anda** Cloudflare iş akışı alan adına dağıtmayı bırakır (§13) ve VPS iş akışı push'ta çalışmaya başlar; canlı veri taşınmaz (yukarıdaki uyarı). |
| `VPS_PASSWORD` | evet | SSH parolası (root). |
| `VPS_USER` | hayır | Varsayılan `root`. Başka kullanıcıda parolasız sudo (NOPASSWD) gerekir. |
| `VPS_PORT` | hayır | Varsayılan `22`. |
| `VPS_HOST_KEY` | önerilir | Sunucunun SSH host anahtarı (`ssh-ed25519 AAAA…`). Verilirse yalnız bu anahtar kabul edilir; verilmezse her çalışmada ilk görülen anahtar kabul edilir (TOFU). İlk dağıtımın özeti değeri yazar; kopyalayıp ekleyin. Sunucu yeniden kurulursa güncelleyin. |
| `ADMIN_PASSWORD` | evet* | İlk platform yöneticisinin (`admin@yemekgelsin.net`) parolası, **en az 12 karakter**. *Yoksa `DEV_PASSWORD` kullanılır (o da en az 12 karakter olmalı). Yönetici bir kez açılır; sonraki dağıtımlar parolasına ve iki adımlı doğrulamasına **dokunmaz** (değiştirmek: §5 `create-admin.ts --reset-password`). |
| `CLOUDFLARE_API_TOKEN` | evet | `yemekgelsin.net` bölgesinde **Zone > DNS > Edit** ve **Zone > Zone > Read** (Caddy'nin DNS-01 sertifikaları ve DNS geçişi). Geçişte Worker Custom Domain'lerini silmek (gerekirse geri bağlamak) için **Account > Workers Scripts > Edit** ve **Zone > Workers Routes > Edit** (Cloudflare ortamının "Edit Cloudflare Workers" token'ında ve bölge izinlerinde vardır). SSL/TLS modu "Flexible" ise düzeltmek için **Zone > Zone Settings > Edit** (yoksa modu elle "Full (strict)" yapın). |
| `CADDY_CLOUDFLARE_API_TOKEN` | **önerilir** | Sunucuya (Caddy) yalnız DNS yetkili ayrı bir token (Zone > DNS > Edit + Zone > Zone > Read, yalnız bu bölge). Yoksa Workers yetkili `CLOUDFLARE_API_TOKEN` sunucunun `.env`'ine yazılır ve iş akışı her dağıtımda uyarır. Token her iki durumda da **yalnız caddy konteynerine** verilir; api/worker/migrate ortamında boştur (`docker-compose.yml` x-api-base). |
| `CLOUDFLARE_ACCOUNT_ID` | hayır | Yoksa bölgenin hesabı kullanılır. |
| `D360_API_KEY`, `WA_PHONE` | hayır | Gerçek WhatsApp, 360dialog (ortak numara; varsayılan yol, §6.2). İkisi tamsa `PLATFORM_WA_PROVIDER=d360`. |
| `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_APP_SECRET`, `WA_PHONE` (+ `META_WA_WABA_ID`) | hayır | Gerçek WhatsApp, Meta doğrudan (§6.2b). Dördü tamsa `PLATFORM_WA_PROVIDER=cloud`. İki yol birlikte verilirse dağıtım durur; hiçbiri tam değilse ortak numara kapalı (mock) ve uyarı. |
| `NETGSM_USERCODE`, `NETGSM_PASSWORD`, `NETGSM_HEADER` | hayır | SMS (§7). Üçü tamsa `SMS_PROVIDER=netgsm` ve SMS yedeği açık başlar; değilse SMS gitmez, `sms_fallback` kapalı başlar. |
| `SUPPORT_WHATSAPP` | hayır | Destek hattı (rakamlarla, `905321234567`); "Parolamı unuttum" bunu gösterir. Cloudflare ortamında (§13, alan adı kipi) `/demo`'daki WhatsApp bağlantısı. |
| `BACKUP_PING_URL` | hayır | Yedek sonrası çağrılan dış izleme adresi (§8). |

Secret eklemek/değiştirmek dağıtımı başlatmaz: Actions > "Canlı ortam (Türkiye VPS)" > Run workflow.

### 14.3 İş akışı ne yapar

`main` ya da çalışma dalına her push'ta (yalnız `docs/**`, `*.md` değişiklikleri hariç) ve elle:

1. **Secret denetimi:** `VPS_HOST` ve `VPS_PASSWORD` yoksa push'ta uyarıyla atlanır (elle çalıştırmada hata). Varsa: yönetici parolası (≥ 12), `CLOUDFLARE_API_TOKEN`, VPS IPv4'ü denetlenir; betik testleri çalışır.
2. **Cloudflare izin denetimi** (sunucuya dokunmadan): bölge görünüyor mu, DNS yazılabiliyor mu (zararsız bir TXT kaydı açılıp silinir), Worker alan adları okunabiliyor mu (`scripts/vps/cloudflare-dns.mjs check`). Eksik izin adıyla yazılır.
3. **SSH** (`sshpass`, parola komut satırında değil): host anahtarı `VPS_HOST_KEY` ile sabit ya da ilk görüldüğü gibi (TOFU).
4. **`.env` birleştirme** (`scripts/vps/env-merge.mjs`, sunucuda hiçbir şey değişmeden): sunucudaki mevcut `.env` indirilir; `POSTGRES_PASSWORD`, `SESSION_SECRET`, `TRACKING_SECRET`, `ENCRYPTION_KEY`, `WA_VERIFY_TOKEN`, `PLATFORM_WA_WEBHOOK_TOKEN` ve VAPID çifti **bir kez üretilir ve sonsuza dek korunur** (bozuksa kendiliğinden değiştirilmez, dağıtım durur); alan adı, Cloudflare token'ı, WhatsApp ve Netgsm değerleri secret'lardan yazılır; `DEPLOY_ENV=production`, `DEV_TOOLS=0`, `ADMIN_TOTP_REQUIRED=true`, demo vitrin/uyarı kapalı, `BACKUP_DIR=/opt/yemekgelsin/backups`. Sonuç API'nin açılış kurallarını (`productionConfigErrors`) sağlamazsa Türkçe hatayla durur. Tüm gizli değerler iş akışı günlüğünde maskelenir.
5. **Sunucu hazırlığı** (`scripts/vps/bootstrap.sh`, root, idempotent): ilk seferde `apt upgrade` (sonra yalnız eksik paket; elle çalıştırmada "full_bootstrap" ile yeniden), Docker Engine + compose (get.docker.com), Docker log döndürme (5 × 20 MB), git, curl, jq, rclone, UFW (yalnız SSH, 80/tcp, 443/tcp, 443/udp; SSH için sshd'nin **gerçekten dinlediği** portlar — `sshd -T`, `ssh.socket`, `ss` — ve `VPS_PORT` birlikte açılır, NAT/port yönlendirmeli VPS'te kilitlenme olmasın; dinlenen port bulunamazsa UFW etkinleştirilmez ve uyarı yazılır), fail2ban (sshd: 10 dk'da 5 hatalı deneme → 1 saat yasak), unattended-upgrades (güvenlik güncellemeleri; otomatik yeniden başlatma yok), saat dilimi Europe/Istanbul, RAM < 6 GB ve takas yoksa 2 GB takas, `/opt/yemekgelsin/{app,backups}`.
6. **Kod:** herkese açık depo (`https://github.com/eraycaylak/siparisinonunde.git`) `/opt/yemekgelsin/app`'e getirilir ve **tam dağıtılan commit'e** geçilir (depo özel yapılırsa sunucu çekemez; o zaman deploy anahtarı gerekir).
7. **`.env` yükleme** (root, 600): sunucu tarafı korunan gizli değerlerin değişmesini ve `.env` yokken var olan veritabanı birimine yeni parola yazılmasını reddeder; önceki `.env` `/opt/yemekgelsin/env-backups/`'a kopyalanır (son 10).
8. **Dağıtım** (`scripts/vps/deploy.sh up`): **disk denetimi** (Docker veri dizini ve `/opt/yemekgelsin` diskinde en az %15 boş; değilse çalışan servislere dokunmadan durur) → `docker compose config` → `docker compose build --pull` (web derleme argümanları `.env`'den: `NEXT_PUBLIC_SITE_URL=https://yemekgelsin.net`, `NEXT_PUBLIC_ROOT_DOMAIN=yemekgelsin.net`, `NEXT_PUBLIC_DEV_TOOLS=0`, uyarı kapalı) → **yeni imajla yapılandırma denetimi** (`scripts/check-config.ts`; hata varsa eski sürüm çalışmaya devam eder) → veritabanı varsa **güncelleme öncesi yedek** (yalnız veritabanı, `pre-deploy-db-*.dump`, son 5 saklanır; `backup.sh --pre-deploy`) → `docker compose up -d` (önce migrate) → **Caddyfile değiştiyse caddy yeniden oluşturulur** (tek dosya bağlaması git checkout'tan sonra eski içeriği tutar; birkaç saniyelik kesinti) → postgres/api/worker/web sağlıklı ve caddy çalışır olana kadar bekleme (en çok 15 dk; olmazsa süzülmüş tanı yazılır, aşağıda "Günlükler") → **bayraklar** (`scripts/bootstrap-production.ts`) → **ilk yönetici** (`create-admin.ts --if-missing`: yoksa açılır; varsa hiçbir şeyi değişmez; aynı e-posta platform yöneticisi olmayan bir hesaptaysa yetki verilmez ve dağıtım hata verir) → yedek cron'u (§8) → eski imaj ve 7 günden eski derleme önbelleği temizliği.
9. **DNS'ten önce sağlık denetimi** (`curl --resolve <ad>:443:<VPS>`, en çok ~15 dk): kökte `/api/v1/health`, `/api/v1/health/worker`, `/`, `/panel/giris`, `/admin/giris`, `/panel/kayit` 200; **her adın sertifikası ayrı doğrulanır** (Caddy her ad için ayrı DNS-01 sertifikası alır): `www` → kök 301, `panel.` ve `admin.` giriş sayfaları 200, rastgele vitrin alt alan adı 404 (wildcard), `hooks.…/wa/…` 404. Geçmezse **DNS'e dokunulmaz** (site eski yerinde kalır).
10. **DNS geçişi** (`scripts/vps/cloudflare-dns.mjs cutover`, idempotent): DNS yazma izni denenir; SSL/TLS "Flexible"/"Off" ise "Full (strict)" yapılır; dev Worker'ına giden bölge rotaları silinir; her ad için Worker Custom Domain'i kaldırılıp hemen proxy'li A kaydı yazılır: `yemekgelsin.net`, `www`, `*` (vitrinler), `hooks` (TTL otomatik). A kaydı yazılamazsa az önce kaldırılan Custom Domain **geri bağlanır** (ad kayıtsız kalmaz; site Cloudflare ortamında açık kalır) ve iş akışı hata verir; sorunu giderip "only_dns" ile yeniden çalıştırın (§14.6).
11. **Duman testi** gerçek alan adında: `/api/v1/health` VPS'ten (Worker'ın `x-robots-tag` başlığı kalkana kadar bekler), `/`, `/panel/giris`, `/admin/giris`, `/panel/kayit` (kayıt formu açık), `/api/v1/health/worker`, `/yasal/gizlilik` 200; `/dev/whatsapp` ve `/api/v1/dev/*` 404; `/s/bozok-pide` 404 (demo yok); `www` → kök 301; rastgele bir vitrin alt alan adı 404 (wildcard DNS + sertifika çalışıyor); `hooks.yemekgelsin.net/wa/…` API'ye ulaşıyor (bu üçü Cloudflare kenarı adları ayrı ayrı uyguladığı için süreyle sınırlı yeniden denenir).
12. **Özet** (gizli değer yok): commit, adres, yönetici girişi, WhatsApp/SMS durumu, yedek, TOFU parmak izi, gerekiyorsa yeniden başlatma uyarısı.

**Elle çalıştırma seçenekleri:** `ref` (geri alma, §14.5), `full_bootstrap` (sunucu paketlerini yükselt), `only_dns` (yalnız 2, 3, 9, 10, 11: sunucuya dokunmadan VPS sağlık denetimi + DNS geçişi + duman testi; sunucuda tamamlanmış bir dağıtım yoksa durur).

**Günlükler ve kişisel veri** (00 §12a madde 10, değişmez kural 7): iş akışı günlükleri GitHub'da (Türkiye dışında) durur. Bu yüzden sunucudaki servis günlükleri iş akışına **ham kopyalanmaz**: hata durumunda `deploy.sh diag` tam günlüğü sunucuya yazar (`/opt/yemekgelsin/deploy-logs/<zaman>.log`, root 600, son 20) ve iş akışına yalnız süzülmüş özeti basar — JSON günlüklerinden uyarı/hata düzeyindeki satırların düzey, kaynak, ileti ve hata iletisi (istek, IP ve başlık alanları yok; Caddy'nin HTTP erişim/istek günlükleri hiç yok), düz metinde IP, telefon ve e-posta maskeli. SSH parolası (`SSHPASS`) yalnız SSH kullanan adımlara verilir.

### 14.4 İlk dağıtımdan sonra

1. **Giriş:** https://yemekgelsin.net/admin/giris → `admin@yemekgelsin.net`, parola `ADMIN_PASSWORD` (yoksa `DEV_PASSWORD`). İlk girişte **iki adımlı doğrulama** kurulur (§5; zorunlu). Kurtarma kodlarını kaydedin.
2. **Gizli anahtarların yedeği:** sunucudaki `.env`'in `ENCRYPTION_KEY` ve `TRACKING_SECRET` değerlerini bir parola yöneticisine kopyalayın (`ssh root@<VPS> 'grep -E "^(ENCRYPTION_KEY|TRACKING_SECRET)=" /opt/yemekgelsin/app/.env'`); sunucu kaybında gerekir.
3. **WhatsApp webhook'u yeniden girin** (gerçek WhatsApp açıksa): canlı ortamın webhook ve doğrulama belirteçleri Cloudflare ortamındakilerden **farklıdır**. 360dialog: Admin > WhatsApp > WhatsApp kurulumu > **Webhook'u 360dialog'a kaydet** (§6.2 C.2). Meta doğrudan: **Göster** → Meta > uygulama > WhatsApp > Configuration > Webhook > Edit: Callback URL ve Verify token'ı yapıştırın → **Verify and save**; **messages** aboneliği açık kalsın (§6.2b C.1). Sonra "Bağlantıyı test et". Yapılmazsa müşteri mesajları yeni sunucuya gelmez.
4. `VPS_HOST_KEY` secret'ını özetteki değerle ekleyin (TOFU yerine sabit anahtar).
5. Kayıt açıktır: işletmeler `https://yemekgelsin.net/panel/kayit`'tan kaydolur ya da yönetici ekler. Cloudflare ortamı artık gizli staging'dir; gerekirse elle çalıştırın (§13).
6. §12 kontrol listesini tamamlayın; özellikle ikinci Türkiye lokasyonuna yedek (§8) ve dış izleme (§10).

**Sunucuya giriş:** `ssh root@<VPS_HOST>` (parola `VPS_PASSWORD`). Uygulama `/opt/yemekgelsin/app`, komutlar orada: `docker compose ps`, `docker compose logs -f --since 15m api worker`, `bash scripts/vps/deploy.sh status`. Dağıtım geçmişi: `/opt/yemekgelsin/deploy-history`.

### 14.5 Geri alma

- **Kod:** Actions > "Canlı ortam (Türkiye VPS)" > Run workflow > `ref` alanına önceki (çalışan) commit'in SHA'sını yazın. İş akışı o commit'i derleyip dağıtır; DNS zaten VPS'tedir, değişmez.
- **Veritabanı:** migration'lar yalnız ileri yönlüdür. Yeni sürüm şemayı değiştirdiyse ve eski kod yeni şemayla çalışmıyorsa, dağıtımdan hemen önce alınan yedekten geri dönün: sunucuda `cd /opt/yemekgelsin/app && ls -t /opt/yemekgelsin/backups/pre-deploy-db-*.dump | head` → `./scripts/restore.sh <pre-deploy-db-….dump>` (§8; yalnız veritabanı — görseller migration'dan etkilenmez; o andan sonraki siparişler kaybolur). Görseller de gerekiyorsa gecelik `uploads-*.tar.gz` ile `--uploads`.
- **Alan adını Cloudflare ortamına geri vermek** (VPS tamamen çalışmıyorsa ya da VPS yolundan vazgeçilirse): Cloudflare > `yemekgelsin.net` > DNS'te `@`, `www`, `*` ve `hooks` A kayıtlarını silin, `VPS_HOST` secret'ını silip "Canlı ortam (Cloudflare)" iş akışını çalıştırın (Custom Domain'leri yeniden ekler; canlı ortam kendi R2 verisiyle açılır). VPS'teki veri oraya kendiliğinden taşınmaz.

### 14.6 Sorun giderme

- **"İsteğe bağlı VPS yolu kullanılmıyor" notu:** `VPS_HOST` yok; olağan durum (canlı ortam Cloudflare'de). Elle çalıştırmada eksik secret hatası verir.
- **"SSH parolası kabul edilmedi":** `VPS_PASSWORD`/`VPS_USER`; sağlayıcıda parola ile SSH açık mı? fail2ban 10 dakikada 5 hatalı denemeden sonra IP'yi 1 saat yasaklar: sağlayıcı konsolundan `fail2ban-client set sshd unbanip <IP>`.
- **"SSH host anahtarı VPS_HOST_KEY ile uyuşmuyor":** sunucu yeniden kurulduysa secret'ı güncelleyin; değilse durun ve inceleyin (araya giren olabilir).
- **`.env` hataları** ("… geçersiz: Kendiliğinden değiştirilmedi", "… değişecekti"): korunan gizli değerler bilerek değiştirilmez. Neden değiştiğini anlayın; gerçekten yenilemek gerekiyorsa sunucuda `.env`'den ilgili satırı silip iş akışını yeniden çalıştırın (`POSTGRES_PASSWORD` için önce veritabanında `ALTER USER`).
- **"uygulama yapılandırması geçersiz"** (check-config): satırdaki Türkçe hata `productionConfigErrors` iletisidir (§4); çalışan sürüm etkilenmez.
- **VPS'te sağlık denetimi geçmiyor:** adım süzülmüş tanıyı yazar (caddy, api, web uyarı/hataları); tam günlük sunucuda `/opt/yemekgelsin/deploy-logs/`. Hangi adın beklenen yanıtı vermediği iletide yazar (`www.`, `panel.`, `admin.`, `hooks.` ya da vitrin: o adın sertifikası henüz alınmamış olabilir). Sertifika: `CLOUDFLARE_API_TOKEN` (ya da `CADDY_CLOUDFLARE_API_TOKEN`) DNS yetkisi, Let's Encrypt oran sınırı; servis: `docker compose logs migrate api`.
- **DNS geçişi izin hatası:** ileti eklenecek izni adıyla söyler (Zone > DNS > Edit, Account > Workers Scripts > Edit + Zone > Workers Routes > Edit, Zone > Zone Settings > Edit). DNS yazma izni yoksa hiçbir şeye dokunulmaz.
- **DNS geçişi yarım kaldı** ("DNS geçişi tamamlanamadı"): A kaydı yazılamayan adın Worker Custom Domain'i geri bağlanır (ileti "yeniden Worker'a bağlandı" der). İleti "DİKKAT: … geri bağlanamadı" diyorsa o ad şu an kayıtsız olabilir: hemen Cloudflare > Workers & Pages > `siparisinonunde-dev` > Domains'ten adı ekleyin ya da sorunu giderip Run workflow > **only_dns** ile geçişi tamamlayın (derleme ve sunucu adımları tekrarlanmaz).
- **"diskte yer az":** `docker system prune` (kullanılmayan imaj/konteyner), `/opt/yemekgelsin/backups` altındaki eski dökümler; `df -h`. Sonra yeniden çalıştırın.
- **Caddyfile değişikliği etkisiz görünüyor:** `deploy.sh up` içerik farkında caddy'yi kendiliğinden yeniden oluşturur; elle: `docker compose up -d --no-deps --force-recreate caddy`.
- **SSH portu yönlendirmeli (NAT) VPS:** bootstrap sshd'nin dinlediği portu da açar ve uyarı yazar; UFW "etkinleştirilmedi" uyarısında portu doğrulayıp sunucuda `ufw enable` çalıştırın.
- **Duman testi "hâlâ Worker":** Cloudflare kenarının güncellenmesi birkaç dakika sürebilir; 10 dakikada geçmezse DNS > Records'ta A kayıtlarının proxy'li ve VPS IP'sinde olduğunu, Workers Routes'ta dev Worker'ına rota kalmadığını denetleyin.
- **Sonsuz yönlendirme (ERR_TOO_MANY_REDIRECTS):** SSL/TLS modu "Flexible"; "Full (strict)" yapın.
- **"Sunucu yeniden başlatma bekliyor":** yoğun saat dışında `ssh root@<VPS> reboot`; servisler `restart: unless-stopped` ile kendiliğinden açılır.
---

## 15. Kalite kapıları: lint, kapsam, erişilebilirlik

Denetim 2026-10-04 madde 4.6'nın karşılığı. Üç ayrı araç, üç ayrı soru:

| Araç | Soru | Komut | Dağıtım kapısında? |
|------|------|-------|--------------------|
| ESLint | Bu kod çalışma zamanında yanlış davranır mı? | `pnpm lint` | Evet (şimdilik `continue-on-error`) |
| Vitest kapsam | Testler kodun ne kadarına dokunuyor? | `pnpm test:coverage` | **Hayır** — eşikler henüz ölçülmedi |
| axe-core | Ekran okuyucu/klavye ile kullanılabilir mi? | `pnpm --filter @siparis/web test` | Evet (web birim testlerinin içinde) |

### 15.1 ESLint

Yapılandırma: kökteki `eslint.config.js` (flat config). Her kuralın NEDEN açık ya da kapalı olduğu dosyanın
içinde yazılıdır; kural eklemeden önce o notları okuyun.

```bash
pnpm lint        # denetle
pnpm lint:fix    # makineyle düzeltilebilenleri düzelt (import düzeni, gereksiz tür iddiası)
```

Tasarım ilkesi: **`error` yalnız gerçek hata.** `error` seviyesindeki kurallar, kodun yazarın niyetinden
başka davrandığı ya da güvenlik açığı doğduğu durumlar:

- `@typescript-eslint/no-floating-promises` — `await` yazılmamış yan etki (WhatsApp mesajı, outbox yazımı,
  yedek) sessizce düşer; tür denetimi bunu görmez.
- `react-hooks/rules-of-hooks` — koşullu kanca; panel ekranı rastgele davranır.
- `react/jsx-no-target-blank` — `target="_blank"` + `rel="noopener"` eksikse açılan sayfa ana sekmeyi
  yönlendirebilir.
- `no-restricted-imports` — **CLAUDE.md değişmez kural 1'in makine kapısı:** Baileys / whatsapp-web.js /
  Evolution API gibi resmi olmayan WhatsApp kütüphanelerini import etmek lint'i kırmızı yakar. Kural `patterns`
  ile yazılıdır, yani alt yol import'u da (`@whiskeysockets/baileys/lib/socket`) yakalanır ve kapı `.ts` kadar
  `.mjs`/`.js` dosyalarında da geçerlidir. **Kapının görmediği yol:** `require('baileys')` ve doğrudan
  `package.json`'a bağımlılık eklenmesi — onlar kod incelemesinin işidir.

Biçim kuralları (satır uzunluğu, tırnak, alfabetik import, `any` yasağı) **bilerek yok**: 100 bin satırlık
mevcut kodu tek seferde değiştirmek `git blame`'i kullanılamaz hâle getirir. Prettier de eklenmedi.

2026-10-05 ölçümü: **0 hata, 247 uyarı** (101 dosya, ~13 sn). Uyarı sayısını çivilemek için
`pnpm lint --max-warnings <sayı>` kullanılabilir; sayıyı her temizlikte düşürün.

### 15.2 Kapsam (coverage) eşiği — ÖLÇÜM BEKLİYOR

```bash
ALLOW_DB_RESET=1 pnpm test:coverage          # core + db + api  → coverage/
pnpm --filter @siparis/web test:coverage     # web              → apps/web/coverage/
```

Eşikler iki yerde, ağaç başına ayrı ayrı tanımlıdır:

| Dosya | Kapsadığı ağaç | Eşik anahtarı |
|-------|----------------|---------------|
| `vitest.config.ts` | `packages/core`, `packages/db`, `apps/api` | `ESIKLER.core` / `.db` / `.api` / `.genel` |
| `apps/web/vitest.config.ts` | `apps/web/lib`, `apps/web/components/*.ts` | tek blok (`thresholds`) |

⚠️ **Yazılı sayılar HEDEFTİR, ölçüm değil.** Kapsam bu depoda hiç ölçülmemişti; ölçüm `pnpm test`i koşmayı
gerektirir ve o da paylaşılan `siparis_test` veritabanını sıfırlar. Bu yüzden eşikler varsayılan olarak
**UYGULANMAZ**: `--coverage` yalnız rapor üretir.

**Eray'ın yapacağı adım** (tek seferlik, başka iş koşmuyorken):

1. Yukarıdaki iki komutu çalıştırın, çıkan gerçek yüzdeleri not edin.
2. Gerçek değerlerin ~5 puan ALTINI `ESIKLER`e yazın (bugünkü seviyeyi çivileyen eşik: kapsamın
   DÜŞMESİNİ engeller, bir gecede %80'e çıkmayı zorlamaz).
3. Eşikleri zorunlu kılın: `KAPSAM_ESIK=1` ortam değişkeni. Dağıtım kapısına eklemek için
   `.github/workflows/testler.yml` içindeki "Ne koşmaz (bilinçli, 2)" notundaki hazır adımı kullanın —
   o adım `pnpm test` adımının **yerine** geçer, yanına değil (ikisi aynı veritabanını kullanır).
   ⚠️ **Aynı commit'te `deploy-gate.test.mjs` de güncellenmelidir:** o test "core+db+api testleri koşuyor mu"
   değişmezini `/run:\s*pnpm test\s*$/` çapasıyla arar; satır `pnpm test:coverage` olunca çapa eşleşmez ve
   kapının son adımı kırmızı yanar, dağıtım hiç başlamaz. Çapa `pnpm test(:coverage)?` yapılmalıdır.

Kapsamdan bilerek çıkarılanlar (oranı yapay şişirirdi): yalnız tür/sözleşme tanımları
(`packages/core/src/contracts`, `packages/db/src/schema`), CLI giriş noktaları (`migrate`, `seed`, `reset`,
`server.ts`, `worker.ts`), yalnız geliştirmede yüklenen rotalar (`routes/dev`), `apps/web/app/**` ve React
bileşenleri (bunlar Playwright e2e'nin alanı).

### 15.3 Erişilebilirlik (axe-core)

Yardımcı: `apps/web/test/a11y.tsx`. Bileşeni jsdom'a gerçek istemci olarak basar (`createRoot` + `act`,
yani `useEffect` çalışır) ve axe-core'u WCAG 2.2 AA kural kümesiyle koşar.

```tsx
/** @vitest-environment jsdom */
import { auditA11y, renderForAudit } from '@/test/a11y';

const screen = renderForAudit(<CheckoutPage slug="x" store={store} />);
expect(await auditA11y(screen.container)).toEqual([]);
```

Bugün denetlenen ekran: **checkout** (`components/storefront/checkout/checkout-a11y.test.tsx`) — sözleşmenin
kurulduğu ve ödeme yükümlülüğünün doğduğu tek ekran. Etiketsiz bir alan burada siparişin tamamlanamaması
demektir. Test ayrıca denetimin kendisinin sökülmediğini de doğrular (bilinen bir ihlali kurup yakalandığını
sınar), yoksa yapılandırma bozulduğunda testler sessizce yeşil kalırdı.

jsdom'un sınırı: düzen (layout) hesaplanmaz, bu yüzden `color-contrast` ve `target-size` kuralları
**kapalıdır**. Onların karşılığı başka yerdedir:

- renk kontrastı → `apps/web/components/panel/panel-contrast.test.ts` (token değerlerinden ölçer, 4,5:1 / 3:1)
- dokunma hedefi → Tailwind `min-h-hit` yardımcı sınıfı ([12](12-marka-tasarim-ve-kullanilabilirlik.md) §11.1)

**Henüz yapılmayan (FAZ 5):** işletme paneli ve admin ekranları axe ile denetlenmedi; gerçek tarayıcıda tam
tarama (Playwright + `@axe-core/playwright`) kurulmadı. İkisi de aynı yardımcının kapsamını genişletmekle olur.

---

## 16. Kapasite ve sınırlar

Denetim 2026-10-04 FAZ 4.9'un karşılığı. Soru şu: **tek container kaç işletmeyi taşır, hangi sayı ilk dolar, dolunca
ne yapılır?** Buradaki sınırların hepsi ya kodda ya `wrangler.jsonc`/`entrypoint.sh`'de yazılıdır; tahmin
edilmemiştir. Ölçüm kaynağı `/api/v1/health/worker` ayrıntılı alanlarıdır (§10 "Ayrıntılı ölçümler"; belirteç ister).

### 16.1 Bugünkü ölçüm (5 Eki 2026, canlı)

| Ölçüm | Değer | Tavan | Doluluk |
|---|---|---|---|
| Disk (`diskFreePct` / `diskFreeMb`) | %73 boş · 2.681 MiB boş | 4 GB (`basic`) | ≈ %27 |
| Bellek (`memUsedPct` / `memRssMb`) | %14 · RSS 123 MiB | yığın tavanı 704 MiB · container 1 GiB | ≈ %14 |

**Karar: `instance_type` `basic` kalır — ölçüldü, yeterli.** `standard-1` (4 GiB) bugün yalnız maliyeti artırırdı
(sürekli açık `basic` ≈ 7 $/ay, §13). Bu karar `deploy/cloudflare/scripts/mode.test.mjs` "kapasite" vakasıyla
çivilendi: örnek tipi değişirse test kırmızı yanar ve gerekçe buraya yazılır.

### 16.2 Hangi sınır nerede yazılı

| Sınır | Değer | Kaynak | Aşılırsa ne olur |
|---|---|---|---|
| Container kaynağı | 1/4 vCPU · 1 GiB bellek · 4 GB disk · **tek örnek** | `wrangler.jsonc` `containers[0]` | Bellek yetmezse container açılmaz ("Failed to start container", §13 Sorun giderme) |
| Süreçlerin yığın tavanı | api 256 + worker 192 + web 256 = **704 MiB** | `deploy/cloudflare/entrypoint.sh` (`--max-old-space-size`) | `memUsedPct` %95'i geçince `memory_high` uyarısı (U-27); süreç ölürse `wait -n` container'ı düşürür |
| PostgreSQL bağlantısı | `max_connections=40` (`shared_buffers=48MB`, `work_mem=2MB`) | `entrypoint.sh` postgres başlatma satırı | Havuz dolunca sorgular bekler; "too many connections" hatası API günlüğüne düşer |
| Uygulamanın bağlantı kullanımı | api havuzu **10** + worker **5** + SSE `LISTEN` **1** ≈ 16/40 | `packages/db/src/client.ts` (`max` varsayılanı 10), `apps/api/src/worker.ts` (`max: 5`), `apps/api/src/lib/sse.ts` | ≈ %40 doluluk: ikinci bir süreç eklenmeden önce burası hesaplanmalı |
| Panel canlı akışı (SSE) | şube başına **8**, işletme başına **24** eşzamanlı | `apps/api/src/plugins/sse-limit.ts` (`SSE_MAX_PER_BRANCH`, `SSE_MAX_PER_TENANT`; ortamdan ezilebilir) | En eski akış kapatılır (30 sn sonra dönmesi istenir, `Last-Event-ID` telafi eder) ve `sse_connection_limit` uyarısı gider ([17](17-olay-mudahale-runbook.md) §1.1 **U-19**) |
| Kuyruk gecikmesi | vadesi gelmiş en eski iş **300 sn** | `apps/api/src/routes/health.ts` `WORKER_MAX_LAG_SEC` | `/health/worker` **503** → dış izleme P1 (§10) |
| Disk / yedek / bellek eşikleri | %15 boş · 900 sn · %95 | `HEALTH_MIN_DISK_FREE_PCT`, `HEALTH_MAX_BACKUP_AGE_SEC`, `HEALTH_MAX_MEM_USED_PCT` (§10) | 200 + `degraded` + uyarı kanalı (U-25…U-27) |
| WhatsApp konuşma kotası | **24 saatlik** iş-kaynaklı konuşma tavanı: varsayılan **250** tekil alıcı (`WABA_CONVERSATION_CAP`; aylık kota değil) | `apps/api/src/services/messaging/waba-quota.ts` (`WABA_CONVERSATION_CAP_DEFAULT`), `wrangler.jsonc` `vars` | %70'te warning, %90 ve tavan dolu durumunda critical uyarı ([17](17-olay-mudahale-runbook.md) §1.1 **U-20**, gerçeği **U-21**). Tavana yaklaşınca önemsiz durum mesajları düşürülebilir (`WABA_SHED_NONCRITICAL`), sipariş mesajları düşmez. **Tüm dükkanlar tek portföyü paylaşır** |

### 16.3 Beklenen yük

Varsayımlar işletme başına **900 sipariş/ay** (≈ 30/gün) ve sipariş başına en çok 4 durum mesajıdır
([06](06-teknik-mimari.md) §17 "Ölçek ve maliyet tahmini", CLAUDE.md kural 8). Ölçek adımları
[11](11-finansal-model-ve-finansman.md) §2.2 ve [09](09-yol-haritasi-ve-sprint-plani.md) §1.1'den:

| Aşama | İşletme | Kaba sipariş/ay | Not |
|---|---|---|---|
| Pilot (Ara 2026) | 10 (3+4+3 dalga) | ≈ 9.000 | Bugünkü yapılandırmanın hedefi; tek container |
| Faz 1 sonu | ≤ 30 | ≈ 27.000 | [06](06-teknik-mimari.md) §13.3 "Pilot / Faz 1" bandı |
| Faz 2 (Haz 2027) | ≈ 100 | ≈ 90.000 | Tek container'ın **dışına** çıkma kararı bu bantta verilir |
| Faz 3 hedefi (Mar 2028) | ≈ 1.000 | ≈ 900.000 | Zirvede ≈ 1,7 sipariş/sn ve 15–20 WhatsApp olayı/sn ([06](06-teknik-mimari.md) §13.3) |

Yük **küçüktür**: sıkışma noktası istek sayısı değil, tek container'ın **tek hata noktası** olmasıdır (veritabanı
container'ın içindedir, `max_instances: 1` bu yüzden değiştirilemez — ikinci örnek ikinci, boş bir veritabanı
demektir).

### 16.4 Hangi eşikte ne yapılır

Sırayla okunur; her satırın kanıtı ölçümdür, "sanırım yavaşladı" değildir.

| Gözlem | Eşik | Yapılacak |
|---|---|---|
| `diskFreePct` düşüyor | < %40 | Büyüme hızını ölç (iki tarihte `diskFreeMb`), görsel saklamayı gözden geçir; < %15'te `disk_low` uyarısı gelir (U-26, [17](17-olay-mudahale-runbook.md) §2.6) |
| `diskFreePct` | < %25 ve düşüyor | `instance_type` → `standard-1`; gerekçeyi §16.1'e yaz, `mode.test.mjs` kapasite vakasını güncelle |
| `memUsedPct` | sürekli > %70 | Önce yığın tavanlarını (`entrypoint.sh`) gözden geçir, sonra örnek tipini; %95'te `memory_high` (U-27) |
| "Failed to start container" | ilk kez | `instance_type` → `standard-1` (§13 Sorun giderme) |
| `jobLagSec` | zirvede sürekli > 60 sn | Worker'ın iş eşzamanlılığı ve `max: 5` havuzu; 300 sn'de uç 503 döner |
| PostgreSQL "too many connections" | bir kez bile | Havuzları topla (api 10 + worker 5) ya da `max_connections`'ı artır — ikisi birden yapılmaz, bellek de artar |
| SSE sınırı uyarısı (U-19) | tekrarlıyorsa | Gerçek sekme sayısını öğren; kalabalık işletmede `SSE_MAX_PER_BRANCH`/`SSE_MAX_PER_TENANT` ortamdan artırılır (bellek maliyeti düşüktür) |
| İşletme sayısı | > 30 | Tek container bandının sonu: [06](06-teknik-mimari.md) §13.3 Faz 2 topolojisi (ayrı veritabanı düğümü) değerlendirilir. **Bu bir mimari karardır, ölçümle tetiklenir** |

**Bilerek yapılmayan:** CPU kullanımı ölçülmüyor (Cloudflare Containers CPU'yu kullanım başına ücretlendirir ve
sağlık ucu CPU oranı raporlamaz); p95 gecikme ölçümü yok (06 §13.3'ün "p95 webhook→panel > 2 sn" tetikleyicisi
bugün ölçülemiyor — dış izlemenin yanıt süresi grafiği kaba vekildir). İkisi de ölçüm altyapısı işidir (E-2).
