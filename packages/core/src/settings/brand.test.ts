import { describe, expect, it } from 'vitest';
import { BRAND_PRESETS, DARK_BG, WHITE, brandPalette, contrastRatio } from './brand';
import { polygonFromPoints, validateAlarmPolicy, validatePolygon, validateWeeklyHours } from './validation';

function expectThresholds(hex: string) {
  const p = brandPalette(hex);
  expect(contrastRatio(p.brand, p.brandContrast), `${hex} buton`).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(p.brandStrong, WHITE), `${hex} strong`).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(p.brandUi, WHITE), `${hex} ui`).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(p.brandDark, DARK_BG), `${hex} koyu`).toBeGreaterThanOrEqual(3);
}

describe('brandPalette (12 §5.1)', () => {
  it('doküman örnekleri', () => {
    expect(contrastRatio('#E53935', WHITE)).toBeCloseTo(4.23, 1);
    const red = brandPalette('#E53935');
    expect(red.adjusted).toBe(true);
    expect(red.brandContrast).toBe(WHITE);
    expect(brandPalette('#FFD400').brandContrast).toBe('#111827');
    expect(brandPalette('#8E24AA').brandContrast).toBe(WHITE);
    expect(brandPalette('#8E24AA').adjusted).toBe(false);
    expect(brandPalette(null).input).toBe(BRAND_PRESETS[0]!.hex);
  });

  it('hazır renkler eşikleri sağlar', () => {
    for (const p of BRAND_PRESETS) expectThresholds(p.hex);
  });

  it('200 rastgele renk eşikleri sağlar', () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const hex = `#${Math.floor(rnd() * 0xffffff)
        .toString(16)
        .padStart(6, '0')
        .toUpperCase()}`;
      expectThresholds(hex);
    }
  });
});

describe('ayar doğrulama', () => {
  it('alarm politikası sınırları', () => {
    expect(validateAlarmPolicy({ auto_cancel_minutes: 15, customer_notice_minutes: 10, platform_wa_enabled: true, sms_enabled: true })).toEqual([]);
    expect(validateAlarmPolicy({ auto_cancel_minutes: 9, customer_notice_minutes: 4, platform_wa_enabled: true, sms_enabled: true })).toHaveLength(2);
    expect(validateAlarmPolicy({ auto_cancel_minutes: 12, customer_notice_minutes: 8, platform_wa_enabled: true, sms_enabled: true })[0]?.path).toBe(
      'alarmPolicy.customer_notice_minutes',
    );
  });

  it('haftalık saatler: gece yarısı ve çakışma', () => {
    expect(validateWeeklyHours([{ weekday: 5, intervals: [{ opensAt: '18:00', closesAt: '02:00' }] }, { weekday: 6, intervals: [{ opensAt: '11:00', closesAt: '23:00' }] }])).toEqual([]);
    expect(validateWeeklyHours([{ weekday: 5, intervals: [{ opensAt: '18:00', closesAt: '02:00' }] }, { weekday: 6, intervals: [{ opensAt: '01:00', closesAt: '10:00' }] }])).toHaveLength(1);
    // Cumartesi gecesi → Pazar sabahı (hafta döngüsü)
    expect(validateWeeklyHours([{ weekday: 6, intervals: [{ opensAt: '20:00', closesAt: '03:00' }] }, { weekday: 0, intervals: [{ opensAt: '02:00', closesAt: '05:00' }] }])).toHaveLength(1);
    expect(validateWeeklyHours([{ weekday: 1, intervals: [{ opensAt: '11:00', closesAt: '15:00' }, { opensAt: '14:00', closesAt: '23:00' }] }])).toHaveLength(1);
    expect(validateWeeklyHours([{ weekday: 1, intervals: [{ opensAt: '25:00', closesAt: '15:00' }] }])).toHaveLength(1);
  });

  it('poligon doğrulama', () => {
    expect(validatePolygon(polygonFromPoints([[34.8, 39.8], [34.82, 39.8], [34.82, 39.82]]))).toBeNull();
    expect(validatePolygon({ type: 'Polygon', coordinates: [[[34.8, 39.8], [34.82, 39.8], [34.8, 39.8]]] })).not.toBeNull();
    expect(validatePolygon({ type: 'Polygon', coordinates: [[[34.8, 39.8], [34.82, 39.8], [34.82, 39.82], [34.9, 39.9]]] })).toMatch(/kapalı/);
    expect(validatePolygon({ type: 'Point', coordinates: [1, 2] })).not.toBeNull();
    expect(validatePolygon(polygonFromPoints([[34.8, 39.8], [34.81, 39.8], [34.82, 39.8]]))).toMatch(/çizgi/);
  });
});
