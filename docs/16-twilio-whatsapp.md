# 16 — Twilio WhatsApp Adaptörü (üçüncü sağlayıcı yolu)

> Bu doküman `docs/02-whatsapp-entegrasyonu.md` (mesaj tasarımı, şablonlar, pencere kuralları) ve
> `docs/15-kurulum-ve-isletim.md` §6 (bağlama adımları) ile birlikte okunur. Bağlayıcı kararlar
> `docs/00-kararlar-ve-sozluk.md`'dedir. Burada yalnız **Twilio** yolunun gereksinimleri, sözleşmesi ve
> sınırları yazılıdır.

## 1. Neden

Ortak numara (00 §12a madde 8) bugüne kadar iki yoldan bağlanabiliyordu: **360dialog** (varsayılan) ve
**Meta Cloud API doğrudan**. Twilio üçüncü yoldur ve şu durumlarda seçilir:

| Ölçüt | 360dialog | Meta doğrudan | **Twilio** |
|---|---|---|---|
| Aylık sabit ücret | ~49 €/numara | yok | **yok** |
| Mesaj başı aracı payı | yok | yok | **0,005 $ (gelen + giden)** |
| Meta ücreti | geçişli | doğrudan | geçişli |
| Numara doğrulaması | 360dialog Hub | Meta | **Twilio Console (sesli arama ile doğrulanabilir)** |
| Başabaş noktası | — | — | **~10.000 mesaj/ay** (altında Twilio ucuz) |

Karar (28.09.2026): düşük hacimde (ayda 10.000 mesajın altı) Twilio, yüksek hacimde 360dialog. Kod her iki
yolu da taşır; seçim **yalnız GitHub secret'larıyla** yapılır, kod değişmez.

**Yalnız ortak numara:** Twilio yalnız platformun ortak numarasının (`PLATFORM_WA_PROVIDER`) yoludur. İşletmenin
kendi numarası (panel "WhatsApp bağlantısı", `WA_OWN_PROVIDERS`, `WA_DEFAULT_PROVIDER`) Twilio seçemez: içerik
kaynakları (`wa_content_templates`), durum geri bildirimi adresi ve webhook imzası tek platform hesabına bağlıdır.

**KVKK:** Twilio Inc. (ABD) yurt dışı alt işleyendir; 08 §2.11 envanterinde ve aydınlatma metinlerinde adıyla yazılıdır
(değişmez kural 7). Kurul standart sözleşmesi ve 5 iş günü içinde Kurum bildirimi proje sahibinin yapılacaklarıdır.

**Değişmez kural 1 korunur:** Twilio, Meta'nın resmî BSP'sidir (Business Solution Provider). Resmî olmayan
kütüphane (Baileys, whatsapp-web.js, Evolution API) hiçbir koşulda eklenmez.

## 2. Sağlayıcı sözleşmesi

Twilio'nun API'si Cloud API'ye **uymaz**; `providers/graph.ts` çekirdeği kullanılamaz. Ayrı bir sağlayıcı
yazılır (`apps/api/src/wa/providers/twilio.ts`) ve `WhatsAppProvider` arayüzünü aynen karşılar.

### 2.1 Gönderim

```
POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
Authorization: Basic base64(AccountSid:AuthToken)
Content-Type:  application/x-www-form-urlencoded
```

| Alan | Değer |
|---|---|
| `From` | `whatsapp:+18509099295` (ortak numara, `PLATFORM_WA_DISPLAY_PHONE`) |
| `To` | `whatsapp:+90…` (E.164) |
| `Body` | düz metin (≤ 1.600 karakter) |
| `ContentSid` | etkileşimli ve şablon mesajlarda (`HX…`) |
| `ContentVariables` | `{"1":"…","2":"…"}` JSON dizgesi |
| `StatusCallback` | ortak webhook adresi (durum geri bildirimi) |

Yanıt: `{ "sid": "SM…"/"MM…", "status": "queued", … }` → `sid` **wamid** olarak saklanır.

Hata: `{ "code": 63016, "message": "…", "more_info": "…", "status": 400 }`.

### 2.2 Alıcı alanı

