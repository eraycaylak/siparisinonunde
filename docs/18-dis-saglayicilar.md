# 18 — Dış sağlayıcılar: ne işe yarar, nereden alınır, çalışmazsa ne olur

> **Bu dosya nedir?** Üründe **gerçekten çağrılan** her dış sağlayıcı için tek sayfa: hangi ortam değişkenini
> okur, değeri nereden alınır, çalıştığı nasıl doğrulanır, **çalışmazsa ne olur** ve maliyet kalemi nedir.
> Liste koddan türetilmiştir; kullanılmayan sağlayıcı buraya yazılmaz (değişmez kural 7, 08 §2.11 ile aynı ilke).
>
> **Kapsam dışı (bağlantı verilir):** kurulum ve dağıtım adımları → [15](15-kurulum-ve-isletim.md); uyarı
> türlerinin tamamı ve nöbet adımları → [17](17-olay-mudahale-runbook.md); Twilio adaptörünün iç ayrıntısı →
> [16](16-twilio-whatsapp.md); KVKK aktarım envanteri ve yasal dayanaklar → [08](08-mevzuat-kvkk-odeme-fatura.md)
> §2.11; Web Push servisleri (FCM / APNs / Mozilla) → 15 §10 (bir hesap ya da anahtar satın alınmaz, `VAPID_*`
> kendimiz üretiriz).
>
> **Hiçbir gerçek anahtar bu dosyada yazılı değildir** ve yazılmayacaktır. Değerler Worker secret'ı olarak verilir
> (15 §13 madde 5).

---

## 1. Özet: hangi sağlayıcı zorunlu?

| Sağlayıcı | Ne için | Durum (2026-10-05) | Yoksa ne olur |
|---|---|---|---|
| **Cloudflare** | Barındırma: Worker, container, R2 yedek, DNS/TLS | **CANLI** | Ürün yok; tek barındırma yolu bu |
| **WhatsApp iş çözümü sağlayıcısı** (Twilio ya da 360dialog) | Ortak numaranın mesaj iletimi | **Bağlanmadı** (`PLATFORM_WA_PROVIDER=mock`) | Ortak numara kapalı: vitrinde WhatsApp bağlantısı yok, işletmeye WhatsApp uyarısı gitmez (alarm zincirinin 2. halkası düşer) |
| **SMS (Netgsm)** | Doğrulama kodu, durum SMS'i, işletme alarmı | **Bağlanmadı** (`SMS_PROVIDER=mock`, §2) | Müşteriye SMS yedeği **teklif edilmez** ("işletmeyi arayın"); alarm zincirinin 5 dk SMS halkası `sms_unavailable` notuyla atlanır |
| **E-posta** | Lead bildirimi, KVKK başvurusu, parola sıfırlama, fatura | **Bağlanmadı** (`EMAIL_PROVIDER=mock`, §3) | Bu akışların hiçbiri e-posta göndermez; çağrı `skipped` döner ve uyarı kanalına düşer |
| **Uyarı kanalı** (`ALERT_WEBHOOK_URL`) | Operasyon uyarılarının gittiği tek dış kanal | **Bağlanmadı** (§5) | 17 §1'deki uyarı türlerinin **hiçbiri** sana ulaşmaz; yalnız `wrangler tail`'de görünür |
| **OpenFreeMap** | Panelde harita döşemeleri | **CANLI** (anahtarsız, §7) | Harita boş kalır; bölge çizimi elle koordinat girmeye düşer |
| **Google Haritalar bağlantısı** | Yol tarifi için adresi harita uygulamasında açmak | **CANLI** (anahtarsız, §7) | Bağlantı açılmaz; kurye adrese elle gider |

**Üç satır canlıya çıkmadan kapatılmalıdır:** WhatsApp iş çözümü sağlayıcısı, SMS ve uyarı kanalı. Üçü de
şu an taklit (mock) ya da tanımsızdır ve **bu durum artık sessiz değildir**: canlı açılışta
`productionConfigWarnings` (`apps/api/src/config.ts`) her biri için bir uyarı satırı yazar, ekranlar da kanalın
gittiğini söylemez (`channelDelivers`).

### Taklit (mock) sağlayıcı ne demek — tek kural

`channelDelivers(config, kanal)` (`apps/api/src/config.ts`) **tek** karar noktasıdır: taklit sağlayıcı
geliştirme/test ortamında ve simülatörlü gizli staging'de (`DEPLOY_ENV=dev`) mesajı simülatöre "teslim eder";
**canlı ortamda (NODE_ENV=production + DEPLOY_ENV=production) hiçbir yere göndermez.** Canlı ortamda taklit bir
kanal için:

1. **Gönderim denenmez.** Kayıt `failed` + nedeni yazılır, **asla `sent` işaretlenmez**.
2. **Günlüğe tek anlamlı hata satırı düşer** (`SMS GÖNDERİLMEDİ…`, `E-POSTA GÖNDERİLMEDİ…`).
3. **Uyarı kanalına gider** (`sms_provider_mock`, `email_not_configured`; saatte bir, §5).
4. **Hiçbir ekran mesajın gittiğini söylemez.** SMS'te bu, müşteriye SMS yedeğinin hiç teklif edilmemesi demektir.

> **Niçin bu kadar yazılı:** denetim 2026-10-04 madde 4.4'e kadar taklit SMS sağlayıcısı sahte bir mesaj kimliği
> döndürüyor, kayıt `sent` oluyor, günlüğe "SMS gönderildi" yazılıyordu. Müşteri ekranda **"kod gönderildi"**
> görüyor ve hiç gelmeyecek kodu bekliyordu. Bu bir yapılandırma eksiği değil, **sessiz yalandı**; düzeltmesi
> `apps/api/src/services/messaging/sms-send.ts` ve `apps/api/src/services/orders/verification.ts`'tedir.

