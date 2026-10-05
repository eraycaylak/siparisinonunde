// Panel açılış kapısı: panelin boyanması için tarayıcıda GERÇEKTEN bulunması gereken CSS özellikleri (04 §4.17).
// Restoranın eski Android tableti ya da eski iPad'inde panel sessizce bozuk açılmasın; kullanıcı ne yapacağını bilsin.
//
// Eşikler tahmin DEĞİL: `apps/web/app/globals.css` projenin kendi `@tailwindcss/postcss` eklentisiyle
// (tailwindcss 4.3.3, `optimize: true` = üretim çıktısı) derlendi ve 69 411 baytlık çıktı tarandı. Kaynak CSS'te hiç
// `oklch`/`color-mix` yok (tüm token'lar hex); aşağıdaki sayılar Tailwind'in kendi ürettiği CSS'ten gelir ve aynı
// derlemeyle yeniden üretilebilir:
//
//   | Üretilen CSS'te                       | Sayı | Tailwind yedeği                              | Kapıda mı |
//   |---------------------------------------|------|----------------------------------------------|-----------|
//   | `color-mix(in oklab, …)`              |  35  | 35'inin HEPSİ `@supports (color:color-mix(in  | EVET      |
//   |   (border-color 15, background-color  |      | lab, red, red))` içinde ve her birinin önünde |           |
//   |   15, color 3, ring 1, gradient-from 1)|     | DÜZ renkli yedek var → saydamlık kaybolur,   |           |
//   |                                       |      | renk katı olur (ör. `::placeholder` %50       |           |
//   |                                       |      | yerine tam opak). `color-mix(in srgb, …)`     |           |
//   |                                       |      | çıktıda HİÇ geçmiyor                          |           |
//   | `dvh` (`min-h-dvh` + 4 `calc(100dvh…)`|  23  | YOK → bildirim geçersiz olur, yükseklik       | EVET      |
//   |   panel kabuğu, sheet, dialog, sohbet)|      | hesaplanmaz, düzen çöker                      |           |
//   | `oklch()` (`--color-neutral-200`)     |   1  | YOK, ama tek kullanıcısı `.bg-neutral-200` =  | evet      |
//   |                                       |      | fiş çıktısındaki not zemini                   | (bedava)  |
//   | `linear-gradient(… in oklab, …)`      |   1  | YOK, ama tek kullanıcısı VİTRİN               | HAYIR     |
//   |                                       |      | (`components/storefront/store-header.tsx`)    |           |
//   | `@property --tw-*`                    |  71  | VAR: Tailwind `@layer properties` + eski      | HAYIR     |
//   |                                       |      | Safari/Firefox için `@supports` yedeği basar  |           |
//
// Kapıya girmeyenler ve nedenleri:
//  - `linear-gradient(… in oklab, …)`: panelde hiç yok. Kapıya alınsaydı Firefox 113–127 (color-mix ✓, dvh ✓, oklch ✓,
//    oklab gradyan ✗) panel kusursuz boyanırken kapatılamaz "panel bozuk" bandını görürdü — YANLIŞ ALARM.
//  - `@property`: Tailwind kendi yedeğini basar.
//  - `@layer`, `:is()`, `:where()`, `:has()`, CSS nesting: color-mix'ten eski eşikler (nesting üretim çıktısında
//    düzleştirilir), color-mix destekleniyorsa bunlar da desteklenir.
//
// `oklch` kapıda kalır ama hiçbir tarayıcıda TEK BAŞINA tetiklenmez: oklch her motorda color-mix'ten önce geldi
// (Chrome 111 ↔ 111, Safari 15.4 ↔ 16.2, Firefox 113 ↔ 113), yani eksikse color-mix de eksiktir. Bedava ek kanıt.
//
// Eşiği belirleyen bu yüzden `color-mix`: Chrome/Edge 111, Safari 16.2, Firefox 113. `dvh` daha eski (Chrome 108,
// Safari 15.4, Firefox 101) ama tek gerçek DÜZEN kırıcısıdır — yedeği yoktur.
//
// Karar: sürüm numarasına değil ÖZELLİĞE bakılır (`CSS.supports`). Sürüm tablosu (PANEL_MIN_BROWSERS) yalnız "en az şu
// sürüme güncelleyin" cümlesini yazmak içindir ve Tailwind 4'ün tam tabanını söyler — eski bir kullanıcı ajanı
// özellikleri destekliyorsa uyarı çıkmaz.

/** `CSS.supports(property, value)` imzası (test edilebilirlik için enjekte edilir). */
export type CssSupports = (property: string, value: string) => boolean;