Twilio **BSUID desteklemez**; alıcı yalnız telefondur. `WaRecipient.phone` yoksa gönderim
`no_recipient` ile kalıcı başarısızdır (`WaSendError`, `retryable: false`).

### 2.3 Etkileşimli mesajlar (buton / liste)

Twilio serbest JSON etkileşimli gövde almaz; **Content API** kaynağı ister. Twilio belgesi:
`twilio/quick-reply` ve `twilio/list-picker` **gelen mesaja yanıt olarak (24 saatlik oturum içinde)
WhatsApp onayı olmadan** gönderilebilir, ve değişkenler (`{{n}}`) hem `title` hem `id` alanında
kullanılabilir.

Bu yüzden **her mesaj için içerik kaynağı üretilmez**. Bunun yerine sabit, sınırlı bir katalog bir kez
üretilir ve `wa_content_templates` tablosunda önbelleklenir:

| Friendly name | Tür | Değişkenler |
|---|---|---|
| `yg_qr1` … `yg_qr3` | `twilio/quick-reply` | `{{1}}` gövde; her buton için başlık + kimlik |
| `yg_list1` … `yg_list10` | `twilio/list-picker` | `{{1}}` gövde, `{{2}}` düğme; her satır için başlık + kimlik + açıklama |

Üretim tembeldir (ilk kullanımda), idempotenttir (tabloda `friendly_name` UNIQUE) ve sonuç `HX…`
kaynak kimliği olarak saklanır.

**Kasıtlı indirgemeler** (Twilio'da karşılığı yok; mesaj kaybolmaz, biçim sadeleşir):

| Cloud API | Twilio karşılığı |
|---|---|
| `header` / `footer` | gövdenin ilk/son satırına yazılır (ortak numarada dükkan adı korunur) |
| `cta_url` | düz metin + bağlantı (WhatsApp bağlantıyı kendisi tıklanır yapar) |
| `location_request` | düz metin: konum gönderme isteği yazıyla açıklanır |
| liste bölümleri (`sections`) | tek listeye düzleştirilir; bölüm başlığı satır açıklamasına eklenir |

### 2.4 Şablonlar (pencere dışı, işletme başlatmalı)

`WA_TEMPLATE_CATALOG`'daki her şablon Twilio'da bir Content kaynağıdır:

1. `POST https://content.twilio.com/v1/Content` — `friendly_name` = şablon adı, `language` = `tr`,
   tür: butonsuz şablonda `twilio/text`, URL butonlu şablonda `twilio/call-to-action`,
   hızlı yanıt butonlu şablonda `twilio/quick-reply`.
2. `POST https://content.twilio.com/v1/Content/{sid}/ApprovalRequests/whatsapp` — `name` + `category`
   (`UTILITY` / `MARKETING` / `AUTHENTICATION`) ile WhatsApp onayına gönderilir.
3. Durum: `GET https://content.twilio.com/v1/ContentAndApprovals` → `approval_requests.status`
   (`approved` / `pending` / `rejected` / `unsubmitted`).

Gönderimde şablon adı → `ContentSid`, parametreler → `ContentVariables`.

- **Yarıda kalan onay:** içerik oluşup onay isteği başarısız olduysa durum `unsubmitted` (ekranda "Onaya gönderilmedi")
  görünür; "Şablonları gönder" içeriği yeniden üretmez, yalnız onay isteğini tekrar gönderir.
- **Bayat kimlik:** Twilio `ContentSid`'i bulamazsa (21655, 20404 ya da şablon hatası; ör. kaynak Console'dan silinip
  aynı adla yeniden üretildi) kimlik bellekten ve `wa_content_templates`'ten silinir; sonraki gönderim adı Twilio'da
  yeniden arar. Bulunamayan şablon adı 5 dakika hatırlanır (her gönderim listeyi baştan sayfalamaz).

### 2.5 Webhook

Twilio **JSON değil `application/x-www-form-urlencoded`** gönderir ve Meta'nın
`X-Hub-Signature-256` imzasını **göndermez**.

