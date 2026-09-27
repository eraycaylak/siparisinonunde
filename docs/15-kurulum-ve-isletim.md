# 15 — Kurulum ve İşletim Rehberi (geliştirici / operatör)

> **Kime:** Sunucuyu kuran, güncelleyen ve nöbet tutan kişi (00 §12a: sistemi Claude yazar ve bakımını yapar, proje sahibi ürün/saha tarafını yürütür). Esnafa dönük değildir.
> **Bağlayıcı kaynaklar:** [00](00-kararlar-ve-sozluk.md) §10, §12a · [14](14-uygulama-sartnamesi.md) §1, §3, §11 · [08](08-mevzuat-kvkk-odeme-fatura.md) §9 · [13](13-varsayim-ve-teyit-kaydi.md) §2.
> **Dağıtım dosyaları:** `docker-compose.yml`, `Caddyfile`, `docker/*.Dockerfile`, `docker/env.production.example`, `scripts/*`.
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
13. [Cloudflare dev (demo) ortamı](#13-cloudflare-dev-demo-ortamı)

---

## 1. Mimari özet

Tek VPS üzerinde Docker Compose (00 §12a):

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

Kalıcı veriler adlandırılmış Docker birimlerindedir: `pgdata` (veritabanı), `uploads` (menü görselleri), `caddy_data` (sertifikalar), `caddy_logs` (HTTP erişim logları, 1 yıl). Yedekler sunucuda `./backups` klasörüne (`siparis` kullanıcısına ait, izin `700`) `scripts/backup.sh` tarafından yazılır; bu klasör hiçbir konteynere bağlanmaz.

## 2. Gereksinimler

| Kalem | Başlangıç (pilot, ≤ 50 işletme) | Not |
|---|---|---|
| Sunucu | **Türkiye'de** VPS, 2 vCPU / 4 GB RAM / 80 GB SSD, IPv4 | Kişisel veri Türkiye'de (00 §10, 08 §2.12). Aday sağlayıcılar: Turkcell Bulut, Türk Telekom, Huawei Cloud İstanbul, Radore, Bulutistan (V-009 teklifleri). ISO 27001 ve DPA belgesi alınır. |
| İşletim sistemi | Ubuntu 24.04 LTS | Saat dilimi UTC kalsın (uygulama Europe/Istanbul'u kendi hesaplar). |
| Docker | Docker Engine 27+ ve Compose v2.24+ (BuildKit açık) | `docker compose version` |
| Disk | Veritabanı + 14 günlük yedek + görseller için en az 40 GB boş | Yedekler ayrıca ikinci bir Türkiye lokasyonuna kopyalanır (§8). |
| Ağ | Gelen: 22 (yalnız anahtarla), 80, 443. Giden: Let's Encrypt, Cloudflare API, Meta Graph API (`graph.facebook.com`) ya da 360dialog, Netgsm, Web Push servisleri (`fcm.googleapis.com`, `web.push.apple.com`, `*.push.services.mozilla.com`) | 80 portu HTTP-01 doğrulaması ve HTTPS yönlendirmesi için açık kalmalı. |
| Hesaplar | Cloudflare (DNS), WhatsApp ortak numarası için Meta Business + geliştirici uygulaması ya da 360dialog, Netgsm, ACME e-postası | §3, §6, §7 |

Ölçeklenme notu: sipariş hacmi büyüdüğünde önce `postgres` ayrı sunucuya taşınır (00 §10: tek sunucu → app + pg primary + pg standby). "Sipariş kaçmaz" paketi için ikinci ucuz VPS'te webhook alımı ve dış izleme pilot öncesi zorunludur (00 §11).

Sunucu hazırlığı (bir kez):

```bash
adduser --disabled-password siparis && usermod -aG sudo,docker siparis    # docker grubu kurulumdan sonra
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw enable
apt-get install -y unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
curl -fsSL https://get.docker.com | sh                                     # Docker Engine + compose eklentisi
```

## 3. Alan adı ve DNS

Alan adı `yemekgelsin.net` Cloudflare'de (Registrar + DNS) yönetilir (00 §10: Faz 1 wildcard alt alan adı; 00 §12a madde 9). Kayıtlar (`203.0.113.10` yerine sunucu IP'si):

> **Bugünkü durum (27.09.2026):** `yemekgelsin.net` ve `www.yemekgelsin.net` Cloudflare dev ortamının Worker'ına **Custom Domain** olarak bağlıdır (§13); DNS kayıtlarını ve sertifikayı Cloudflare kendisi yönetir. Üretim VPS'ine geçerken önce `deploy/cloudflare/wrangler.jsonc`'deki `routes` kaldırılıp dev ortamı yeniden dağıtılır (ya da Workers & Pages > `siparisinonunde-dev` > Settings > Domains & Routes'tan silinir); Custom Domain'in oluşturduğu kayıtlar böylece kalkar. Ardından aşağıdaki kayıtlar eklenir. Dev ortamı için ayrı bir alt alan adı (ör. `demo.yemekgelsin.net`) seçilirse: `wrangler.jsonc`'de `routes` yalnız `{ "pattern": "demo.yemekgelsin.net", "custom_domain": true }` olur (kök ve `www` satırları çıkar), `vars.APP_BASE_URL` ve `image_vars.NEXT_PUBLIC_SITE_URL` bu adrese çevrilir, iş akışındaki `SITE_URL` `https://demo.yemekgelsin.net` yapılır. İş akışındaki `ZONE` `yemekgelsin.net` olarak kalır (token izinleri bu bölge içindir); `www` → kök denetimi `SITE_URL` alt alan adındayken kendiliğinden atlanır.

