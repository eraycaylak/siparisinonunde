import { describe, expect, it } from 'vitest';
import {
  allNeighborhoods,
  haversineMeters,
  matchNeighborhood,
  neighborhoodKey,
  pointInPolygon,
  resolveZone,
  turkishLower,
  type GeoJsonPolygon,
  type ZoneLike,
} from '../src/zones';

const square: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [34.8, 39.81],
      [34.83, 39.81],
      [34.83, 39.83],
      [34.8, 39.83],
      [34.8, 39.81],
    ],
    [
      [34.81, 39.815],
      [34.815, 39.815],
      [34.815, 39.82],
      [34.81, 39.82],
      [34.81, 39.815],
    ],
  ],
};

describe('zones', () => {
  it('Türkçe küçük harf', () => {
    expect(turkishLower('IŞIK İNCİ')).toBe('ışık inci');
  });

  it('mahalle eşleme harf/boşluk/ek duyarsız', () => {
    const list = ['Aşağınohutlu', 'Yukarı Nohutlu', 'İstiklal'];
    expect(matchNeighborhood('aşağınohutlu mahallesi', list)).toBe('Aşağınohutlu');
    expect(matchNeighborhood('YUKARINOHUTLU Mah.', list)).toBe('Yukarı Nohutlu');
    expect(matchNeighborhood('  istiklal  ', list)).toBe('İstiklal');
    expect(matchNeighborhood('ISTIKLAL', list)).toBeNull(); // I → ı (Türkçe kural)
    expect(matchNeighborhood('Medrese', list)).toBeNull();
    expect(neighborhoodKey('Yeni  Mahalle Mh.')).toBe('yenimahalle');
  });

  it('bitişik "-mahalle" adlarında ek atılmaz; yalnız ayrı kelime atılır', () => {
    expect(neighborhoodKey('Yenimahalle')).toBe('yenimahalle');
    expect(neighborhoodKey('YENİMAHALLE')).toBe('yenimahalle');
    expect(neighborhoodKey('Yenimahalle Mah.')).toBe('yenimahalle');
    expect(neighborhoodKey('Yenimahalle Mahallesi')).toBe('yenimahalle');
    expect(neighborhoodKey('Yenimahalle mh.')).toBe('yenimahalle');
    expect(neighborhoodKey('Yenimahalle mah')).toBe('yenimahalle');
    expect(neighborhoodKey('Cumhuriyet Mahallesi')).toBe('cumhuriyet');
    expect(neighborhoodKey('Cumhuriyet Mahalle')).toBe('cumhuriyet');
    expect(neighborhoodKey('Cumhuriyet Mah.')).toBe('cumhuriyet');
    expect(neighborhoodKey('Cumhuriyet mah')).toBe('cumhuriyet');
    expect(neighborhoodKey('Cumhuriyet Mh.')).toBe('cumhuriyet');
    expect(neighborhoodKey('Mahalle')).toBe('mahalle');
    // Bitişik ad listede ayrı yazılmış varyantıyla da eşleşir, "Yeni" ile karışmaz
    const list = ['Yenimahalle', 'Yeni', 'Cumhuriyet'];
    expect(matchNeighborhood('yenimahalle mahallesi', list)).toBe('Yenimahalle');
    expect(matchNeighborhood('Yeni Mahalle Mah.', list)).toBe('Yenimahalle');
    expect(matchNeighborhood('Yeni Mahallesi', list)).toBe('Yeni');
    expect(matchNeighborhood('Yenimahalle', ['Yeni'])).toBeNull();
  });

  it('point-in-polygon (delik dahil)', () => {
    expect(pointInPolygon({ lat: 39.812, lng: 34.805 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 39.817, lng: 34.812 }, square)).toBe(false); // delikte
    expect(pointInPolygon({ lat: 39.9, lng: 34.805 }, square)).toBe(false);
    expect(pointInPolygon({ lat: 39.812, lng: 34.805 }, null)).toBe(false);
  });

  it('haversine', () => {
    const d = haversineMeters({ lat: 39.8181, lng: 34.8147 }, { lat: 39.8271, lng: 34.8147 });
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it('resolveZone sıraya göre ilk eşleşen', () => {
    const zones: ZoneLike[] = [
      { id: 'r', name: 'Çevre', kind: 'radius', radiusM: 4000, sort: 3 },
      { id: 'n', name: 'Yakın', kind: 'neighborhoods', neighborhoods: ['Medrese', 'Çapanoğlu'], sort: 1 },
      { id: 'p', name: 'Alan', kind: 'polygon', polygon: square, sort: 2 },
      { id: 'x', name: 'Pasif', kind: 'neighborhoods', neighborhoods: ['Tekke'], sort: 0, isActive: false },
    ];
    const center = { lat: 39.8181, lng: 34.8147 };
    expect(resolveZone(zones, { neighborhood: 'medrese' }, { center })?.zone.id).toBe('n');
    expect(resolveZone(zones, { neighborhood: 'Tekke' }, { center })).toBeNull();
    expect(resolveZone(zones, { lat: 39.812, lng: 34.805 }, { center })?.zone.id).toBe('p');
    const r = resolveZone(zones, { lat: 39.84, lng: 34.8147 }, { center });
    expect(r?.zone.id).toBe('r');
    expect(r?.distanceM).toBeGreaterThan(2000);
    expect(resolveZone(zones, { lat: 40.5, lng: 34.8 }, { center })).toBeNull();
    // Mahalle eşleşmesi konumdan önce gelir (sort)
    expect(resolveZone(zones, { neighborhood: 'Çapanoğlu', lat: 39.812, lng: 34.805 }, { center })?.via).toBe('neighborhoods');
  });

  it('tüm mahalleler tekil ve sıralı', () => {
    const zones: ZoneLike[] = [
      { id: 'a', name: 'A', kind: 'neighborhoods', neighborhoods: ['Medrese', 'Çapanoğlu'] },
      { id: 'b', name: 'B', kind: 'neighborhoods', neighborhoods: ['medrese', 'Bahçeşehir'] },
    ];
    expect(allNeighborhoods(zones)).toEqual(['Bahçeşehir', 'Çapanoğlu', 'Medrese']);
  });
});
