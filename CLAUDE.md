# CLAUDE.md — siparisinonunde

Türkiye'deki işletmeler için komisyonsuz, WhatsApp üzerinden sipariş alma SaaS'ı. Şu an **planlama aşamasında**; kod henüz yok. Tüm plan `docs/` altında.

## Önce bunları oku
- `docs/00-kararlar-ve-sozluk.md`: **bağlayıcı** kararlar, sözlük, sipariş durum makinesi, roller, enum'lar. Kodda ve dokümanda isimler buradakiyle birebir aynı olmalı. Bir kararı değiştirmek gerekiyorsa önce bu dosyayı güncelle, sonra kodu.
- Konuya göre ilgili doküman: WhatsApp → `02`, müşteri akışları → `03`, işletme paneli → `04`, admin/site → `05`, mimari → `06`, veri modeli/API → `07`, mevzuat → `08`, yol haritası → `09`, riskler/metrikler → `10`.

## Dil
- Dokümanlar, UI metinleri ve commit mesajları Türkçe.
- Kod, tablo ve kolon adları, enum değerleri İngilizce `snake_case`. Tablo adları çoğul (`orders`, `order_items`).

## Değişmez kurallar (kod yazarken)
1. **Yalnız resmi WhatsApp Cloud API.** Baileys, whatsapp-web.js, Evolution API gibi resmi olmayan kütüphaneler hiçbir koşulda eklenmez.
2. **Tenant yalıtımı:** Her tabloda `tenant_id` bulunur. PostgreSQL RLS açıktır. Sorgular tenant bağlamı olmadan çalışmaz. Yeni her tablo ve uç nokta için tenant yalıtım testi yazılır.
3. **Fiyat ve toplamlar yalnız sunucuda hesaplanır.** İstemciden ya da LLM'den gelen fiyat kabul edilmez. Sipariş anında ürün adı ve fiyatı kopyalanır (snapshot).
4. **Sipariş kaçmaz:** Sipariş durum değişiklikleri `branch_events` olay günlüğüne yazılır. Panel SSE + `Last-Event-ID` ile beslenir. Yan etkiler (WhatsApp mesajı, yazdırma, bildirim) **outbox** üzerinden gider.
5. **Durum makineleri** (sipariş ve konuşma) `packages/core` içinde, tablo güdümlü ve %100 birim testlidir. Geçişler kararlar dosyasındaki tabloyla birebir aynıdır.
6. **Idempotency:** WhatsApp `wamid` UNIQUE'tir. Webhook işleyici ham olayı kaydeder, hemen 200 döner, kuyruğa atar. Dış çağrılarda idempotency anahtarı kullanılır.
7. **Kişisel veri:** Loglarda telefon ve adres maskelenir. Sentry'de PII temizlenir. LLM'e giden metinde telefon ve adres maskelenir. Kişisel veri Türkiye'deki altyapıda tutulur.
8. **Mesaj bütçesi:** Sipariş başına en fazla 4 durum mesajı gönderilir (60 sn debounce ile). Sipariş durum şablonlarına promosyon veya indirim kodu eklenmez; bunlar İYS kapsamındaki ticari ileti sayılır.
9. **Para** integer kuruş + `currency` olarak tutulur. Zaman `timestamptz` (UTC) olarak saklanır, `Europe/Istanbul` ile gösterilir.
10. Müşteri parası hiçbir akışta platform hesabından geçmez (6493 sayılı Kanun).

## Stack (varsayılan, bkz. `docs/06-teknik-mimari.md`)
pnpm + Turborepo monorepo. Bileşenler:
- Next.js 16: pazarlama sitesi ve storefront
- Vite + React SPA: panel ve admin
- Fastify 5: API, SSE ve webhook
- BullMQ worker'ları
- PostgreSQL 18 + PostGIS, Drizzle
- Redis/Valkey
- Better Auth
- Zod 4