export interface CssFeature {
  /** Teşhis kimliği (konsola/rapora yazılır, kullanıcıya gösterilmez). */
  id: 'color-mix' | 'dvh' | 'oklch';
  property: string;
  value: string;
  /** Uyarının ayrıntı bölümünde görünen Türkçe sonuç. */
  broken: string;
}

/**
 * Panelin doğru boyanması için gereken özellikler. Sıra ağırlığa göredir: `color-mix` eşiği belirler, `dvh` tek
 * gerçek düzen kırıcısıdır, `oklch` bedava ek kanıttır (tek başına hiç tetiklenmez).
 * Listeye yeni özellik eklemeden önce PANELDE gerçekten kullanıldığını doğrula (yukarıdaki tabloya bak):
 * panelde olmayan bir özellik yüzünden kapatılamaz "panel bozuk" bandı çıkarmak yanlış alarmdır.
 */
export const PANEL_CSS_FEATURES: readonly CssFeature[] = [
  {
    id: 'color-mix',
    property: 'color',
    // Tailwind'in üretilen CSS'te kendi kullandığı yoklamanın aynısı: @supports (color: color-mix(in lab, red, red))
    value: 'color-mix(in lab, red, red)',
    // Tailwind her color-mix'in önüne düz renkli yedek basar: renk kaybolmaz, SAYDAMLIĞI kaybolur.
    broken: 'Soluk kenarlıklar, yarı saydam zeminler ve seçili durumlar katı renge döner; sütunlar birbirinden ayırt edilemez.',
  },
  {
    id: 'dvh',
    property: 'height',
    value: '100dvh',
    broken: 'Ekran yüksekliği hiç hesaplanmaz; sipariş listesi, çekmeceler ve bantlar taşar ya da üst üste biner.',
  },
  {
    id: 'oklch',
    property: 'color',
    value: 'oklch(50% 0.1 250)',
    broken: 'Fiş çıktısında sipariş notunun vurgu zemini boyanmaz.',
  },
] as const;

export interface BrowserSupportVerdict {
  /** true: panel bu tarayıcıda doğru boyanır, uyarı gösterilmez. */
  ok: boolean;
  /** Desteklenmeyen özelliklerin kimlikleri (teşhis). */
  missing: CssFeature['id'][];
  /** `CSS.supports` hiç yok → tarayıcı tek tek sınanamayacak kadar eski. */
  probeUnavailable: boolean;
}

/**
 * Tarayıcıyı sınar. `supports` verilmezse (sunucu tarafı render ya da `CSS.supports` olmayan tarayıcı)
 * `probeUnavailable` döner; sunucuda uyarı BASILMAZ, karar istemcide verilir (bkz. OldBrowserNotice).
 */
export function evaluateCssSupport(supports: CssSupports | null | undefined): BrowserSupportVerdict {
  if (typeof supports !== 'function') return { ok: false, missing: [], probeUnavailable: true };
  const missing: CssFeature['id'][] = [];
  for (const feature of PANEL_CSS_FEATURES) {
    let supported = false;
    try {
      supported = supports(feature.property, feature.value) === true;
    } catch {
      supported = false;
    }
    if (!supported) missing.push(feature.id);
  }
  return { ok: missing.length === 0, missing, probeUnavailable: false };
}

/** Tarayıcıdaki gerçek yoklama (istemci). `CSS.supports` yoksa null döner. */
export function browserCssSupports(): CssSupports | null {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return null;
  return (property: string, value: string) => CSS.supports(property, value);
}

// ---------------------------------------------------------------------------
// "Hangi sürüme güncelleyeyim" tablosu (Tailwind 4 tabanı: Chrome 111, Safari 16.4, Firefox 128)

/** Panelin desteklendiği en düşük sürümler (yalnız uyarı metni içindir; karar `CSS.supports` ile verilir). */
export const PANEL_MIN_BROWSERS = {
  chrome: '111',
  edge: '111',
  firefox: '128',
  safari: '16.4',
  ios: '16.4',
} as const;

export interface UpdateTarget {
  /** Kullanıcıya gösterilecek tarayıcı adı; tanınmadıysa null. */
  browser: string | null;
  /** En az bu sürüm gerekir; bilinmiyorsa null. */
  minVersion: string | null;
  /** Kullanıcı ajanından okunabilen mevcut sürüm; okunamadıysa null. */
  currentVersion: string | null;
  /** Türkçe, tek adımlık yapılacak iş. */
  howTo: string;
}