| Yön | Alanlar |
|---|---|
| Gelen mesaj | `MessageSid`, `From` (`whatsapp:+90…`), `To`, `Body`, `ProfileName`, `WaId`, `NumMedia`, `MediaUrl{N}`, `MediaContentType{N}`, `Latitude`, `Longitude`, `Address`, `Label`, `ButtonText`, `ButtonPayload`, `ListId`, `ListTitle`, `OriginalRepliedMessageSid` |
| Durum | `MessageSid`, `MessageStatus`, `ErrorCode` |

Durum eşlemesi: `sent`/`sending`/`queued`/`accepted` → `sent`; `delivered` → `delivered`;
`read` → `read`; `failed`/`undelivered`/`canceled` → `failed`.

**İmza:** `X-Twilio-Signature` = base64(HMAC-SHA1(AuthToken, tam URL + alfabetik sıralı `ad+değer`
çiftleri)). Doğrulama zorunludur; `PLATFORM_WA_API_KEY` (Auth Token) ile yapılır. Geçersizse 401.

Ham gövde `wa_webhook_events.payload` sütununa **düz nesne** olarak yazılır (form alanları
anahtar → değer); ayrıştırma `twilio-parse.ts`'tedir.

### 2.6 Hata eşlemesi

Twilio hata kodları Meta kodlarına çevrilir; `wa/errors.ts` sınıflandırması değişmeden çalışır:

| Twilio | Anlam | Davranış |
|---|---|---|
| `63016` | 24 saat penceresi kapalı, serbest mesaj | `131047` → şablona düş |
| `63003`, `63024` | alıcı bulunamadı / geçersiz numara | `131026` → teslim edilemez |
| `20003`, `20005` | kimlik doğrulama başarısız / hesap askıda | `190` → hesap duraklar. **Ortak numarada** (platformun numarası) işletmenin satırı duraklatılmaz ama `shared_wa_account_error` **kritik** operasyon uyarısı gider (`services/messaging/shared-router.ts` `performSharedSend`; denetim H8). Anahtar bozulduğunda tüm ortak numara dükkanlarının mesajları durduğu için bu uyarı sessiz bırakılamaz |
| `20429`, `63018` | hız sınırı | `130429` → yeniden dene |
| `63021`, `63005` | içerik/şablon hatası | `132000` → şablon hatası |
| HTTP 5xx, ağ, zaman aşımı | geçici | yeniden dene |

## 3. Yapılandırma

### 3.1 Ortam değişkenleri (container)

| Değişken | Değer |
|---|---|
| `PLATFORM_WA_PROVIDER` | `twilio` |
| `PLATFORM_WA_API_KEY` | Twilio **Auth Token** (gönderim + imza doğrulaması) |
| `PLATFORM_WA_PHONE_NUMBER_ID` | Twilio **Account SID** (`AC…`); gönderim adresindeki kimlik |
| `PLATFORM_WA_DISPLAY_PHONE` | ortak numara, E.164 |
| `PLATFORM_WA_WEBHOOK_TOKEN` | ortak webhook yolundaki gizli belirteç |