---

## 2. SMS — Netgsm

| | |
|---|---|
| **Ne işe yarar** | (a) WhatsApp'sız modda sipariş doğrulama kodu (OTP, 03 §3.2.1), (b) WhatsApp'sız modda sipariş durumu SMS'i, (c) işletme sahibine 5 dk'lık yeni sipariş alarmı (00 §10) |
| **Kod** | `apps/api/src/sms/providers/netgsm.ts` · seçim `apps/api/src/sms/index.ts` → `getSmsProvider()` · gönderim işi `apps/api/src/services/messaging/sms-send.ts` (`sms.send`) · kota `apps/api/src/sms/quota.ts` |
| **Ortam değişkenleri** | `SMS_PROVIDER` = `mock` \| `netgsm` · `NETGSM_USERCODE` · `NETGSM_PASSWORD` · `NETGSM_HEADER` |
| **Nereden alınır** | Netgsm (yurt içi) hesabı: kullanıcı kodu ve API şifresi panelden; `NETGSM_HEADER` **onaylı alfanümerik gönderici başlığıdır** (≤ 11 karakter, ör. `YEMEKGELSIN`), Netgsm'den başvurup onaylatılır. Marka başlığı onayı birkaç iş günü sürer (teyit edilmeli) |
| **Maliyet kalemi** | Paket başına SMS kontörü + gönderici başlığı ücreti + (İYS kapsamı dışı olsa da) operatör kuralları. **Birim fiyat teyit edilmeli**; ürün tarafı aylık kotayı plana göre sınırlar: Esnaf 100, Zincir şube başına 300 (`SMS_PLAN_QUOTAS`) |
| **Kota aşımı** | SMS **yine gider**, işletmeye `notifications`'ta ayda bir uyarı düşer; %80'de ön uyarı (`sms_quota_warning` / `sms_quota_exceeded`) |

### Nasıl doğrulanır

1. Canlı açılış günlüğünde `SMS_PROVIDER=mock` uyarısı **artık görünmemeli** (`npx wrangler tail siparisinonunde-dev`).
2. Vitrinde WhatsApp'sız bir sipariş aç: doğrulama ekranında **"WhatsApp'ım yok · SMS ile doğrula"** bağlantısı
   görünüyor olmalı. Bağlantı yoksa kanal hâlâ teslim etmiyor demektir (`smsAvailable=false`).
3. Kod iste → telefona SMS gelmeli. `Admin › İşler`'de `sms.send` işi `done`, `sms_messages` satırı
   `status='sent'` ve `provider='netgsm'` olmalı.
4. **Kanıt ölçütü:** `sms_messages` satırında `provider_message_id` Netgsm'in döndürdüğü görev kimliğidir;
   `mock-sms.` ile başlıyorsa gerçek gönderim olmamıştır.

### Çalışmazsa ne olur

| Arıza | Davranış |
|---|---|
| `SMS_PROVIDER=mock` (bugünkü durum) | Müşteriye SMS yedeği **teklif edilmez**; `/sms-otp` ucu çağrılırsa 409 `sms_unavailable` + "Lütfen işletmeyi arayın". Alarm SMS halkası `sms_unavailable` notuyla atlanır. Uyarı: `sms_provider_mock` |
| Anahtarlar eksik/yanlış (`SMS_PROVIDER=netgsm`) | **Süreç açılmaz**: `productionConfigErrors` "NETGSM_USERCODE, NETGSM_PASSWORD ve NETGSM_HEADER zorunlu" der (fail-fast, 15 §4) |
| Netgsm 30 (yetkisiz) / 40 (başlık tanımsız) | Kalıcı hata: kayıt `failed`, kuyruk yeniden **denemez**, uyarı kanalına iş hatası düşer |
| Netgsm 80 (gönderim sınırı) / ağ hatası / 5xx | Geçici: kuyruk yeniden dener; denemeler biterse `Admin › İşler` (DLQ) |
| `sms_fallback` kill-switch kapalı | OTP ve durum SMS'i gitmez (**alarm SMS'i etkilenmez**); kayıt `failed` + "sms_fallback kapalı" |

### ⚠️ Eray'ın yapacağı adımlar (SMS)

1. Netgsm hesabı aç, API erişimini etkinleştir, `YEMEKGELSIN` başlığını onaylat.
2. GitHub secret'ları: `NETGSM_USERCODE`, `NETGSM_PASSWORD`, `NETGSM_HEADER`
   (`deploy-production.yml` bunları **zaten okuyor**; canlı Cloudflare yolunda henüz okunmuyor — §11).
3. **§11'deki beyaz liste işi yapılmadan secret vermek HİÇBİR ŞEY değiştirmez** (canlı yolda `SMS_PROVIDER`
   koda `'mock'` olarak sabitlenmiştir).
4. Yukarıdaki 4 adımlı doğrulamayı yap ve sonucunu 13 (varsayım ve teyit kaydı) dosyasına yaz.

---

## 3. E-posta