function major(match: RegExpExecArray | null): string | null {
  return match?.[1] ?? null;
}

/**
 * Kullanıcı ajanından güncelleme hedefi. iOS'ta tüm tarayıcılar WebKit olduğu için çözüm tarayıcı değil
 * işletim sistemi güncellemesidir; Android'de Chrome Play Store'dan güncellenir.
 */
export function updateTargetFor(userAgent: string): UpdateTarget {
  const ua = userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua);

  if (ios) {
    return {
      browser: 'Safari',
      minVersion: PANEL_MIN_BROWSERS.ios,
      currentVersion: major(/OS (\d+)[_.]/.exec(ua)),
      // iPhone/iPad'de her tarayıcı Safari motorunu kullanır: tarayıcıyı değiştirmek çözmez.
      howTo: `iPhone ve iPad'de Ayarlar › Genel › Yazılım Güncelleme ile iOS ${PANEL_MIN_BROWSERS.ios} veya üstüne güncelleyin. Başka tarayıcı kurmak bu sorunu çözmez.`,
    };
  }

  if (/Edg\//.test(ua)) {
    return {
      browser: 'Edge',
      minVersion: PANEL_MIN_BROWSERS.edge,
      currentVersion: major(/Edg\/(\d+)/.exec(ua)),
      howTo: `Edge'i ${PANEL_MIN_BROWSERS.edge} veya üstüne güncelleyin (Edge menüsü › Yardım ve geri bildirim › Microsoft Edge hakkında).`,
    };
  }

  if (/SamsungBrowser\//.test(ua)) {
    return {
      browser: 'Samsung Internet',
      // Samsung Internet sürüm ↔ Chromium eşlemesi kesin değil: numara uydurulmaz.
      minVersion: null,
      currentVersion: major(/SamsungBrowser\/(\d+)/.exec(ua)),
      howTo: `Galaxy Store'dan Samsung Internet'i güncelleyin; güncelleme yoksa paneli Chrome ${PANEL_MIN_BROWSERS.chrome} veya üstünde açın.`,
    };
  }

  if (/Firefox\//.test(ua)) {
    return {
      browser: 'Firefox',
      minVersion: PANEL_MIN_BROWSERS.firefox,
      currentVersion: major(/Firefox\/(\d+)/.exec(ua)),
      howTo: `Firefox'u ${PANEL_MIN_BROWSERS.firefox} veya üstüne güncelleyin (menü › Yardım › Firefox Hakkında).`,
    };
  }

  if (/Chrome\/|CriOS\//.test(ua)) {
    const android = /Android/.test(ua);
    return {
      browser: 'Chrome',
      minVersion: PANEL_MIN_BROWSERS.chrome,
      currentVersion: major(/Chrome\/(\d+)/.exec(ua)),
      howTo: android
        ? `Play Store'u açın, Chrome'u arayın ve "Güncelle"ye dokunun (en az sürüm ${PANEL_MIN_BROWSERS.chrome}). Android sürümü çok eskiyse Chrome güncellenemez; panel için başka bir tablet gerekir.`
        : `Chrome'u ${PANEL_MIN_BROWSERS.chrome} veya üstüne güncelleyin (menü › Yardım › Google Chrome Hakkında), sonra tarayıcıyı kapatıp açın.`,
    };
  }

  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) {
    return {
      browser: 'Safari',
      minVersion: PANEL_MIN_BROWSERS.safari,
      currentVersion: major(/Version\/(\d+)/.exec(ua)),
      howTo: `macOS'u güncelleyerek Safari'yi ${PANEL_MIN_BROWSERS.safari} veya üstüne çıkarın (Sistem Ayarları › Genel › Yazılım Güncelleme).`,
    };
  }

  return {
    browser: null,
    minVersion: null,
    currentVersion: null,
    howTo: `Paneli güncel Chrome ya da Edge ile açın (en az sürüm ${PANEL_MIN_BROWSERS.chrome}).`,
  };
}

/** Uyarı başlığı: kısa, tek cümle, ne yapılacağını söyler (04 §1.3 düşük dijital okuryazarlık). */
export const OLD_BROWSER_TITLE = 'Tarayıcınız eski — panel bozuk görünüyor';

/** Uyarı gövdesi: neden önemli. Sürüme bağlı kısım `updateTargetFor().howTo` ile eklenir. */
export const OLD_BROWSER_BODY =
  'Bu tarayıcı panelin renklerini ve yerleşimini gösteremiyor. Siparişleri kaçırmamak için tarayıcıyı güncelleyin.';