`WA_APP_SECRET` **kullanılmaz** (Meta imzası yok; koruma `X-Twilio-Signature` + URL'deki belirteç).

### 3.2 GitHub secret'ları (canlı ortam, Cloudflare)

| Secret | Zorunlu |
|---|---|
| `TWILIO_ACCOUNT_SID` | evet (`AC` + 32 onaltılık karakter) |
| `TWILIO_AUTH_TOKEN` | evet (32 onaltılık karakter) |
| `WA_PHONE` | evet (E.164) |

Üç yolun secret'ları birlikte verilirse dağıtım **durur** (`whatsappSecretsConflict`): hangi yoldan
bağlanılacağı belirsizdir. Öncelik sırası yoktur; kullanılmayan yolun secret'ları silinmelidir.

## 4. Admin "WhatsApp kurulumu" (15 §6.2a)

Ekran 360dialog akışıyla aynıdır: **Bağlantıyı test et → Webhook'u Twilio'ya kaydet → Şablonları gönder.**

| Adım | Twilio'da karşılığı |
|---|---|
| Bağlantıyı test et | `GET /2010-04-01/Accounts/{sid}.json` (hesap etkin mi, deneme hesabı mı) + `GET https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp` (gönderen durumu, görünen ad, kalite, günlük sınır, çevrimdışı sebepleri, kayıtlı webhook) |
| Webhook'u Twilio'ya kaydet | `POST https://messaging.twilio.com/v2/Channels/Senders/{XE…}` ile `webhook.callback_url` **ve** `webhook.status_callback_url` ortak webhook adresimize yazılır (ikisi de POST). Adres zaten doğruysa yazılmaz |
| Kayıtlı adresi göster | Aynı gönderen kaydından okunur; adres maskeli gösterilir (belirtecin yalnız son 4 karakteri) |
| Şablonları gönder | Content kaynakları + WhatsApp onay istekleri (§2.4) |
| Durumu yenile | `GET /v1/ContentAndApprovals` |

"Numarayı etkinleştir" (Meta `register`) ve "Webhook aboneliği" (Meta `subscribed_apps`) adımları
Twilio'da **yoktur**; ekranda gizlenir ve çağrılırsa 409 `wa_setup_not_cloud` döner.

## 5. Kabul ölçütleri

- [ ] `PLATFORM_WA_PROVIDER=twilio` ile ortak numaradan düz metin gönderilir ve `sid` wamid olarak saklanır.
- [ ] Buton ve liste mesajları Content kaynağıyla gider; kaynak bir kez üretilir, ikinci mesajda yeniden üretilmez.
- [ ] Gelen form-encoded webhook `NormalizedWaEvent`'e çevrilir: metin, buton yanıtı, liste yanıtı, konum, medya, alıntı.
- [ ] `X-Twilio-Signature` doğrulanır; yanlış imza 401 döner ve olay kaydedilmez.
- [ ] Durum geri bildirimleri `sent` / `delivered` / `read` / `failed` olarak işlenir.
- [ ] `63016` alınca şablona düşülür (`templateFallback`).
- [ ] Üç yolun secret'ları birlikte verilirse dağıtım durur.
- [ ] Tüm birim testleri ve `pnpm typecheck` geçer.

## 6. Bilinen sınırlar

1. **BSUID yok:** Twilio yalnız telefon numarasıyla çalışır; WhatsApp'ın kimliksiz (username) akışı bu yolda desteklenmez.
2. **Coexistence echo yok:** Twilio `smb_message_echoes` benzeri bir olay yayınlamaz; işletme telefonundan yazılan mesajlar panele düşmez.
3. **Pencere kapalı hatası geç gelebilir:** `63016` gönderim yanıtında gelirse şablona düşülür; Twilio mesajı kabul edip hatayı yalnız durum geri bildiriminde bildirirse mesaj `failed` olarak işaretlenir, şablona düşülmez (Meta Cloud API yolundaki `131047` ile aynı sınır). Pencere, son gelen mesaj zamanından takip edilir.
4. **Numara Console'da bağlanır:** WhatsApp gönderen kaydı (numara doğrulaması, görünen ad, profil) Twilio Console'da yapılır; buradan yalnız okunur ve webhook'u yazılır. SMS alamayan numaralarda doğrulama yöntemi olarak "Phone call" seçilir.
5. **Şablon değişkenleri tek sayaçtır:** Twilio içeriğinde gövde ve URL butonu aynı `{{n}}` uzayını paylaşır; dinamik URL butonunun parametresi gövde değişkenlerinden sonra numaralanır (`twilioContentPayload` ve sağlayıcının `sendTemplate`'i aynı sırayı üretir).
6. **Deneme (trial) hesabı:** yalnız doğrulanmış numaralara mesaj gider ve mesajın başına Twilio uyarısı eklenir; bağlantı testi bunu ayrı satırda uyarır.
7. **`messages.payload.request` Cloud API biçimindedir:** giden mesajın teşhis kaydı sağlayıcıdan bağımsız kanonik gövdeyi saklar (`specRequestBody`), Twilio'ya giden form gövdesini değil.
8. **Fiyat:** Twilio'nun 0,005 $/mesaj payı Meta ücretinin üstüne biner; hacim büyüdüğünde 360dialog'a geçiş `PLATFORM_WA_PROVIDER` değişikliğidir, veri göçü gerekmez.
