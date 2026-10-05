// Akış B doğrulama ekranının UÇ SÖZLEŞMESİ (denetim 2026-10-05 MEDIUM A).
//
// NEDEN BÖYLE BİR TEST: ekran "sepetiniz güncellendi" dalında [Güncel sepetle devam] düğmesi gösterip
// `POST /store/track/:token/accept-changes` çağırıyordu. Böyle bir uç ne API'de ne 14 §6.2 sözleşmesinde vardı:
// her tıklama 404 dönüyor, müşteri ÇIKMAZ SOKAKTA kalıyordu. Tip denetimi bunu yakalayamaz (yol düz metin),
// birim testi de yakalayamaz (ağ mock'lanır). Yakalayan tek şey budur: ekranın çağırdığı her storefront yolunun
// sunucuda KAYITLI olduğunu kanıtlamak.
//
// Test kaynak metni okur çünkü kanıtlanan şey davranış değil SÖZLEŞME: istemcinin yazdığı yol ile sunucunun
// kaydettiği yol aynı mı. Yorumlar bilerek taranmaz — yalnız `apiFetch(...)` çağrılarındaki yollar sayılır,
// böylece "kaldırıldı" notu içinde geçen eski yol yanlış pozitif üretmez.
//
// KAPSAM: ekranın kendisi + çizdiği `sms-verify-panel.tsx` (ağ yüzeyinin tamamı). Checkout yolunda ayrı bir ekran
// YOKTUR: `components/storefront/checkout/verification-screen.tsx` yalnız `VerificationHandoff`'u yeniden dışa
// veren bir kabuktur (/t/<token>'a yönlendirir), kendi uç çağrısı yoktur.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SCREEN = read('./verification-screen.tsx');
/**
 * Ekranın AĞ YÜZEYİ tek dosya değildir: SMS dalını çizen `sms-verify-panel.tsx` kendi uçlarını (`sms-otp`,
 * `sms-verify`) çağırır. Kapı o dosyayı da taramazsa ölü çağrı bir alt bileşene yazılarak geri gelebilirdi.
 */
const SCREEN_SOURCES = [SCREEN, read('./sms-verify-panel.tsx')].join('\n');
/** Storefront uçları iki dosyada kayıtlı; ikisi de `/api/v1/store` ön ekiyle bağlanır (apps/api/src/app.ts). */
const ROUTE_FILES = ['../../../api/src/routes/store/orders.ts', '../../../api/src/routes/store/storefront.ts'].map(read);

/** `${token}` ve `:token` gibi değişken parçaları tek bir biçime indirir: iki taraf karşılaştırılabilir olsun. */
function normalize(path: string): string {
  return path.replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':p');
}

/** Ekranın `apiFetch` ile çağırdığı storefront yolları (sunucudaki ön ek düşülmüş). */
function calledStorePaths(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/apiFetch(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    const path = m[1]!;
    if (path.startsWith('/store/')) found.add(normalize(path.slice('/store'.length)));
  }
  return [...found];
}

/** Route dosyalarındaki `app.post('/track/:token/cancel', …)` kayıtları. */
function registeredStorePaths(sources: string[]): string[] {
  const found = new Set<string>();
  for (const source of sources) {
    for (const m of source.matchAll(/app\.(?:get|post|put|patch|delete)(?:<[^>]*>)?\(\s*'([^']+)'/g)) {
      found.add(normalize(m[1]!));
    }
  }
  return [...found];
}

describe('doğrulama ekranı · uç sözleşmesi', () => {
  it('ekranın çağırdığı her storefront yolu sunucuda kayıtlı (ölü düğme olamaz)', () => {
    const called = calledStorePaths(SCREEN_SOURCES);
    const registered = registeredStorePaths(ROUTE_FILES);
    // Ekran en az bir uç çağırıyor olmalı: regex bozulup liste boşalırsa test sessizce "geçmesin"
    expect(called.length).toBeGreaterThan(0);
    expect(registered).toContain('/track/:p/cancel');
    // Alt bileşen de tarandığının kanıtı: panelin uçları listede olmalı (dosya yolu değişirse test kırılır)
    expect(called).toContain('/orders/:p/sms-verify');
    expect(called.filter((p) => !registered.includes(p))).toEqual([]);
  });

  it('ölü `accept-changes` çağrısı geri gelmez', () => {
    expect(calledStorePaths(SCREEN_SOURCES).some((p) => p.includes('accept-changes'))).toBe(false);
    // Uç gerçekten yazılırsa bu test de güncellenmelidir: o gün sunucuda kayıtlı olacağı için üstteki test geçer,
    // bu satır ise bilerek elle değiştirilmek üzere durur (sessiz geri dönüş olmasın).
    expect(ROUTE_FILES.join('\n')).not.toContain('accept-changes');
  });

  it('sepet değişikliği dalı müşteriyi çıkmaz sokakta bırakmaz: arama + iptal yolu var', () => {
    // Onay düğmesini taşıyan bileşen (cart-change-notice) ARTIK ÇİZİLMEZ: onayın arkasındaki uç yok. Gerekçe
    // ekranın içindeki yorumda: sipariş anında fiyat kopyalanır (snapshot) + sipariş sonrası onay Faz 2'de (M14).
    // Etiket metni yerine import aranır: ekranın kendi yorumu eski etiketi anlatıyor, metin araması onu sayardı.
    expect(SCREEN).not.toContain("from './cart-change-notice'");
    expect(SCREEN).toContain('İşletmeyi ara');
    expect(SCREEN).toContain('Vazgeçtim, siparişi iptal et');
  });
});