| | |
|---|---|
| **Ne işe yarar** | Bugün **hiçbir akış bağlı değil**; kanal bu turda kuruldu. Bağlanacak akışlar aşağıdaki tabloda |
| **Kod** | Sözleşme `apps/api/src/services/messaging/email-send.ts` → `sendEmail()` · sağlayıcı seçimi `apps/api/src/email/index.ts` → `getEmailProvider()` · adaptörler `apps/api/src/email/providers/{mock,resend}.ts` |
| **Ortam değişkenleri** | `EMAIL_PROVIDER` = `mock` \| `resend` · `EMAIL_FROM` · `EMAIL_REPLY_TO` (isteğe bağlı) · `RESEND_API_KEY` |
| **Nereden alınır** | Resend hesabı → API anahtarı (`re_…`) + **gönderici alan adının doğrulanması**: `yemekgelsin.net` için SPF, DKIM ve (önerilir) DMARC DNS kayıtları. Alan adı Cloudflare Registrar'da aynı hesapta olduğu için kayıtlar Cloudflare DNS'e girilir |
| **Maliyet kalemi** | Aylık e-posta adedine göre paket; düşük hacimde ücretsiz katman yeterli olabilir (**teyit edilmeli**). Alan adı doğrulaması ücretsizdir |
| **Neden HTTP API, SMTP değil** | Canlı ortam Worker + tek container'dır; giden SMTP (25/465/587) bu ortamda güvenilir değil ve yeni bir npm bağımlılığı (nodemailer) ister. HTTP API `fetch` ile çalışır, bağımlılık eklemez |

### Hangi akışlar e-postaya bağlanacak (kod HENÜZ bağlamadı)

| `purpose` | Akış | Alıcı | Niçin e-posta | Dayanak |
|---|---|---|---|---|
| `lead_notice` | Pazarlama sitesindeki demo / hesaplayıcı formu | **biz** (satış adresi) | Talep geldiğini panele bakmadan öğrenmek | 08 §2.8 satır 15 |
| `kvkk_request` | KVKK m.11 başvurusu alındı bilgisi | **başvuran** (ziyaretçi) | Başvurunun alındığı ve 30 günlük süre yazılı olarak bildirilmeli | 08 §2.10; m.13 |
| `password_reset` | Panel kullanıcısının parola sıfırlama bağlantısı | panel kullanıcısı | Tek kanalı WhatsApp olan bir hesap telefonunu kaybederse başka yol kalmıyor | 15 §5 |
| `invoice` | Abonelik faturası / ödeme bildirimi | işletme yetkilisi | Fatura belgesinin işletmeye ulaşması | 08 §6 |
| `ops_test` | Kurulum doğrulaması (elle tek mesaj) | nöbetçi | Kanalın çalıştığını kanıtlamak | bu bölüm |

> **Akışları bağlamak ayrı iştir.** Her satır kendi metnini, ret/şikâyet yolunu ve saklama süresini getirir;
> `kvkk_request` ve `invoice` ayrıca yasal metin gerektirir. Bu turda yalnız kanal kuruldu.
>
> **Yeni bir alt işleyen eklenmesi demektir:** e-posta sağlayıcısı devreye alınmadan **önce** 08 §2.11 aktarım
> envanteri, `/yasal/alt-isleyenler` sayfası (`apps/web/app/(marketing)/yasal/alt-isleyenler/page.tsx`) ve
> aydınlatma metinleri güncellenir; işletmelere **30 gün önceden** bildirilir (08 §2.2 madde 5). Resend ABD
> merkezlidir → **yurt dışı aktarım**, KVKK m.9 (standart sözleşme + Kurum bildirimi).

### Nasıl doğrulanır

1. Canlı açılış günlüğünde `EMAIL_PROVIDER=mock` uyarısı görünmemeli.
2. Tek `ops_test` mesajı gönder (geçici bir admin ucu ya da container içi betik ile `sendEmail` çağır) →
   nöbetçi adrese ulaşmalı.
3. Dönen `providerMessageId` **`mock-email.` ile başlamıyor** olmalı; sağlayıcı panelinde aynı kimlik görünmeli.
4. `notifications` tablosunda `channel='email'` satırı `status='sent'`; `payload.to` **maskeli**
   (`no***@yemekgelsin.net`) olmalı — açık adres görünüyorsa maskeleme kırılmıştır.

### Çalışmazsa ne olur

| Arıza | Davranış |
|---|---|
| `EMAIL_PROVIDER=mock` (bugünkü durum) | `sendEmail` → `{status:'skipped', reason:'provider_not_deliverable'}`; `log.error` + uyarı `email_not_configured` (saatte bir). Tenant'a ait mesajda `notifications` satırı `failed`. **Sessizce "gönderildi" DÖNMEZ** |
| `EMAIL_PROVIDER=resend`, anahtar/gönderici eksik | **Süreç açılmaz**: `productionConfigErrors` "RESEND_API_KEY ve EMAIL_FROM zorunlu" (fail-fast) |
| Alan adı doğrulanmamış (401/403/422) | Kalıcı hata: kayıt `failed`, yeniden denenmez, uyarı `email_send_failed` |
| 429 / 5xx / ağ | Geçici: kuyruktan çağrıldığında yeniden denenir; son denemede `failed` + uyarı |
| 200 ama mesaj kimliği yok | **Başarı sayılmaz** (`no_id`, geçici): kimliksiz "gönderildi" taklit sağlayıcının yalanının başka biçimidir |

### ⚠️ Eray'ın yapacağı adımlar (e-posta)

1. Sağlayıcı seç (Resend varsayılan; Postmark / Brevo / AWS SES de tek `POST /emails` çağrısıdır — yalnız
   `apps/api/src/email/providers/` altına ikinci bir dosya yazılır, sözleşme değişmez).
2. Hesap aç, API anahtarı üret, `yemekgelsin.net` için SPF + DKIM (+ DMARC) kayıtlarını Cloudflare DNS'e gir,
   alan adını doğrulat.
