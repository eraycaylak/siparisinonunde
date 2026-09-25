# 14 — Uygulama Şartnamesi (Faz 1 kodu)

> **Amaç:** Plan dokümanlarını (00–13) çalışan koda çeviren **bağlayıcı teknik sözleşme**. Kodu yazan herkes (Claude ve alt ajanlar) bu dokümana uyar. Kanonik isimler, durumlar, roller ve kurallar [00](00-kararlar-ve-sozluk.md)'dan gelir; bu doküman solo işletim için sadeleştirilmiş uygulama kararlarını ([00](00-kararlar-ve-sozluk.md) §12a) ve API sözleşmesini tanımlar. Çelişkide öncelik: 00 §12a > bu doküman > 00'ın geri kalanı > 01–13.

## 1. Teknoloji ve sürümler

| Katman | Seçim |
|---|---|
| Çalışma zamanı | Node.js 22, pnpm 10 workspaces (Turborepo yok) |
| Dil | TypeScript **5.9** (strict), ESM |
| API | Fastify 5 + `fastify-type-provider-zod` + Zod 4, `@fastify/cookie`, `@fastify/multipart` (görsel yükleme), `@fastify/static` (uploads) |
| Veritabanı | PostgreSQL 16+ (PostGIS yok), Drizzle ORM 0.45 + `postgres` (postgres-js) sürücüsü, drizzle-kit ile SQL migration |
| Arka plan | Aynı kod tabanından `worker` süreci; `jobs` tablosu + `FOR UPDATE SKIP LOCKED`; Redis yok |
| Gerçek zamanlı | SSE (`text/event-stream`), `Last-Event-ID` = `branch_events.seq`; süreçler arası dağıtım `LISTEN/NOTIFY branch_events` |
| Web | Next.js 16 App Router + React 19 + Tailwind CSS 4, TanStack Query 5, lucide-react ikonları, maplibre-gl (harita, OpenFreeMap stili) |
| Test | Vitest (birim + API entegrasyon, gerçek PostgreSQL `siparis_test`), Playwright 1.56 (e2e, Chromium `/opt/pw-browsers`) |
| Dağıtım | Docker Compose: `postgres`, `api`, `worker`, `web`, `caddy` |

## 2. Depo yapısı

```
/                         package.json (scripts), pnpm-workspace.yaml, tsconfig.base.json, .env.example,
                          docker-compose.yml, Caddyfile, vitest.workspace.ts, playwright.config.ts
packages/core/            Saf TypeScript, bağımlılık yalnız zod. Alanlar:
  src/enums.ts            00 §5'teki TÜM enum'lar (as const dizileri + TS tipleri + TR etiketleri)
  src/order-fsm.ts        Sipariş durum makinesi (geçiş tablosu, canTransition, allowedActions)
  src/pricing.ts          Sepet/fiyat hesaplama (kuruş, seçenek doğrulama, min sepet, teslimat ücreti)
  src/zones.ts            Mahalle eşleme, point-in-polygon, yarıçap (haversine)
  src/hours.ts            Çalışma saatleri (gece yarısını aşan aralık), özel günler, ordering_state hesabı (Europe/Istanbul)
  src/money.ts, phone.ts  formatTRY(kuruş), parseTRY; TR telefon normalize (E.164 +90…), maskPhone (son 4)
  src/messages/tr.ts      Müşteri mesaj metinleri (03 §9 M-kodları), şablon adları (02 §5), ret/iptal metinleri
  src/contracts/*.ts      API istek/yanıt Zod şemaları (bu dokümanın §6'sı) — web ve api aynı şemayı kullanır
  src/calculator.ts       Komisyon hesaplayıcı formülleri (01 §6.7 / 05 C.4) + test değerleri
packages/db/              drizzle şeması (src/schema/*.ts), migrations/ (SQL), src/client.ts, src/seed.ts
apps/api/                 src/app.ts (buildApp — testler de bunu kullanır), src/server.ts, src/worker.ts,
                          src/config.ts (env Zod ile), src/plugins/*, src/routes/<alan>/*.ts, src/jobs/<alan>/*.ts,
                          src/wa/* (sağlayıcılar + konuşma motoru), src/sms/*, test/*.test.ts
apps/web/                 app/(marketing)/*, app/s/[slug]/*, app/t/[token]/*, app/panel/*, app/admin/*,
                          app/kurye/*, app/dev/whatsapp/*, components/ui/*, components/<alan>/*, lib/api.ts, lib/sse.ts
e2e/                      Playwright testleri
```

**Sahiplik kuralı (paralel geliştirme):** Her dilim (§11) yalnız kendi dosyalarını düzenler. `packages/db` şeması ve `packages/core/src/enums.ts` **temel dilimin** malıdır; sonraki dilimler şema değişikliği gerekirse yeni bir migration dosyası ekler (`migrations/NNNN_<dilim>_*.sql` — numara çakışmasını önlemek için dilime ayrılmış aralık: temel 0000–0099, menü 0100–0199, sipariş 0200–0299, whatsapp 0300–0399, işletme-ayarları 0400–0499, admin 0500–0599, kimlik güvenliği 0600–0699) **ve** drizzle şemasına kendi dosyasında (`schema/<dilim>-ext.ts`) ekleme yapar. Mevcut kolonları değiştirmez.

## 3. Ortam değişkenleri (`.env.example`)