| Tür | Ad | Değer | Proxy |
|---|---|---|---|
| A | `@` (yemekgelsin.net) | 203.0.113.10 | Yalnız DNS (gri bulut) |
| A | `*` (tüm vitrinler: `{slug}.yemekgelsin.net`) | 203.0.113.10 | Yalnız DNS |
| A | `www`, `panel`, `admin`, `hooks` | 203.0.113.10 | Yalnız DNS (wildcard kapsar; açık kayıt okunurluk içindir) |
| AAAA | yukarıdakilerin aynısı | sunucunun IPv6'sı | Sunucuda IPv6 varsa |
| CAA | `@` | `0 issue "letsencrypt.org"` ve `0 issuewild "letsencrypt.org"` | — |

- **Wildcard sertifika** Let's Encrypt'te yalnız DNS-01 doğrulamasıyla alınır. Bu yüzden Caddy imajı Cloudflare DNS modülüyle derlenir (`docker/caddy.Dockerfile`) ve `.env`'de `CLOUDFLARE_API_TOKEN` gerekir. Belirteç: Cloudflare > My Profile > API Tokens > "Edit zone DNS" şablonu, yalnız bu bölge (Zone.DNS:Edit + Zone.Zone:Read).
- **Proxy (turuncu bulut) başlangıçta kapalı** önerilir: SSE bağlantısı Cloudflare'in 100 sn boşta kalma sınırına ve tamponlamasına takılabilir (15 sn ping bunu çoğu zaman aşar ama doğrulanmadı — teyit edilmeli). Proxy açılacaksa SSL modu "Full (strict)" olmalı ve `Caddyfile`'daki `trusted_proxies` bloğu açılmalıdır (aksi halde hız sınırı tüm istekleri Cloudflare IP'sine sayar).
- **Ayrılmış alt alan adları** vitrin olamaz: `www, api, app, panel, admin, kurye, dev, static, assets, uploads, mail, smtp, help, destek, blog, hooks, status, docs, demo, test, bayi, yardim, siparisinonunde, yemekgelsin, yemek-gelsin` (`packages/core/src/slug.ts`).
- DNS yayıldıktan sonra doğrulama: `dig +short bozok-pide.yemekgelsin.net` sunucu IP'sini döndürmeli.

## 4. Ortam değişkenleri (.env)

Şablon: `docker/env.production.example` → sunucuda depo kökünde `.env` (git'e girmez, izin `chmod 600 .env`). Compose bu dosyayı hem değişken yerleştirmede (`${DOMAIN}` vb.) hem de `api/worker/migrate` konteynerlerine `env_file` olarak kullanır. Uygulamanın okuduğu değişkenler 14 §3 ile aynıdır; aşağıda üretimdeki anlamları:

| Değişken | Zorunlu | Açıklama | Üretme / örnek |
|---|---|---|---|
| `DOMAIN` | evet | Kök alan adı; `APP_BASE_URL=https://${DOMAIN}` ve web derleme argümanları bundan kurulur | `yemekgelsin.net` |
| `ACME_EMAIL` | evet | Let's Encrypt bildirim e-postası | `destek@yemekgelsin.net` |
| `CLOUDFLARE_API_TOKEN` | evet (wildcard için) | DNS-01 doğrulaması | §3 |
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
| `DEMO_STORE_SLUG` | hayır | Pazarlama sitesindeki "demo vitrin" bağlantısı | `bozok-pide` |
| `SUPPORT_WHATSAPP` | önerilir | Platform destek hattı (WhatsApp), rakamlarla. Giriş ekranındaki "Parolamı unuttum" işletme sahibine bu numarayı (WhatsApp + arama) gösterir; boşsa iletişim formuna yönlendirir. Web'e derleme anında gömülür | `905321234567` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | önerilir | Web Push anahtar çifti: yeni sipariş bildirimi panel kapalıyken de cihazlara gider (00 §10 alarm t=0, §10). Boşsa push kapalıdır; API/worker açılır, logda uyarı yazar. **Değişirse** tüm cihazların aboneliği geçersizleşir, cihazlar bir sonraki "Siparişleri almaya başla"da yeniden abone olur | aşağıda |
| `VAPID_SUBJECT` | push için | İtme servislerinin (Google, Apple, Mozilla) sorun olursa ulaşacağı adres; `mailto:` ya da `https://` ile başlamalı | `mailto:destek@yemekgelsin.net` |
| `BACKUP_REMOTE`, `RETENTION_DAYS` | önerilir | Yedeğin ikinci konumu (rclone) ve saklama günü | §8 |
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

- `DEV_TOOLS=1` (`/api/v1/dev/*` kimlik doğrulamasızdır),
- `SESSION_SECRET` ya da `TRACKING_SECRET` 32 karakterden kısa ya da örnek (`dev-only…`) değer,
- `WA_VERIFY_TOKEN` boş ya da `dev-verify`,
- `SMS_PROVIDER=netgsm` iken `NETGSM_USERCODE`, `NETGSM_PASSWORD` ya da `NETGSM_HEADER` boş,
- `PLATFORM_WA_PROVIDER=d360` ya da `cloud` iken `PLATFORM_WA_API_KEY` boş (`cloud` için ayrıca `PLATFORM_WA_PHONE_NUMBER_ID` ve webhook imzası için `WA_APP_SECRET`), `PLATFORM_WA_DISPLAY_PHONE` boş/E.164 değil ya da `PLATFORM_WA_WEBHOOK_TOKEN` boş/kısa/örnek değer (ortak numara).

`docker/env.production.example` `SMS_PROVIDER=netgsm` ve `PLATFORM_WA_PROVIDER=d360` ile, anahtarlar boş olarak gelir; bu haliyle API açılmaz. Netgsm ve 360dialog hesapları hazır olmadan kurulum yapılacaksa ikisini geçici olarak `mock` yapın. Süreç açılır, logda uyarı yazar (`SMS_PROVIDER=mock: SMS OTP ve alarm SMS'leri gönderilmez` vb.). Bu durumda SMS ve platform WhatsApp uyarıları **gerçekten gitmez**: WhatsApp'sız moddaki işletmenin müşterisi SMS kodu alamaz ve sahibine alarm gitmez. `PLATFORM_WA_PROVIDER=mock` iken ortak numara da kapalıdır: `PLATFORM_WA_DISPLAY_PHONE` boşsa geliştirme numarası (+90 555 000 00 00) üretimde kullanılmaz; vitrin, QR ve sipariş onayı WhatsApp bağlantısı göstermez (yalnız `DEPLOY_ENV=dev` simülatörü bu numarayı kullanır). Canlıya çıkmadan önce gerçek sağlayıcıya geçin (§6, §7, §12).

Web Push anahtarları (`VAPID_*`) açılış için zorunlu değildir: boşsa API ve worker açılır, logda `Web Push kapalı (VAPID_PUBLIC_KEY, … boş)` uyarısı yazar ve panel kapalıyken cihazlara yeni sipariş bildirimi gitmez (§10). Biçimi bozuk bir anahtar ya da `mailto:`/`https://` ile başlamayan `VAPID_SUBJECT` ise açılışı durdurur (`Geçersiz yapılandırma: VAPID_…`).

## 5. İlk kurulum

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

**Seed üretimde çalıştırılmaz.** `pnpm db:seed` demo işletmeyi ve parolası herkesçe bilinen hesapları (`demo1234`, `admin1234`) oluşturur; yalnız geliştirme içindir. İlk platform yöneticisi betikle açılır:

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

Ardından **Bayraklar** ekranında kill-switch'lerin açık olduğunu görün (`signup_open`, `sms_fallback` …). İlk işletme `https://DOMAIN/panel/kayit` üzerinden kaydolur ve kurulum sihirbazına (`/panel/kurulum`) iner. Kayıtla birlikte işletmeye dükkan kodu verilir ve işletme **ortak numaraya** bağlanır (§6); sihirbazın WhatsApp adımı kendiliğinden tamamdır ve QR kodunu gösterir. Ortak numara henüz yapılandırılmadıysa (`PLATFORM_WA_*`, §6.4) işletme "WhatsApp'sız başla" ile web siparişi alabilir (SMS doğrulamalı).

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

Türkiye VPS'i (üretim): aynı değerler `.env`'e (§6.4 Yol A): `PLATFORM_WA_PROVIDER=cloud`, `PLATFORM_WA_API_KEY`, `PLATFORM_WA_PHONE_NUMBER_ID`, `PLATFORM_WA_WABA_ID`, `WA_APP_SECRET`, `PLATFORM_WA_DISPLAY_PHONE` → `docker compose up -d api worker`.

**C. Admin'de, sırayla** — `/admin/giris` → platform sahibi hesabı → **WhatsApp** → **WhatsApp kurulumu** (yalnız platform sahibi görür; her işlem denetim kaydına yazılır). "Kurulum durumu" kartında beş değer "Tanımlı" görünmeli (gizliler yalnız son 4 karakterle).

1. **Göster** → webhook adresi ve doğrulama belirteci. developers.facebook.com > uygulama > **WhatsApp > Configuration (Yapılandırma) > Webhook > Edit**: **Callback URL** = webhook adresi, **Verify token** = doğrulama belirteci (ikisinde de **Kopyala**) → **Verify and save**. Aynı sayfada **Webhook fields > Manage** → **messages** satırında **Subscribe**. Doğrulama hatası: 404 → adres eksik ya da yanlış kopyalandı; 403 → doğrulama belirteci farklı.
2. **Bağlantıyı test et** → numara, görünen ad ve onayı, Cloud API kaydı, kalite. Yapılacak bir şey varsa altında Türkçe yazar (190 → token geçersiz, izin hatası, yanlış kimlik …).
3. **Numarayı etkinleştir** → 6 haneli PIN'i iki kez girin. Bu PIN numaranın **WhatsApp iki adımlı doğrulama PIN'idir**: siz seçersiniz, parola yöneticisine kaydedin; numarayı yeniden kaydederken gerekir. Sonra 2. düğme "Cloud API'ye kayıtlı" göstermeli.
4. **Webhook aboneliğini aç** → "Abonelik açık".
5. **Şablonları Meta'ya gönder** → kodun kullandığı tüm şablonlar (sipariş durumu + işletme uyarıları; §6.5) Meta'da yoksa oluşturulur; var olana dokunulmaz, hiçbir şey silinmez. **Durumu yenile** her şablonu Onaylandı / İncelemede / Reddedildi olarak (ret sebebiyle) gösterir; utility şablonlar genelde dakikalar içinde onaylanır.

**Deneme:** kendi telefonunuzdan numaraya `#BOZOK` yazın → demo dükkanın adıyla karşılama ve **Menüyü aç** gelmeli; `Admin > WhatsApp` ortak numara kartında "Son webhook" güncellenir. `/dev/whatsapp` artık "Gerçek WhatsApp bağlı; simülatör kapalı" gösterir.

**Görünen ad:** "Yemek Gelsin" adı Meta incelemesinden geçer (genelde 1–3 gün). Onaylanana kadar müşteri ad yerine numarayı görebilir. Reddedilirse WhatsApp Manager > Phone numbers > numara > **Display name > Edit** ile yeniden gönderin; ad sitedeki marka adıyla aynı olmalı. Durum 2. düğmede görünür.

**KVKK:** Cloudflare dev ortamının verileri Türkiye dışındadır (§13). Bu ortamda gerçek WhatsApp **yalnız kendi telefonlarınızla** denenir: QR basılıp dağıtılmaz, gerçek işletme ya da müşteri bu numaraya yönlendirilmez. Gerçek müşteriler sistem Türkiye'deki VPS'e taşındıktan sonra gelir (§1–§12). Taşınınca aynı beş değer `.env`'e yazılır; webhook belirteci ve doğrulama belirteci yeni sunucuda farklıdır: C.1'i yeni sunucuda tekrarlayın.

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

**Günlük yedek** (`scripts/backup.sh`): `pg_dump -Fc` (sıkıştırılmış, doğrulanmış) + `uploads` biriminin tar arşivi `./backups` klasörüne; **14 günden eskiler silinir**. Döküm `docker compose exec` ile akıtılır; klasörü betik ilk çalışmada `700` izniyle oluşturur, dosyalar `600`'dür. Cron, depoyu ve compose'u yöneten **`siparis` kullanıcısının** crontab'ına kurulur (root'un değil: root'un aldığı dökümleri `siparis` olarak çalışan `restore.sh` okuyamaz). Log kullanıcının ev dizinine yazılır (`/var/log` altına normal kullanıcı yazamaz):

```bash
sudo -iu siparis crontab -e
15 3 * * * cd /opt/siparisinonunde && ./scripts/backup.sh >> "$HOME/siparis-backup.log" 2>&1
```

İlk kurulumda bir kez elle çalıştırıp dosyanın oluştuğunu görün: `./scripts/backup.sh && ls -l backups/`. Klasör root'a aitse (ör. eski bir compose sürümü oluşturduysa) betik yazmaya başlamadan durur ve düzeltme komutunu yazar: `sudo chown -R siparis: backups && chmod 700 backups`.

**Yedek alınamazsa sessiz kalmaz:** betik sıfır dışı kodla çıkar, `~/siparis-backup.log`'a ve syslog'a yazar (`journalctl -t siparis-backup`). Cron'un e-postası çoğu sunucuda gitmediği için asıl uyarı dış izlemedir: Uptime Kuma'da (ikinci VPS, §10) **Push** türünde, 26 saat aralıklı bir monitör açın ve adresini `.env`'e `BACKUP_PING_URL=https://…/api/push/<anahtar>` olarak yazın. Betik her başarılı yedekten sonra bu adresi çağırır; 26 saat çağrı gelmezse nöbetçiye P2 alarmı gider (06 §14.1: yedek yaşı > 26 sa).

**İkinci konum (zorunlu):** Yedeğin bir kopyası başka bir Türkiye lokasyonunda tutulur (00 §10; kişisel veri yurt dışına çıkmaz). `rclone` kurun (`apt-get install rclone`), yurt içi S3 uyumlu depoyu `rclone config` ile tanımlayın ve `.env`'e `BACKUP_REMOTE=yedek-ankara:siparis-yedek` yazın; betik her gece son 48 saatin dosyalarını kopyalar ve uzakta da 14 günü aşanları siler. `BACKUP_REMOTE` boşsa betik her çalıştığında uyarı yazar. Yedek dosyaları kişisel veri içerir: klasör izni `700`, uzak depoda şifreleme (rclone `crypt`) önerilir.

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
2. Araya başka bir vekil girmesin: Cloudflare proxy (turuncu bulut) ya da kurumsal ağ vekilleri akışı tamponlayabilir → §3'teki gibi "Yalnız DNS". Caddy'de `/api/*` için `flush_interval -1` ve sıkıştırma yok (Caddyfile); başka bir nginx eklenirse `proxy_buffering off` ve `X-Accel-Buffering: no` gerekir.
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
- [ ] Seed çalıştırılmadı: `select email from users where email in ('admin@yemekgelsin.net','demo@yemekgelsin.net','mudur@yemekgelsin.net','kasa@yemekgelsin.net','mutfak@yemekgelsin.net','kurye@yemekgelsin.net','doner@yemekgelsin.net')` boş; demo işletmeler (`bozok-pide`, `camlik-doner`) yok. Gerçek yöneticiler bu demo adreslerini kullanmaz (ör. `yonetici@yemekgelsin.net`).
- [ ] Gizli anahtarlar rastgele üretildi (§4) ve `ENCRYPTION_KEY`, `TRACKING_SECRET` parola yöneticisinde + ayrı bir güvenli yerde saklı.
- [ ] Platform yöneticileri `create-admin.ts` ile açıldı ve her biri **iki adımlı doğrulamayı (TOTP) kurdu** (00 §12a madde 7, 14 §5): girişte `/admin/guvenlik` → QR'ı okut → 6 haneli kodla aç → 8 kurtarma kodunu kaydet (§5). Kontrol: `docker compose exec api printenv ADMIN_TOTP_REQUIRED` → `true`; `select email from users where is_platform_admin and totp_enabled_at is null` boş; kurtarma kodlarıyla giriş bir kez denendi (kullanılan kod yenilenerek yerine konur).
- [ ] Yedek cron'u `siparis` kullanıcısının crontab'ında kurulu, ilk elle çalıştırmada `backups/` altında `600` izinli döküm oluştu, `BACKUP_REMOTE` ikinci Türkiye lokasyonuna kopyalıyor, `BACKUP_PING_URL` dış izlemede 26 saatlik push monitörüne bağlı, bir geri yükleme tatbikatı (`restore.sh --target`) başarıyla yapıldı; PITR (WAL arşivleme) kuruldu (00 §11).
- [ ] Caddy erişim logu dosyaya yazılıyor: `docker compose exec caddy ls -l /var/log/caddy/` (5651, 1 yıl).
- [ ] Dış izleme `GET /api/v1/health` ve `GET /api/v1/health/worker`'ı 1 dk aralıkla izliyor, P1 bildirimi nöbetçiye gidiyor; `Admin > İşler`'de başarısız iş yok.
- [ ] Sağlayıcılar gerçek: `docker compose exec worker printenv SMS_PROVIDER PLATFORM_WA_PROVIDER WA_DEFAULT_PROVIDER` çıktısında `mock` yok (§4).
- [ ] Web Push açık: `VAPID_*` dolu, açılış logunda `Web Push kapalı` uyarısı yok; bir Android tablette ve ana ekrana eklenmiş bir iPhone'da "Siparişleri almaya başla" → izin → `Ayarlar › Bu cihazda bildirimler › Test bildirimi gönder` geldi; panel sekmesi kapalıyken verilen deneme siparişinde "Yeni sipariş #…" bildirimi geldi (§10).
- [ ] Panel çevrimdışı uyarısı denendi: açık saatte paneli kapatıp 5 dk bekleyince sahibin telefonuna `isletme_panel_cevrimdisi_v1` geldi (`notifications` tablosunda `kind = 'panel_offline'`).
- [ ] Sunucu: UFW açık (22/80/443), SSH yalnız anahtarla, otomatik güvenlik güncellemeleri açık, `.env` izni 600.
- [ ] Ortak numara bağlı (§6.2 Meta Cloud API ya da §6.3 360dialog): görünen ad "Yemek Gelsin" onaylı, işletme doğrulaması tamam, ödeme kartı tanımlı, `PLATFORM_WA_DISPLAY_PHONE` ve `PLATFORM_WA_WEBHOOK_TOKEN` dolu, webhook tanımlı (`Admin > WhatsApp` ortak numara kartında sorun satırı yok; Yol A'da **WhatsApp kurulumu**nda "Bağlantıyı test et" hazır, "Aboneliği kontrol et" açık, tüm şablonlar Onaylandı). İki farklı işletmenin QR'ı gerçek telefonla okutuldu: her birinde o işletmenin adıyla karşılama → "Menüyü aç" → sipariş → doğru işletmenin panelinde alarm → onay mesajı; kodsuz yazınca dükkan seçici geldi. Müşteri ve platform şablonları onaylı (V-011).
- [ ] Netgsm başlığı onaylı, OTP ve "onaylandı" SMS'i gerçek telefona geldi (V-012, V-020, V-023).
- [ ] `pnpm test` ve `pnpm e2e` yeşil (yayınlanan sürüm etiketinde).

**Hukuki / operasyonel** — [08](08-mevzuat-kvkk-odeme-fatura.md) §9.1 "MVP öncesi zorunlu" setinin tamamı; özellikle:

- [ ] Şirket, vergi levhası, e-Tebligat; marka başvurusu ve alan adları (V-002).
- [ ] Kurumsal aydınlatma metni, gizlilik ve çerez politikası; abonelik sözleşmesi + kullanım koşulları + DPA + alt işleyen listesi (click-wrap, sürümlü); son müşteri aydınlatma, ön bilgilendirme ve mesafeli satış şablonları avukat onaylı ve `/yasal/*` sayfalarındaki "Hukuki inceleme bekliyor" etiketleri kaldırıldı.
- [ ] Site künyesi gerçek bilgilerle dolduruldu (`/kunye`); vitrinde işletme künyesi alanları zorunlu.
- [ ] Barındırma Türkiye'de (DB, yedekler, görseller), sağlayıcı DPA/ISO belgeleri alındı; aktarım envanteri (360dialog/Meta, Cloudflare, Netgsm …) ve Meta aktarımı için yazılı risk değerlendirmesi (V-009, V-026).
- [ ] Veri ihlali müdahale planı (işletmeye 24 saat, Kurul'a 72 saat), saklama-imha politikası, ilgili kişi başvuru kanalı.
- [ ] Fatura düzeni (Paraşüt / e-Arşiv) ilk ücretli işletmeden önce hazır; fişteki "mali değeri yoktur" ibaresi teyitli (V-024, V-025).

**[13](13-varsayim-ve-teyit-kaydi.md) §2 engelleyici teyitler** — P0 (pilot) kapısındaki maddeler `teyitli` durumda olmalı ya da kapı kararına "şu maddeye rağmen şu gerekçeyle" notu yazılmalı: V-001 (rate card), V-009 (TR barındırma), V-011 (platform şablonları), V-012 (SMS fiyatı), V-018 (Coexistence), V-020 (SMS başlığı), V-021 (canary), V-022 (harita kotaları), V-023 (SMS İYS sınıfı), V-024 (fiş ibaresi), V-025 (e-Arşiv), V-026 (Meta aktarımı risk değerlendirmesi). 00 §12a'daki BSP yolu nedeniyle Tech Provider'a özgü maddelerin (V-005, V-010, V-015, V-016, V-019) yerine ortak numaranın bağlandığı yolun (Meta Cloud API ya da 360dialog) API uç noktası, webhook tanımı ve imza davranışı (§6) teyit edilir.

---

## 13. Cloudflare dev (demo) ortamı

Sistemi gerçek işletme verisi olmadan denemek ve göstermek için ayrı bir ortamdır. Adresi **https://yemekgelsin.net**'tir (00 §12a madde 9). **Üretimin yerine geçmez:** üretim Türkiye'deki VPS'tedir (§1–§12). Dev ortamında:
- SMS ve işletmelerin kendi numaraları `mock` çalışır; ortak numara varsayılan olarak simülatördür (`mock`, gerçek mesaj gitmez), isteğe bağlı beş GitHub secret'ıyla gerçek Meta Cloud API'ye bağlanır (aşağıda **Gerçek WhatsApp**, §6.2a);
- site **herkese açıktır**: pazarlama sitesi, vitrinler (`/s/*`), takip (`/t/*`), yasal sayfalar, panel ve admin giriş ekranları, API ve webhook'lar;
- pazarlama, vitrin, takip ve giriş sayfalarının üstünde **"Demo ortamı"** uyarısı görünür (siparişler örnektir, WhatsApp/SMS gitmez, gerçek adres ve telefon girilmez). Uyarı derleme anında açılır: `deploy/cloudflare/Dockerfile` `NEXT_PUBLIC_DEPLOY_ENV=dev`; üretim imajında yoktur;
- **yeni işletme kaydı kapalı başlar**: seed `DEPLOY_ENV=dev` iken `signup_open` bayrağını ilk kurulumda kapalı yazar (veriler yurt dışında ve sağlayıcılar mock olduğundan gerçek işletme kaydolmamalı). Kayıt formu "Yeni kayıtlar geçici olarak kapalı" der. Proje sahibi açmak isterse `/admin/bayraklar`'dan açar; sonraki açılışlar ve dağıtımlar bayrağa dokunmaz;
- **yalnız geliştirici araçları** parolalıdır: WhatsApp simülatörü (`/dev/*`) ve `/api/v1/dev/*` (HTTP Basic, kullanıcı adı serbest, parola `DEV_PASSWORD`);
- demo hesaplarının parolası da `DEV_PASSWORD`'dür (seed `SEED_PASSWORD = DEV_PASSWORD` ile kurar);
- arama motorları dizinlemez: `DEPLOY_ENV=dev` iken her yanıtta `x-robots-tag: noindex, nofollow`;
- veriler yurt dışındadır (Cloudflare R2, ENAM). Bu yüzden gerçek müşteri ve işletme verisi girilmez (00 §12a, 08).

**Yapı** (`deploy/cloudflare/`): tek bir Worker ve Workers Paid planının Containers özelliğiyle çalışan tek bir container örneği (`basic`: 1/4 vCPU, 1 GiB).
- **Alan adı:** `yemekgelsin.net` ve `www.yemekgelsin.net` Worker'a **Custom Domain** olarak bağlıdır (`wrangler.jsonc` `routes`); DNS kaydını ve sertifikayı Cloudflare oluşturur. `www` her yolda köke kalıcı yönlenir (301; gövdeli istekte 308). `workers.dev` adresi yedek olarak açık kalır: API ve webhook istekleri orada da çalışır, tarayıcı sayfa gezinmeleri (GET, `text/html`) `https://yemekgelsin.net`'e geçici yönlenir (302). Kurallar: `deploy/cloudflare/src/access.ts` (testleri `npm test`).
- Container içinde aynı anda PostgreSQL 16, API, worker ve web çalışır. İmaj depo kökünden derlenir (`deploy/cloudflare/Dockerfile`). Worker `/api/*` isteklerini API'ye (4000), diğer istekleri web'e (3000) aktarır.
- Container diski geçicidir. `entrypoint.sh` her açılışta boş bir veritabanı kurar, son yedeği Worker'ın `yedek.internal` çıkış işleyicisi üzerinden R2'den (`siparisinonunde-dev-yedek`) geri yükler, migration'ları uygular ve seed'i çalıştırır. Seed işletme başına idempotenttir: var olan demo işletme atlanır, yedekte olmayan yeni demo işletme (ör. Çamlık Döner) eklenir; `SEED_PASSWORD` değiştiyse var olan demo hesaplarının parolası yeni değere eşitlenir. Önceki marka döneminin demo hesapları (`admin@`, `demo@`, `mudur@`, `kasa@`, `mutfak@`, `kurye@`, `doner@siparisinonunde.local`; varsayılan parolaları eski README'de yayımlıydı) eski bir yedekten dönerse onlar da `SEED_PASSWORD`'e eşitlenir (`LEGACY_DEMO_EMAILS`); herkese açık sitede `admin1234` gibi parolalarla giriş olmaz.
- **Veri dönemi (`DATA_EPOCH`):** R2 anahtarları veri dönemiyle öneklenir: `e2/db/son.dump`, `e2/uploads/son.tar.gz`, `e2/db/gun-<0–6>.dump`. Dönem Worker değişkeni `DATA_EPOCH`'tan container **açılırken** alınır (ortam değişkeni) ve container'ın ömrü boyunca sabittir: `entrypoint.sh` yedek yoluna yazar (`http://yedek.internal/e2/db`), Worker anahtarı bu yoldan kurar (`src/access.ts` `parseBackupPath`), kendi o anki değerinden değil. Böylece yeniden dağıtım sırasında kapanan eski container'ın son yedeği yeni döneme düşmez; yeni dönemin container'ı yedek bulamaz ve boş veritabanı + seed ile (yeni marka ve demo hesaplarıyla) açılır. Dönemsiz yol (`/db`, ilk sürümün entrypoint'i) önekli olmayan eski `db/…` nesnelerine gider. Eski dönemin nesnelerine dokunulmaz. Geçersiz değer (rakam dışı) dağıtımdan önce `scripts/prepare-config.mjs`'te, container'da da açılışta reddedilir.
- Yedek 10 dakikada bir, kapanışta ve çökmede alınır. Veritabanı ve görsel yedeğinin haftanın her günü için bir kopyası tutulur (7 gün). R2'ye ulaşılamazsa container boş veritabanıyla açılmaz, çıkar; böylece iyi yedeğin üzerine yazılmaz.
- Son istekten 30 dakika sonra container uyur. Açık bir panel (SSE) uyumayı engeller. Uyanış yaklaşık 30–60 saniye sürer; bu sırada tarayıcıda "Sistem başlatılıyor" sayfası görünür ve kendiliğinden yenilenir.
- `DEPLOY_ENV=dev`, üretim derlemesinde geliştirici araçlarını yalnız tüm sağlayıcılar `mock` iken açar (`apps/api/src/config.ts`, `devToolsAllowed`). Gerçek WhatsApp kipinde Worker container'a `DEV_TOOLS=0` verir (aksi halde API açılmaz); web simülatörle derlendiği için `/dev/whatsapp` 200 döner ama simülatör yerine "Gerçek WhatsApp bağlı; simülatör kapalı" bildirimini gösterir, `/api/v1/dev/*` 404 döner. Yönetici 2FA'sı dev ortamında isteğe bağlıdır (`ADMIN_TOTP_REQUIRED=false`); site herkese açık olduğundan proje sahibinin admin hesabında `/admin/guvenlik`'ten iki adımlı doğrulamayı açması önerilir.

**Kurulum (bir kez):**
1. Cloudflare hesabında **Workers Paid** planını açın (aylık 5 $; Containers bu planla gelir). Container sürekli açık kalırsa kullanım ücreti ayda yaklaşık 7 $ tutar; uyuyan container ücretlendirilmez.
2. Cloudflare > My Profile > API Tokens > **Create Token** > **"Edit Cloudflare Workers"** şablonuyla bir token oluşturun (var olan token da düzenlenebilir). **Özel alan adı için** token'da şu izinler `yemekgelsin.net` bölgesini kapsamalıdır (Zone Resources: Include > Specific zone > `yemekgelsin.net`, ya da hesabın tüm bölgeleri):
   - **Zone > Workers Routes > Edit**
   - **Zone > Zone > Read**
   Eksikse iş akışı dağıtımdan önce durur ve eksik izni adıyla yazan bir hata verir. Alan adında `@` ya da `www` için önceden elle eklenmiş A/AAAA/CNAME kaydı varsa Custom Domain eklenemez; Cloudflare > `yemekgelsin.net` > DNS > Records'tan silin.
3. GitHub deposunda **Settings > Secrets and variables > Actions > New repository secret** ile şunları ekleyin:
   - `CLOUDFLARE_API_TOKEN`: 2. adımdaki token.
   - `DEV_PASSWORD`: geliştirici araçlarının ve demo hesaplarının parolası, en az 8 karakter.
   - `CLOUDFLARE_ACCOUNT_ID`: yalnız token birden fazla hesaba erişiyorsa gerekir.
   - İsteğe bağlı, gerçek WhatsApp için (§6.2a): `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_WABA_ID`, `META_APP_SECRET`, `WA_PHONE`.
4. GitHub > **Actions > "Dev ortamı (Cloudflare)" > Run workflow**. Sonraki her push, `main` ya da çalışma dalına, ortamı kendiliğinden günceller.

**İş akışı** (`.github/workflows/deploy-dev-cloudflare.yml`):
1. Tür denetimi ve Worker kural testleri (`npm run typecheck`, `npm test`).
2. Hesabı bulur ve token'ın iş akışındaki `ZONE` (`yemekgelsin.net`) bölgesine erişimini denetler (Zone > Zone > Read ile bölge, Zone > Workers Routes > Edit ile Worker rotaları). workers.dev adresini yalnız yedek adres denetimi için bulur.
3. Sitenin adresini iş akışındaki `SITE_URL` değerinden (varsayılan `https://yemekgelsin.net`) web derlemesine (`NEXT_PUBLIC_SITE_URL`) ve API'ye (`APP_BASE_URL`) yazar (`scripts/prepare-config.mjs`).
4. Eksik gizli değerleri bir kez üretir (`scripts/secrets.mjs`): `SESSION_SECRET`, `TRACKING_SECRET`, `ENCRYPTION_KEY`, `WA_VERIFY_TOKEN`, `PLATFORM_WA_WEBHOOK_TOKEN` (ortak numara webhook yolu) ve VAPID çifti. Worker'da zaten olanlara dokunmaz; `ENCRYPTION_KEY` değişirse yedekteki şifreli veriler okunamaz. `DEV_PASSWORD` her dağıtımda GitHub secret'ından güncellenir. WhatsApp secret'ları (`META_*`, `WA_PHONE`) yalnız doluysa yüklenir (`WA_PHONE` E.164'e çevrilir; geçersiz telefon ya da rakam olmayan Meta kimliği dağıtımı durdurur); GitHub'da boşaltılan WhatsApp secret'ı Worker'dan silinir (`wrangler secret delete`), çünkü `--secrets-file` eksik secret'ı silmez. Ayrı bir adım kipi yazar: dört zorunlu secret tamsa "gerçek", değilse "simülatör" (eksikler uyarıyla).
5. `wrangler deploy` ile Worker'ı, container imajını ve Custom Domain'leri yayınlar. Yalnız wrangler'ın son hata bloğu Custom Domain API'sine (`/workers/domains`) aitse izin hatasında eksik izni, DNS çakışmasında silinecek kaydı Türkçe `::error::` ile yazar; imaj derleme ya da rollout hataları genel "wrangler deploy başarısız" iletisiyle raporlanır.
6. Duman testi: `https://yemekgelsin.net/api/v1/health` 200 (Custom Domain, sertifika ve ilk açılış için en çok 15 dakika bekler; süreyle sınırlıdır, container açılamazsa da 15 dakikada Türkçe hatayla durur); `/`, `/s/bozok-pide`, `/s/camlik-doner`, `/panel/giris`, `/admin/giris` parolasız 200; ana sayfada ve vitrinde "Demo ortamı" uyarısı; `/dev/whatsapp` ve `/api/v1/dev/*` parolasız 401, `/dev/whatsapp` parolayla 200; parolayla `/api/v1/dev/*` simülatör kipinde 200, gerçek WhatsApp kipinde 404 ve `/dev/whatsapp` "Gerçek WhatsApp bağlı" bildirimini gösterir; ortak numara webhook yolu parolasız API'ye ulaşır (yanlış belirteçle 404); `www` → kök 301 (yalnız `SITE_URL` kök alan adındaysa); workers.dev'de API 200 ve sayfa gezinmesi → `yemekgelsin.net` (302). Sonuç iş akışı özetine yazılır.

**Kullanım:**
- Site: https://yemekgelsin.net · Panel: `/panel/giris` · Admin: `/admin/giris`.
- Demo hesapları README'deki e-postalardır; **parola her hesap için `DEV_PASSWORD`**: `demo@yemekgelsin.net` (Bozok Pide sahibi), `mudur@`, `kasa@`, `mutfak@`, `kurye@yemekgelsin.net`, `doner@yemekgelsin.net` (Çamlık Döner sahibi), platform yöneticisi `admin@yemekgelsin.net`.
- Demo işletmeler: `/s/bozok-pide` (`#BOZOK`) ve `/s/camlik-doner` (`#DONER`).
- Simülatör kipinde WhatsApp akışları `/dev/whatsapp` simülatöründen denenir (tarayıcı kullanıcı adı ve parola sorar: kullanıcı adı `dev`, parola `DEV_PASSWORD`): numara "Yemek Gelsin · ortak numara" (`+905550000000`, mock); `#BOZOK` / `#DONER` çipleri dükkanın QR'ını okutmakla aynıdır, kodsuz yazınca dükkan seçici gelir.
- `DEV_PASSWORD` değişince (GitHub secret'ı güncellenip iş akışı çalışınca) container yeniden başlar ve seed demo hesaplarının parolasını yeni değere eşitler.

**Gerçek WhatsApp (isteğe bağlı):** ortak numarayı gerçek Meta WhatsApp Cloud API'ye bağlamak için §6.2a'daki beş GitHub secret'ı eklenip iş akışı çalıştırılır. Worker (`src/whatsapp-env.ts`) `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_APP_SECRET` ve `WA_PHONE` birlikte varsa container'a `PLATFORM_WA_PROVIDER=cloud`, `PLATFORM_WA_API_KEY`, `PLATFORM_WA_PHONE_NUMBER_ID`, `PLATFORM_WA_WABA_ID` (varsa), `WA_APP_SECRET` (= `META_APP_SECRET`; ortak ve işletmeye özel webhook imzası), `PLATFORM_WA_DISPLAY_PHONE` (= `WA_PHONE`) ve `DEV_TOOLS=0` verir; biri eksikse eski düzen sürer (`mock`, `DEV_TOOLS=1`, `+905550000000`). Kip container günlüğüne yazılır ("WhatsApp: gerçek Meta Cloud API" / "WhatsApp: simülatör"). SMS ve işletmelerin kendi numaraları her iki kipte `mock`'tur. Kurulumun Meta tarafı ve admin düğmeleri §6.2a'dadır. **Veriler Türkiye dışında olduğundan gerçek kipte yalnız proje sahibinin kendi telefonlarıyla denenir**; gerçek müşteriler Türkiye VPS'ine geçildikten sonra gelir.

**Sıfırlama (demo verisini baştan kurmak):** `deploy/cloudflare/wrangler.jsonc` içindeki `vars.DATA_EPOCH` değerini bir artırın (ör. `"2"` → `"3"`) ve push edin (ya da iş akışını elle çalıştırın). Yeni container yeni dönemde yedek bulamadığından boş veritabanı + seed ile açılır; kapanan eski container'ın son yedeği kendi dönemine (`e2/…`) yazılır. Eski dönemin nesneleri R2'de kalır; yer kaplamasın isterseniz Cloudflare > R2 > `siparisinonunde-dev-yedek` içinden eski önekli nesneleri (`e2/…` ya da öneksiz `db/…`, `uploads/…`) silebilirsiniz. Eski bir döneme dönmek önerilmez: o dönemin verisi geri gelir, `signup_open` bayrağı o dönemdeki haliyle kalır ve ilk (öneksiz) dönemde demo hesapları eski `@siparisinonunde.local` adresleridir (seed parolalarını `DEV_PASSWORD`'e eşitler, yeni `@yemekgelsin.net` hesapları eklenmez).

**Sorun giderme:**
- Container günlükleri: Cloudflare > Workers & Pages > `siparisinonunde-dev` > Logs, ya da `npx wrangler tail siparisinonunde-dev`.
- İlk dağıtımda Custom Domain'in DNS kaydı ve sertifikası birkaç dakika sürebilir; duman testi en çok 15 dakika bekler. Bu sürede site workers.dev üzerinden (API) denenebilir. 15 dakikada sağlık denetimi 200 dönmezse container günlüğünde `[baslat]` satırlarına bakın (seed ya da migration hatası, bellek).
- "Özel alan adı kurulamadı … izni eksik" hatası: §13 Kurulum 2. adımdaki iki izni token'a ekleyip iş akışını yeniden çalıştırın.
- "Failed to start container" hatası çoğunlukla bellek yetmediğini gösterir. `wrangler.jsonc` içinde `instance_type` değerini `standard-1` yapın (4 GiB; maliyet artar).
