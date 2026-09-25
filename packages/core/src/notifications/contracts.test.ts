import { describe, expect, it } from 'vitest';
import { newOrderPushText, panelOfflineAlertText } from '../messages/tr';
import { isAllowedPushEndpoint, pushSubscribeRequestSchema } from './contracts';

const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

describe('push abonelik adresi', () => {
  it('yalnız bilinen itme servisleri ve https', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://fcm.googleapis.com/wp/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
      'https://web.push.apple.com/QGx',
      'https://wns2-am3p.notify.windows.com/w/?token=x',
      'https://android.googleapis.com/gcm/send/x',
    ]) {
      expect(isAllowedPushEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/fcm.googleapis.com',
      'https://notfcm.googleapis.com.example/x',
      'https://user:pass@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://127.0.0.1/x',
      'https://api:4000/x',
      'fcm.googleapis.com/x',
      '',
    ]) {
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
    }
  });

  it('abonelik şeması PushSubscription.toJSON() biçimini kabul eder, eksik/bozuk anahtarı reddeder', () => {
    expect(pushSubscribeRequestSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', expirationTime: null, keys: KEYS }).success).toBe(true);
    expect(pushSubscribeRequestSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { ...KEYS, auth: 'kısa' } }).success).toBe(false);
    expect(pushSubscribeRequestSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { auth: KEYS.auth } }).success).toBe(false);
    const bad = pushSubscribeRequestSchema.safeParse({ endpoint: 'https://example.com/push', keys: KEYS });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Bu tarayıcının bildirim servisi desteklenmiyor.');
  });
});

describe('işletme uyarı metinleri', () => {
  it('yeni sipariş bildirimi: numara, ürün adedi, tutar; mutfakta tutar yok; kurulum testinde TEST etiketi', () => {
    expect(newOrderPushText({ number: 1051, itemCount: 3, totalKurus: 24500 })).toEqual({ title: 'Yeni sipariş #1051', body: '3 ürün · 245,00 TL' });
    expect(newOrderPushText({ number: 1051, itemCount: 3, totalKurus: null })).toEqual({ title: 'Yeni sipariş #1051', body: '3 ürün' });
    expect(newOrderPushText({ number: 7, itemCount: 1, totalKurus: 5000, test: true }).title).toBe('Yeni sipariş TEST #7');
  });

  it('panel çevrimdışı metni', () => {
    expect(panelOfflineAlertText({ isletme: 'Bozok Pide', dk: 5 })).toBe(
      'Bozok Pide: sipariş ekranı 5 dakikadır kapalı görünüyor. Siparişleri kaçırmamak için paneli açın.',
    );
    expect(panelOfflineAlertText({ isletme: 'Bozok Pide', dk: 0 })).toContain('1 dakikadır');
  });
});