3. **08 §2.11 + `/yasal/alt-isleyenler` + aydınlatma metinleri** güncellenmeden kanalı açma (yukarıdaki not).
4. Worker secret'ları: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, (isteğe bağlı) `EMAIL_REPLY_TO`.
5. **§11'deki beyaz liste işi** yapılmadan bu secret'lar container'a ulaşmaz.
6. Doğrulamanın 4 adımını yap.

---

## 4. Cloudflare

| | |
|---|---|
| **Ne işe yarar** | Worker (`siparisinonunde-dev`) istekleri yönlendirir ve container'ı uyanık tutar; **tek container** PostgreSQL + API + worker + web'i çalıştırır; **R2** (`siparisinonunde-dev-yedek`) veritabanı ve görsel yedeklerini tutar; DNS, CDN, TLS ve alan adı kaydı (Registrar) aynı hesapta |
| **Kod / yapılandırma** | `deploy/cloudflare/wrangler.jsonc` · `deploy/cloudflare/src/` · `deploy/cloudflare/entrypoint.sh` · `.github/workflows/deploy-dev-cloudflare.yml` |
| **Ortam değişkenleri** | Dağıtım: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (GitHub secret'ları). Çalışma zamanı: `wrangler.jsonc` `vars` + Worker secret'ları (`npx wrangler secret put …`) |
| **API token yetkileri** | Workers Scripts: Edit · Workers R2 Storage: Edit · Account Settings: Read · Zone > Workers Routes: Edit · Zone > Zone: Read (özel alan adı için) · **Logs: Write** (§8 Logpush için eklenir) |
| **Maliyet kalemleri** | Workers Paid (container ve Workers Logpush için gerekir) · Container çalışma süresi (`instance_type: basic` = 1/4 vCPU, 1 GiB, 4 GB disk; `max_instances: 1`) · R2 depolama + işlem · Logpush dışa aktarma (§8) · alan adı yenileme. Güncel oranlar: `developers.cloudflare.com/workers/platform/pricing`, `/r2/pricing`, `/logs/logpush/pricing` (**teyit edilmeli**) |
| **Nasıl doğrulanır** | `GET /api/v1/health` → `{"ok":true,"db":"up"}` · `GET /api/v1/health/worker` → `degraded:false`, `warnings:[]`, `lastBackupAgeSec` **sayı** · R2 > kovada `e3/db/son.dump` tazeleniyor · `npx wrangler tail siparisinonunde-dev` |
| **Çalışmazsa** | Container açılamazsa Worker bekleme sayfası gösterir ve webhook'ları tamponlar (15 §13); 5 dk'lık uyanık tutma turu `container_baslatilamadi` uyarısı gönderir. R2 yazılamazsa yedek zinciri durur → `backup_stale` / `yedek_eskidi` (15 §10) |

---

## 5. Uyarı kanalı — `ALERT_WEBHOOK_URL`

| | |
|---|---|
| **Ne işe yarar** | Operasyon uyarılarının gittiği **tek** dış kanal: kalıcı iş hatası, takılı iş, DLQ eşiği, yedek eskimesi, disk/bellek eşiği, alarm zinciri eksikliği, imza/numara uyuşmazlığı, yasal metin kapısı, canary — **ve bu turda eklenen `sms_provider_mock`, `email_not_configured`, `email_send_failed`** |
| **Kod** | `apps/api/src/lib/alert.ts` (`alert()` / `sendAlert()`) · Worker tarafı `deploy/cloudflare/src/alert.ts` · **türlerin tamamı ve her biri için ilk 5 dakika: [17](17-olay-mudahale-runbook.md) §1** (burada kopyası tutulmaz) |
| **Ortam değişkenleri** | `ALERT_WEBHOOK_URL` (yalnız `http`/`https`) · `ALERT_MIN_SEVERITY` = `info` \| `warning` \| `critical` (varsayılan `warning`) |
| **Nereden alınır** | Bir **alıcı kanal** gerekir: Telegram bot ucu, Slack/Discord webhook'u, Better Stack ya da kendi uç noktamız. Sağlayıcı adresi verir, `openssl` gerekmez |
| **Gövde** | `POST`, JSON: `{service, env, kind, severity, message, data, at}`; 5 sn zaman aşımı; aynı uyarı için 10 dk soğuma (bellekte) |
| **Kişisel veri** | Gönderilmez: uzun rakam dizileri maskelenir, metinler kırpılır, en çok 20 alan (`scrubText` / `scrubData`) |
| **Maliyet kalemi** | Telegram/Slack/Discord webhook'u ücretsiz; Better Stack benzeri servis abonelik ister (**teyit edilmeli**) |
| **Nasıl doğrulanır** | Kanalı bağla, sonra bilerek bir uyarı üret: en kolayı eşik testi (`HEALTH_MAX_BACKUP_AGE_SEC` düşürülüp `/health/worker` yoklanır) ya da bu turdan sonra **SMS/e-posta hâlâ mock olduğu için ilk `sms.send`/`sendEmail` çağrısı zaten uyarı üretir** |
| **Çalışmazsa** | **Uygulama çalışmaya devam eder**, uyarılar yalnız günlüğe yazılır. 17 §1'deki tablonun **hiçbir satırı tetiklenmez**: arızayı yalnız `wrangler tail`'de görürsün. Bu yüzden 17 §1'de **E-1** ilk kurulum adımıdır |

⚠️ **Eray'ın yapacağı adım:** bir alıcı kanal aç ve `npx wrangler secret put ALERT_WEBHOOK_URL`.
`ALERT_WEBHOOK_URL` ve `ALERT_MIN_SEVERITY` container beyaz listesinde **zaten vardır** (§11 işi bunlar için
gerekmez) ve bu turda `apps/api/src/config.ts` şemasına da eklendi: geçersiz bir adres artık açılışta yakalanır,
çalışma anında sessizce yok sayılmaz.

---

## 6. WhatsApp iş çözümü sağlayıcısı — Twilio ya da 360dialog

> Adaptörün iç ayrıntısı ve kurulum ekranları: [16](16-twilio-whatsapp.md) ve 15 §6.2. Burada yalnız
> "hangi değişken, nereden, çalışmazsa ne olur" satırları var.

| | |
|---|---|
| **Ne işe yarar** | **Ortak numaranın** (00 §12a madde 8) mesaj iletimi: gönderim, gelen mesaj ve teslim durumu webhook'ları, şablon onayı. Üç yol: `twilio` (varsayılan), `d360` (360dialog), `cloud` (Meta'ya doğrudan) |
| **Kod** | `apps/api/src/wa/providers/{twilio,d360,graph,mock}.ts` · seçim `apps/api/src/wa/registry.ts` · Worker tarafı ortam kurulumu `deploy/cloudflare/src/whatsapp-env.ts` |
| **Ortam değişkenleri** | `PLATFORM_WA_PROVIDER` = `mock` \| `cloud` \| `d360` \| `twilio` · `PLATFORM_WA_API_KEY` · `PLATFORM_WA_PHONE_NUMBER_ID` (**twilio'da Twilio Account SID**, `AC` + 32 onaltılık; cloud'da Graph `phone_number_id`) · `PLATFORM_WA_WABA_ID` (yalnız cloud, isteğe bağlı) · `PLATFORM_WA_DISPLAY_PHONE` (E.164) · `PLATFORM_WA_WEBHOOK_TOKEN` · `WA_APP_SECRET` (cloud'da **zorunlu**) · `WA_VERIFY_TOKEN` |
| **GitHub secret adları** | Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` · 360dialog: `D360_API_KEY` · Meta: `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_WABA_ID`, `META_APP_SECRET` · ortak: `WA_PHONE` |
| **Nereden alınır** | Twilio Console > Account Info (SID + Auth Token) ve WhatsApp Sender kaydı · 360dialog panelinden API anahtarı · Meta için Business hesabı + uygulama + numara doğrulaması |
| **Maliyet kalemleri** | Meta'nın oturum/şablon ücretleri + sağlayıcı aylık ücreti/mesaj payı. Aylık ücretsiz oturum tavanı `WABA_CONVERSATION_CAP` ile sınırlanır; tavana yaklaşınca `WABA_SHED_NONCRITICAL=1` önemsiz durum mesajlarını düşürür (sipariş mesajları düşmez). **Birim fiyatlar teyit edilmeli** |
| **Nasıl doğrulanır** | `Admin › WhatsApp` ortak numara kartında "son webhook" taze · `WhatsApp kurulumu › Bağlantıyı test et` · webhook doğrulaması: `curl -i "https://yemekgelsin.net/api/v1/webhooks/wa/shared/<belirteç>?hub.mode=subscribe&hub.verify_token=<WA_VERIFY_TOKEN>&hub.challenge=42"` → `42` |
| **Çalışmazsa** | `mock`: ortak numara kapalı — vitrinde/QR'da WhatsApp bağlantısı gösterilmez, alarm zincirinin 2 dk halkası `platform_wa_unavailable` notuyla atlanır (gitmiş gibi kaydedilmez). Eksik anahtar: **süreç açılmaz** (`productionConfigErrors`). Token/ödeme hatası hesabı `error`'a çeker, işletme WhatsApp'sız moda düşer (bu da SMS'e bağlıdır → §2) |

---

## 7. Harita ve döşemeler

| | OpenFreeMap | Google Haritalar bağlantısı |
|---|---|---|
| **Ne işe yarar** | Panelde şube konumu ve teslimat bölgelerinin haritada gösterilmesi | Teslimat adresini yol tarifi için harita uygulamasında açmak |
| **Kod** | `apps/web/components/settings/map/use-maplibre.ts` → `MAP_STYLE_URL = https://tiles.openfreemap.org/styles/liberty` (MapLibre GL tarayıcıda dinamik yüklenir) | `apps/web/components/orders/labels.ts` → `https://www.google.com/maps/search/?api=1&query=…` |
| **Ortam değişkeni / anahtar** | **Yok** — anahtarsız, hesap gerekmez | **Yok** — yalnız bağlantı; Google Maps Platform API'si çağrılmaz, anahtar tutulmaz |
| **Maliyet kalemi** | **Yok** (OpenFreeMap ücretsiz; harita verisi OpenStreetMap katkıcılarınındır — atıf gösterilmeli) | **Yok** |
| **Kişisel veri** | Müşteri verisi gönderilmez; servis yalnız paneli kullanan kişinin IP'sini ve istenen döşemeleri görür | Aktarım **yalnız personel/kurye tıklayınca** doğar ve o siparişin adresiyle sınırlıdır; otomatik istek gitmez |
| **Çalışmazsa** | Harita boş kalır (WebGL yok ya da stil yüklenmezse bileşen zarifçe düşer); bölge çizimi elle koordinat girmeye kalır | Bağlantı açılmaz; adres metni panelde ve fişte yazılı kaldığı için operasyon durmaz |
| **Alternatif gerekirse** | Anahtarlı bir döşeme servisine (MapTiler vb.) geçmek **yeni bir alt işleyen** demektir: 08 §2.11 + `/yasal/alt-isleyenler` + 30 gün bildirim | — |

---

## 8. 5651 trafik ve erişim kaydı — **KOD İŞİ DEĞİL, YAPILANDIRMA İŞİ**

### Bugünkü gerçek durum

İşletme içeriğini (menü, fotoğraf) barındırdığımız için **yer sağlayıcı** sayılabiliriz; 5651 m.5 trafik
bilgisinin saklanmasını ister (süre 1–2 yıl aralığında [O], kesin süre **teyit edilmeli**).

**Canlı ortamda hiçbir erişim kaydı tutulmuyor.** 15 §10'daki "Caddy erişim logları, 366 gün" satırı **yalnız
isteğe bağlı Türkiye VPS yolu** içindir: canlı ortam Cloudflare container'ıdır ve o imajda Caddy **yoktur**
(`deploy/cloudflare/Dockerfile`). Yani:

- Uygulama günlüğü (`wrangler tail`) kalıcı değildir ve trafik kaydı değildir.
- `retention.access_logs` işi **trafik kaydı tutmaz**: sipariş onayındaki ve belge kabulündeki IP/tarayıcı
  alanını 1 yıl sonra **boşaltır** (08 §2.8 satır 10 uygulama notu). Ayrı bir yükümlülüktür.

### Çözüm: Cloudflare Logpush → R2

Logpush, Cloudflare kenarından geçen her isteği seçilen alanlarla bir hedefe yazar; R2 **iç hedef** sayılır.
(2026-09-30'dan beri Free/Pro/Business/Enterprise planlarında kullanım bazlı; Workers Trace Events ayrı
fiyatlanır.)

**Adım adım:**

1. **Ayrı bir R2 kovası aç** — ör. `yemekgelsin-erisim-kaydi`. Yedek kovasına (`siparisinonunde-dev-yedek`)
   **karıştırma**: yedeklerin saklama süresi 35 gün, erişim kaydının 1 yıldır; aynı kovada tek bir yaşam döngüsü
   kuralı ikisinden birini bozar.
2. **R2 API token'ı üret** (R2 > API tokens): Logpush'un yazması için Access Key ID + Secret Access Key.
3. **Logpush işi oluştur** — Cloudflare dashboard > (zone) Logpush > Create a Logpush job > **R2 Object Storage**,
   dataset **`http_requests`**, "Organize logs into daily subfolders" **açık**. API ile karşılığı:
   `destination_conf: "r2://<kova>/<yol>/{DATE}?account-id=…&access-key-id=…&secret-access-key=…"`,
   `dataset: "http_requests"`.
4. **Alanları SEÇ (maskeleme burada başlar).** Varsayılanı olduğu gibi kabul etme: 5651 için gereken asgari
   alanlar zaman damgası, kaynak IP, istenen kaynak, yöntem, yanıt kodu ve boyuttur. Önerilen küme:
   `EdgeStartTimestamp`, `EdgeEndTimestamp`, `ClientIP`, `ClientRequestHost`, `ClientRequestMethod`,
   `ClientRequestURI`, `EdgeResponseStatus`, `EdgeResponseBytes`, `RayID`.
   **Bilerek DIŞARIDA bırakılacaklar:** çerezler, `Authorization` ve istek/yanıt başlıkları, `ClientRequestUserAgent`
   gerekmiyorsa o da (parmak izi alanıdır).
5. **Belirteçleri maskele.** `ClientRequestURI` yoldaki gizli belirteçleri taşır: takip linki (`/t/<token>`),
   ortak webhook yolu (`/api/v1/webhooks/wa/shared/<belirteç>`), kurye girişi (`?t=`). Caddy yolunda bunlar `***`
   yazılıyordu; Logpush'ta karşılığı **Transformers**'tır (SQL ile alan maskeleme/süzme; 2026-09-30'da genel
   kullanıma açıldı). Belirteç maskelenmezse **log dosyası oturum açma anahtarına dönüşür** — bu kuralın sebebi
   budur, isteğe bağlı değildir.
6. **1 yıl saklama:** kovaya yaşam döngüsü kuralı koy —
   `npx wrangler r2 bucket lifecycle add yemekgelsin-erisim-kaydi 5651-bir-yil <önek> --expire-days 366`
   (366: artık yılı da kapsar; 15 §10'daki Caddy süresiyle aynı).
7. **Bütünlük (isteğe bağlı ama önerilir):** `npx wrangler r2 bucket lock add … --retention-days 366` ile kaydı
   silinemez/üzerine yazılamaz yap. 5651'de kaydın **değiştirilmemiş** olması delil değeri için önemlidir.
8. **Doğrula:** 1–2 saat sonra kovada `{DATE}` klasörü ve dosyalar görünmeli. Bir dosya indirip kontrol et:
   (a) satır sayısı trafikle makul mü, (b) **belirteç içeren bir URI maskeli mi**, (c) çerez/başlık alanı var mı
   (olmamalı). Bu üç kontrol yapılmadan iş "tamam" sayılmaz.
9. **Dokümanı güncelle:** 08 §2.8 satır 10'un yöntem hücresi ve §4.7, kurulumdan sonra "kurulu" olarak
   düzeltilir (bu turda "kurulmadı" olarak gerçeğe uyduruldu).

**Maliyet kalemleri:** Logpush iç hedef dışa aktarma — hesap başına **25 GB/ay dahil**, sonrası **GB başına
$0,03**; Transformers — **1 GB/ay dahil**, sonrası **GB başına $0,04**; ayrıca R2 depolama ve işlem ücreti
(`developers.cloudflare.com/r2/pricing`). Pilot trafiğinde dahil kotanın altında kalması beklenir
(**ilk ay ölçülerek teyit edilmeli**). API token'ına **Logs: Write** yetkisi eklenmelidir.

**Yapılmazsa ne olur:** yer sağlayıcı yükümlülüğü karşılanmaz; bir içerik şikâyeti ya da adli talepte trafik
kaydı sunulamaz. Ayrıca bir güvenlik olayında "kim, ne zaman, neye erişti" sorusunun cevabı yoktur — 08 §2.9'un
"T0 + 4 saat etki analizi" adımı erişim loglarına dayanır.

---

## 9. PITR (saniye hassasiyetinde geri dönüş) — **KOD İŞİ DEĞİL, İŞLETME KARARI**

### Bugünkü gerçek durum

Dayanıklılık **tek bir `pg_dump` zincirine** bağlıdır: `deploy/cloudflare/entrypoint.sh` 2 dakikada bir
(değişiklik varsa) ve kapanışta R2'ye döküm yazar; container her açılışta son dökümü geri yükler. Yani:

- **Kurtarma noktası hedefi (RPO) ≈ 2 dakika, en kötü hâlde daha fazla.** Son dökümden sonraki siparişler
  geri dönüşte **kaybolur**.
- **PITR yoktur.** "Dün 14:35'e dön" denemez; yalnız `son.dump` ve 7 günlük gece kopyaları vardır.
- 08 §2.8 satır 17'nin "Yedekler (PITR), 35 gün rotasyon" ifadesi **gerçeği yansıtmıyordu**; bu turda düzeltildi.

### Seçenekler

| Seçenek | Nasıl | RPO | Karmaşıklık | Maliyet kalemi | Not |
|---|---|---|---|---|---|
| **A. Bugünkü hâli iyileştir** (döküm sıklığı + kopya sayısı) | `entrypoint.sh` tur süresini düşür, gece kopyası sayısını artır | Dakikalar | **Düşük** (var olan zincir) | Yalnız R2 depolama/işlem | PITR **değildir**; 2 dk'lık kaybı 1 dk'ya indirir, sorunun sınıfını değiştirmez |
| **B. WAL arşivleme — pgBackRest ya da WAL-G → R2** | Container'a araç eklenir, R2'nin S3 uyumlu ucuna WAL gönderir; tam yedek + sürekli WAL | **Saniyeler** | **Yüksek**: container'a ikinci bir süreç, R2 S3 kimlik bilgileri, geri yükleme tatbikatı, disk tamponu (1 GiB / 4 GB disk sınırı!) | R2 depolama + işlem (WAL çok küçük nesne üretir → **işlem** ücreti depolamadan baskın olabilir) | 15 §8'de "pilot öncesi zorunlu paket"in parçası diye yazılı. **Risk:** tek container'da PostgreSQL'in yanına ikinci bir yazıcı koymak açılış sırasını ve "yarım geri yükleme" korumasını karmaşıklaştırır |
| **C. Yönetilen PostgreSQL'e taşı** (PITR sağlayıcıda) | Veritabanı container'dan çıkar, dış servise taşınır; container yalnız API + worker + web çalıştırır | **Saniyeler** (sağlayıcının taahhüdü) | **Orta**: kod değişikliği yok (`DATABASE_URL`), ama ağ gecikmesi, bağlantı havuzu ve **yeni bir alt işleyen** gelir | Aylık abonelik + çıkış trafiği | **KVKK etkisi:** yeni yurt dışı alt işleyen → 08 §2.11 + `/yasal/alt-isleyenler` + m.9 standart sözleşme + 30 gün bildirim. Konum Türkiye/AB seçilebilirse aktarım yükü azalır |
| **D. PITR'ı bilinçli ERTELE** | Karar yazılır, RPO ≈ 2 dk kabul edilir | 2 dk | **Sıfır** | Yok | **Yalnız yazılı kabulle:** 08 §2.8 satır 17 ve DPA eki (08 §2.2 madde 3) "PITR" demeye devam ederse **işletmeye yanlış taahhüt** verilmiş olur. Bu turda o satırlar gerçeğe uyduruldu |

### Öneri ve karar sırası

1. **Önce ölç:** aylık sipariş hacminde 2 dakikalık kayıp kaç sipariştir? Pilotta (Yozgat/Merkez) bu sayı küçükse
   **D** (yazılı kabul) + **A** (turu sıklaştır) pilot boyunca yeterlidir.
2. **Pilot büyüdüğünde C'yi B'ye tercih et:** 1 GiB bellek / 4 GB diskli tek container'da WAL arşivleme işletilmesi
   zor bir yoldur ve "yarım geri yükleme" korumasının (15 §13) yanına ikinci bir arıza sınıfı ekler. Yönetilen
   veritabanı aynı RPO'yu bakım yükü olmadan verir; bedeli bir alt işleyen ve aylık ücrettir.
3. **Hangisi seçilirse seçilsin: aylık geri yükleme tatbikatı.** Hiç denenmemiş bir yedek yedek değildir; tarih ve
   sonuç 13 (varsayım ve teyit kaydı) dosyasına yazılır.

⚠️ **Eray'ın yapacağı adım:** A–D arasından **birini seç ve 00 §12a'ya karar olarak yaz.** Seçim yapılmadığı
sürece yürürlükteki durum D'dir (RPO ≈ 2 dk) ve bunun yazılı kabulü yoktur.

---

## 10. ⚠️ Eray'ın yapacağı adımlar — tek liste

| # | Adım | Bağımlı olan | Bölüm |
|---|---|---|---|
| 1 | `ALERT_WEBHOOK_URL`'e bir alıcı kanal bağla | 17 §1'deki **tüm** uyarılar; aşağıdaki adımların doğrulanması | §5 |
| 2 | **Beyaz liste işini yap** (`deploy/cloudflare/src/mode.ts`) | 3 ve 4 numaralı adımlar **buna bağlıdır** | §11 |
| 3 | Netgsm hesabı + başlık onayı + 3 secret | SMS yedeği, 5 dk alarm halkası | §2 |
| 4 | E-posta sağlayıcısı + alan adı doğrulaması + 3 secret (**önce** 08 §2.11 ve yasal metinler) | Lead, KVKK, parola sıfırlama, fatura akışları | §3 |
| 5 | WhatsApp iş çözümü sağlayıcısı sözleşmesi + secret'lar | Ortak numara, 2 dk alarm halkası | §6 |
| 6 | Logpush → R2 kur (ayrı kova, alan seçimi, maskeleme, 366 gün, kilit) | 5651 yer sağlayıcı yükümlülüğü | §8 |
| 7 | PITR için A–D'den birini seç ve 00 §12a'ya yaz | Dayanıklılık taahhüdü, DPA eki | §9 |
| 8 | Her adımın doğrulama sonucunu 13 (varsayım ve teyit kaydı) dosyasına yaz | — | — |

**Sıra önemlidir:** 1 olmadan diğerlerinin arızası sana ulaşmaz; 2 olmadan 3 ve 4 için verilen secret'lar
**hiçbir şey değiştirmez**.

---

## 11. DIŞ BAĞIMLILIK — canlı yolda SMS ve e-posta değişkenleri container'a ULAŞMIYOR

> **Bu bölüm bir arıza kaydıdır.** §2 ve §3'teki secret'ları vermek, aşağıdaki iki düzeltme yapılmadan
> **hiçbir şeyi değiştirmez.** Değişiklik `deploy/cloudflare/` altındadır ve bu turda **bilerek yapılmadı**
> (sahiplik alanı dışı; ayrıca kendi beyaz liste kapısı testi var).

**1) `SMS_PROVIDER` koda sabitlenmiş.** `deploy/cloudflare/src/mode.ts:184`:

```ts
SMS_PROVIDER: 'mock',
```

Bu satır `passthroughEnv(env)`'den **sonra** yazıldığı için hiçbir `vars` ya da secret onu ezemez. Canlı ortamda
SMS sağlayıcısı **her koşulda** taklittir.

**2) Beyaz liste kapalıdır.** `deploy/cloudflare/src/mode.ts:106` → `PASSTHROUGH_KEYS` bir **kapalı** listedir:
orada yazmayan hiçbir Worker değişkeni container'a geçmez. Listede `NETGSM_*`, `EMAIL_PROVIDER`, `EMAIL_FROM`,
`EMAIL_REPLY_TO`, `RESEND_API_KEY` **yoktur**. (`ALERT_WEBHOOK_URL` ve `ALERT_MIN_SEVERITY` vardır.)