```
DATABASE_URL=postgres://siparis:siparis@localhost:5432/siparis_dev
TEST_DATABASE_URL=postgres://siparis:siparis@localhost:5432/siparis_test
APP_BASE_URL=http://localhost:3000          # web kök adresi (linkler, takip, storefront)
API_PORT=4000
WEB_PORT=3000
SESSION_SECRET=dev-only-change-me-32chars-minimum
TRACKING_SECRET=dev-only-tracking-secret
ENCRYPTION_KEY=base64-32-bayt                # WhatsApp/SMS API anahtarlarını şifreler (AES-256-GCM)
WA_DEFAULT_PROVIDER=mock                    # mock | cloud | d360
WA_APP_SECRET=                              # cloud: X-Hub-Signature-256 doğrulaması
WA_VERIFY_TOKEN=dev-verify                  # cloud: GET doğrulama
PLATFORM_WA_PROVIDER=mock                   # platform uyarı numarası
PLATFORM_WA_API_KEY=
SMS_PROVIDER=mock                           # mock | netgsm
NETGSM_USERCODE= / NETGSM_PASSWORD= / NETGSM_HEADER=
UPLOAD_DIR=./uploads
ANTHROPIC_API_KEY=                          # Faz 2 (AI), boşsa kapalı
DEV_TOOLS=1                                 # /dev/whatsapp simülatörü ve /api/dev/* (üretimde 0)
ADMIN_TOTP_REQUIRED=                        # platform yöneticisine TOTP zorunlu; boşsa üretimde 1, diğer ortamlarda 0 (§5)
```

## 4. Veritabanı (Faz 1 tablo seti)

Kolon adları ve anlamları için [07](07-veri-modeli-ve-api.md) §3 esastır; aşağıdaki **sadeleştirmeler** geçerlidir. Tüm tablolar: `id uuid pk default gen_random_uuid()` (UUIDv7 yerine), `created_at timestamptz default now()`, gerekiyorsa `updated_at`. Para `*_kurus integer`. Tenant verisi taşıyan her tabloda `tenant_id uuid not null` + indeks.

