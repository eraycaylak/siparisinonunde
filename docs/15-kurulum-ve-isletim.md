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
6. [360dialog ile gerçek WhatsApp bağlama](#6-360dialog-ile-gerçek-whatsapp-bağlama)
7. [SMS (Netgsm)](#7-sms-netgsm)
8. [Yedekleme ve geri yükleme](#8-yedekleme-ve-geri-yükleme)
9. [Güncelleme](#9-güncelleme)
10. [İzleme](#10-izleme)
11. [Sorun giderme](#11-sorun-giderme)
12. [Canlıya çıkış kontrol listesi](#12-canlıya-çıkış-kontrol-listesi)

---

## 1. Mimari özet

Tek VPS üzerinde Docker Compose (00 §12a):

| Servis | İmaj | Görev | Dışarı açık |
|---|---|---|---|
| `caddy` | `docker/caddy.Dockerfile` (Caddy 2 + Cloudflare DNS modülü) | TLS (Let's Encrypt), ters vekil | 80, 443 (TCP+UDP) |
| `web` | `docker/web.Dockerfile` (Next.js 16, standalone) | Pazarlama sitesi, storefront, panel, admin, kurye | Hayır |
| `api` | `docker/api.Dockerfile` (Fastify 5, tsx) | REST `/api/v1`, SSE, WhatsApp webhook, görseller (`/api/v1/uploads`) | Hayır |
| `worker` | aynı API imajı, `src/worker.ts` | `jobs` kuyruğu: WhatsApp gönderimi, alarm zinciri, SMS, cron | Hayır |
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
| Ağ | Gelen: 22 (yalnız anahtarla), 80, 443. Giden: Let's Encrypt, Cloudflare API, 360dialog, Netgsm | 80 portu HTTP-01 doğrulaması ve HTTPS yönlendirmesi için açık kalmalı. |
| Hesaplar | Cloudflare (DNS), 360dialog, Netgsm, ACME e-postası | §3, §6, §7 |

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

Alan adı Cloudflare'de yönetilir (00 §10: Faz 1 wildcard alt alan adı). Kayıtlar (`203.0.113.10` yerine sunucu IP'si):

| Tür | Ad | Değer | Proxy |
|---|---|---|---|
| A | `@` (siparisinonunde.com) | 203.0.113.10 | Yalnız DNS (gri bulut) |
| A | `*` (tüm vitrinler: `{slug}.siparisinonunde.com`) | 203.0.113.10 | Yalnız DNS |
| A | `www`, `panel`, `admin`, `hooks` | 203.0.113.10 | Yalnız DNS (wildcard kapsar; açık kayıt okunurluk içindir) |
| AAAA | yukarıdakilerin aynısı | sunucunun IPv6'sı | Sunucuda IPv6 varsa |
| CAA | `@` | `0 issue "letsencrypt.org"` ve `0 issuewild "letsencrypt.org"` | — |

- **Wildcard sertifika** Let's Encrypt'te yalnız DNS-01 doğrulamasıyla alınır. Bu yüzden Caddy imajı Cloudflare DNS modülüyle derlenir (`docker/caddy.Dockerfile`) ve `.env`'de `CLOUDFLARE_API_TOKEN` gerekir. Belirteç: Cloudflare > My Profile > API Tokens > "Edit zone DNS" şablonu, yalnız bu bölge (Zone.DNS:Edit + Zone.Zone:Read).
- **Proxy (turuncu bulut) başlangıçta kapalı** önerilir: SSE bağlantısı Cloudflare'in 100 sn boşta kalma sınırına ve tamponlamasına takılabilir (15 sn ping bunu çoğu zaman aşar ama doğrulanmadı — teyit edilmeli). Proxy açılacaksa SSL modu "Full (strict)" olmalı ve `Caddyfile`'daki `trusted_proxies` bloğu açılmalıdır (aksi halde hız sınırı tüm istekleri Cloudflare IP'sine sayar).
- **Ayrılmış alt alan adları** vitrin olamaz: `www, api, app, panel, admin, kurye, dev, static, assets, uploads, mail, smtp, help, destek, blog, hooks, status, docs, demo, test, bayi, yardim` (`packages/core/src/slug.ts`).
- DNS yayıldıktan sonra doğrulama: `dig +short bozok-pide.siparisinonunde.com` sunucu IP'sini döndürmeli.

## 4. Ortam değişkenleri (.env)

Şablon: `docker/env.production.example` → sunucuda depo kökünde `.env` (git'e girmez, izin `chmod 600 .env`). Compose bu dosyayı hem değişken yerleştirmede (`${DOMAIN}` vb.) hem de `api/worker/migrate` konteynerlerine `env_file` olarak kullanır. Uygulamanın okuduğu değişkenler 14 §3 ile aynıdır; aşağıda üretimdeki anlamları:

| Değişken | Zorunlu | Açıklama | Üretme / örnek |
|---|---|---|---|
| `DOMAIN` | evet | Kök alan adı; `APP_BASE_URL=https://${DOMAIN}` ve web derleme argümanları bundan kurulur | `siparisinonunde.com` |
| `ACME_EMAIL` | evet | Let's Encrypt bildirim e-postası | `ops@siparisinonunde.com` |
| `CLOUDFLARE_API_TOKEN` | evet (wildcard için) | DNS-01 doğrulaması | §3 |
| `POSTGRES_USER`, `POSTGRES_DB` | hayır | Varsayılan `siparis` / `siparis` | — |
| `POSTGRES_PASSWORD` | evet | Veritabanı parolası; URL'ye girdiği için yalnız harf/rakam | `openssl rand -hex 24` |
| `DATABASE_URL` | (compose kurar) | `postgres://USER:PASS@postgres:5432/DB`; `.env`'e yazmayın | — |
| `APP_BASE_URL` | (compose kurar) | Linkler, takip sayfası, webhook adresi | `https://siparisinonunde.com` |
| `SESSION_SECRET` | evet | Oturum/çerez imzaları (storefront müşteri çerezi HMAC). Değişirse "Son siparişin" çerezleri geçersizleşir | `openssl rand -base64 48` |
| `TRACKING_SECRET` | evet | Takip linki HMAC'i (14 §7.4). **Değişirse tüm takip linkleri kırılır** | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | evet | WhatsApp/SMS API anahtarlarını şifreler (AES-256-GCM, 32 bayt base64). **Kaybolursa kayıtlı anahtarlar çözülemez**, parola yöneticisinde ve ayrı bir yerde saklayın | `openssl rand -base64 32` |
| `WA_DEFAULT_PROVIDER` | hayır | Yeni hesap varsayılanı: `mock` \| `cloud` \| `d360` (işletme hesabı panelde seçilir) | `d360` |
| `WA_APP_SECRET` | cloud için | Meta Cloud API webhook imzası (`X-Hub-Signature-256`). 360dialog hesaplarında imza denetlenmez (teyit edilmeli) | Meta uygulama gizli anahtarı |
| `WA_VERIFY_TOKEN` | cloud için | Webhook GET doğrulaması (`hub.verify_token`) | `openssl rand -hex 16` |
| `PLATFORM_WA_PROVIDER` | evet | İşletme sahibine alarm şablonlarını gönderen platform numarası (00 §10 alarm t=2 dk) | `d360` |
| `PLATFORM_WA_API_KEY` | d360/cloud için | Platform numarasının API anahtarı | 360dialog'dan |
| `PLATFORM_WA_PHONE_NUMBER_ID` | cloud için | Platform numarasının Graph `phone_number_id`'si (d360'ta boş) | — |
| `SMS_PROVIDER` | evet | `mock` \| `netgsm` | `netgsm` |
| `NETGSM_USERCODE`, `NETGSM_PASSWORD`, `NETGSM_HEADER` | netgsm için | §7 | — |
| `UPLOAD_DIR` | (compose kurar) | `/data/uploads` (`uploads` birimi) | — |
| `ANTHROPIC_API_KEY` | hayır | Faz 2 (AI); boşsa kapalı | — |
| `DEV_TOOLS` | evet | **Üretimde `0`**: `/dev/whatsapp` ve `/api/v1/dev/*` kapalı. Web'e derleme anında gömülür (değişince `docker compose build web`) | `0` |
| `ADMIN_TOTP_REQUIRED` | (compose kurar) | Platform yöneticilerine iki adımlı doğrulama (TOTP) zorunlu. Compose `api` servisinde `true` sabittir; `.env` ile kapatılamaz. Yerelde boşsa kapalıdır (00 §12a madde 7) | `true` |
| `LOG_LEVEL` | hayır | `info` (sorun ararken `debug`) | `info` |
| `DEMO_STORE_SLUG` | hayır | Pazarlama sitesindeki "demo vitrin" bağlantısı | `bozok-pide` |
| `SUPPORT_WHATSAPP` | önerilir | Platform destek hattı (WhatsApp), rakamlarla. Giriş ekranındaki "Parolamı unuttum" işletme sahibine bu numarayı (WhatsApp + arama) gösterir; boşsa iletişim formuna yönlendirir. Web'e derleme anında gömülür | `905321234567` |
| `BACKUP_REMOTE`, `RETENTION_DAYS` | önerilir | Yedeğin ikinci konumu (rclone) ve saklama günü | §8 |
| `BACKUP_PING_URL` | önerilir | Her başarılı yedekten sonra çağrılan dış izleme (push) adresi; 26 saat gelmezse alarm | §8 |

Tüm gizli anahtarları bir kerede üretmek için:

```bash
printf 'POSTGRES_PASSWORD=%s\nSESSION_SECRET=%s\nTRACKING_SECRET=%s\nENCRYPTION_KEY=%s\nWA_VERIFY_TOKEN=%s\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -base64 48 | tr -d '\n')" "$(openssl rand -base64 32)" \
  "$(openssl rand -base64 32)" "$(openssl rand -hex 16)"
```

Web derleme argümanları (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_DEV_TOOLS`, `NEXT_PUBLIC_SUPPORT_WHATSAPP`, `API_INTERNAL_URL`) compose'da `.env`'den türetilir ve **derleme anında** imaja gömülür; `DOMAIN`, `DEV_TOOLS` ya da `SUPPORT_WHATSAPP` değişirse `docker compose build web && docker compose up -d web` gerekir.

**Hatalı üretim yapılandırmasında API ve worker açılmaz.** Compose `NODE_ENV=production` verir; aşağıdakilerden biri varsa süreç başlamaz ve `docker compose logs api` içinde `Geçersiz üretim yapılandırması: …` yazar (`apps/api/src/config.ts`):

- `DEV_TOOLS=1` (`/api/v1/dev/*` kimlik doğrulamasızdır),
- `SESSION_SECRET` ya da `TRACKING_SECRET` 32 karakterden kısa ya da örnek (`dev-only…`) değer,
- `WA_VERIFY_TOKEN` boş ya da `dev-verify`,
- `SMS_PROVIDER=netgsm` iken `NETGSM_USERCODE`, `NETGSM_PASSWORD` ya da `NETGSM_HEADER` boş,
- `PLATFORM_WA_PROVIDER=d360` ya da `cloud` iken `PLATFORM_WA_API_KEY` boş (`cloud` için ayrıca `PLATFORM_WA_PHONE_NUMBER_ID`).

`docker/env.production.example` `SMS_PROVIDER=netgsm` ve `PLATFORM_WA_PROVIDER=d360` ile, anahtarlar boş olarak gelir; bu haliyle API açılmaz. Netgsm ve 360dialog hesapları hazır olmadan kurulum yapılacaksa ikisini geçici olarak `mock` yapın. Süreç açılır, logda uyarı yazar (`SMS_PROVIDER=mock: SMS OTP ve alarm SMS'leri gönderilmez` vb.). Bu durumda SMS ve platform WhatsApp uyarıları **gerçekten gitmez**: WhatsApp'sız moddaki işletmenin müşterisi SMS kodu alamaz ve sahibine alarm gitmez. Canlıya çıkmadan önce gerçek sağlayıcıya geçin (§6.8, §7, §12).

## 5. İlk kurulum

```bash
sudo mkdir -p /opt/siparisinonunde && sudo chown siparis: /opt/siparisinonunde
git clone <depo-adresi> /opt/siparisinonunde && cd /opt/siparisinonunde
cp docker/env.production.example .env && chmod 600 .env && nano .env      # §4

docker compose build                   # api (api+worker+migrate aynı imaj), web, caddy
docker compose up -d                   # sıra: postgres (sağlıklı) → migrate (bir kez) → api, worker → web → caddy
docker compose ps -a                   # migrate "Exited (0)" (-a olmadan listelenmez), diğerleri "healthy"
docker compose logs migrate            # "Migration tamam: N yeni, 0 zaten uygulanmış."
curl -fsS https://siparisinonunde.com/api/v1/health     # {"ok":true,"db":"up",...}
```

**Seed üretimde çalıştırılmaz.** `pnpm db:seed` demo işletmeyi ve parolası herkesçe bilinen hesapları (`demo1234`, `admin1234`) oluşturur; yalnız geliştirme içindir. İlk platform yöneticisi betikle açılır:

```bash
docker compose run --rm api node --import tsx /app/scripts/create-admin.ts \
  --email eray@siparisinonunde.com --name "Eray"               # rol varsayılan platform_owner
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
docker compose run --rm api node --import tsx /app/scripts/create-admin.ts --email eray@siparisinonunde.com --reset-totp
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

Ardından **Bayraklar** ekranında kill-switch'lerin açık olduğunu görün (`signup_open`, `sms_fallback` …). İlk işletme `https://DOMAIN/panel/kayit` üzerinden kaydolur ve kurulum sihirbazına (`/panel/kurulum`) iner; WhatsApp bağlanmadan da "WhatsApp'sız başla" ile web siparişi alabilir (SMS doğrulamalı).

Yedek cron'unu kurmayı unutmayın (§8).

## 6. 360dialog ile gerçek WhatsApp bağlama

00 §12a gereği WhatsApp erişimi aracı firma (BSP) **360dialog** üzerindendir; Meta ile doğrudan Tech Provider süreci yürütülmez. Kod sağlayıcıdan bağımsızdır (`apps/api/src/wa/providers/{mock,cloud,d360}.ts`). Aşağıdaki adımların tamamı 360dialog'un güncel belgesiyle doğrulanmalıdır (teyit edilmeli).

1. **Hesap açma:** 360dialog Client Hub'da hesap açılır (işletme adına ya da platform olarak partner hesabıyla — hangisinin seçileceği 13'e göre teyit edilmeli). İşletmenin bir Meta Business Portfolio'su olmalıdır; Meta mesaj ücretleri Meta'ya tanımlanan karttan, 360dialog numara ücreti 360dialog'a ödenir (teyit edilmeli).
2. **Numarayı bağlama:** 360dialog'un kayıt ekranındaki (Embedded Signup) akışla numara bağlanır. Varsayılan yol **Coexistence**'tır: esnaf WhatsApp Business uygulamasındaki numarasını ve telefondan yazmayı korur (00 §6.4; 360dialog'da Coexistence desteği ve kısıtları teyit edilmeli — V-018). Alternatif: yeni numara. Görünen ad (display name) Meta onayından geçer.
3. **API anahtarı:** Client Hub'da numaranın ayarlarından API anahtarı üretilir (anahtar bir kez gösterilir — teyit edilmeli). Anahtarı yalnız güvenli kanaldan alın; e-posta/WhatsApp'la düz metin taşımayın.
4. **Panelde sağlayıcı seçimi (yalnız işletme sahibi):** `Panel > Ayarlar > WhatsApp` (`/panel/ayarlar/whatsapp`): Sağlayıcı **360dialog**, "WhatsApp numarası" (ör. `0532 123 45 67`), "360dialog API anahtarı" → **Kaydet**. Anahtar `ENCRYPTION_KEY` ile şifrelenip saklanır; ekranda maskeli görünür. Gönderim `POST https://waba-v2.360dialog.io/messages` + `D360-API-KEY` başlığıyla yapılır (14 §8; teyit edilmeli).
5. **Webhook adresi:** Aynı sayfadaki "Webhook adresi" kartında işletmeye özel adres görünür: `https://DOMAIN/api/v1/webhooks/wa/<gizli-belirteç>`. Bu adres 360dialog'a tanımlanır; API ile (teyit edilmeli):
   ```bash
   curl -X POST https://waba-v2.360dialog.io/v1/configs/webhook \
     -H "D360-API-KEY: <anahtar>" -H "Content-Type: application/json" \
     -d '{"url":"https://siparisinonunde.com/api/v1/webhooks/wa/<belirteç>"}'
   ```
   360dialog Meta'nın `X-Hub-Signature-256` imzasını göndermez; URL'deki gizli belirteç doğrulamanın yerine geçer (teyit edilmeli). Belirteci gizli tutun (loglarda, ekran görüntülerinde paylaşmayın). Webhook ham olayı kaydedip hemen 200 döner; işleme `wa-inbound` kuyruğundadır (00 §10).
6. **Deneme:** Kendi telefonunuzdan işletme numarasına "merhaba" yazın → karşılama mesajı ve **Menüyü aç** butonu gelmeli; linkten sipariş verin, panelde sesli uyarıyı görün. Paneldeki "Test mesajı gönder" pencere kuralına tabidir: test numarası son 24 saatte işletme numarasına yazmış olmalıdır. Sağlık durumu: `Admin > WhatsApp` (son webhook zamanı, son 24 saat hata).
7. **Şablonlar:** 24 saat penceresi dışındaki durum mesajları onaylı **utility** şablonlarla gider. Müşteri şablonları: `siparis_alindi_v1`, `siparis_onaylandi_v1`, `siparis_hazir_v1`, `siparis_yolda_v1`, `siparis_teslim_v1`, `siparis_reddedildi_v1`, `siparis_iptal_v1`, `siparis_iptal_yanitsiz_v1`, `yanit_bekliyor_v1` (metin ve parametre sırası `packages/core/src/messages/tr.ts` → `CUSTOMER_TEMPLATES`). Her işletmenin WABA'sında 360dialog Hub ya da API üzerinden oluşturulup onaylatılır (teyit edilmeli). Şablonlara promosyon eklenmez (İYS, 00 §7).
8. **Platform uyarı numarası:** İşletme sahibine yeni sipariş alarmı (t=2 dk), WhatsApp bağlantı sorunu ve Meta ödeme uyarısı platformun kendi numarasından gider: `.env`'de `PLATFORM_WA_PROVIDER=d360`, `PLATFORM_WA_API_KEY=...`. Platform şablonları: `isletme_yeni_siparis_v1`, `isletme_panel_cevrimdisi_v1`, `kurye_giris_v1`, `isletme_baglanti_sorunu_v1`, `isletme_meta_odeme_v1`, `isletme_kalite_uyari_v1` (utility kategorisinde onay — V-011). `isletme_panel_cevrimdisi_v1` "panel çevrimdışı" dedektörü için ayrılmıştır; dedektör henüz yoktur (§10 "Henüz olmayanlar"), şablon yine de onaylatılır. Gerekirse `Admin > Bayraklar > platform_wa_alerts` ile geçici kapatılır.

WhatsApp bağlantısı koparsa (hesap `error`, token/ödeme hatası) işletme otomatik olarak **WhatsApp'sız moda** düşer: Akış B SMS OTP ile doğrulanır, onay/ret/iptal SMS ile bildirilir (00 §4, §7).

## 7. SMS (Netgsm)

SMS OTP (WhatsApp'sız mod), kritik durum SMS'leri ve 5. dakika alarm SMS'i platform maliyetidir (00 §4 kotalar: Esnaf 100, Pro 300 SMS/ay).

1. Netgsm kurumsal hesabı açılır; **API kullanıcısı** tanımlanır ve API erişimi açılır. Netgsm panelinde API erişimi IP kısıtlıysa sunucunun çıkış IP'si eklenir (teyit edilmeli).
2. **Gönderici başlığı:** platformun onaylı alfanümerik başlığı (≤ 11 karakter, ör. `SIPARISNDE`); onay süresi pilot öncesine sığmalı (V-020, teyit edilmeli). Mesaj gövdesinde işletme adı geçer.
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
docker compose ps && curl -fsS https://siparisinonunde.com/api/v1/health
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
| Admin paneli | `Özet` (lifecycle'a göre işletmeler, bugünkü sipariş, açık alarm, başarısız iş), `İşler` (`/admin/isler`: başarısız işler = DLQ, tek tıkla yeniden dene), `WhatsApp` (hesap sağlığı; kırmızılar üstte), `Bayraklar` (kill-switch'ler), `Denetim` (audit log) |
| Veritabanı | 500 ms'yi aşan sorgular postgres loguna düşer (`log_min_duration_statement`). Disk: `docker system df`, `df -h` |
| Kuyruk | `docker compose exec postgres psql -U siparis -c "select status, count(*) from jobs group by 1"` |

**Henüz olmayanlar (pilot sürümü).** 00 §10 ve 04 §4.5'teki alarm zincirinin iki halkası bu sürümde yoktur; nöbette bunlara güvenmeyin:

- **Web Push (t=0):** Panel kapalıyken ya da tarayıcı arka plandayken cihaza bildirim gitmez. t=0'da ve 60 sn'de yalnız açık paneldeki ses ve bant çalışır; 2 dk platform WhatsApp uyarısı, 5 dk SMS, 10 dk müşteriye bilgi ve 15 dk otomatik iptal panelden bağımsız olarak worker işleriyle çalışır. Bu nedenle `PLATFORM_WA_PROVIDER` ve `SMS_PROVIDER` üretimde gerçek sağlayıcı olmalıdır (§4).
- **"Panel çevrimdışı" dedektörü:** Açık saatte şubenin hiçbir panel bağlantısı olmasa da sahibine uyarı gitmez. Kaçan sipariş yine 2 dk'da platform WhatsApp uyarısıyla sahibine ulaşır. Pilot işletmelerde "Vardiyayı başlat" alışkanlığı kurulum sırasında gösterilir.

## 11. Sorun giderme

**Sipariş düşmüyor**

1. Vitrinde "sipariş almıyor" bandı var mı? `curl -s https://DOMAIN/api/v1/store/<slug> | jq .branch.orderingState` → `closed` (çalışma saatleri/özel gün), `paused` (panelden durdurulmuş ya da `ordering_enabled=false`, askıya alınmış işletme). Admin > İşletme detayında lifecycle ve `ordering_enabled`'a bakın.
2. Sipariş `awaiting_customer`'da mı kalıyor? Akış B doğrulaması tamamlanmamıştır: WhatsApp kod mesajı gelmiyorsa aşağıdaki "Webhook gelmiyor" adımları; SMS yedeği açık mı (`sms_fallback` bayrağı + işletme izni). 30 dk sonra sipariş `customer_timeout` ile iptal olur.
3. Sipariş `new` ama panelde yok: paneldeki bağlantı bandına bakın (SSE); sayfayı yenileyin (`GET /panel/orders/active` her 45 sn'de de çalışır). Doğru şube/işletme seçili mi?
4. Alarm zinciri çalışmıyor (platform WhatsApp uyarısı, SMS): worker çalışıyor mu (`docker compose ps worker`, `logs worker`), `Admin > İşler`'de başarısız iş var mı?

**Webhook gelmiyor (müşteri yazıyor, bot yanıt vermiyor)**

1. `Admin > WhatsApp` → "son webhook" zamanı eski mi? 360dialog'a tanımlı URL paneldeki adresle birebir aynı mı (§6.5)?
2. Dışarıdan erişim: `curl -i -X POST https://DOMAIN/api/v1/webhooks/wa/<belirteç> -H 'Content-Type: application/json' -d '{}'` → 200 beklenir (400 = gövde geçersiz ama yol çalışıyor; 404 = belirteç yanlış; 401 `invalid_signature` = cloud hesabında `WA_APP_SECRET` uyuşmuyor).
3. Caddy erişim loglarında istek görünüyor mu? `docker compose logs --since 1h caddy | grep 'webhooks/wa'` (belirteç `***` olarak yazılır; `status` alanı yanıt kodudur). Görünmüyorsa DNS/TLS ya da sağlayıcı tarafı; görünüyorsa API loglarına bakın.
4. Olay kaydedildi ama işlenmedi: `select count(*) from wa_webhook_events where processed_at is null` → worker'ı ve `wa-inbound` işlerini kontrol edin.
5. Giden mesaj `failed`: sohbet ekranında hata kodu; 131047 = 24 saat penceresi dışı (şablon gerekir), token/ödeme hataları hesabı `error`'a çeker ve işletme WhatsApp'sız moda düşer.

**SSE (canlı ekran) kopuyor**

1. Panelde "Yeniden bağlanıyor" bandı sık mı görünüyor? Tarayıcı geliştirici araçlarında `/api/v1/panel/stream` isteğinin 15 sn'de bir `ping` aldığını doğrulayın.
2. Araya başka bir vekil girmesin: Cloudflare proxy (turuncu bulut) ya da kurumsal ağ vekilleri akışı tamponlayabilir → §3'teki gibi "Yalnız DNS". Caddy'de `/api/*` için `flush_interval -1` ve sıkıştırma yok (Caddyfile); başka bir nginx eklenirse `proxy_buffering off` ve `X-Accel-Buffering: no` gerekir.
3. Tablet uykuya geçiyor: "Vardiyayı başlat" Wake Lock ister; cihazın güç tasarrufu ayarını kapatın.
4. Kopmalar sunucu yeniden başlatmalarıyla aynı anda mı? Güncellemeleri yoğun saat dışına alın (§9). Kaçan olaylar `Last-Event-ID` ile yeniden oynatılır; 1000'den fazla olay kaçarsa panel tam yenilenir (resync).

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
- [ ] Seed çalıştırılmadı: `select email from users where email like '%@siparisinonunde.local'` boş; demo işletme (`bozok-pide`) yok.
- [ ] Gizli anahtarlar rastgele üretildi (§4) ve `ENCRYPTION_KEY`, `TRACKING_SECRET` parola yöneticisinde + ayrı bir güvenli yerde saklı.
- [ ] Platform yöneticileri `create-admin.ts` ile açıldı ve her biri **iki adımlı doğrulamayı (TOTP) kurdu** (00 §12a madde 7, 14 §5): girişte `/admin/guvenlik` → QR'ı okut → 6 haneli kodla aç → 8 kurtarma kodunu kaydet (§5). Kontrol: `docker compose exec api printenv ADMIN_TOTP_REQUIRED` → `true`; `select email from users where is_platform_admin and totp_enabled_at is null` boş; kurtarma kodlarıyla giriş bir kez denendi (kullanılan kod yenilenerek yerine konur).
- [ ] Yedek cron'u `siparis` kullanıcısının crontab'ında kurulu, ilk elle çalıştırmada `backups/` altında `600` izinli döküm oluştu, `BACKUP_REMOTE` ikinci Türkiye lokasyonuna kopyalıyor, `BACKUP_PING_URL` dış izlemede 26 saatlik push monitörüne bağlı, bir geri yükleme tatbikatı (`restore.sh --target`) başarıyla yapıldı; PITR (WAL arşivleme) kuruldu (00 §11).
- [ ] Caddy erişim logu dosyaya yazılıyor: `docker compose exec caddy ls -l /var/log/caddy/` (5651, 1 yıl).
- [ ] Dış izleme `GET /api/v1/health` ve `GET /api/v1/health/worker`'ı 1 dk aralıkla izliyor, P1 bildirimi nöbetçiye gidiyor; `Admin > İşler`'de başarısız iş yok.
- [ ] Sağlayıcılar gerçek: `docker compose exec worker printenv SMS_PROVIDER PLATFORM_WA_PROVIDER WA_DEFAULT_PROVIDER` çıktısında `mock` yok (§4).
- [ ] Sunucu: UFW açık (22/80/443), SSH yalnız anahtarla, otomatik güvenlik güncellemeleri açık, `.env` izni 600.
- [ ] 360dialog numarası bağlı, webhook tanımlı, "merhaba" → "Menüyü aç" → sipariş → panel alarmı → onay mesajı uçtan uca gerçek telefonla denendi; müşteri ve platform şablonları onaylı (V-011).
- [ ] Netgsm başlığı onaylı, OTP ve "onaylandı" SMS'i gerçek telefona geldi (V-012, V-020, V-023).
- [ ] `pnpm test` ve `pnpm e2e` yeşil (yayınlanan sürüm etiketinde).

**Hukuki / operasyonel** — [08](08-mevzuat-kvkk-odeme-fatura.md) §9.1 "MVP öncesi zorunlu" setinin tamamı; özellikle:

- [ ] Şirket, vergi levhası, e-Tebligat; marka başvurusu ve alan adları (V-002).
- [ ] Kurumsal aydınlatma metni, gizlilik ve çerez politikası; abonelik sözleşmesi + kullanım koşulları + DPA + alt işleyen listesi (click-wrap, sürümlü); son müşteri aydınlatma, ön bilgilendirme ve mesafeli satış şablonları avukat onaylı ve `/yasal/*` sayfalarındaki "Hukuki inceleme bekliyor" etiketleri kaldırıldı.
- [ ] Site künyesi gerçek bilgilerle dolduruldu (`/kunye`); vitrinde işletme künyesi alanları zorunlu.
- [ ] Barındırma Türkiye'de (DB, yedekler, görseller), sağlayıcı DPA/ISO belgeleri alındı; aktarım envanteri (360dialog/Meta, Cloudflare, Netgsm …) ve Meta aktarımı için yazılı risk değerlendirmesi (V-009, V-026).
- [ ] Veri ihlali müdahale planı (işletmeye 24 saat, Kurul'a 72 saat), saklama-imha politikası, ilgili kişi başvuru kanalı.
- [ ] Fatura düzeni (Paraşüt / e-Arşiv) ilk ücretli işletmeden önce hazır; fişteki "mali değeri yoktur" ibaresi teyitli (V-024, V-025).

**[13](13-varsayim-ve-teyit-kaydi.md) §2 engelleyici teyitler** — P0 (pilot) kapısındaki maddeler `teyitli` durumda olmalı ya da kapı kararına "şu maddeye rağmen şu gerekçeyle" notu yazılmalı: V-001 (rate card), V-009 (TR barındırma), V-011 (platform şablonları), V-012 (SMS fiyatı), V-018 (Coexistence), V-020 (SMS başlığı), V-021 (canary), V-022 (harita kotaları), V-023 (SMS İYS sınıfı), V-024 (fiş ibaresi), V-025 (e-Arşiv), V-026 (Meta aktarımı risk değerlendirmesi). 00 §12a'daki BSP yolu nedeniyle Tech Provider'a özgü maddelerin (V-005, V-010, V-015, V-016, V-019) yerine 360dialog'un API uç noktası, webhook tanımı ve imza davranışı (§6) teyit edilir.
