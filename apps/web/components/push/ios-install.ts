// iPhone/iPad'de Web Push yalnız "Ana Ekrana Ekle" ile kurulmuş web uygulamasında çalışır (iOS 16.4+, 06 §7.8,
// 04 §4.1 "iOS'ta ana ekrana eklenmemişse: rehber"). Tarayıcı sekmesinde izin penceresi HİÇ çıkmaz: `PushManager`
// yoktur, `enablePush()` `needs_home_screen` döner. Kullanıcı bunu bilmezse "bildirim açtım" sanıp sipariş kaçırır.
//
// Bu dosya rehberin saf (test edilebilir) kısmıdır: hangi tarayıcıda hangi adımlar, rehber ne zaman gösterilir.

import type { PushPlatform } from './push-client';

/** Ana ekrandaki simgenin adı — `app/panel/manifest.webmanifest/route.ts` içindeki `short_name` ile aynı olmalı. */
export const IOS_HOME_SCREEN_NAME = 'Siparişler';

/** iOS'ta panelin açıldığı tarayıcı. Motor hepsinde WebKit'tir; yalnız Paylaş simgesinin YERİ değişir. */
export type IosBrowser = 'safari' | 'chrome' | 'other';

/** iOS tarayıcısı. Sıra önemli: Chrome iOS'ta kullanıcı ajanı hem CriOS hem Safari içerir. */
export function iosBrowserOf(userAgent: string): IosBrowser {
  if (/CriOS\//.test(userAgent)) return 'chrome';
  if (/FxiOS\/|EdgiOS\/|OPT\/|YaBrowser\//.test(userAgent)) return 'other';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

export interface IosInstallGuide {
  browser: IosBrowser;
  /** Rehber başlığı. */
  title: string;
  /** Neden gerekli — tek cümle. */
  why: string;
  /** Sırayla yapılacaklar. */
  steps: readonly string[];
  /** Adımlar tutmazsa ne yapılacağı; gerekmiyorsa null. */
  fallback: string | null;
}

const WHY = `iPhone ve iPad'de bildirim, panel ana ekrana eklenmeden gelmez. Sekmede açık panel kapanınca yeni sipariş bildirimi hiç ulaşmaz.`;

const COMMON_TAIL: readonly string[] = [
  `Ana ekranda çıkan "${IOS_HOME_SCREEN_NAME}" simgesine dokunarak paneli açın ve giriş yapın.`,
  'Panelde Ayarlar › Bu cihazda bildirimler\'i açın ve çıkan pencerede "İzin Ver"e dokunun.',
];

/** Tarayıcıya göre "Ana Ekrana Ekle" adımları. Adımlar kullanıcıya göründüğü gibi yazılır (04 §1.3). */
export function iosInstallGuide(browser: IosBrowser): IosInstallGuide {
  if (browser === 'chrome') {
    return {
      browser,
      title: 'iPhone ve iPad: paneli ana ekrana ekleyin',
      why: WHY,
      steps: [
        'Chrome\'da adres çubuğunun sağındaki Paylaş simgesine (kutudan çıkan ok) dokunun.',
        'Listeyi kaydırıp "Ana Ekrana Ekle"ye dokunun.',
        'Sağ üstteki "Ekle"ye dokunun.',
        ...COMMON_TAIL,
      ],
      fallback: '"Ana Ekrana Ekle" görünmüyorsa paneli Safari\'de açıp adımları orada yapın.',
    };
  }
  if (browser === 'other') {
    return {
      browser,
      title: 'iPhone ve iPad: paneli Safari ile ana ekrana ekleyin',
      why: WHY,
      steps: [
        'Paneli Safari\'de açın (bu tarayıcıda "Ana Ekrana Ekle" bulunmayabilir).',
        'Alt çubuktaki Paylaş simgesine (kutudan çıkan ok) dokunun.',
        'Listeyi kaydırıp "Ana Ekrana Ekle"ye, sonra sağ üstte "Ekle"ye dokunun.',
        ...COMMON_TAIL,
      ],
      fallback: null,
    };
  }
  return {
    browser: 'safari',
    title: 'iPhone ve iPad: paneli ana ekrana ekleyin',
    why: WHY,
    steps: [
      'Safari\'nin alt çubuğundaki Paylaş simgesine (kutudan çıkan ok) dokunun.',
      'Listeyi kaydırıp "Ana Ekrana Ekle"ye dokunun.',
      'Sağ üstteki "Ekle"ye dokunun.',
      ...COMMON_TAIL,
    ],
    fallback: 'Paylaş simgesi görünmüyorsa sayfayı aşağı kaydırıp tekrar yukarı çekin; Safari alt çubuğu gizlemiş olabilir.',
  };
}

/**
 * Rehber gösterilsin mi: yalnız iOS'ta, ana ekrana eklenmemişken ve iOS sürümü web push'u destekliyorken.
 * iOS 16.4'ten eskide ana ekrana eklemek de yetmez (ayrı uyarı: "iOS sürümü eski").
 */
export function shouldOfferIosInstall(platform: Pick<PushPlatform, 'needsHomeScreen' | 'iosTooOld'>): boolean {
  return platform.needsHomeScreen && !platform.iosTooOld;
}

/** Vardiya ekranındaki tek satırlık özet (tam rehber çekmecede açılır). */
export const IOS_INSTALL_SHORT = 'Bu iPhone/iPad\'de panel kapalıyken bildirim gelmez.';