| Tablo | Not (07'ye göre fark) |
|---|---|
| `tenants` | `name, slug (unique), legal_name, tax_no, phone, lifecycle_stage, suspension_reason, ordering_enabled (bool, default true), sms_fallback_enabled (default true), brand_color, logo_url, cover_url, marketplace_commission_bp (tasarruf raporu için, default 2500), plan_code ('esnaf'|'pro'|'zincir'), trial_ends_at, live_at, web_live_at` |
| `branches` | `tenant_id, name, phone, address_line, neighborhood, district ('Merkez'), city ('Yozgat'), lat, lng, timezone ('Europe/Istanbul'), paused_until, busy_extra_minutes, default_prep_minutes (20), accepts_delivery, accepts_pickup, payment_methods text[] (00 §5 kodları), meal_card_brands text[], status_messages jsonb (hangi durum mesajı gitsin; preparing varsayılan false), alarm_policy jsonb (00 §10: {auto_cancel_minutes:15, customer_notice_minutes:10, platform_wa_enabled:true, sms_enabled:true}), receipt_settings jsonb` |
| `users` | `email (unique, nullable), phone (unique, nullable), name, password_hash (scrypt), is_platform_admin bool, platform_role (00 §4, nullable), totp_secret_enc, totp_enabled_at, totp_pending_secret_enc, totp_last_step, totp_recovery_hashes text[] (§5 iki adımlı doğrulama), last_login_at, disabled_at` |
| `sessions` | `user_id, token_hash (unique), kind ('user'|'courier'|'impersonation'), tenant_id (seçili), expires_at, ip, user_agent, impersonator_user_id, read_only bool` |
| `memberships` | `tenant_id, user_id, role (owner/manager/cashier/kitchen/courier), branch_id nullable` unique(tenant_id,user_id) |
| `courier_login_links` | `tenant_id, user_id, token_hash, expires_at (15 dk), used_at` |
| `categories` | `tenant_id, name, sort, is_active` |
| `products` | `tenant_id, category_id, name, description, price_kurus, image_url, is_active, sold_out_until (timestamptz null — "Bugün tükendi" = gün sonuna kadar), wa_restricted bool (alkol/tütün: storefront'ta satılamaz), sort` |
| `option_groups` / `options` / `product_option_groups` | grup: `tenant_id, name, min_select, max_select`; seçenek: `group_id, name, price_delta_kurus, is_active, sort`; bağ: `product_id, group_id, sort` |
| `price_change_batches` | toplu fiyat güncelleme kaydı (kind 'percent'|'fixed', value, product_ids, applied_by) |
| `opening_hours` | `branch_id, weekday (0=Pazar..6), opens_at 'HH:MM', closes_at 'HH:MM'` (closes < opens ⇒ gece yarısını aşar) |
| `special_days` | `branch_id, date, is_closed, opens_at, closes_at, note` |
| `delivery_zones` | `tenant_id, branch_id, name, kind ('neighborhoods'|'polygon'|'radius'), neighborhoods text[], polygon jsonb (GeoJSON Polygon), radius_m, fee_kurus, min_order_kurus, eta_minutes, is_active, sort` |
| `customers` | `tenant_id, wa_bsuid (null), phone_e164 (null), wa_username, name, notes, is_blocked, order_count, last_order_at` unique partial (tenant_id,wa_bsuid) ve (tenant_id,phone_e164) |
| `customer_addresses` | `tenant_id, customer_id, neighborhood, address_line, directions, lat, lng, last_used_at` |
| `orders` | 07 `orders` alanları; ayrıca `number integer` (tenant başına artan, `tenants.order_seq` ile), `zone_id, neighborhood, address_line, directions, lat, lng, customer_name, customer_phone, change_for_kurus, wants_cutlery, note, eta_minutes, estimated_ready_at, courier_user_id, first_acked_at, rejection_scheduled_at, tracking_expires_at, conversation_id, verification_method, verified_at, test_kind, delay_notice_count, version`. Takip token'ı saklanmaz (§7.4). |
| `order_items` / `order_item_options` | snapshot: `name, unit_price_kurus, quantity, line_total_kurus, note`; seçenek: `group_name, option_name, price_delta_kurus` |
| `order_events` | `order_id, from_status, to_status, actor_type ('customer'|'user'|'system'), actor_user_id, reason, note` |
| `order_acks` | `order_id, user_id, device_label, acked_at` (ilk ack `orders.first_acked_at`'ı doldurur) |
| `order_verification_codes` | `order_id, code (6 hane, karışmayan harf/rakam), expires_at (30 dk), used_at` |
| `otp_verifications` | `tenant_id, order_id, phone_e164, code_hash, expires_at (5 dk), attempts, verified_at` |
| `storefront_link_tokens` | `tenant_id, token_hash, conversation_id, customer_id, expires_at (2 sa), first_opened_at, exchanged_at` |
| `reviews` | `order_id, tenant_id, rating ('good'|'ok'|'bad'), comment` |
| `cancellation_requests` | `order_id, tenant_id, requested_at, reason, status ('pending'|'approved'|'rejected'), decided_by, decided_at` |
| `branch_events` | `seq bigserial pk, tenant_id, branch_id, type, payload jsonb, created_at` — SSE günlüğü; 7 gün saklanır |
| `wa_accounts` | `tenant_id, branch_id, provider ('mock'|'cloud'|'d360'), display_phone, phone_number_id, waba_id, api_key_enc, webhook_token (unique, URL'de), status ('connected'|'disconnected'|'error'), last_webhook_at, last_error` |
| `conversations` | `tenant_id, branch_id, wa_account_id, customer_id, mode ('bot'|'human'), human_until, state, last_inbound_at, last_welcome_at, last_nudge_at, last_status_card_at, last_closed_notice_at, unread_count, opted_out` |
| `messages` | `tenant_id, conversation_id, direction ('in'|'out'), wamid (unique null), kind ('text'|'interactive'|'button_reply'|'list_reply'|'location'|'image'|'audio'|'template'|'system'|'echo'), body, payload jsonb, template_name, status ('queued'|'sent'|'delivered'|'read'|'failed'), error_code, sent_by ('bot'|'user'|'customer'|'business_phone'), sent_by_user_id, order_id` |
| `wa_webhook_events` | ham olay: `provider, wa_account_id, payload jsonb, received_at, processed_at, error` |
| `sms_messages` | `tenant_id, to_phone, body, purpose ('otp'|'status'|'alarm'), provider, status, counts_toward_quota, error` |
| `notifications` | platform → işletme uyarıları: `tenant_id, kind (07 listesi + 'new_order_alarm'), channel ('platform_wa'|'sms'|'email'|'log'), payload, status` |
| `jobs` | `queue (00 §5 kuyrukları), type, payload jsonb, run_at, status ('pending'|'running'|'done'|'failed'|'cancelled'), attempts, max_attempts (5), locked_at, locked_by, last_error, dedupe_key (unique null), tenant_id null` |
| `audit_log` | `tenant_id null, actor_user_id, impersonator_user_id, action, entity_type, entity_id, data jsonb, ip` |
| `feature_flags` | `key pk, enabled, kind ('kill_switch'|'ops'|'release')` — seed: 00 §4 kill-switch'leri |
| `subscriptions` | `tenant_id, plan_code, status (00 §7), trial_ends_at, current_period_end, founder_discount_bp` (Faz 1 manuel yönetim) |
| `admin_notes` | `tenant_id, author_user_id, body, tags text[]` |
| `leads` | `name, business_name, phone, city, source, calculator_input jsonb, status, notes` |
| `legal_acceptances` | `user_id/tenant_id veya order_id, document ('abonelik','kvkk_aydinlatma','mesafeli_satis','on_bilgilendirme'), version, accepted_at, ip` |

**Seed (dev):** platform admin `admin@siparisinonunde.local / admin1234`; demo işletme **"Bozok Pide Salonu"** (`bozok-pide`, Yozgat Merkez), sahip `demo@siparisinonunde.local / demo1234`, kasiyer `kasa@…/kasa1234`, kurye `kurye@…/kurye1234`; menü (Pideler, Lahmacun, Kebaplar, Çorbalar, İçecekler, Tatlılar; seçenek grupları: "Porsiyon" (tam/1,5 +%), "Ekstralar" (kaşar +, yumurta +, max 3), "Acı" (acılı/acısız, zorunlu 1)); saatler 10:00–23:30; 3 bölge (mahalle listesi — **örnek**; gerçek mahalle adları işletmece düzenlenir); `mock` WhatsApp hesabı `+90 555 000 00 01`; birkaç geçmiş sipariş.

## 5. Kimlik doğrulama ve yetki

- Oturum: rastgele 32 bayt token → çerez `sid` (HttpOnly, SameSite=Lax, prod'da Secure, Path=/); DB'de SHA-256 hash. Süreler 00 §4 (kişisel 30 gün, kurye 12 sa, admin 8 sa + 30 dk hareketsizlik, impersonation 30 dk salt-okunur).
- Parola: `crypto.scrypt` (N=16384, r=8, p=1, 64 bayt, rastgele tuz) — `packages/core` değil `apps/api/src/lib/password.ts`.
- `request.auth = { user, session, tenantId, role, isPlatformAdmin, readOnly }`. Panel rotaları `requireTenantRole([...])`; admin rotaları `requirePlatform([...])`. Salt-okunur oturumda yazma → 403 `read_only_session`.
- **Tenant kapsamı:** panel sorgularının hepsi `request.auth.tenantId` ile filtrelenir; başka tenant'ın kaydına erişim 404 döner. Her rota grubu için yalnıtım testi zorunlu (§10).
- İzin matrisi (özet, ayrıntı 04 §2): owner her şey; manager abonelik ve WhatsApp bağlantısı hariç her şey; cashier siparişler, sohbetler, müşteriler, telefon siparişi; kitchen yalnız sipariş listesi (fiyatsız görünüm) ve hazırlık durumları; courier yalnız kendine atanmış siparişler.
- Hız sınırı: giriş 10/dk/IP, storefront sipariş 5/dk/IP + 3/10dk/telefon, OTP 3/10dk/telefon, iki adımlı doğrulama kodu 5/10dk/kullanıcı (bellek içi token bucket yeterli).
- **İki adımlı doğrulama (TOTP; 00 §12a madde 7):**
  - Kapsam: platform yöneticisinde zorunlu (`ADMIN_TOTP_REQUIRED`; verilmezse üretimde `true`, diğer ortamlarda `false`), işletme kullanıcılarının kişisel hesaplarında isteğe bağlı (sahibe önerilir). Kurye ve paylaşımlı cihaz (PIN) oturumu kullanmaz; yalnız kurye üyeliği olan hesapta girişte ikinci adım sorulmaz.
  - Veri: `users.totp_secret_enc` (etkin sır, `lib/encryption` AES-256-GCM), `totp_enabled_at` (null = kapalı), `totp_pending_secret_enc` (kurulumu süren sır), `totp_last_step` (son kabul edilen 30 sn adımı; tekrar oynatma koruması), `totp_recovery_hashes text[]` (8 tek kullanımlık kurtarma kodunun SHA-256 özeti; kod "ABCD-EFGH" biçiminde, karışmayan harf/rakam). Migration `0600_auth_totp.sql` (kimlik güvenliği aralığı 0600–0699).
  - Giriş: parola **önce** doğrulanır (TOTP durumu parola bilinmeden açığa çıkmaz). TOTP açıksa `totp`/`recoveryCode` yoksa 401 `totp_required`; hatalı, süresi geçmiş ya da daha önce kullanılmış kod 401 `invalid_totp`; ikinci adım başarılı olmadan oturum açılmaz. ±1 adım kabul edilir; adım `totp_last_step`'ten büyük değilse reddedilir (atomik güncelleme). Kurtarma kodu kullanılınca silinir. Kullanıcı başına 5 deneme/10 dk aşılırsa 429 `rate_limited` (Türkçe mesaj, `details.retryAfterSec`).
  - Yönetim uçları yalnız kişisel oturumda (`kind='user'`); destek görünümü (impersonation), kurye ve cihaz oturumu 403. Tümü audit'e yazılır (`auth.totp_*`); sır ve kodlar hiçbir kayda girmez.
  - Zorunluluk: `ADMIN_TOTP_REQUIRED` açıkken TOTP'si kurulmamış platform yöneticisinin girişi başarılıdır (kurulum yapabilsin diye), fakat admin kapsamındaki `onRequest` kancası (`requireAdminTotpEnrollment`) tüm `/api/v1/admin/*` isteklerini 403 `totp_enrollment_required` ile reddeder; web yönetim kabuğu bu durumda `/admin/guvenlik`'e yönlendirir. Zorunluyken `disable` 403 `totp_required_for_admin`. Operatör kurtarması: `scripts/create-admin.ts --email … --reset-totp` (sırrı, kurtarma kodlarını ve tüm oturumları siler).

## 6. API sözleşmesi (`/api/v1`)

Hata biçimi: `{ "error": { "code": "snake_case", "message": "Türkçe açıklama", "details"?: any } }` + uygun HTTP kodu. Tarihler ISO 8601. Para kuruş. Liste yanıtları `{ items: [...], nextCursor?: string }`. Web uygulaması `/api/*` isteklerini API'ye proxy'ler (aynı köken, çerez).

### 6.1 Kimlik (`/api/v1/auth`)
| Metot | Yol | Açıklama |
|---|---|---|
| POST | `/auth/signup` | `{businessName, ownerName, phone, email, password, city?, acceptTerms:true}` → tenant + şube + owner + deneme aboneliği; oturum açar. `{ user, tenant }` |
| POST | `/auth/login` | `{login (email|telefon), password, totp? (6 hane), recoveryCode?}` → `{ user, memberships[], isPlatformAdmin }`; TOTP açıksa kodsuz 401 `totp_required`, hatalı kod 401 `invalid_totp` (§5) |
| POST | `/auth/logout` | |
| GET | `/auth/me` | `{ user, tenant?, role?, memberships[], isPlatformAdmin, totpEnabled, totpRequired? (yalnız platform yöneticisi), readOnly, impersonating? }` |
| GET | `/auth/totp` | `{ enabled, enabledAt, recoveryCodesRemaining, required }` (yalnız kişisel oturum) |
| POST | `/auth/totp/setup` | → `{ secret, otpauthUrl, qrSvg }`; bekleyen sır saklanır (issuer "Siparişin Önünde", etiket e-posta ya da telefon). Açıksa 409 `totp_already_enabled` |
| POST | `/auth/totp/enable` | `{code}` → `{ recoveryCodes[8] }` (yalnız bu yanıtta); kullanıcının diğer oturumlarını kapatır. Hatalı kod 400 `invalid_totp` |
| POST | `/auth/totp/disable` | `{password, code (TOTP ya da kurtarma kodu)}`; zorunlu olduğu platform yöneticisinde 403 `totp_required_for_admin` |
| POST | `/auth/totp/recovery-codes` | `{code}` → yeni `{ recoveryCodes[8] }`, eskiler geçersiz |
| POST | `/auth/switch-tenant` | `{tenantId}` (çok üyelikli kullanıcı) |
| POST | `/auth/courier/exchange` | `{token}` magic link → kurye oturumu |

### 6.2 Storefront (herkese açık, `/api/v1/store`)
| Metot | Yol | Açıklama |
|---|---|---|
| GET | `/store/:slug` | İşletme + şube vitrini: `{tenant:{name,slug,brandColor,logoUrl,coverUrl,phone}, branch:{id,name,address,orderingState ('open'|'busy'|'paused'|'closed'), nextOpenAt?, acceptsDelivery, acceptsPickup, paymentMethods, mealCardBrands, prepMinutes}, zones:[{id,name,kind,neighborhoods,feeKurus,minOrderKurus,etaMinutes}], categories:[{id,name,products:[{id,name,description,priceKurus,imageUrl,soldOut,optionGroups:[{id,name,minSelect,maxSelect,options:[{id,name,priceDeltaKurus}]}]}]}], legal:{…künye} }` |
| POST | `/store/:slug/session` | `{linkToken?}` Akış A token'ını çerez `sfs`e çevirir (GET tüketmez) → `{customer?:{name,phoneMasked}, lastOrder?:{items,totalKurus,createdAt}}` |
| POST | `/store/:slug/quote` | Sepet doğrulama/fiyat: `{items:[{productId,quantity,optionIds[],note?}], fulfillmentType, zoneId?, neighborhood?, lat?, lng?}` → `{lines[], subtotalKurus, deliveryFeeKurus, totalKurus, minOrderKurus, meetsMinimum, zone?, problems:[{code,message,productId?}]}` |
| POST | `/store/:slug/orders` | quote girdisi + `{customerName, customerPhone, addressLine?, directions?, paymentMethod, mealCardBrand?, changeForKurus?, wantsCutlery, note?, acceptPreInfo:true, idempotencyKey}` → `{orderId, number, status, trackingUrl, verification:{required:boolean, method?:'wa_code', waLink?, code?, smsAvailable:boolean}}`. Akış A çerezi varsa `status:'new'`, `verification.required=false`. Yoksa `awaiting_customer` (Akış B). İşletme kapalı/duraklatılmış/`ordering_enabled=false` → 409 `ordering_closed`. |
| POST | `/store/orders/:orderId/sms-otp` | `{phone}` OTP gönderir (WhatsApp'sız mod) |
| POST | `/store/orders/:orderId/sms-verify` | `{code}` → sipariş `new` |
| GET | `/store/track/:token` | Takip: `{order:{number,status,statusLabel,timeline[],items[],totals,fulfillmentType,etaAt?,canCancel,canRequestCancel,review?}, business:{name,phone}, expired:false}`; süresi dolmuşsa 410 + kişisel veri yok |
| POST | `/store/track/:token/cancel` | `new` → doğrudan iptal; `accepted+` → iptal talebi |
| POST | `/store/track/:token/review` | `{rating, comment?}` (yalnız `delivered`) |
| POST | `/store/events` | analitik (PII yok) — Faz 1'de kabul et ve kaydet ya da 204 |

### 6.3 Panel (`/api/v1/panel`, oturum + tenant zorunlu)
| Alan | Uç noktalar |
|---|---|
| Canlı | `GET /panel/stream?branchId=` (SSE; olaylar §7.1) · `GET /panel/orders/active` (açık siparişler) · `POST /panel/orders/:id/ack` |
| Sipariş | `GET /panel/orders?status=&from=&to=&q=&cursor=` · `GET /panel/orders/:id` · `POST /panel/orders/:id/accept {etaMinutes}` · `POST /:id/reject {reason, note?}` (30 sn bekleyen ret) · `POST /:id/undo-reject` · `POST /:id/advance {to:'preparing'|'ready'|'on_the_way'|'delivered'}` · `POST /:id/cancel {reason, note?}` · `POST /:id/delay {extraMinutes}` (≤2) · `POST /:id/assign-courier {userId|null}` · `POST /panel/orders/manual {…telefon siparişi; zone dışı istisna}` · `POST /:id/cancellation-request/:reqId/decide {approve}` · `GET /:id/receipt?type=kitchen|delivery` (yazdırma HTML/JSON) |
| Menü | `GET /panel/menu` (tam ağaç) · CRUD `categories`, `products`, `option-groups`, `options` · `POST /panel/products/:id/sold-out {until:'end_of_day'|null}` · `POST /panel/menu/reorder` · `POST /panel/menu/bulk-price {productIds[], kind, value, preview:boolean}` · `POST /panel/uploads` (görsel, ≤ 5 MB, jpeg/png/webp) · `GET /panel/menu/export.csv` · `POST /panel/menu/import.csv` |
| Ayarlar | `GET/PATCH /panel/tenant` · `GET/PATCH /panel/branches/:id` (ödeme yöntemleri, durum mesajları, alarm politikası, fiş) · `PUT /panel/branches/:id/hours` · CRUD `special-days` · `POST /panel/branches/:id/pause {minutes|null}` · `POST /:id/busy {extraMinutes|0}` · CRUD `zones` |
| WhatsApp | `GET /panel/whatsapp` (bağlantı + sağlık) · `PUT /panel/whatsapp {provider, displayPhone, phoneNumberId?, wabaId?, apiKey?}` (owner) · `POST /panel/whatsapp/test` |
| Sohbet | `GET /panel/conversations?cursor=` · `GET /panel/conversations/:id/messages` · `POST /panel/conversations/:id/messages {text}` (24 sa penceresi kontrolü) · `POST /:id/mode {mode:'bot'|'human'}` · `POST /:id/read` |
| Müşteri | `GET /panel/customers?q=` · `GET/PATCH /panel/customers/:id {notes, isBlocked}` · `POST /panel/customers/:id/export` · `POST /panel/customers/:id/erase` (owner/manager) |
| Personel | `GET /panel/staff` · `POST /panel/staff {name, email|phone, role, password}` · `PATCH/DELETE /panel/staff/:userId` · `POST /panel/couriers/:userId/login-link` → `{url}` |
| Rapor | `GET /panel/reports/daily?date=` (sayı, ciro, ödeme yöntemine göre, ürün top 10) · `GET /panel/reports/summary?from=&to=` (kanal kırılımı, saat ısı haritası) · `GET /panel/reports/savings?month=` (00 formülü: kendi kanal `delivered` ciro × `marketplace_commission_bp`) |
| Onboarding | `GET /panel/onboarding` (adımlar ve durum) · `POST /panel/onboarding/test-order` (`test_kind='onboarding_test'`) · `POST /panel/onboarding/go-live` |
| Kurye | `GET /courier/orders` · `POST /courier/orders/:id/on-the-way` · `POST /courier/orders/:id/delivered` |

### 6.4 Admin (`/api/v1/admin`, platform oturumu)
`GET /admin/overview` (işletme sayıları lifecycle'a göre, bugünkü sipariş, açık alarm, başarısız iş) · `GET /admin/tenants?q=&stage=` · `GET/PATCH /admin/tenants/:id` (plan, lifecycle, suspension_reason, ordering_enabled) · `GET /admin/tenants/:id/orders` · `POST /admin/tenants/:id/impersonate {reason}` → salt-okunur 30 dk oturum · `POST /admin/impersonation/end` · CRUD `/admin/tenants/:id/notes` · `GET /admin/whatsapp` (tüm hesapların sağlığı) · `GET /admin/jobs?status=failed` · `POST /admin/jobs/:id/retry` · `GET/PATCH /admin/flags` · `GET /admin/leads` · `PATCH /admin/leads/:id` · `GET /admin/audit?tenantId=`

### 6.5 Webhook ve geliştirme
- `GET /api/v1/webhooks/wa/:webhookToken` — Meta doğrulama (`hub.challenge`).
- `POST /api/v1/webhooks/wa/:webhookToken` — Cloud API/360dialog biçimli olay; `WA_APP_SECRET` varsa `X-Hub-Signature-256` doğrulanır; ham olay `wa_webhook_events`e yazılır, **hemen 200**, işleme `wa-inbound` kuyruğunda.
- `POST /api/v1/public/leads` — demo talebi/hesaplayıcı lead'i.
- `DEV_TOOLS=1` iken: `GET /api/v1/dev/wa/accounts`, `POST /api/v1/dev/wa/inbound {waAccountId, from:{phone,name,bsuid?}, message:{type:'text'|'button_reply'|'location', …}}` (Cloud API webhook yükü üretip aynı işlem hattına sokar), `GET /api/v1/dev/wa/thread?waAccountId=&phone=` (mock giden + gelen mesajlar), `POST /api/v1/dev/wa/echo` (işletme telefonundan yazılmış mesaj — coexistence echo), `GET /api/v1/dev/sms` (mock SMS'ler).

## 7. Olaylar, işler ve kurallar

### 7.1 SSE olayları (`branch_events.type`)
`order.created`, `order.updated` (payload: sipariş özeti), `order.alarm` (`{orderId, step}`), `conversation.message`, `conversation.updated`, `branch.state` (ordering_state değişti), `ping` (15 sn). İstemci `Last-Event-ID` ile yeniden bağlanınca kaçırdıklarını alır; ayrıca 45 sn'de bir `GET /panel/orders/active` emniyet sorgusu.

### 7.2 İşler (`jobs.type` → sahibi)
| Tür | Kuyruk | Tetik | Etki |
|---|---|---|---|
| `wa.process_inbound` | wa-inbound | webhook | konuşma motoru (§8) |
| `wa.send` | wa-outbound | outbox | sağlayıcıya gönder, `messages.status` |
| `order.notify_customer` | notify | durum değişimi | mesaj bütçesi + pencere kontrolü → `wa.send` veya SMS |
| `order.alarm_step` | notify | `new` oluşunca 60 sn, 2, 5, 10, 15 dk | 00 §10 zinciri; sipariş artık `new` değilse no-op |
| `order.received_debounced` | notify | Akış A `new` +60 sn | "alındı" mesajı (onay gelmişse iptal) |
| `order.finalize_rejection` | notify | ret +30 sn | `rejected` + müşteri mesajı |
| `order.awaiting_timeout` | notify | `awaiting_customer` +30 dk | `cancelled/customer_timeout` |
| `sms.send` | notify | | SMS sağlayıcısı, kota sayacı |
| `platform.alert` | notify | | platform WhatsApp/SMS ile işletme sahibine uyarı |
| `cron.retention` | cron | günlük 03:00 | 08 §2.8 silme işleri (Faz 1: branch_events 7 gün, wa_webhook_events 30 gün, otp 30 gün, sms 90 gün, konum/medya 30 gün) |
| `cron.sold_out_reset` | cron | | süresi dolan `sold_out_until` temizliği (sorguda da kontrol edilir) |

Worker döngüsü: 250 ms'de bir `select … where status='pending' and run_at<=now() order by run_at for update skip locked limit 20`; başarısızlıkta üstel geri çekilme (5 deneme), sonra `failed` (admin DLQ ekranı). İşleyiciler idempotent yazılır.

### 7.3 Sipariş kuralları (özet — tamamı 00 §5, §7, §10)
- FSM geçiş tablosu `packages/core/order-fsm.ts`'de; geçiş yalnız `transitionOrder(tx, orderId, to, actor, extra)` ile yapılır: sürüm kontrolü (`version`), `order_events` kaydı, `branch_events` kaydı, `pg_notify`, outbox işleri — tek transaction.
- Ret: `rejection_scheduled_at=now()`, `order.finalize_rejection` işi +30 sn; `undo-reject` işi iptal eder. Bekleyen retteki siparişe `accept` → 409 `rejection_pending`.
- Otomatik iptal süresi `alarm_policy.auto_cancel_minutes` (10–30), müşteri bilgisi `≤ auto_cancel − 5`.
- Mesaj bütçesi: ≤4 durum mesajı (+1 karşılama Akış A); debounce yalnız Akış A; gecikme bildirimi ≤2 ve bütçe dışı; test siparişi kısaltılmış zincir; canary dış bildirim yok.
- WhatsApp'sız mod: tenant WA bağlı değilse ya da hesap `error` ise ve `sms_fallback` açıksa Akış B SMS OTP ile doğrular; kritik durumlar (onaylandı/ret/iptal) SMS ile gider.
- Test siparişleri raporlardan hariç.

### 7.4 Takip token'ı
`token = base64url(orderId 16 bayt) + "." + base64url(HMAC-SHA256(TRACKING_SECRET, orderId))[0..16]`; doğrulama yeniden hesaplanarak yapılır; geçerlilik `tracking_expires_at` (final durum + 7 gün). Takip URL'si: `${APP_BASE_URL}/t/${token}`.

## 8. WhatsApp katmanı

```ts
interface WhatsAppProvider {
  sendText(acc, to: {bsuid?: string; phone?: string}, text: string): Promise<{wamid: string}>;
  sendInteractive(acc, to, msg: {kind:'buttons'|'cta_url'|'list'; body: string; footer?: string;
    buttons?: {id: string; title: string}[]; url?: {label: string; href: string}}): Promise<{wamid: string}>;
  sendTemplate(acc, to, name: string, lang: 'tr', params: string[], buttons?: …): Promise<{wamid: string}>;
  parseWebhook(body: unknown): NormalizedWaEvent[];   // inbound mesaj, status, echo
}
```
- `mock`: gönderimi `messages`e yazar (wamid `mock.<uuid>`), gerçek ağ çağrısı yok; simülatör okur.
- `cloud`: `POST https://graph.facebook.com/v23.0/{phone_number_id}/messages`, `Authorization: Bearer <apiKey>`.
- `d360`: `POST https://waba-v2.360dialog.io/messages`, başlık `D360-API-KEY: <apiKey>`; gövde Cloud API ile aynı. (teyit edilmeli)
- Buton başlıkları ≤ 20 karakter; kimlikler `order:{id}:confirm|edit|cancel`, `menu`, `human`, `review:{orderId}:good|ok|bad`, `wait:{orderId}`, `cancel:{orderId}`.
- **Konuşma motoru sırası** (00 §7): opt-out/insan modu → kara liste/askı → sipariş kodu (Akış B) → "yetkili" → açık sipariş durum kartı (15 dk'da 1) → şube kapalı (6 sa'te 1)/duraklatılmış (12 sa'te 1) → tam karşılama (12 sa'te 1, `request_welcome` dahil) / kısa yanıt (30 dk'da 1). İşletme telefonundan gelen echo → `mode='human'`, `human_until=now()+30dk`.
- Karşılama mesajı: işletme adı + "Menüyü aç" CTA URL (storefront linki + `?l=<linkToken>`), [Yetkiliyle görüş] butonu. Metinler `packages/core/src/messages/tr.ts` (03 §9).
- Pencere: `last_inbound_at` 24 sa içindeyse serbest mesaj; değilse şablon (mock'ta `kind='template'`).

## 9. Web uygulaması

- **Tasarım:** 12 no'lu dokümandaki token'lar (durum renkleri + ikon + kelime, dokunma hedefi ≥ 48 px, panel ana aksiyonları 56–64 px), açık/koyu tema, Türkçe; emoji yok, lucide ikonları.
- **Pazarlama (`/`):** ana sayfa, `/nasil-calisir`, `/fiyatlar` (KDV hariç + dahil), `/hesaplayici` (formüller `core/calculator.ts`), `/demo` (lead formu), `/sss`, `/yasal/*` (taslak metinler — "hukuki inceleme bekliyor" etiketi), `/kunye`. Ana mesaj: "Keşif pazaryerinde, sadakat sende."
- **Storefront (`/s/[slug]`):** mobil öncelikli; kapalı/meşgul bandı; kategori sekmeleri; ürün kartı → seçenek sayfası/çekmece (min/max doğrulama); sepet çekmecesi; `/s/[slug]/siparis` checkout (teslim türü, ad, telefon, mahalle seçimi + adres + tarif, ödeme yöntemi, para üstü, çatal-bıçak, not, ön bilgilendirme özeti + "Siparişi onayla" + altında "ödeme yükümlülüğü doğar"); gönderim sonrası Akış B ekranı (WhatsApp ile onayla butonu + kod + "SMS ile doğrula" + durum yoklama); "Son siparişin" kartı; altbilgide "Altyapı: Siparişin Önünde". `?l=` parametresi varsa `POST /session` ile çereze çevrilir ve URL temizlenir.
- **Takip (`/t/[token]`):** durum çizelgesi, tahmini süre, kalemler, iptal/iptal talebi, teslimden sonra 3 butonlu değerlendirme.
- **Panel (`/panel`):** `/panel/giris`, `/panel/kayit` → onboarding sihirbazı (`/panel/kurulum`); canlı ekran `/panel` (sütunlar Yeni / Onaylandı / Hazırlanıyor / Hazır / Yolda; "Vardiyayı başlat" butonu ses kilidini açar ve Wake Lock alır; yeni siparişte döngüsel ses + kırmızı yanıp sönen kart; bağlantı koptu bandı; "Onayla · 20/30/45 dk" hızlı butonları; ret sebep çipleri + 30 sn "Geri al" şeridi; kurye atama; "Gecikme bildir"; fiş yazdır (80 mm CSS, `window.print`)); `/panel/siparisler`, `/panel/telefon-siparisi`, `/panel/menu`, `/panel/sohbetler`, `/panel/musteriler`, `/panel/raporlar`, `/panel/ayarlar/*` (işletme, şube, saatler, bölgeler (mahalle listesi + haritada poligon/yarıçap), ödeme, bildirim/durum mesajları, alarm, WhatsApp, personel, fiş, QR/afiş (QR PNG + A5 afiş yazdırma)), `/panel/kuryeler`.
- **Kurye (`/kurye`):** magic link `/kurye/giris?t=` → atanmış siparişler, adres + harita linki (Google/Yandex/Apple), müşteriyi ara (tam numara yalnız burada), ödeme tipi, "Yola çıktım", "Teslim ettim".
- **Admin (`/admin`):** giriş, özet, işletmeler (liste + detay: profil, lifecycle, plan, WhatsApp sağlığı, siparişler, notlar, impersonation), WhatsApp sağlık tablosu, işler/DLQ, bayraklar (kill-switch), lead'ler, audit.
- **Geliştirici simülatörü (`/dev/whatsapp`):** yalnız `DEV_TOOLS=1`; sol: işletme numarası seçimi + müşteri (telefon/ad); orta: WhatsApp benzeri sohbet (gelen/giden balonlar, butonlar tıklanabilir, CTA URL yeni sekmede açılır); "İşletme telefonundan yaz" (echo) ve SMS kutusu.

## 10. Test ve kalite kapıları

- `pnpm typecheck` — tüm paketler hatasız.
- `pnpm test` — Vitest: `packages/core` birim testleri (FSM tüm geçişler, fiyat, bölge, saatler, hesaplayıcı referans değerleri 3.722,5 / 6.872,5 / 5.972,5 ve 59/38/42/21), API entegrasyon testleri `buildApp()` + `inject` + gerçek `siparis_test` DB (her dosya kendi şemasını sıfırlar/transaction), **tenant yalıtım testleri** (ikinci tenant'ın siparişine/ürününe/müşterisine erişim 404), iş işleyici testleri (sahte saat).
- `pnpm e2e` — Playwright (mock WhatsApp): (1) Akış A: simülatörde "merhaba" → menü linki → sepet → sipariş → panelde görünür → onayla → simülatörde "onaylandı" mesajı; (2) Akış B: storefront'tan doğrudan sipariş → WhatsApp kodu → `new`; (3) SMS OTP yedeği; (4) ret + geri al; (5) kurye akışı; (6) admin impersonation salt-okunur.
- Kod kuralları: fiyat yalnız sunucuda; tüm panel sorgularında tenant filtresi; loglarda telefon maskeli; gizli anahtarlar şifreli; her yazma işleminde audit (menü, ayarlar, personel, sipariş aksiyonları).

## 11. Geliştirme dilimleri (sıra ve sahiplik)

| # | Dilim | Sahip olduğu dosyalar | Bağımlılık |
|---|---|---|---|
| 0 | **Temel** | kök yapılandırma, `packages/db` (tüm Faz 1 şeması + seed), `packages/core` (enums, fsm, pricing, zones, hours, money, phone, calculator, contracts iskeleti), `apps/api` iskeleti (config, db, auth, session, tenant, hata, jobs çalıştırıcı, SSE yardımcısı, `transitionOrder`), `apps/web` iskeleti (Tailwind, UI kit, düzenler, API istemcisi, giriş/kayıt) | — |
| 1 | Menü + storefront okuma | `routes/panel/menu*`, `routes/store/storefront*`, web `panel/menu`, `s/[slug]` vitrin | 0 |
| 2 | Sipariş yaşam döngüsü | `routes/store/orders*`, `routes/panel/orders*`, `routes/courier*`, `jobs/order/*`, web checkout, takip, canlı ekran, siparişler, telefon siparişi, kurye | 0 |
| 3 | WhatsApp + SMS | `src/wa/*`, `src/sms/*`, `routes/webhooks/*`, `routes/dev/*`, `routes/panel/conversations*`, `routes/panel/whatsapp*`, `jobs/wa/*`, web `panel/sohbetler`, `dev/whatsapp` | 0 (+2'nin olay sözleşmesi) |
| 4 | İşletme ayarları + onboarding + raporlar | `routes/panel/{tenant,branches,zones,staff,reports,onboarding,customers}*`, web `panel/ayarlar/*`, `panel/kurulum`, `panel/raporlar`, `panel/musteriler`, `panel/kuryeler` | 0 |
| 5 | Admin + pazarlama sitesi | `routes/admin/*`, `routes/public/*`, web `admin/*`, `(marketing)/*` | 0 |
| 6 | Entegrasyon, e2e, dağıtım | e2e testleri, docker-compose, Caddyfile, Dockerfile'lar, [15](15-kurulum-ve-isletim.md) kurulum rehberi | 1–5 |
