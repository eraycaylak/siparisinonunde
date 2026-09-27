# 15 — Kurulum ve İşletim Rehberi (geliştirici / operatör)

> **Kime:** Sunucuyu kuran, güncelleyen ve nöbet tutan kişi (00 §12a: sistemi Claude yazar ve bakımını yapar, proje sahibi ürün/saha tarafını yürütür). Esnafa dönük değildir.
> **Bağlayıcı kaynaklar:** [00](00-kararlar-ve-sozluk.md) §10, §12a · [14](14-uygulama-sartnamesi.md) §1, §3, §11 · [08](08-mevzuat-kvkk-odeme-fatura.md) §9 · [13](13-varsayim-ve-teyit-kaydi.md) §2.
> **Dağıtım dosyaları:** `docker-compose.yml`, `Caddyfile`, `docker/*.Dockerfile`, `docker/env.production.example`, `scripts/*`; canlı ortam otomasyonu `.github/workflows/deploy-production.yml` ve `scripts/vps/*` (§14).
> **Canlı ortam (00 §12a madde 10):** Türkiye'deki VPS, demo verisi yok, kurulum ve güncelleme GitHub Actions ile (§14). Aşağıdaki elle kurulum adımları aynı yığının ayrıntısı ve yedek yoldur.
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
13. [Cloudflare ortamı (VPS öncesi alan adı, sonra gizli staging)](#13-cloudflare-ortamı-vps-öncesi-alan-adı-sonra-gizli-staging)
14. [Canlı ortam: Türkiye VPS'i GitHub Actions ile](#14-canlı-ortam-türkiye-vpsi-github-actions-ile)

---

## 1. Mimari özet

Tek VPS üzerinde Docker Compose (00 §12a). Canlı ortam budur (00 §12a madde 10): Türkiye'deki VPS, önünde yalnız DNS ve proxy olarak Cloudflare (turuncu bulut); kurulum ve güncelleme GitHub Actions ile (§14).

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
| Sunucu | **Türkiye'de** VPS, 2 vCPU / 4 GB RAM / 80 GB SSD, IPv4 | Kişisel veri Türkiye'de (00 §10, 08 §2.12). Aday sağlayıcılar: Turkcell Bulut, Türk Telekom, Huawei Cloud İstanbul, Radore, Bulutistan (V-009 teklifleri). ISO 27001 ve DPA belgesi alınır. |
| İşletim sistemi | Ubuntu 24.04 LTS | Otomatik kurulum sunucu saat dilimini Europe/Istanbul yapar (yedek cron'u 03:30 İstanbul). Konteynerler UTC'dir; uygulama İstanbul saatini kendisi hesaplar. |
| Docker | Docker Engine 27+ ve Compose v2.24+ (BuildKit açık) | `docker compose version` |
| Disk | Veritabanı + 14 günlük yedek + görseller için en az 40 GB boş | Yedekler ayrıca ikinci bir Türkiye lokasyonuna kopyalanır (§8). |
| Ağ | Gelen: 22 (otomatik kurulum parola ile bağlanır, fail2ban korur; sonra anahtara geçiş önerilir), 80, 443. Giden: Let's Encrypt, Cloudflare API, Meta Graph API (`graph.facebook.com`) ya da 360dialog, Netgsm, Web Push servisleri (`fcm.googleapis.com`, `web.push.apple.com`, `*.push.services.mozilla.com`) | 80 portu HTTP-01 doğrulaması ve HTTPS yönlendirmesi için açık kalmalı. |
| Hesaplar | Cloudflare (DNS), WhatsApp ortak numarası için Meta Business + geliştirici uygulaması ya da 360dialog, Netgsm, ACME e-postası | §3, §6, §7 |

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

> **Bugünkü durum (27.09.2026):** Türkiye VPS'i alınana kadar `yemekgelsin.net` ve `www.yemekgelsin.net` Cloudflare ortamının Worker'ına **Custom Domain** olarak bağlıdır (§13; demo verisi yok, kayıt kapalı). **Geçiş otomatiktir:** canlı ortam iş akışı (§14) VPS'te sağlık denetimi geçince Worker'ın Custom Domain'lerini kaldırır ve aşağıdaki A kayıtlarını proxy'li (turuncu bulut) olarak yazar (`scripts/vps/cloudflare-dns.mjs`; SSL/TLS modu "Flexible" ise önce "Full (strict)" yapar). Elle yapmak gerekirse: Workers & Pages > `siparisinonunde-dev` > Settings > Domains & Routes'tan alan adlarını silin, sonra kayıtları ekleyin. Dev ortamı için ayrı bir alt alan adı (ör. `demo.yemekgelsin.net`) seçilirse: `wrangler.jsonc`'de `routes` yalnız `{ "pattern": "demo.yemekgelsin.net", "custom_domain": true }` olur (kök ve `www` satırları çıkar), `vars.APP_BASE_URL` ve `image_vars.NEXT_PUBLIC_SITE_URL` bu adrese çevrilir, iş akışındaki `SITE_URL` `https://demo.yemekgelsin.net` yapılır. İş akışındaki `ZONE` `yemekgelsin.net` olarak kalır (token izinleri bu bölge içindir); `www` → kök denetimi `SITE_URL` alt alan adındayken kendiliğinden atlanır.

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
| `WA_VERIFY_TOKEN` | cloud için | Webhook GET doğrulaması (`hub.verify_token`; ortak numarada Meta uygulamasının Webhook ayarına da girilir, §6.2 madde 12) | `openssl rand -hex 16` |
| `PLATFORM_WA_PROVIDER` | evet | Platform numarasının (= **ortak numara**, 00 §12a madde 8) sağlayıcısı: `cloud` (Meta Cloud API, §6.2) \| `d360` (360dialog, §6.3) \| `mock`. İşletmelerin müşteri mesajları ve işletme sahibine giden uyarılar (00 §10 alarm t=2 dk) bu numaradan gider | `cloud` ya da `d360` |
| `PLATFORM_WA_API_KEY` | d360/cloud için | Platform numarasının API anahtarı: Cloud API'de kalıcı System User token'ı (§6.2 madde 9), 360dialog'da API anahtarı | Meta ya da 360dialog |
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
| `DEMO_STORE_SLUG` | hayır | Pazarlama sitesindeki "Demo menüyü aç" vitrini. **Canlı ortamda boş** (demo işletme yok; kart gizlenir) | boş |
| `DEMO_BANNER` | hayır | "Demo ortamı" uyarısı (`NEXT_PUBLIC_DEMO_BANNER`); canlı ortamda `0` | `0` |
| `SUPPORT_WHATSAPP` | önerilir | Platform destek hattı (WhatsApp), rakamlarla. Giriş ekranındaki "Parolamı unuttum" işletme sahibine bu numarayı (WhatsApp + arama) gösterir; boşsa iletişim formuna yönlendirir. Web'e derleme anında gömülür | `905321234567` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | önerilir | Web Push anahtar çifti: yeni sipariş bildirimi panel kapalıyken de cihazlara gider (00 §10 alarm t=0, §10). Boşsa push kapalıdır; API/worker açılır, logda uyarı yazar. **Değişirse** tüm cihazların aboneliği geçersizleşir, cihazlar bir sonraki "Siparişleri almaya başla"da yeniden abone olur | aşağıda |
| `VAPID_SUBJECT` | push için | İtme servislerinin (Google, Apple, Mozilla) sorun olursa ulaşacağı adres; `mailto:` ya da `https://` ile başlamalı | `mailto:destek@yemekgelsin.net` |
| `BACKUP_REMOTE`, `RETENTION_DAYS` | önerilir | Yedeğin ikinci konumu (rclone) ve saklama günü | §8 |
| `BACKUP_DIR` | hayır | Yedek klasörü; otomatik kurulumda `/opt/yemekgelsin/backups` | §8 |
| `BACKUP_PING_URL` | önerilir | Her başarılı yedekten sonra çağrılan dış izleme (push) adresi; 26 saat gelmezse alarm | §8 |

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

**Hatalı üretim yapılandırmasında API ve worker açılmaz.** Compose `NODE_ENV=production` verir; aşağıdakilerden biri varsa süreç başlamaz ve `docker compose logs api` içinde `Geçersiz üretim yapılandırması: …` yazar (`apps/api/src/config.ts`):

- `DEV_TOOLS=1` (`/api/v1/dev/*` kimlik doğrulamasızdır; canlı ortamda `DEPLOY_ENV=production`),
- `SESSION_SECRET` ya da `TRACKING_SECRET` 32 karakterden kısa ya da örnek (`dev-only…`) değer,
- `WA_VERIFY_TOKEN` boş ya da `dev-verify`,
- `SMS_PROVIDER=netgsm` iken `NETGSM_USERCODE`, `NETGSM_PASSWORD` ya da `NETGSM_HEADER` boş,
- `PLATFORM_WA_PROVIDER=d360` ya da `cloud` iken `PLATFORM_WA_API_KEY` boş (`cloud` için ayrıca `PLATFORM_WA_PHONE_NUMBER_ID` ve webhook imzası için `WA_APP_SECRET`), `PLATFORM_WA_DISPLAY_PHONE` boş/E.164 değil ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş/kısa/örnek değer (ortak numara).

Bu kurallar `scripts/check-config.ts` ile API açılmadan da denetlenir; canlı ortam iş akışı yeni imajla bunu çalışan konteynerlere dokunmadan önce yapar (§14). `docker/env.production.example` `SMS_PROVIDER=netgsm` ve `PLATFORM_WA_PROVIDER=d360` ile, anahtarlar boş olarak gelir; bu haliyle API açılmaz. Netgsm ve 360dialog hesapları hazır olmadan kurulum yapılacaksa ikisini geçici olarak `mock` yapın. Süreç açılır, logda uyarı yazar (`SMS_PROVIDER=mock: SMS OTP ve alarm SMS'leri gönderilmez` vb.). Bu durumda SMS ve platform WhatsApp uyarıları **gerçekten gitmez**: WhatsApp'sız moddaki işletmenin müşterisi SMS kodu alamaz ve sahibine alarm gitmez. `PLATFORM_WA_PROVIDER=mock` iken ortak numara da kapalıdır: `PLATFORM_WA_DISPLAY_PHONE` boşsa geliştirme numarası (+90 555 000 00 00) üretimde kullanılmaz; vitrin, QR ve sipariş onayı WhatsApp bağlantısı göstermez (yalnız `DEPLOY_ENV=dev` simülatörü bu numarayı kullanır). Canlıya çıkmadan önce gerçek sağlayıcıya geçin (§6, §7, §12).

Web Push anahtarları (`VAPID_*`) açılış için zorunlu değildir: boşsa API ve worker açılır, logda `Web Push kapalı (VAPID_PUBLIC_KEY, … boş)` uyarısı yazar ve panel kapalıyken cihazlara yeni sipariş bildirimi gitmez (§10). Biçimi bozuk bir anahtar ya da `mailto:`/`https://` ile başlamayan `VAPID_SUBJECT` ise açılışı durdurur (`Geçersiz yapılandırma: VAPID_…`).

## 5. İlk kurulum

**Önerilen yol otomatiktir (§14):** VPS'i alın, GitHub secret'larını ekleyin, "Canlı ortam (Türkiye VPS)" iş akışı sunucuyu hazırlar, kurar, ilk yöneticiyi açar ve alan adını taşır. Aşağısı aynı işlerin elle yapılışıdır (otomasyon çalışmazsa ya da başka bir sunucuda).

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

**Seed üretimde çalıştırılmaz** (00 §12a madde 10). `pnpm db:seed` demo işletmeleri ve parolası herkesçe bilinen hesapları (`demo1234`, `admin1234`) oluşturur; yalnız geliştirme içindir ve `NODE_ENV=production` + `DEPLOY_ENV=production` iken kendini reddeder. Canlı veritabanı boş başlar. Bayraklar üretim varsayılanlarıyla bir betikle yazılır (kayıt açık, WhatsApp bağlama açık, kampanyalar ve yapay zeka kapalı, SMS yedeği yalnız Netgsm tanımlıysa açık, platform uyarıları açık; var olan bayrağa dokunmaz):

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

00 §12a madde 8 gereği **tüm platformda tek WhatsApp numarası** vardır: "Yemek Gelsin" ortak numarası. Bütün işletmeler varsayılan olarak bu numaradan sipariş alır; işletme sahiplerine giden platform uyarıları (yeni sipariş alarmı, bağlantı sorunu …) da aynı numaradan gider. Yapılandırma tek yerdedir: `.env`'deki `PLATFORM_WA_*` değişkenleri. Kod sağlayıcıdan bağımsızdır (`apps/api/src/wa/providers/{mock,cloud,d360}.ts`); yalnız resmi WhatsApp Business Platform (Cloud API) kullanılır.

Numarayı iki yoldan biriyle bağlarsınız; ikisi de aynı sonucu verir, uygulama tarafında yalnız birkaç değişken farklıdır:

| | **Yol A: Meta Cloud API (doğrudan)** — §6.2 | **Yol B: 360dialog (aracı firma)** — §6.3 |
|---|---|---|
| Aylık numara ücreti | Yok (yalnız Meta mesaj ücretleri) | ~49 €/ay (teyit edilmeli) + Meta mesaj ücretleri |
| Kurulum | Meta Business + geliştirici uygulaması + kalıcı token; daha çok adım | 360dialog kayıt ekranı; daha az adım |
| Webhook imzası | `X-Hub-Signature-256` (`WA_APP_SECRET`) denetlenir | İmza yok; URL'deki gizli belirteç korur (teyit edilmeli) |
| `PLATFORM_WA_PROVIDER` | `cloud` | `d360` |

Yol A'da aracı ücreti yoktur ama adım sayısı fazladır; Yol B kurulumu kısaltır ve aracı desteği sağlar (00 §12a madde 8: seçim proje sahibinindir). Platformun kendi tek numarası için doğrudan Cloud API kullanmak Meta Tech Provider sürecini (App Review) gerektirmez; o süreç başka işletmelerin numaralarını bağlamak içindir (teyit edilmeli). İşletmenin **kendi numarası** isteğe bağlıdır (üst paket): §6.8.

### 6.1 Ortak numara nasıl çalışır (operatör özeti)

- Her işletmenin kısa bir **dükkan kodu** vardır (`tenants.wa_code`, ör. `BOZOK`; kayıtta slug'dan üretilir). İşletmenin QR'ı ve bağlantısı ortak numaraya kodlu ön-dolu mesaj açar: `https://wa.me/<ortak numara>?text=Merhaba, Bozok Pide Salonu için sipariş vermek istiyorum. #BOZOK`. İşletme sahibi bunları `Panel > Ayarlar > WhatsApp`'ta görür: kod, bağlantı (kopyala), QR (PNG/SVG indir) ve yazdırılabilir A5/A6 masa kartı.
- Ortak numaraya gelen her mesaj tek webhook adresine düşer: `https://DOMAIN/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>`. Ham olay kaydedilir, hemen 200 dönülür; `wa-inbound` işi mesajın dükkanını seçer (14 §8.1): `#KOD` → o dükkan; Akış B sipariş kodu → siparişin dükkanı; buton/yanıt → mesajın dükkanı; son 24 saatte konuşulan dükkan → devam; dükkan adı → eşleşen dükkan; hiçbiri değilse **dükkan seçici** ("Hangi dükkandan sipariş vermek istersin?": son 2 dükkan + "Diğer dükkanlar", ya da dükkan listesi).
- Seçilen dükkanın konuşma motoru aynen çalışır; her mesajın ilk satırı kalın dükkan adıdır. Sohbet, müşteri ve sipariş verisi dükkan başına ayrıdır; sipariş o dükkanın paneline düşer.
- Dükkan kodunu ve modu (ortak numara / kendi numarası) yalnız platform yöneticisi değiştirir: `Admin > İşletmeler > (işletme) > WhatsApp`. Kod değişirse eski QR'lar çalışmaz; işletmeye yenisini bastırmasını söyleyin.
- `Admin > WhatsApp` en üstte **ortak numara** kartını gösterir: numara, sağlayıcı, maskeli webhook adresi, son webhook zamanı, ortak numaradaki ve dükkan listesinde görünen işletme sayısı, son 24 saatte dükkan seçici mesajları ve yapılandırma sorunları.

### 6.2 Yol A — Meta Cloud API ile doğrudan (tek numara)

**Proje sahibi için kısa yol: §6.2a.** Orada Meta'da yalnız tıklama yapılır, beş değer GitHub secret'ı (Cloudflare dev) ya da `.env` (VPS) olarak girilir; numara kaydı, webhook aboneliği ve şablonlar `Admin > WhatsApp > WhatsApp kurulumu` düğmeleriyle yapılır. Bu bölüm ayrıntılı başvuru ve elle (curl) yoldur.

Menü adları Meta'nın arayüz diline göre Türkçe ya da İngilizce görünür; ikisi birlikte yazılmıştır. Meta ekranları sık değişir: her adım canlıya çıkmadan önce güncel belgeyle doğrulanır (teyit edilmeli).

**Hazırlık:** WhatsApp'ta hiç kullanılmamış (ya da WhatsApp/WhatsApp Business uygulamasındaki hesabı silinmiş) bir telefon numarası: SMS ya da sesli arama alabilen bir cep hattı veya sabit/0850 hat. Şirketin resmi bilgileri (unvan, adres, vergi levhası) ve `yemekgelsin.net` sitesinin yayında olması (görünen ad ve işletme doğrulaması siteye bakar).

1. **İşletme portföyü (Business portfolio):** [business.facebook.com](https://business.facebook.com) → **Hesap oluştur (Create account)** → şirket adı, adınız, iş e-postası. Sonra **Ayarlar (Settings) > İşletme bilgileri (Business info)**: yasal unvan, adres, telefon, web sitesi.
2. **İşletme doğrulaması (Business verification):** **Ayarlar > Güvenlik Merkezi (Security Center) > Doğrulamayı başlat (Start verification)** → vergi levhası / ticaret sicil belgesi yükleyin. Doğrulanmamış portföyde günlük iletişim sınırı düşüktür (§6.7) ve görünen ad onayı zorlaşır (teyit edilmeli). Birkaç gün sürebilir; hemen başlatın.
3. **Ödeme yöntemi:** **Ayarlar > Faturalandırma ve ödemeler (Billing & payments)** ya da WhatsApp Manager > **Ödeme yöntemleri (Payment methods)** → şirket kartını ekleyin. Kart yoksa ücretli mesajlar (şablonlar) gönderilmez, hata 131042 döner.
4. **Geliştirici uygulaması:** [developers.facebook.com](https://developers.facebook.com) → aynı Facebook hesabıyla giriş → **Uygulamalarım (My Apps) > Uygulama oluştur (Create app)** → kullanım amacı olarak **"Müşterilerle WhatsApp üzerinden iletişim kurun" (Connect with customers through WhatsApp)** (eski ekranda: **Diğer (Other) > İşletme (Business)**) → uygulama adı `yemekgelsin`, 1. adımdaki işletme portföyünü seçin → **Oluştur**.
5. **WhatsApp ürününü ekleyin:** Uygulama panosunda **WhatsApp > Kur (Set up)** → işletme portföyünü seçin. Meta bir WhatsApp Business hesabı (WABA) ve deneme numarası açar. Sol menüde **WhatsApp > API Kurulumu (API Setup)** sayfası görünür.
6. **Gerçek numarayı ekleyin:** **API Kurulumu > Telefon numarası ekle (Add phone number)** → işletme görünen adı **Yemek Gelsin**, saat dilimi İstanbul, kategori (Yemek ve içecek / Food & beverage), kısa açıklama → numara (ülke kodu +90) → **SMS ya da sesli arama** ile gelen 6 haneli kodu girin.
7. **Görünen ad onayı:** [business.facebook.com](https://business.facebook.com) > **WhatsApp Manager > Telefon numaraları (Phone numbers)** → numaranın yanında görünen ad durumu "Onaylandı (Approved)" olmalı. Ad, sitede ve belgelerde geçen marka adıyla aynı olmalıdır; onay 1–3 gün sürebilir (teyit edilmeli).
8. **Numarayı Cloud API'ye kaydedin (register) ve iki adımlı PIN:** en kolayı `Admin > WhatsApp > WhatsApp kurulumu > Numarayı etkinleştir` (6 haneli PIN, §6.2a). Elle: WhatsApp Manager > Telefon numaraları > numara > **İki adımlı doğrulama (Two-step verification)** → 6 haneli PIN belirleyin, parola yöneticisinde saklayın. Numara API Kurulumu'nda "Bağlı değil (Pending)" görünüyorsa bir kez kaydedin (9. adımdaki token ile):
   ```bash
   curl -X POST "https://graph.facebook.com/v23.0/<PHONE_NUMBER_ID>/register" \
     -H "Authorization: Bearer <KALICI_TOKEN>" -H "Content-Type: application/json" \
     -d '{"messaging_product":"whatsapp","pin":"<6 haneli PIN>"}'
   ```
9. **Kalıcı erişim anahtarı (System User token):** business.facebook.com > **Ayarlar > Kullanıcılar > Sistem kullanıcıları (System users) > Ekle (Add)** → ad `yemekgelsin-api`, rol **Yönetici (Admin)** →
   - **Varlık ata (Assign assets):** **Uygulamalar**'da 4. adımdaki uygulama (Tam kontrol / Full control), **WhatsApp hesapları**'nda WABA (Tam kontrol).
   - **Yeni token oluştur (Generate new token)** → uygulamayı seçin → süre **Hiçbir zaman (Never)** → izinler: `whatsapp_business_messaging`, `whatsapp_business_management` → **Oluştur**. Token **bir kez** gösterilir; doğrudan parola yöneticisine kopyalayın, e-posta/WhatsApp ile taşımayın. (API Kurulumu sayfasındaki "geçici token" 24 saatte biter; üretimde kullanılmaz.)
10. **Kimlikler ve uygulama gizli anahtarı:** developers.facebook.com > uygulama > **WhatsApp > API Kurulumu**: **Telefon numarası kimliği (Phone number ID)** ve **WhatsApp Business hesap kimliği (WABA ID)**. **Uygulama ayarları > Temel (App settings > Basic) > Uygulama gizli anahtarı (App secret) > Göster (Show)**. Aynı sayfada **Gizlilik politikası URL'si**: `https://yemekgelsin.net/yasal/gizlilik`.
11. **`.env`'i doldurun** (§6.4'teki ortak blok + Yol A satırları) ve API/worker'ı yeniden başlatın: `docker compose up -d api worker`. Webhook doğrulaması (12. adım) çalışan API'ye ihtiyaç duyar.
12. **Webhook:** developers.facebook.com > uygulama > **WhatsApp > Yapılandırma (Configuration) > Webhook > Düzenle (Edit)**:
    - **Geri çağırma URL'si (Callback URL):** `https://yemekgelsin.net/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>`
    - **Doğrulama belirteci (Verify token):** `.env`'deki `WA_VERIFY_TOKEN`
    - **Doğrula ve kaydet (Verify and save)** → API `hub.challenge`'ı geri döndürür. Hata alırsanız: 404 = belirteç yol ile `.env`'dekinden farklı ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş; 403 = `WA_VERIFY_TOKEN` farklı.
    - Aynı ekranda **Webhook alanları (Webhook fields) > Yönet (Manage)** → **`messages`** alanına abone olun (gelen mesajlar ve teslim/okundu durumları bununla gelir).
    - Uygulamanın WABA'ya abone olduğunu doğrulayın (teyit edilmeli; panodan kurulumda genelde kendiliğinden olur): `Admin > WhatsApp > WhatsApp kurulumu > Webhook aboneliğini aç` ya da `curl -X POST "https://graph.facebook.com/v23.0/<WABA_ID>/subscribed_apps" -H "Authorization: Bearer <KALICI_TOKEN>"`.
13. **Uygulamayı canlı moda alın:** uygulama panosunun üstündeki **Uygulama modu (App Mode): Geliştirme → Canlı (Live)**. Geliştirme modunda webhook yalnız test verisi gönderir (teyit edilmeli).
14. **Şablonlar ve deneme:** §6.5 ve §6.6.

### 6.2a Gerçek WhatsApp'ı bağlama (tek numara, Meta doğrudan) — proje sahibi için kısa yol

Meta'da yalnız tıklama yaparsınız ve **beş değer** kopyalarsınız; gerisini `Admin > WhatsApp > WhatsApp kurulumu`'ndaki düğmeler yapar. Menü adları Meta'nın İngilizce arayüzüne göredir (parantez içinde Türkçesi); Meta ekranları değişebilir (teyit edilmeli, 2026 arayüzü).

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

Cloudflare dev ortamı (§13): GitHub > depo > **Settings > Secrets and variables > Actions > New repository secret** (ad + değer → **Add secret**):

| Secret | Değer |
|---|---|
| `META_WA_TOKEN` | 4. adımdaki token |
| `META_WA_PHONE_NUMBER_ID` | Phone number ID |
| `META_WA_WABA_ID` | WhatsApp Business Account ID |
| `META_APP_SECRET` | App secret |
| `WA_PHONE` | numara, ülke koduyla: `+905321234567` |

Sonra **Actions > "Dev ortamı (Cloudflare)" > Run workflow** (secret eklemek dağıtımı kendiliğinden başlatmaz). `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_APP_SECRET` ve `WA_PHONE` birlikte varsa ortak numara gerçek Meta Cloud API ile açılır ve simülatör kapanır; iş akışı özetinde "WhatsApp: gerçek numara" yazar. Biri eksikse uyarı verir ve simülatörde kalır; telefon ya da kimlik biçimi yanlışsa dağıtım Türkçe hatayla durur. `META_WA_WABA_ID` yalnız aşağıdaki 4. ve 5. düğmeler için gerekir.

Türkiye VPS'i (canlı ortam, §14): **aynı beş GitHub secret'ı** kullanılır; "Canlı ortam (Türkiye VPS)" iş akışı her dağıtımda bunları `.env`'e yazar (`PLATFORM_WA_PROVIDER=cloud`, `PLATFORM_WA_API_KEY`, `PLATFORM_WA_PHONE_NUMBER_ID`, `PLATFORM_WA_WABA_ID`, `WA_APP_SECRET`, `PLATFORM_WA_DISPLAY_PHONE`; §6.4 Yol A). Secret değişince iş akışını elle çalıştırın. Elle kurulumda aynı değerler `.env`'e yazılıp `docker compose up -d api worker`.

**C. Admin'de, sırayla** — `/admin/giris` → platform sahibi hesabı → **WhatsApp** → **WhatsApp kurulumu** (yalnız platform sahibi görür; her işlem denetim kaydına yazılır). "Kurulum durumu" kartında beş değer "Tanımlı" görünmeli (gizliler yalnız son 4 karakterle).

1. **Göster** → webhook adresi ve doğrulama belirteci. developers.facebook.com > uygulama > **WhatsApp > Configuration (Yapılandırma) > Webhook > Edit**: **Callback URL** = webhook adresi, **Verify token** = doğrulama belirteci (ikisinde de **Kopyala**) → **Verify and save**. Aynı sayfada **Webhook fields > Manage** → **messages** satırında **Subscribe**. Doğrulama hatası: 404 → adres eksik ya da yanlış kopyalandı; 403 → doğrulama belirteci farklı.
2. **Bağlantıyı test et** → numara, görünen ad ve onayı, Cloud API kaydı, kalite. Yapılacak bir şey varsa altında Türkçe yazar (190 → token geçersiz, izin hatası, yanlış kimlik …).
3. **Numarayı etkinleştir** → 6 haneli PIN'i iki kez girin. Bu PIN numaranın **WhatsApp iki adımlı doğrulama PIN'idir**: siz seçersiniz, parola yöneticisine kaydedin; numarayı yeniden kaydederken gerekir. Sonra 2. düğme "Cloud API'ye kayıtlı" göstermeli.
4. **Webhook aboneliğini aç** → "Abonelik açık".
5. **Şablonları Meta'ya gönder** → kodun kullandığı tüm şablonlar (sipariş durumu + işletme uyarıları; §6.5) Meta'da yoksa oluşturulur; var olana dokunulmaz, hiçbir şey silinmez. **Durumu yenile** her şablonu Onaylandı / İncelemede / Reddedildi olarak (ret sebebiyle) gösterir; utility şablonlar genelde dakikalar içinde onaylanır.

**Deneme:** canlı ortamda (demo işletme yoktur) kendi deneme işletmenizi açın (`/panel/kayit`), kurulumu bitirin ve kendi telefonunuzdan numaraya dükkan kodunu yazın (`#KOD`, panel > Ayarlar > WhatsApp) → dükkanın adıyla karşılama ve **Menüyü aç** gelmeli; `Admin > WhatsApp` ortak numara kartında "Son webhook" güncellenir. `/dev/whatsapp` artık "Gerçek WhatsApp bağlı; simülatör kapalı" gösterir.

**Görünen ad:** "Yemek Gelsin" adı Meta incelemesinden geçer (genelde 1–3 gün). Onaylanana kadar müşteri ad yerine numarayı görebilir. Reddedilirse WhatsApp Manager > Phone numbers > numara > **Display name > Edit** ile yeniden gönderin; ad sitedeki marka adıyla aynı olmalı. Durum 2. düğmede görünür.

**KVKK:** Cloudflare ortamının verileri Türkiye dışındadır (§13). Orada gerçek WhatsApp **yalnız kendi telefonlarınızla** denenir: QR basılıp dağıtılmaz, gerçek işletme ya da müşteri bu numaraya yönlendirilmez. Gerçek müşteriler Türkiye VPS'inde (§14) gelir. **Taşınınca C.1'i yeni sunucuda tekrarlayın:** canlı ortamın webhook belirteci (`PLATFORM_WA_WEBHOOK_TOKEN`) ve doğrulama belirteci (`WA_VERIFY_TOKEN`) Cloudflare'dekilerden farklıdır; `https://yemekgelsin.net/admin` > WhatsApp > WhatsApp kurulumu > **Göster** → Meta'da Callback URL ve Verify token'ı yenileyip **Verify and save**. Yapılmazsa gelen mesajlar yeni sunucuya ulaşmaz.

**Simülatöre dönmek:** GitHub'da `META_WA_TOKEN` secret'ını (ya da dört zorunlu secret'tan birini) silin → Run workflow; iş akışı Worker'daki eski değerleri de siler.

### 6.3 Yol B — 360dialog ile (tek numara)

1. **Hesap:** [hub.360dialog.com](https://hub.360dialog.com) → platform şirketi adına hesap açın; ödeme planı numara başına ~49 €/ay (teyit edilmeli). Meta mesaj ücretleri ayrıca Meta'ya tanımlı karttan çekilir (§6.2 madde 3).
2. **Numara ekleme:** 360dialog Hub'da **Numara ekle** → Facebook hesabıyla giriş (Embedded Signup) → işletme portföyünü seçin (yoksa oluşturun; §6.2 madde 1–2 burada da geçerlidir) → görünen ad **Yemek Gelsin** → numarayı SMS/arama koduyla doğrulayın. Bu numara yalnız platform içindir; yeni bir hat kullanın.
3. **API anahtarı:** Hub'da numaranın ayarlarından API anahtarı üretin (bir kez gösterilir — teyit edilmeli) → parola yöneticisine.
4. **`.env`** (§6.4, Yol B satırları) → `docker compose up -d api worker`.
5. **Webhook:** platform numarasının webhook adresini API ile tanımlayın (teyit edilmeli: v2 uç noktası `configs/webhook`):
   ```bash
   curl -X POST https://waba-v2.360dialog.io/v1/configs/webhook \
     -H "D360-API-KEY: <PLATFORM_WA_API_KEY>" -H "Content-Type: application/json" \
     -d '{"url":"https://yemekgelsin.net/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>"}'
   ```
   360dialog Meta imzasını (`X-Hub-Signature-256`) göndermez; `PLATFORM_WA_PROVIDER=d360` iken imza denetlenmez, URL'deki gizli belirteç korur (teyit edilmeli). Belirteci gizli tutun: loglarda ve ekran görüntülerinde paylaşmayın.
6. **Şablonlar ve deneme:** §6.5 ve §6.6.

### 6.4 Ortam değişkenleri

Ortak blok (iki yolda da):

```bash
PLATFORM_WA_DISPLAY_PHONE=+908501234567            # ortak numara, E.164 (QR, wa.me bağlantıları, Akış B)
PLATFORM_WA_WEBHOOK_TOKEN=$(openssl rand -hex 24)  # webhook yolundaki gizli belirteç, ≥ 16 karakter
WA_VERIFY_TOKEN=$(openssl rand -hex 16)            # Meta webhook GET doğrulaması (Yol A)
WA_DEFAULT_PROVIDER=d360                           # yalnız kendi numarasına geçen işletmelerin varsayılanı (§6.8)
```

Yol A (Meta Cloud API):

```bash
PLATFORM_WA_PROVIDER=cloud
PLATFORM_WA_API_KEY=<§6.2 madde 9: kalıcı System User token>
PLATFORM_WA_PHONE_NUMBER_ID=<§6.2 madde 10: Phone number ID>
PLATFORM_WA_WABA_ID=<§6.2 madde 10: WABA ID>       # isteğe bağlı: admin kurulumu (webhook aboneliği, şablon gönderimi)
WA_APP_SECRET=<§6.2 madde 10: App secret>          # webhook imzası
```

Yol B (360dialog):

```bash
PLATFORM_WA_PROVIDER=d360
PLATFORM_WA_API_KEY=<360dialog API anahtarı>
PLATFORM_WA_PHONE_NUMBER_ID=                       # boş
```

`$(openssl …)` ifadeleri `.env`'e kendiliğinden işlenmez: komutu kabukta çalıştırıp çıktısını yazın. API açılışta eksikleri denetler (§4): gerçek sağlayıcıda `PLATFORM_WA_DISPLAY_PHONE` boş/E.164 değilse ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş, 16 karakterden kısa ya da `dev…` ile başlıyorsa süreç açılmaz. Açılışta ortak numara tüm ortak numara işletmelerinin kayıtlarına yazılır (`syncSharedWaAccounts`); numara değişirse yalnız `.env` güncellenip `docker compose up -d api worker` yapılır, ama **basılı QR'lar eski numarayı içerdiğinden numara değiştirmek bütün işletmelerin QR'larını geçersiz kılar**: numarayı bir kez seçin.

### 6.5 Şablonlar (müşteri ve platform uyarıları)

24 saat penceresi dışındaki durum mesajları ve işletme sahibine giden uyarılar onaylı **utility** şablonlarla gider. Ortak numarada tek WABA olduğu için şablonlar **bir kez**, platform hesabında oluşturulur (işletme başına değil). Yol A: `Admin > WhatsApp > WhatsApp kurulumu > Şablonları Meta'ya gönder` hepsini tek seferde oluşturur (eksikleri; var olana dokunmaz) ve durumlarını (onay, ret sebebi, kategori değişimi) gösterir (§6.2a). Tek kaynak `apps/api/src/services/messaging/template-bodies.ts` (`WA_TEMPLATE_CATALOG`): gövde metni, konumsal değişkenler (`{{1}}`…, sıra `CUSTOMER_TEMPLATES` / `PLATFORM_TEMPLATES`), örnek değerler ve butonlar; gövdelerin 02 §5.2/§5.3 ile aynı olduğu testle denetlenir. Butonlar: takip şablonlarında "Siparişi takip et" / "Değerlendir" dinamik URL (`APP_BASE_URL/t/{{1}}`, değişken takip token'ı), `yanit_bekliyor_v1`'de "Devam et" hızlı yanıt, platform uyarılarında panelin sabit adresi (gönderen kod buton parametresi vermez), `kurye_giris_v1`'de `/kurye/giris?t={{1}}`. Metin değişikliği yeni sürüm adıyla (`_v2`) yapılır. Elle yol: WhatsApp Manager > **Mesaj şablonları (Message templates) > Şablon oluştur**; Yol B: 360dialog Hub ya da API. Dil: Türkçe (`tr`), kategori: Yardımcı program (Utility).

- **Müşteri şablonları:** `siparis_alindi_v1`, `siparis_onaylandi_v1`, `siparis_hazir_v1`, `siparis_yolda_v1`, `siparis_teslim_v1`, `siparis_reddedildi_v1`, `siparis_iptal_v1`, `siparis_iptal_yanitsiz_v1`, `yanit_bekliyor_v1`. Metin ve parametre sırası `packages/core/src/messages/tr.ts` → `CUSTOMER_TEMPLATES`; hepsi işletme adını (`{isletme}`) değişken olarak taşır, müşteri hangi dükkandan mesaj aldığını görür. Şablonlara promosyon ya da indirim kodu eklenmez (İYS, 00 §7).
- **Platform şablonları** (işletme sahibine): `isletme_yeni_siparis_v1`, `isletme_panel_cevrimdisi_v1`, `kurye_giris_v1`, `isletme_baglanti_sorunu_v1`, `isletme_meta_odeme_v1`, `isletme_kalite_uyari_v1` (V-011). `isletme_yeni_siparis_v1` yeni sipariş alarmıdır (t=2 dk, 00 §10). `isletme_panel_cevrimdisi_v1` "panel çevrimdışı" uyarısıdır (06 §7.7): şube sipariş alırken (çalışma saati içinde, duraklatılmamış, sipariş alma açık, web canlı) sipariş ekranı 5 dakikadır açık değilse ya da şube açılalı 10 dakika olduğu hâlde açılıştan beri hiç açılmadıysa işletme sahibine gider; şube başına saatte en çok bir kez (`cron.panel_presence`, §10). Parametreler: işletme adı (ek şubede "İşletme · Şube") ve dakika. Gerekirse `Admin > Bayraklar > platform_wa_alerts` ile geçici kapatılır.
- İşletme sahibinin uyarı şablonlarına verdiği yanıtlar da ortak webhook'a gelir ve müşteri mesajı gibi yönlendirilir; ayrı destek gelen kutusu henüz yoktur (açık iş).

### 6.6 Deneme ve izleme

1. Kendi telefonunuzla bir işletmenin QR'ını okutun (`Panel > Ayarlar > WhatsApp`, ya da bağlantıyı açın) → mesajı gönderin → o işletmenin adıyla karşılama ve **Menüyü aç** gelmeli; linkten sipariş verin, o işletmenin panelinde sesli uyarıyı görün, onaylayın, "onaylandı" mesajı gelsin.
2. İkinci bir işletmenin QR'ını okutun → ikinci işletmenin adıyla karşılama gelmeli. Ardından kodsuz "merhaba" yazın: son 24 saatteki dükkan devam eder; "değiştir" yazınca dükkan seçici gelir.
3. `Admin > WhatsApp` > **Ortak numara** kartı: "Son webhook" yeni olmalı, sorun satırı olmamalı. Aynı sayfadaki **WhatsApp kurulumu** (platform sahibi): "Bağlantıyı test et" hazır, abonelik açık, şablonlar Onaylandı. Paneldeki "Test mesajı gönder" pencere kuralına tabidir: test telefonu son 24 saatte ortak numaraya yazmış olmalıdır.
4. Webhook dışarıdan: `curl -i "https://DOMAIN/api/v1/webhooks/wa/shared/yanlis-belirtec-0000"` → 404 (yol çalışıyor, belirteç yanlış). Doğru belirteçle imzasız `POST` Yol A'da 401 döner (imza denetleniyor).

### 6.7 Maliyet ve sınırlar

- **Aracı ücreti:** Yol A'da yok; Yol B'de numara başına ~49 €/ay (teyit edilmeli). Tek numara olduğu için bu ücret işletme sayısıyla artmaz.
- **Meta mesaj ücretleri platform hesabına yansır** (00 §12a madde 8): ücretsiz hizmet (service) mesajı hakkı numara/WABA başınadır ve **tüm dükkanlar tek numarayı paylaştığı için bu hak da paylaşılır**. Proje sahibinin kararında geçen "ayda 1.000 ücretsiz hizmet mesajı" Meta'nın eski (Kasım 2024 öncesi) modelidir; güncel modelde müşterinin başlattığı 24 saat penceresindeki serbest mesajlar ücretsiz, pencere içindeki utility şablonlar da ücretsizdir; ücret pencere dışındaki şablon mesajlarından alınır (teyit edilmeli — V-001 rate card). Ücret, mesaj bazında işletmeye göre izlenir (`messages.tenant_id`); pakete yansıtma açık karar.
- **Günlük iletişim sınırı (messaging limit):** işletmenin başlattığı sohbetler (pencere dışı şablonlar) için 24 saatte ulaşılabilecek kişi sayısı portföy başınadır ve yeni hesapta düşüktür (ör. 250; işletme doğrulaması ve kaliteyle 1.000 → 10.000 … artar — teyit edilmeli). Tüm dükkanlar bu sınırı paylaşır: işletme doğrulamasını (§6.2 madde 2) canlıdan önce tamamlayın. Müşterinin başlattığı sohbetler sınıra sayılmaz.
- **Kalite ve engelleme:** müşteriler numarayı engeller ya da şikâyet ederse numaranın kalitesi düşer ve **bütün dükkanlar etkilenir**. Promosyon gönderilmez, mesaj bütçesi (sipariş başına en çok 4 durum mesajı) korunur; `isletme_kalite_uyari_v1` uyarısını ciddiye alın.
- **Hız:** tüm dükkanların gönderimleri tek numaranın hız sınırını paylaşır (uygulama tek sıra tutar; `wa/throttle.ts`).
- **Hesap hataları:** ortak numarada token (190) ya da ödeme (131042) hatası işletmenin kaydını kapatmaz ve işletme sahibine uyarı göndermez; loga yazılır. `Admin > WhatsApp` ortak numara kartını ve `docker compose logs worker | grep 'ortak numara'` çıktısını izleyin.

### 6.8 Kendi numarası (isteğe bağlı, ileri)

Kendi numarasıyla çalışmak isteyen işletme (üst paket; 00 §12a madde 8) önce platform yöneticisince **kendi numarası** moduna alınır: `Admin > İşletmeler > (işletme) > WhatsApp > WhatsApp modu: Kendi numarası` → gerekçe → Kaydet. Ortak numara kaydı kapanır; işletme sahibi kendi numarasını bağlayana kadar WhatsApp'tan sipariş gelmez, web siparişleri SMS ile doğrulanır (WhatsApp'sız mod). Müşteri eski `#KOD`'u yazarsa işletmenin kendi numarası bildirilir. Sonra işletme sahibi:

1. **Hesap ve numara (360dialog, önerilen):** 360dialog Client Hub'da işletme adına hesap → **Numara ekle** (Embedded Signup). Varsayılan yol **Coexistence**'tır: esnaf WhatsApp Business uygulamasındaki numarasını ve telefondan yazmayı korur (00 §6.4; 360dialog'da Coexistence desteği ve kısıtları teyit edilmeli — V-018). Alternatif: yeni numara. Görünen ad (display name) Meta onayından geçer. İşletmenin Meta Business portföyünde geçerli bir ödeme kartı olmalıdır.
2. **API anahtarı:** Client Hub'da numaranın ayarlarından üretilir (bir kez gösterilir — teyit edilmeli). Anahtarı yalnız güvenli kanaldan alın.
3. **Panelde (yalnız işletme sahibi):** `Panel > Ayarlar > WhatsApp` (`/panel/ayarlar/whatsapp`): Sağlayıcı **360dialog** (ya da Meta Cloud API: Phone number ID + erişim anahtarı), "WhatsApp numarası", API anahtarı → **Kaydet**. Anahtar `ENCRYPTION_KEY` ile şifrelenip saklanır; ekranda maskeli görünür.
4. **Webhook adresi:** aynı sayfadaki "Webhook adresi" kartında işletmeye özel adres görünür: `https://DOMAIN/api/v1/webhooks/wa/<gizli-belirteç>`. 360dialog'a API ile tanımlanır (§6.3 madde 5'teki komut, işletmenin anahtarı ve bu adresle); Meta Cloud API'de uygulamanın Webhook ayarına girilir. Adres "Webhook adresini yenile" ile değiştirilebilir (eski adres hemen geçersizleşir).
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

**Otomatik (canlı ortam, §14):** `main` ya da çalışma dalına her push (yalnız `docs/**` ve `*.md` değişiklikleri hariç) "Canlı ortam (Türkiye VPS)" iş akışını çalıştırır: tam o commit'i sunucuya getirir, derler, yapılandırmayı denetler, yedek alır, migration'ları uygular, servisleri yeniler ve sağlık/duman testlerini yapar. **Geri alma:** Actions > "Canlı ortam (Türkiye VPS)" > Run workflow > `ref` = önceki commit SHA'sı. Elle güncelleme:

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

| Ne | Nasıl |
|---|---|
| Servis durumu | `docker compose ps` — `api`, `web`, `worker` (vadesi 5 dk'yı geçmiş bekleyen iş varsa sağlıksız, `scripts/worker-health.ts`), `postgres` sağlık denetimleri |
| Sağlık ucu | `GET /api/v1/health` → `{"ok":true,"db":"up"}`; veritabanı yoksa 503. Dışarıdan (ikinci VPS'te Uptime Kuma vb.) 1 dk aralıkla izlenir, P1 nöbetçiye bildirim gider |
| Worker sağlık ucu | `GET /api/v1/health/worker` → `{"ok":true,"jobLagSec":0,"stuckJobs":0,…}`. Vadesi gelmiş bekleyen iş 300 sn'den fazla gecikmişse ya da 10 dk'dan uzun `running` iş varsa **503**. Worker süreci ayakta ama takılıysa yalnız bu uç yakalar (alarm zinciri, WhatsApp/SMS gönderimi işlerdedir); dış izlemeye `/api/v1/health` ile birlikte eklenir, P1 |
| Loglar | `docker compose logs -f --since 15m api worker` (JSON; telefon/adres maskeli). Konteyner logları 5×20 MB ile sınırlıdır |
| Erişim logları | Caddy her isteği JSON olarak iki yere yazar: `docker compose logs caddy` (son günler, sorun giderme) ve `caddy_logs` birimindeki `/var/log/caddy/access.log` (100 MB'ta döner, **366 gün** saklanır; 5651 trafik kaydı, 08 §2.8 satır 10). Okuma: `docker compose exec caddy tail -f /var/log/caddy/access.log`. Yoldaki gizli belirteçler (webhook, takip linki, kurye girişi `?t=`) `***` olarak yazılır; çerez ve `Authorization` başlıkları maskelidir. Disk: 1 yılda birkaç GB; `docker system df -v` ile izleyin |
| Admin paneli | `Özet` (lifecycle'a göre işletmeler, bugünkü sipariş, açık alarm, başarısız iş, **saklama işi**: son koşu 48 saatten eskiyse "Gecikti", hatalıysa "Hata"), `İşler` (`/admin/isler`: başarısız işler = DLQ, tek tıkla yeniden dene), `WhatsApp` (hesap sağlığı; kırmızılar üstte), `Bayraklar` (kill-switch'ler), `Denetim` (audit log) |
| Veritabanı | 500 ms'yi aşan sorgular postgres loguna düşer (`log_min_duration_statement`). Disk: `docker system df`, `df -h` |
| Kuyruk | `docker compose exec postgres psql -U siparis -c "select status, count(*) from jobs group by 1"` |
| Saklama ve imha (08 §2.8) | `cron.retention` her gün 03:00'te (İstanbul) çalışır; her adım `retention_runs`'a bir satır yazar (iş adı, tenant, etkilenen kayıt sayısı, süre, hata; imha tutanağı, ≥ 3 yıl, silinmez). Son koşu: `docker compose exec postgres psql -U siparis -c "select job_name, tenant_id, affected_count, duration_ms, error from retention_runs where started_at > now() - interval '1 day' order by started_at"`. Hatalı adım diğerlerini durdurmaz; iş yeniden denenir, denemeler biterse `Admin > İşler`'de görünür |

**Panel dışı uyarılar (00 §10 alarm zinciri).** Panelde ses ve kırmızı bant (t=0, 60 sn) dışında şu halkalar sunucu tarafında çalışır; hepsi worker işleridir:

- **Web Push (t=0, `push.send`):** Sipariş `new` olunca şubeye erişen sahip, yönetici, kasiyer ve mutfak kullanıcılarının kayıtlı cihazlarına bildirim gider: "Yeni sipariş #1051 · 3 ürün · 245,00 TL" (mutfakta tutar yok; müşteri adı, telefonu, adresi hiçbir zaman yok). Telefon siparişi ve canary göndermez; kurulum testi "TEST #" etiketiyle gider. Cihaz, "Siparişleri almaya başla" dokunuşunda izin verip abone olur; durum ve aç/kapa `Panel › Ayarlar › Bu cihazda bildirimler` (`/panel/ayarlar/bildirimler/cihaz`; kasiyer/mutfak için telefonda "Diğer" menüsünde, masaüstünde kullanıcı menüsünde) ekranındadır, oradan test bildirimi de gönderilir. Çıkış yapılınca o cihazın kaydı silinir. İtme servisi aboneliği silmişse (404/410) kayıt kapatılır; geçici hatalar o abonelik için 3 denemeye kadar yeniden denenir. `VAPID_*` boşsa bu halka kapalıdır (§4).
  - **iPhone/iPad:** Web Push yalnız **ana ekrana eklenmiş** panelde ve **iOS/iPadOS 16.4+** ile çalışır (Safari › Paylaş › Ana Ekrana Ekle; paneli ana ekrandaki "Siparişler" simgesinden açıp giriş yapın, vardiyayı başlatın). Safari sekmesinde bildirim izni hiç sorulmaz. Kilit ekranında görünür; ses/titreşim iOS bildirim ayarlarına bağlıdır, tekrarlayan alarm sesi yoktur.
  - **Android/masaüstü:** Chrome, Edge, Firefox. Android'de Chrome'un bildirim sesi açık olmalı, pil tasarrufu Chrome'u kısıtlamamalı; masaüstünde bildirim dokunulana kadar ekranda kalır. Gizli sekmede push çalışmaz.
  - Push, açık paneldeki alarm sesinin yerini tutmaz: sekme kapalıyken sesli döngü yoktur, tek bildirim gelir. Asıl güvence 2 dk platform WhatsApp ve 5 dk SMS halkalarıdır; bu yüzden `PLATFORM_WA_PROVIDER` ve `SMS_PROVIDER` üretimde gerçek sağlayıcı olmalıdır (§4).
- **Panel çevrimdışı dedektörü (`cron.panel_presence`, dakikada bir):** Sipariş ekranının canlı akışı (SSE) açıkken şube dakikada bir "görüldü" yazılır (`branch_panel_presence`; yalnız sahip/yönetici/kasiyer ekranları sayılır, mutfak ekranı ve destek görünümü sayılmaz). Şube sipariş alırken ekran 5 dk'dır görülmüyorsa ya da açılıştan beri hiç görülmeyip açılış 10 dk'yı geçtiyse sahibine platform WhatsApp'tan `isletme_panel_cevrimdisi_v1` gider (§6.5); şube başına 60 dk'da en çok 1. Çalışma saati dışında, duraklatılmış şubede, `ordering_enabled` kapalı, web'de canlı olmayan, aday/kurulumdaki/salt-okunur/askıdaki/kapanmış ve demo işletmelerde çalışmaz. Bu sürümde SMS ve "storefront'u otomatik durdur" seçeneği (04 §7.4) yoktur.
- **Sonraki halkalar:** 2 dk platform WhatsApp uyarısı, 5 dk SMS, 10 dk müşteriye bilgi ve 15 dk otomatik iptal panelden bağımsız çalışır (`order.alarm_step`).

İzleme sorguları:

```bash
# Web Push: etkin/kapatılmış abonelik ve son hatalar
docker compose exec postgres psql -U siparis -c "select count(*) filter (where disabled_at is null) as etkin, count(*) filter (where disabled_at is not null) as kapali, max(last_success_at) as son_basari from push_subscriptions"
docker compose exec postgres psql -U siparis -c "select status, count(*) from jobs where type = 'push.send' and created_at > now() - interval '1 day' group by 1"
# Panel varlığı: son görülme ve son çevrimdışı uyarısı
docker compose exec postgres psql -U siparis -c "select b.name, p.last_seen_at, p.offline_alerted_at from branch_panel_presence p join branches b on b.id = p.branch_id order by p.last_seen_at nulls first"
```

## 11. Sorun giderme

**Sipariş düşmüyor**

1. Vitrinde "sipariş almıyor" bandı var mı? `curl -s https://DOMAIN/api/v1/store/<slug> | jq .branch.orderingState` → `closed` (çalışma saatleri/özel gün), `paused` (panelden durdurulmuş ya da `ordering_enabled=false`, askıya alınmış işletme). Admin > İşletme detayında lifecycle ve `ordering_enabled`'a bakın.
2. Sipariş `awaiting_customer`'da mı kalıyor? Akış B doğrulaması tamamlanmamıştır: WhatsApp kod mesajı gelmiyorsa aşağıdaki "Webhook gelmiyor" adımları; SMS yedeği açık mı (`sms_fallback` bayrağı + işletme izni). 30 dk sonra sipariş `customer_timeout` ile iptal olur.
3. Sipariş `new` ama panelde yok: paneldeki bağlantı bandına bakın (SSE); sayfayı yenileyin (`GET /panel/orders/active` her 45 sn'de de çalışır). Doğru şube/işletme seçili mi?
4. Alarm zinciri çalışmıyor (platform WhatsApp uyarısı, SMS): worker çalışıyor mu (`docker compose ps worker`, `logs worker`), `Admin > İşler`'de başarısız iş var mı?

**Webhook gelmiyor (müşteri yazıyor, bot yanıt vermiyor)**

1. `Admin > WhatsApp` → **ortak numara** kartında "son webhook" eski mi, sorun satırı var mı? Meta uygulamasının Webhook ayarındaki (Yol A) ya da 360dialog'a tanımlı (Yol B) adres `https://DOMAIN/api/v1/webhooks/wa/shared/<PLATFORM_WA_WEBHOOK_TOKEN>` ile birebir aynı mı (§6.2 madde 12, §6.3 madde 5)? Meta'da `messages` alanına abonelik ve uygulamanın canlı modda olması (§6.2 madde 12–13)? Kendi numaralı işletmede: işletmenin satırında "son webhook" ve sağlayıcıya tanımlı adres paneldeki adresle aynı mı (§6.8)?
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

**Teknik**

- [ ] `SUPPORT_WHATSAPP` dolu ve web bu değerle derlendi: `/panel/giris` › "Parolamı unuttum" destek numarasını gösteriyor. İşletme sahibinin parolası, kimlik başka kanaldan doğrulandıktan sonra admin panelinden sıfırlanır.
- [ ] `.env`'de `DEV_TOOLS=0` ve web bu değerle derlendi: `curl -o /dev/null -w '%{http_code}' https://DOMAIN/dev/whatsapp` → 404, `https://DOMAIN/api/v1/dev/wa/accounts` → 404.
- [ ] Demo verisi yok (00 §12a madde 10): `select email from users where email in ('demo@yemekgelsin.net','mudur@yemekgelsin.net','kasa@yemekgelsin.net','mutfak@yemekgelsin.net','kurye@yemekgelsin.net','doner@yemekgelsin.net')` boş; `select slug from tenants where is_demo` boş (önyükleme betiği demo işletme görürse uyarır). `admin@yemekgelsin.net` canlı ortamın gerçek platform yöneticisidir: iş akışı `ADMIN_PASSWORD` ile açar, parolası yerel geliştirme parolası (`admin1234`) değildir ve iki adımlı doğrulaması kuruludur.
- [ ] Gizli anahtarlar rastgele üretildi (§4) ve `ENCRYPTION_KEY`, `TRACKING_SECRET` parola yöneticisinde + ayrı bir güvenli yerde saklı.
- [ ] Platform yöneticileri `create-admin.ts` ile açıldı ve her biri **iki adımlı doğrulamayı (TOTP) kurdu** (00 §12a madde 7, 14 §5): girişte `/admin/guvenlik` → QR'ı okut → 6 haneli kodla aç → 8 kurtarma kodunu kaydet (§5). Kontrol: `docker compose exec api printenv ADMIN_TOTP_REQUIRED` → `true`; `select email from users where is_platform_admin and totp_enabled_at is null` boş; kurtarma kodlarıyla giriş bir kez denendi (kullanılan kod yenilenerek yerine konur).
- [ ] Yedek cron'u `siparis` kullanıcısının crontab'ında kurulu, ilk elle çalıştırmada `backups/` altında `600` izinli döküm oluştu, `BACKUP_REMOTE` ikinci Türkiye lokasyonuna kopyalıyor, `BACKUP_PING_URL` dış izlemede 26 saatlik push monitörüne bağlı, bir geri yükleme tatbikatı (`restore.sh --target`) başarıyla yapıldı; PITR (WAL arşivleme) kuruldu (00 §11).
- [ ] Caddy erişim logu dosyaya yazılıyor: `docker compose exec caddy ls -l /var/log/caddy/` (5651, 1 yıl).
- [ ] Dış izleme `GET /api/v1/health` ve `GET /api/v1/health/worker`'ı 1 dk aralıkla izliyor, P1 bildirimi nöbetçiye gidiyor; `Admin > İşler`'de başarısız iş yok.
- [ ] Sağlayıcılar gerçek: `docker compose exec worker printenv SMS_PROVIDER PLATFORM_WA_PROVIDER WA_DEFAULT_PROVIDER` çıktısında `mock` yok (§4).
- [ ] Web Push açık: `VAPID_*` dolu, açılış logunda `Web Push kapalı` uyarısı yok; bir Android tablette ve ana ekrana eklenmiş bir iPhone'da "Siparişleri almaya başla" → izin → `Ayarlar › Bu cihazda bildirimler › Test bildirimi gönder` geldi; panel sekmesi kapalıyken verilen deneme siparişinde "Yeni sipariş #…" bildirimi geldi (§10).
- [ ] Panel çevrimdışı uyarısı denendi: açık saatte paneli kapatıp 5 dk bekleyince sahibin telefonuna `isletme_panel_cevrimdisi_v1` geldi (`notifications` tablosunda `kind = 'panel_offline'`).
- [ ] Sunucu: UFW açık (22/80/443), fail2ban sshd jail'i açık (`fail2ban-client status sshd`), otomatik güvenlik güncellemeleri açık, `.env` izni 600. İş akışı parola ile bağlandığından SSH parolası uzun ve rastgele; mümkünse `VPS_HOST_KEY` sabitlendi (§14).
- [ ] Ortak numara bağlı (§6.2 Meta Cloud API ya da §6.3 360dialog): görünen ad "Yemek Gelsin" onaylı, işletme doğrulaması tamam, ödeme kartı tanımlı, `PLATFORM_WA_DISPLAY_PHONE` ve `PLATFORM_WA_WEBHOOK_TOKEN` dolu, webhook tanımlı (`Admin > WhatsApp` ortak numara kartında sorun satırı yok; Yol A'da **WhatsApp kurulumu**nda "Bağlantıyı test et" hazır, "Aboneliği kontrol et" açık, tüm şablonlar Onaylandı). İki farklı işletmenin QR'ı gerçek telefonla okutuldu: her birinde o işletmenin adıyla karşılama → "Menüyü aç" → sipariş → doğru işletmenin panelinde alarm → onay mesajı; kodsuz yazınca dükkan seçici geldi. Müşteri ve platform şablonları onaylı (V-011).
- [ ] Netgsm başlığı onaylı, OTP ve "onaylandı" SMS'i gerçek telefona geldi (V-012, V-020, V-023).
- [ ] `pnpm test` ve `pnpm e2e` yeşil (yayınlanan sürüm etiketinde); "Canlı ortam (Türkiye VPS)" iş akışının son çalışması yeşil (duman testi gerçek alan adında geçti).

**Hukuki / operasyonel** — [08](08-mevzuat-kvkk-odeme-fatura.md) §9.1 "MVP öncesi zorunlu" setinin tamamı; özellikle:

- [ ] Şirket, vergi levhası, e-Tebligat; marka başvurusu ve alan adları (V-002).
- [ ] Kurumsal aydınlatma metni, gizlilik ve çerez politikası; abonelik sözleşmesi + kullanım koşulları + DPA + alt işleyen listesi (click-wrap, sürümlü); son müşteri aydınlatma, ön bilgilendirme ve mesafeli satış şablonları avukat onaylı ve `/yasal/*` sayfalarındaki "Hukuki inceleme bekliyor" etiketleri kaldırıldı.
- [ ] Site künyesi gerçek bilgilerle dolduruldu (`/kunye`); vitrinde işletme künyesi alanları zorunlu.
- [ ] Barındırma Türkiye'de (DB, yedekler, görseller), sağlayıcı DPA/ISO belgeleri alındı; aktarım envanteri (360dialog/Meta, Cloudflare, Netgsm …) ve Meta aktarımı için yazılı risk değerlendirmesi (V-009, V-026).
- [ ] Veri ihlali müdahale planı (işletmeye 24 saat, Kurul'a 72 saat), saklama-imha politikası, ilgili kişi başvuru kanalı.
- [ ] Fatura düzeni (Paraşüt / e-Arşiv) ilk ücretli işletmeden önce hazır; fişteki "mali değeri yoktur" ibaresi teyitli (V-024, V-025).

**[13](13-varsayim-ve-teyit-kaydi.md) §2 engelleyici teyitler** — P0 (pilot) kapısındaki maddeler `teyitli` durumda olmalı ya da kapı kararına "şu maddeye rağmen şu gerekçeyle" notu yazılmalı: V-001 (rate card), V-009 (TR barındırma), V-011 (platform şablonları), V-012 (SMS fiyatı), V-018 (Coexistence), V-020 (SMS başlığı), V-021 (canary), V-022 (harita kotaları), V-023 (SMS İYS sınıfı), V-024 (fiş ibaresi), V-025 (e-Arşiv), V-026 (Meta aktarımı risk değerlendirmesi). 00 §12a'daki BSP yolu nedeniyle Tech Provider'a özgü maddelerin (V-005, V-010, V-015, V-016, V-019) yerine ortak numaranın bağlandığı yolun (Meta Cloud API ya da 360dialog) API uç noktası, webhook tanımı ve imza davranışı (§6) teyit edilir.

---

## 13. Cloudflare ortamı (VPS öncesi alan adı, sonra gizli staging)

Cloudflare Workers + Containers üzerinde tek container'lı ortam (`deploy/cloudflare/`, iş akışı `.github/workflows/deploy-dev-cloudflare.yml`). **Canlı ortamın yerine geçmez:** canlı ortam Türkiye'deki VPS'tir (§14; 00 §12a madde 10). Veriler Türkiye dışındadır (Cloudflare R2, ENAM); gerçek müşteri ve işletme verisi girilmez. İki kipi vardır; kipi iş akışı `VPS_HOST` secret'ına bakarak seçer:

| | **Alan adı kipi** (VPS yokken) | **Gizli staging** (VPS varken) |
|---|---|---|
| Ne zaman | `VPS_HOST` secret'ı yok | `VPS_HOST` secret'ı var |
| Tetikleyici | her push + elle | yalnız elle (Run workflow); push'ta atlanır |
| Adres | `https://yemekgelsin.net` (Custom Domain) + workers.dev yedek | yalnız `https://siparisinonunde-dev.<hesap>.workers.dev`; özel alan adı eklenmez |
| Erişim | herkese açık; yalnız geliştirici araçları parolalı | tüm site parolalı (kullanıcı adı serbest, parola `DEV_PASSWORD`); yalnız `/api/v1/health` ve `/api/v1/health/worker` açık |
| Veri | **demo yok**: seed yalnız platform yöneticisi (`admin@yemekgelsin.net`, parola `DEV_PASSWORD`) ve bayraklar (`SEED_MODE=admin`) | demo işletmeler ve hesaplar (`SEED_MODE=demo`, parola `DEV_PASSWORD`) |
| Veri dönemi | `vars.DATA_EPOCH` ("3") | `vars.STAGING_DATA_EPOCH` ("901"; farklı olmalı) |
| "Demo ortamı" uyarısı | yok (`NEXT_PUBLIC_DEMO_BANNER=0`) | var |
| Yeni işletme kaydı | kapalı: kayıt sayfası "Kayıtlar çok yakında açılıyor" der, "Bize ulaşın" `/demo`'ya gider | kapalı |
| `/demo` lead formu | **kapalı** (kişisel veri Türkiye dışında saklanmaz; değişmez kural 7): form yerine bilgi kartı, `SUPPORT_WHATSAPP` secret'ı varsa destek hattının WhatsApp bağlantısı; API 403 `leads_closed` (`NEXT_PUBLIC_LEAD_FORM=0`, `PUBLIC_LEADS_ENABLED=0`) | açık (yalnız ekip dener) |
| WhatsApp | simülatör; `META_*` secret'ları tamsa gerçek numara (yalnız kendi telefonlarınızla) | her zaman simülatör (canlı numara kullanılmaz; iş akışı WhatsApp secret'larını yüklemez, Worker'dakileri siler) |

Her iki kipte: SMS ve işletmelerin kendi numaraları `mock`; arama motorları dizinlemez (`DEPLOY_ENV=dev` → her yanıtta `x-robots-tag: noindex, nofollow`); yönetici 2FA'sı isteğe bağlıdır (`ADMIN_TOTP_REQUIRED=false`; alan adı kipinde site herkese açık olduğundan proje sahibinin `/admin/guvenlik`'ten açması önerilir).

**Yapı:** tek bir Worker ve Workers Paid planının Containers özelliğiyle çalışan tek container örneği (`basic`: 1/4 vCPU, 1 GiB).
- Kip `scripts/config-modes.mjs` ile `wrangler.generated.jsonc`'ye yazılır (`scripts/prepare-config.mjs <adres> --mode domain|staging`): `routes` (yalnız alan adı kipi), `DEPLOY_MODE`, `SEED_MODE`, `DATA_EPOCH`, `APP_BASE_URL` ve derleme değişkenleri (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_DEMO_BANNER`, `NEXT_PUBLIC_DEMO_STORE_SLUG`, `NEXT_PUBLIC_LEAD_FORM`, `NEXT_PUBLIC_SUPPORT_WHATSAPP` — ortamdan `SUPPORT_WHATSAPP`, yalnız alan adı kipi). Worker container'a alan adı kipinde `PUBLIC_LEADS_ENABLED=0` verir. `wrangler.jsonc` alan adı kipini tanımlar.
- **Alan adı (alan adı kipi):** `yemekgelsin.net` ve `www.yemekgelsin.net` Worker'a **Custom Domain** olarak bağlıdır; DNS kaydını ve sertifikayı Cloudflare oluşturur. `www` köke kalıcı yönlenir (301; gövdeli istekte 308). workers.dev yedek adresinde API ve webhook istekleri çalışır, tarayıcı gezinmeleri alan adına 302 ile yönlenir. Kurallar: `deploy/cloudflare/src/access.ts` (testleri `npm test`). Staging'de `wrangler deploy` Custom Domain eklemez; var olanları da kaldırmaz — alan adını canlı ortam iş akışı VPS'e taşır (§14). Bu yüzden staging, alan adı hâlâ Worker'a bağlıyken çalışmayı reddeder.
- Container içinde PostgreSQL 16, API, worker ve web birlikte çalışır; imaj depo kökünden derlenir (`deploy/cloudflare/Dockerfile`). Worker `/api/*` isteklerini API'ye (4000), diğerlerini web'e (3000) aktarır.
- Container diski geçicidir. `entrypoint.sh` her açılışta boş bir veritabanı kurar, son yedeği R2'den (`siparisinonunde-dev-yedek`, Worker'ın `yedek.internal` çıkış işleyicisiyle) geri yükler, migration'ları uygular ve seed'i `SEED_MODE` ile çalıştırır. Seed idempotenttir: admin kipinde var olan yöneticiye dokunmaz (parolası `DEV_PASSWORD`'e eşitlenir), demo kipinde var olan demo işletmeyi atlar.
- **Veri dönemi (`DATA_EPOCH`):** R2 anahtarları dönemle öneklenir (`e3/db/son.dump`, `e3/uploads/son.tar.gz`, `e3/db/gun-<0–6>.dump`). Dönem container **açılırken** alınır ve ömrü boyunca sabittir (`entrypoint.sh` yedek yoluna yazar, Worker anahtarı yoldan kurar: `src/access.ts` `parseBackupPath`); yeniden dağıtımda kapanan eski container'ın son yedeği yeni döneme düşmez. `"3"` demo verisinin kaldırıldığı dönemdir; `e2/…` ve öncesi eski demo verisidir (R2'den silinebilir). Staging kendi dönemini kullanır (`e901/…`), alan adı verisine karışmaz. Geçersiz değer dağıtımdan önce reddedilir.
- Yedek 10 dakikada bir, kapanışta ve çökmede alınır; haftanın her günü için bir kopya tutulur. R2'ye ulaşılamazsa container boş veritabanıyla açılmaz, çıkar.
- Son istekten 30 dakika sonra container uyur; açık panel (SSE) uyumayı engeller. Uyanış ~30–60 sn sürer, bu sırada "Sistem başlatılıyor" sayfası görünür.
- `DEPLOY_ENV=dev`, üretim derlemesinde geliştirici araçlarını yalnız tüm sağlayıcılar `mock` iken açar (`apps/api/src/config.ts`, `devToolsAllowed`). Gerçek WhatsApp kipinde Worker container'a `DEV_TOOLS=0` verir; `/dev/whatsapp` "Gerçek WhatsApp bağlı; simülatör kapalı" bildirimini gösterir, `/api/v1/dev/*` 404 döner.

**Kurulum (bir kez):**
1. Cloudflare hesabında **Workers Paid** planını açın (aylık 5 $; Containers bu planla gelir).
2. Cloudflare > My Profile > API Tokens > **Create Token** > **"Edit Cloudflare Workers"** şablonu. **Özel alan adı için** token'da `yemekgelsin.net` bölgesinde (Zone Resources: Include > Specific zone > `yemekgelsin.net`): **Zone > Workers Routes > Edit** ve **Zone > Zone > Read**. Canlı ortam (§14) aynı token'a ayrıca **Zone > DNS > Edit** ister; şimdiden eklenebilir. Eksikse iş akışı dağıtımdan önce durur ve eksik izni adıyla yazar. `@` ya da `www` için önceden elle eklenmiş A/AAAA/CNAME kaydı varsa Custom Domain eklenemez; DNS > Records'tan silin (VPS yokken).
3. GitHub > **Settings > Secrets and variables > Actions > New repository secret**: `CLOUDFLARE_API_TOKEN`, `DEV_PASSWORD` (en az 8 karakter; canlı ortamda `ADMIN_PASSWORD` yoksa yönetici parolası olarak da kullanılır, o zaman en az 12 karakter), gerekirse `CLOUDFLARE_ACCOUNT_ID`; isteğe bağlı `SUPPORT_WHATSAPP` (destek hattı, `/demo`'da WhatsApp bağlantısı); isteğe bağlı gerçek WhatsApp için (§6.2a) `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_WABA_ID`, `META_APP_SECRET`, `WA_PHONE`.
4. **Actions > "Dev ortamı (Cloudflare)" > Run workflow.** VPS yokken sonraki her push ortamı kendiliğinden günceller.

**İş akışı:**
1. Kip seçimi: `VPS_HOST` yoksa alan adı kipi; varsa push'ta bilgi notuyla atlanır, elle çalıştırılınca staging.
2. Tür denetimi ve testler (`npm run typecheck`, `npm test`: erişim kuralları, kip yapılandırması, WhatsApp kipi).
3. Hesap ve erişim: alan adı kipinde token'ın `ZONE` bölgesine erişimi (Zone Read, Workers Routes); staging'de workers.dev alt alan adı zorunludur ve `yemekgelsin.net`'in artık bu Worker'a bağlı olmadığı doğrulanır (`scripts/vps/cloudflare-dns.mjs status`).
4. Yapılandırma (`prepare-config.mjs --mode …`) ve gizli değerler (`scripts/secrets.mjs`): eksikler bir kez üretilir (`SESSION_SECRET`, `TRACKING_SECRET`, `ENCRYPTION_KEY`, `WA_VERIFY_TOKEN`, `PLATFORM_WA_WEBHOOK_TOKEN`, VAPID çifti), `DEV_PASSWORD` her dağıtımda güncellenir; WhatsApp secret'ları yalnız alan adı kipinde ve doluysa yüklenir, boşaltılanlar (staging'de hepsi) Worker'dan silinir.
5. `wrangler deploy` (alan adı kipinde Custom Domain'lerle); Custom Domain izin/DNS çakışması hataları Türkçe `::error::` ile açıklanır.
6. Duman testi — **alan adı kipi:** `/api/v1/health` 200 (en çok 15 dk); `/`, `/panel/giris`, `/admin/giris`, `/panel/kayit`, `/demo`, `/yasal/gizlilik`, `/api/v1/health/worker` parolasız 200; `/s/bozok-pide` ve `/s/camlik-doner` **404** (demo verisi yok); ana sayfada "Demo ortamı" uyarısı ve `/demo`'da "Demo menüyü aç" bağlantısı **yok**; `/demo` lead formunu göstermez ve `POST /api/v1/public/leads` 403 döner; `/panel/kayit` "Kayıtlar çok yakında açılıyor" der; geliştirici araçları parolasız 401, parolayla 200 (gerçek WhatsApp kipinde `/api/v1/dev/*` 404); ortak webhook yolu API'ye ulaşır (404); `www` → kök 301; workers.dev'de API 200, sayfa → alan adı 302. **Staging:** sağlık uçları parolasız 200, diğer yollar parolasız 401; parolayla `/`, `/s/bozok-pide`, `/s/camlik-doner`, `/panel/giris`, `/admin/giris`, `/dev/whatsapp`, `/api/v1/dev/wa/accounts` 200; "Demo ortamı" uyarısı var; `x-robots-tag: noindex`.

**Kullanım (alan adı kipi):** https://yemekgelsin.net · Admin: `/admin/giris` (`admin@yemekgelsin.net`, parola `DEV_PASSWORD`). İşletme ve demo hesabı yoktur; WhatsApp simülatörü `/dev/whatsapp` (kullanıcı adı `dev`, parola `DEV_PASSWORD`). **Staging:** workers.dev adresi, tarayıcı parola sorar (kullanıcı adı `dev`); demo hesapları README'deki e-postalar, parola `DEV_PASSWORD`; vitrinler `/s/bozok-pide` (`#BOZOK`), `/s/camlik-doner` (`#DONER`).

**Gerçek WhatsApp (isteğe bağlı, yalnız alan adı kipi):** §6.2a'daki beş GitHub secret'ı eklenip iş akışı çalıştırılır. Worker (`src/whatsapp-env.ts`) dördü birlikte varsa container'a `PLATFORM_WA_PROVIDER=cloud`, `PLATFORM_WA_API_KEY`, `PLATFORM_WA_PHONE_NUMBER_ID`, `PLATFORM_WA_WABA_ID` (varsa), `WA_APP_SECRET`, `PLATFORM_WA_DISPLAY_PHONE` ve `DEV_TOOLS=0` verir; biri eksikse simülatör. Veriler Türkiye dışında olduğundan yalnız kendi telefonlarınızla denenir. VPS'e geçince aynı secret'ları canlı ortam kullanır ve Meta'daki webhook yeniden girilir (§6.2a C.1, §14).

**Sıfırlama:** `wrangler.jsonc`'de `vars.DATA_EPOCH`'u (staging için `vars.STAGING_DATA_EPOCH`'u) bir artırın ve iş akışını çalıştırın; yeni container yeni dönemde yedek bulamaz, boş veritabanı + seed ile açılır. İki değer hiçbir zaman aynı olmamalıdır. Eski dönemin nesneleri R2'de kalır; Cloudflare > R2 > `siparisinonunde-dev-yedek` içinden silinebilir. Eski bir döneme dönmek önerilmez (o dönemin verisi ve bayrakları geri gelir; `e2` ve öncesi demo verisidir).

**Sorun giderme:**
- Container günlükleri: Cloudflare > Workers & Pages > `siparisinonunde-dev` > Logs ya da `npx wrangler tail siparisinonunde-dev`. Açılış satırları `[baslat]` önekiyle (seed kipi dahil).
- İlk dağıtımda Custom Domain'in DNS kaydı ve sertifikası birkaç dakika sürebilir; duman testi en çok 15 dakika bekler.
- "Özel alan adı kurulamadı … izni eksik": Kurulum 2. adımdaki izinleri ekleyip yeniden çalıştırın.
- Staging "hâlâ bu Worker'a bağlı" hatası: canlı ortam iş akışı DNS geçişini tamamlamadı (§14); önce onu yeşile getirin.
- "Failed to start container" çoğunlukla bellek yetmediğini gösterir: `instance_type` → `standard-1` (4 GiB; maliyet artar).

## 14. Canlı ortam: Türkiye VPS'i GitHub Actions ile

Proje sahibinin kararı (00 §12a madde 10): canlı ortam Türkiye'deki bir VPS'tir, gerçek verilerle çalışır, demo verisi yoktur. Kurulum ve her güncelleme `.github/workflows/deploy-production.yml` ("Canlı ortam (Türkiye VPS)") ile yapılır; sunucuya elle bir şey kurmanız gerekmez.

### 14.1 Hangi VPS

- **Türkiye'de** bir veri merkezi (kişisel veri yurt dışına çıkmaz; 08 §2.12), **Ubuntu 24.04 LTS**, **2 vCPU / 4 GB RAM / 80 GB SSD**, sabit **IPv4**, root erişimi. Aday sağlayıcılar: Turkcell Bulut, Türk Telekom Bulut, Huawei Cloud İstanbul, Radore, Bulutistan, yerli VPS sağlayıcıları (fiyat ve belge teyidi V-009). ISO 27001 ve DPA (veri işleme sözleşmesi) belgesi istenir.
- Kurulumda **root parolası** seçin (uzun, rastgele; parola yöneticisine kaydedin) ve **parola ile SSH girişinin açık** olduğundan emin olun (bazı imajlarda `PasswordAuthentication no` gelir; sağlayıcı panelinden ya da konsoldan açın). İş akışı `sshpass` ile parola kullanır.
- 80 ve 443 portları dışarıdan erişilebilir olmalı (sağlayıcının güvenlik grubu/güvenlik duvarı varsa açın); SSH portu varsayılan 22 değilse `VPS_PORT` secret'ı verilir.

### 14.2 GitHub secret'ları

Settings > Secrets and variables > Actions > New repository secret:

| Secret | Zorunlu | Açıklama |
|---|---|---|
| `VPS_HOST` | evet | Sunucunun IPv4 adresi (ya da IPv4'e çözülen ad). **Eklendiği anda** Cloudflare iş akışı alan adına dağıtmayı bırakır (§13) ve canlı ortam iş akışı push'ta çalışmaya başlar. |
| `VPS_PASSWORD` | evet | SSH parolası (root). |
| `VPS_USER` | hayır | Varsayılan `root`. Başka kullanıcıda parolasız sudo (NOPASSWD) gerekir. |
| `VPS_PORT` | hayır | Varsayılan `22`. |
| `VPS_HOST_KEY` | önerilir | Sunucunun SSH host anahtarı (`ssh-ed25519 AAAA…`). Verilirse yalnız bu anahtar kabul edilir; verilmezse her çalışmada ilk görülen anahtar kabul edilir (TOFU). İlk dağıtımın özeti değeri yazar; kopyalayıp ekleyin. Sunucu yeniden kurulursa güncelleyin. |
| `ADMIN_PASSWORD` | evet* | İlk platform yöneticisinin (`admin@yemekgelsin.net`) parolası, **en az 12 karakter**. *Yoksa `DEV_PASSWORD` kullanılır (o da en az 12 karakter olmalı). Yönetici bir kez açılır; sonraki dağıtımlar parolasına ve iki adımlı doğrulamasına **dokunmaz** (değiştirmek: §5 `create-admin.ts --reset-password`). |
| `CLOUDFLARE_API_TOKEN` | evet | `yemekgelsin.net` bölgesinde **Zone > DNS > Edit** ve **Zone > Zone > Read** (Caddy'nin DNS-01 sertifikaları ve DNS geçişi). Geçişte Worker Custom Domain'lerini silmek (gerekirse geri bağlamak) için **Account > Workers Scripts > Edit** ve **Zone > Workers Routes > Edit** (Cloudflare ortamının "Edit Cloudflare Workers" token'ında ve bölge izinlerinde vardır). SSL/TLS modu "Flexible" ise düzeltmek için **Zone > Zone Settings > Edit** (yoksa modu elle "Full (strict)" yapın). |
| `CADDY_CLOUDFLARE_API_TOKEN` | **önerilir** | Sunucuya (Caddy) yalnız DNS yetkili ayrı bir token (Zone > DNS > Edit + Zone > Zone > Read, yalnız bu bölge). Yoksa Workers yetkili `CLOUDFLARE_API_TOKEN` sunucunun `.env`'ine yazılır ve iş akışı her dağıtımda uyarır. Token her iki durumda da **yalnız caddy konteynerine** verilir; api/worker/migrate ortamında boştur (`docker-compose.yml` x-api-base). |
| `CLOUDFLARE_ACCOUNT_ID` | hayır | Yoksa bölgenin hesabı kullanılır. |
| `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_APP_SECRET`, `WA_PHONE` (+ `META_WA_WABA_ID`) | hayır | Gerçek WhatsApp (ortak numara; §6.2a). Dördü tamsa `PLATFORM_WA_PROVIDER=cloud`; değilse ortak numara kapalı (mock) ve uyarı. |
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
3. **WhatsApp webhook'u yeniden girin** (gerçek WhatsApp açıksa): canlı ortamın webhook ve doğrulama belirteçleri Cloudflare ortamındakilerden **farklıdır**. Admin > WhatsApp > WhatsApp kurulumu > **Göster** → Meta > uygulama > WhatsApp > Configuration > Webhook > Edit: Callback URL ve Verify token'ı yapıştırın → **Verify and save**; **messages** aboneliği açık kalsın (§6.2a C.1). Sonra "Bağlantıyı test et". Yapılmazsa müşteri mesajları yeni sunucuya gelmez.
4. `VPS_HOST_KEY` secret'ını özetteki değerle ekleyin (TOFU yerine sabit anahtar).
5. Kayıt açıktır: işletmeler `https://yemekgelsin.net/panel/kayit`'tan kaydolur ya da yönetici ekler. Cloudflare ortamı artık gizli staging'dir; gerekirse elle çalıştırın (§13).
6. §12 kontrol listesini tamamlayın; özellikle ikinci Türkiye lokasyonuna yedek (§8) ve dış izleme (§10).

**Sunucuya giriş:** `ssh root@<VPS_HOST>` (parola `VPS_PASSWORD`). Uygulama `/opt/yemekgelsin/app`, komutlar orada: `docker compose ps`, `docker compose logs -f --since 15m api worker`, `bash scripts/vps/deploy.sh status`. Dağıtım geçmişi: `/opt/yemekgelsin/deploy-history`.

### 14.5 Geri alma

- **Kod:** Actions > "Canlı ortam (Türkiye VPS)" > Run workflow > `ref` alanına önceki (çalışan) commit'in SHA'sını yazın. İş akışı o commit'i derleyip dağıtır; DNS zaten VPS'tedir, değişmez.
- **Veritabanı:** migration'lar yalnız ileri yönlüdür. Yeni sürüm şemayı değiştirdiyse ve eski kod yeni şemayla çalışmıyorsa, dağıtımdan hemen önce alınan yedekten geri dönün: sunucuda `cd /opt/yemekgelsin/app && ls -t /opt/yemekgelsin/backups/pre-deploy-db-*.dump | head` → `./scripts/restore.sh <pre-deploy-db-….dump>` (§8; yalnız veritabanı — görseller migration'dan etkilenmez; o andan sonraki siparişler kaybolur). Görseller de gerekiyorsa gecelik `uploads-*.tar.gz` ile `--uploads`.
- **Alan adını Cloudflare ortamına geri vermek** (acil durum, VPS tamamen çalışmıyorsa): Cloudflare > `yemekgelsin.net` > DNS'te `@` ve `www` A kayıtlarını silin, `VPS_HOST` secret'ını geçici olarak silip "Dev ortamı (Cloudflare)" iş akışını çalıştırın (Custom Domain'leri yeniden ekler; demo verisi yok, kayıt kapalı). Veriler Türkiye dışına çıkmasın diye bu yalnız geçici bir "bakımdayız" çözümüdür; canlı veritabanı oraya taşınmaz.

### 14.6 Sorun giderme

- **"Eksik GitHub secret: VPS_HOST…" uyarısı:** VPS henüz yok; beklenen davranış. Elle çalıştırmada hatadır.
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