Dosyanın kendi yorumu bu sapmanın geçmişini anlatıyor: künye, canary ve WhatsApp kotası değişkenleri de tam bu
yüzden canlıda hiç devreye girmemişti.

### Yapılacak düzeltme (sahibi: `deploy/cloudflare/`)

1. `ContainerInputs`'a `SMS_PROVIDER`, `NETGSM_USERCODE`, `NETGSM_PASSWORD`, `NETGSM_HEADER`, `EMAIL_PROVIDER`,
   `EMAIL_FROM`, `EMAIL_REPLY_TO`, `RESEND_API_KEY` alanlarını ekle.
2. `SMS_PROVIDER: 'mock'` sabitini kaldır. **Düz passthrough YETMEZ**, çünkü `devToolsAllowed()` gizli
   staging'de WhatsApp simülatörüne yalnız **tüm sağlayıcılar mock iken** izin verir: gerçek bir SMS sağlayıcısı
   staging'e sızarsa simülatör kapanır. Doğru şekil `whatsapp-env.ts` ile aynıdır — kipe duyarlı bir türetme:
   *staging → her zaman `mock`; domain → üçü (usercode/password/header) **tamsa** `netgsm`, aksi halde `mock`.*
   Yarım yapılandırma `netgsm` seçerse `productionConfigErrors` container'ı hiç açmaz; bu yüzden karar
   "üçü tamsa" olmalıdır (iş akışının `deploy-production.yml:469`'daki özet satırı da aynı kuralı anlatıyor).
3. `EMAIL_PROVIDER` için aynı şekil: domain'de `RESEND_API_KEY` + `EMAIL_FROM` tamsa `resend`, aksi halde `mock`.
4. `deploy/cloudflare/scripts/mode.test.mjs` içindeki `SCOPE_OUT` listesinden ilgili satırları **sil**
   (`NETGSM_*` ve bu turda eklenen `EMAIL_*` / `RESEND_API_KEY`) ve yeni türetmeyi sınayan vakalar yaz:
   staging'de her zaman mock, domain'de yarım yapılandırmada mock, tam yapılandırmada gerçek sağlayıcı.
5. `.github/workflows/deploy-dev-cloudflare.yml`'e secret'ları ekle (`deploy-production.yml` `NETGSM_*`'ı
   zaten okuyor; canlı Cloudflare yolu okumuyor).

**Doğrulama:** `cd deploy/cloudflare && npm test` → beyaz liste kapısı yeşil; sonra dağıtım sonrası
`npx wrangler tail siparisinonunde-dev` açılış günlüğünde `SMS_PROVIDER=mock` uyarısının **kaybolması**.
