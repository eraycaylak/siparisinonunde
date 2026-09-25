# CLAUDE.md — siparisinonunde

Türkiye'deki işletmeler için komisyonsuz, WhatsApp üzerinden sipariş alma SaaS'ı. Faz 1 kodu yazıldı ve çalışıyor (pilot: Yozgat / Merkez). Plan `docs/` altında; uygulamanın bağlayıcı teknik sözleşmesi `docs/14-uygulama-sartnamesi.md`, kurulum ve işletim `docs/15-kurulum-ve-isletim.md`.

## Önce bunları oku
- `docs/00-kararlar-ve-sozluk.md`: **bağlayıcı** kararlar, sözlük, sipariş durum makinesi, roller, enum'lar. Kodda ve dokümanda isimler buradakiyle birebir aynı olmalı. Bir kararı değiştirmek gerekiyorsa önce bu dosyayı güncelle, sonra kodu.
- Konuya göre ilgili doküman: WhatsApp → `02`, müşteri akışları → `03`, işletme paneli → `04`, admin/site → `05`, mimari → `06`, veri modeli/API → `07`, mevzuat → `08`, yol haritası → `09`, riskler/metrikler → `10`.

## Dil
- Dokümanlar, UI metinleri ve commit mesajları Türkçe.
- Kod, tablo ve kolon adları, enum değerleri İngilizce `snake_case`. Tablo adları çoğul (`orders`, `order_items`).

## Değişmez kurallar (kod yazarken)
1. **Yalnız resmi WhatsApp Cloud API.** Baileys, whatsapp-web.js, Evolution API gibi resmi olmayan kütüphaneler hiçbir koşulda eklenmez.
2. **Tenant yalıtımı:** Her tabloda `tenant_id` bulunur (küresel tablolar `packages/db/test/schema.test.ts`'te belgelenmiş istisnadır). Kapsam uygulama katmanında zorunludur; PostgreSQL RLS sonraki sertleştirme adımıdır (00 §12a). Sorgular tenant bağlamı olmadan çalışmaz. Yeni her tablo ve uç nokta için tenant yalıtım testi yazılır.
3. **Fiyat ve toplamlar yalnız sunucuda hesaplanır.** İstemciden ya da LLM'den gelen fiyat kabul edilmez. Sipariş anında ürün adı ve fiyatı kopyalanır (snapshot).
4. **Sipariş kaçmaz:** Sipariş durum değişiklikleri `branch_events` olay günlüğüne yazılır. Panel SSE + `Last-Event-ID` ile beslenir. Yan etkiler (WhatsApp mesajı, yazdırma, bildirim) **outbox** üzerinden gider.
5. **Durum makineleri** (sipariş ve konuşma) `packages/core` içinde, tablo güdümlü ve %100 birim testlidir. Geçişler kararlar dosyasındaki tabloyla birebir aynıdır.
6. **Idempotency:** WhatsApp `wamid` UNIQUE'tir. Webhook işleyici ham olayı kaydeder, hemen 200 döner, kuyruğa atar. Dış çağrılarda idempotency anahtarı kullanılır.
7. **Kişisel veri:** Loglarda telefon ve adres maskelenir. Sentry'de PII temizlenir. LLM'e giden metinde telefon ve adres maskelenir. Kişisel veri Türkiye'deki altyapıda tutulur.
8. **Mesaj bütçesi:** Sipariş başına en fazla 4 durum mesajı gönderilir (gecikme/iptal gibi olağan dışı bilgilendirmeler bütçe dışıdır; Akış A'daki karşılama + "Menüyü aç" ek 1 mesajdır). 60 sn debounce ("alındı" + "onaylandı" tek mesaj) **yalnız Akış A'da** uygulanır; Akış B'de kod mesajına "alındı" yanıtı anında gider. Sipariş durum şablonlarına promosyon veya indirim kodu eklenmez; bunlar İYS kapsamındaki ticari ileti sayılır.
9. **Para** integer kuruş + `currency` olarak tutulur. Zaman `timestamptz` (UTC) olarak saklanır, `Europe/Istanbul` ile gösterilir.
10. Müşteri parası hiçbir akışta platform hesabından geçmez (6493 sayılı Kanun).

## Stack (uygulanan; bkz. `docs/00-kararlar-ve-sozluk.md` §12a ve `docs/14-uygulama-sartnamesi.md`)
pnpm monorepo (`packages/core`, `packages/db`, `apps/api`, `apps/web`, `e2e`). Bileşenler:
- Next.js 16 (tek uygulama): pazarlama sitesi, storefront, işletme paneli, admin, kurye. `apps/web/AGENTS.md`'yi oku: bu Next sürümünün API'leri eğitim verisinden farklı olabilir.
- Fastify 5: API, SSE ve webhook; worker aynı kod tabanından ayrı süreç
- Yalnız PostgreSQL: Drizzle, `jobs` tablosu + outbox + `LISTEN/NOTIFY` (Redis/BullMQ yok, PostGIS yok)
- Kendi oturum sistemi (scrypt + HttpOnly çerez), TOTP 2FA
- Zod 4 sözleşmeleri `packages/core/src/contracts`
- WhatsApp: `WhatsAppProvider` (`mock` / `cloud` / `d360` = 360dialog)

## Komutlar
- `pnpm dev` (API :4000 + worker + web :3000), `pnpm typecheck`, `ALLOW_DB_RESET=1 pnpm test`, `pnpm --filter @siparis/web test`, `pnpm e2e`
- Veritabanı: `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset` (yalnız `*_dev` / `*_test`)
