# siparisinonunde — Siparişin Önünde

**İşletmenin kendi WhatsApp'ından komisyonsuz sipariş.** Türkiye'deki restoranlar ve yerel işletmeler için bir SaaS:

- Müşteri işletmenin WhatsApp'ına yazar.
- Sipariş web paneline sesli uyarıyla düşer.
- İşletme tek dokunuşla onaylar.
- Müşteri durum bildirimlerini WhatsApp'tan alır.

İşletme sipariş başına komisyon değil, sabit aylık ücret öder.

> **Durum:** Planlama tamamlandı, geliştirme başlamadı. Hafta 1 = 28 Eylül 2026.

## Nereden başlamalı?

1. **[Yönetici özeti](docs/00-yonetici-ozeti.md):** 3 sayfada her şey.
2. **[Kararlar ve sözlük](docs/00-kararlar-ve-sozluk.md):** Bağlayıcı kararlar: isimler, sipariş durumları, roller, fiyatlar, fazlar, açık kararlar.
3. **[Yol haritası ve sprint planı](docs/09-yol-haritasi-ve-sprint-plani.md):** "Yarın sabah ne yapıyoruz?"

## Plan dokümanları

| # | Doküman | Kapsam |
|---|---|---|
| 00 | [Yönetici özeti](docs/00-yonetici-ozeti.md) | Kısa özet, takvim, riskler, karar bekleyenler |
| 00 | [Kararlar ve sözlük](docs/00-kararlar-ve-sozluk.md) | Tek doğruluk kaynağı |
| 01 | [Vizyon, pazar, iş modeli](docs/01-vizyon-pazar-is-modeli.md) | Problem, rakipler, personalar, fiyatlandırma, birim ekonomi, GTM |
| 02 | [WhatsApp entegrasyonu](docs/02-whatsapp-entegrasyonu.md) | Tech Provider, Embedded Signup, Coexistence, şablonlar, konuşma motoru, maliyet |
| 03 | [Müşteri deneyimi ve storefront](docs/03-musteri-deneyimi-ve-storefront.md) | Sipariş akışları A–E, storefront ekranları, tüm Türkçe mesaj metinleri |
| 04 | [İşletme paneli](docs/04-isletme-paneli.md) | Canlı sipariş ekranı, alarm zinciri, menü, ayarlar, kurye, raporlar |
| 05 | [Admin paneli ve pazarlama sitesi](docs/05-admin-paneli-ve-pazarlama-sitesi.md) | Süper admin, bayi paneli, site ve komisyon hesaplayıcısı |
| 06 | [Teknik mimari](docs/06-teknik-mimari.md) | Stack, multi-tenancy, gerçek zamanlılık, yazıcı, AI, altyapı, güvenlik |
| 07 | [Veri modeli ve API](docs/07-veri-modeli-ve-api.md) | Tablolar, ERD, durum makineleri, REST/SSE uç noktaları, olaylar |
| 08 | [Mevzuat, KVKK, ödeme, fatura](docs/08-mevzuat-kvkk-odeme-fatura.md) | KVKK, İYS, e-ticaret, 6493, abonelik tahsilatı, e-fatura, uyum listesi |
| 09 | [Yol haritası ve sprint planı](docs/09-yol-haritasi-ve-sprint-plani.md) | Kritik yol, Faz 0–3, 6 sprint, pilot, ekip, bütçe |
| 10 | [Riskler, operasyon, metrikler](docs/10-riskler-operasyon-ve-metrikler.md) | Risk kaydı, doğrulama deneyleri, destek, olay yönetimi, SLO, KPI |
| 11 | [Finansal model ve finansman](docs/11-finansal-model-ve-finansman.md) | Gelir-gider ve nakit projeksiyonu, senaryolar, sermaye ihtiyacı ([model betiği](docs/finans/model.py)) |
| 12 | [Marka, tasarım ve kullanılabilirlik](docs/12-marka-tasarim-ve-kullanilabilirlik.md) | Marka, tasarım sistemi, ses, basılı şablonlar, kullanılabilirlik testi, cihaz matrisi, eğitim |
| 13 | [Varsayım ve teyit kaydı](docs/13-varsayim-ve-teyit-kaydi.md) | Doğrulanması gereken varsayımlar, sahip ve son tarihleriyle |

Ham araştırma raporları ve kaynak bağlantıları: [docs/arastirma/](docs/arastirma/). Konular: WhatsApp platformu, pazar, mevzuat, mimari, ürün/UX, risk.

## Bir bakışta

- **Kanal:** Yalnız resmi WhatsApp Cloud API. Esnaf "Coexistence" ile numarasını ve telefondaki uygulamasını kaybetmeden bağlanır.
- **Sipariş akışı:**
  - Sohbet → "Menüyü aç" linki → web sepeti → panelde sesli uyarı → WhatsApp'tan durum bildirimleri.
  - QR ve Instagram'dan gelen web siparişleri WhatsApp ile, gerekirse SMS ile doğrulanır.
- **Fiyat (KDV hariç):** Esnaf 990 TL/ay, Pro 1.790 TL/ay, Zincir 2.990 TL/şube/ay (Faz 2).
  - Komisyon yok.
  - 14 gün kartsız deneme.
  - İlk 100 işletme 12 ay %30 indirimli.
- **Stack (varsayılan):** TypeScript monorepo.
  - Next.js 16 (site ve storefront), Vite + React (paneller), Fastify 5 (API, SSE, webhook).
  - BullMQ, PostgreSQL 18 + PostGIS (RLS), Redis, Better Auth.
  - Kişisel veri Türkiye'de barındırılır.
- **Takvim:**
  - Talep go/no-go: 20 Kasım 2026.
  - Pilot (10 işletme): Aralık 2026.
  - Ticari lansman hedefi: 15 Şubat 2027.

