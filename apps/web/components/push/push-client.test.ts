import { describe, expect, it } from 'vitest';
import { detectPushPlatform, sameApplicationServerKey, urlBase64ToUint8Array } from './push-client';

const VAPID_PUBLIC = 'BEIRDAhHyygHmkikexZb2oLuF-o5Wj2IeilLb8dNfIYUcFSTxncIIssodgVLvqJtTSBlXKP_AE6b-OGAfXe3ZEo';

describe('urlBase64ToUint8Array', () => {
  it('VAPID genel anahtarını 65 baytlık P-256 noktasına çevirir (base64url, dolgusuz)', () => {
    const bytes = urlBase64ToUint8Array(VAPID_PUBLIC);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
    // Standart base64 ile aynı sonuç
    const std = Buffer.from(VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(Buffer.from(bytes).equals(std)).toBe(true);
  });

  it('dolgu ve URL güvenli karakterler', () => {
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff]);
    expect([...urlBase64ToUint8Array('AQ')]).toEqual([1]);
    expect([...urlBase64ToUint8Array('AQ==')]).toEqual([1]);
    expect(urlBase64ToUint8Array('').length).toBe(0);
  });
});

describe('sameApplicationServerKey', () => {
  it('aynı anahtar true; farklı ya da boş false', () => {
    const buf = urlBase64ToUint8Array(VAPID_PUBLIC).buffer;
    expect(sameApplicationServerKey(buf, VAPID_PUBLIC)).toBe(true);
    const other = new Uint8Array(buf.slice(0));
    other[10] = (other[10]! + 1) % 256;
    expect(sameApplicationServerKey(other.buffer, VAPID_PUBLIC)).toBe(false);
    expect(sameApplicationServerKey(null, VAPID_PUBLIC)).toBe(false);
    expect(sameApplicationServerKey(new ArrayBuffer(3), VAPID_PUBLIC)).toBe(false);
  });
});

describe('detectPushPlatform', () => {
  const IPHONE_17 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const IPHONE_16_3 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1';
  const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-T220) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

  it('iOS Safari (ana ekrana eklenmemiş): önce ana ekrana eklenmeli', () => {
    expect(detectPushPlatform(IPHONE_17, { standalone: false })).toMatchObject({ ios: true, iosVersion: 17.05, needsHomeScreen: true, iosTooOld: false });
    expect(detectPushPlatform(IPHONE_17, { standalone: true })).toMatchObject({ ios: true, needsHomeScreen: false });
  });

  it('iOS 16.4 öncesi web push yok', () => {
    expect(detectPushPlatform(IPHONE_16_3, { standalone: true })).toMatchObject({ ios: true, iosTooOld: true, needsHomeScreen: false });
  });

  it('masaüstü kimlikli iPad dokunmatik noktalarından tanınır; Mac tanınmaz', () => {
    expect(detectPushPlatform(IPAD_DESKTOP, { standalone: false, maxTouchPoints: 5 })).toMatchObject({ ios: true, iosVersion: 17.04, needsHomeScreen: true });
    expect(detectPushPlatform(IPAD_DESKTOP, { standalone: false, maxTouchPoints: 0 })).toMatchObject({ ios: false, needsHomeScreen: false });
  });

  it('Android: ana ekran şartı yok', () => {
    expect(detectPushPlatform(ANDROID, { standalone: false })).toMatchObject({ ios: false, iosVersion: null, needsHomeScreen: false, iosTooOld: false });
  });
});
