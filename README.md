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