## Geliştirme kuralları

Kod yazmaya başlamadan önce [CLAUDE.md](CLAUDE.md) ve [kararlar belgesi](docs/00-kararlar-ve-sozluk.md) okunmalı. Dokümanlar, UI metinleri ve commit mesajları Türkçe; kod ve veritabanı adları İngilizce `snake_case`.

## Yerelde çalıştırma

Gereksinimler: Node.js 22+, pnpm 10 (`corepack enable`), PostgreSQL 16+.

1. **PostgreSQL:** yerel kurulum ya da Docker ile:
   ```bash
   docker run -d --name siparis-pg -p 5432:5432 \
     -e POSTGRES_USER=siparis -e POSTGRES_PASSWORD=siparis -e POSTGRES_DB=siparis_dev postgres:16
   docker exec siparis-pg createdb -U siparis siparis_test      # API testleri için
   ```
2. **Ortam değişkenleri:** `cp .env.example .env`, ardından `ENCRYPTION_KEY`'i doldurun:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Değişkenlerin anlamı: [14 §3](docs/14-uygulama-sartnamesi.md).
3. **Bağımlılıklar ve veritabanı:**
   ```bash
   pnpm install
   pnpm db:migrate        # packages/db/migrations/*.sql
   pnpm db:seed           # demo işletme "Bozok Pide Salonu" (yalnız geliştirme; üretimde çalıştırılmaz)
   # sıfırdan başlamak için: pnpm db:reset && pnpm db:seed   (yalnız *_dev / *_test veritabanları)
   ```
4. **Çalıştırma:** `pnpm dev` → API `http://localhost:4000` (+ worker), web `http://localhost:3000`.

Demo hesapları (seed, yalnız geliştirme):

| Rol | Giriş | Parola | Adres |
|---|---|---|---|
| Platform yöneticisi | `admin@siparisinonunde.local` | `admin1234` | `/admin/giris` |
| İşletme sahibi | `demo@siparisinonunde.local` | `demo1234` | `/panel/giris` |
| Yönetici | `mudur@siparisinonunde.local` | `mudur1234` | `/panel/giris` |
| Kasiyer | `kasa@siparisinonunde.local` | `kasa1234` | `/panel/giris` |
| Mutfak | `mutfak@siparisinonunde.local` | `mutfak1234` | `/panel/giris` |
| Kurye | `kurye@siparisinonunde.local` | `kurye1234` | panel > Kuryeler > giriş bağlantısı |

Vitrin: `http://localhost:3000/s/bozok-pide` · Canlı sipariş ekranı: `/panel` ("Vardiyayı başlat").

**WhatsApp simülatörü** (`/dev/whatsapp`, yalnız `DEV_TOOLS=1`): gerçek WhatsApp hesabı olmadan uçtan uca akış. İşletme numarası olarak "Bozok Pide Salonu · +905550000001"i seçin, müşteri telefonu yazın ve "merhaba" gönderin → gelen karşılama mesajındaki **Menüyü aç** vitrini Akış A bağlamıyla açar; sipariş verin, paneli izleyin. Akış B için vitrinden doğrudan sipariş verip doğrulama ekranındaki kodu simülatörden `Sipariş kodu: XXXXXX` olarak gönderin. "Bekleyen işleri çalıştır" worker'ı beklemeden kuyruğu işler; "SMS kutusu" ve "Platform uyarıları" sekmeleri mock SMS'leri ve işletme sahibine giden uyarıları gösterir. Aynı uçlar API'de: `/api/v1/dev/*` (14 §6.5).

## Testler

```bash
pnpm typecheck                     # tüm paketler
pnpm test                          # Vitest: core birim + API entegrasyon (gerçek PostgreSQL, TEST_DATABASE_URL=siparis_test)
pnpm --filter @siparis/web test    # web birim testleri
pnpm e2e                           # Playwright uçtan uca senaryolar (e2e/)
```

`pnpm e2e` kendi ortamını kurar: API + worker `:4200`, web `next dev :3200` (`NEXT_DIST_DIR=.next-e2e`), veritabanı `siparis_e2e_test` (yoksa oluşturulur; her koşuda sıfırlanır, migrate + seed edilir ve demo şube saatten bağımsız açık yapılır). Senaryolar 14 §10'dakilerdir: Akış A, Akış B, SMS OTP (WhatsApp'sız mod), ret + geri al, kurye, admin salt-okunur destek oturumu, kayıt + kurulum sihirbazı + test siparişi ve 360 px yatay taşma denetimi. Chromium `/opt/pw-browsers`'tan kullanılır; başka makinede `pnpm exec playwright install chromium`. Faydalı seçenekler: tek dosya `pnpm e2e e2e/01-akis-a.spec.ts`, tarayıcıyı görmek için `--headed`, konsol hatalarını yazdırmak için `E2E_PRINT_CONSOLE=1`; başarısız testin izi `test-results/e2e/**/trace.zip` → `pnpm exec playwright show-trace <dosya>`.

## Sunucuya kurulum

Üretim dağıtımı Docker Compose ile tek VPS'tedir (postgres, api, worker, web, caddy): `docker-compose.yml`, `Caddyfile`, `docker/`. Alan adı/DNS, `.env` değişkenleri, ilk kurulum ve admin oluşturma (`scripts/create-admin.ts`), 360dialog ile WhatsApp bağlama, Netgsm, yedekleme/geri yükleme (`scripts/backup.sh`, `scripts/restore.sh`), güncelleme, izleme, sorun giderme ve canlıya çıkış kontrol listesi: **[15 — Kurulum ve işletim rehberi](docs/15-kurulum-ve-isletim.md)**.
