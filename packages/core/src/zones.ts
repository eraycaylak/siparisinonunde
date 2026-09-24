// Teslimat bölgesi eşleme (00 §12a: PostGIS yok). Mahalle listesi, poligon, yarıçap.

import type { DeliveryZoneKind } from './enums';

export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON Polygon: coordinates[halka][nokta] = [lng, lat]; ilk halka dış sınır, sonrakiler delik. */
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface ZoneLike {
  id: string;
  name: string;
  kind: DeliveryZoneKind;
  neighborhoods?: string[] | null;
  polygon?: GeoJsonPolygon | null;
  radiusM?: number | null;
  isActive?: boolean;
  sort?: number;
}

/** Türkçe büyük/küçük harf duyarsız küçük harf (İ→i, I→ı). */
export function turkishLower(input: string): string {
  return input.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
}

/**
 * Sondaki mahalle eki — yalnız AYRI kelime olarak ("Cumhuriyet Mah.", "Aşağı Mahallesi"). Bitişik adlarda
 * ("Yenimahalle", "Karşıyakamahallesi" gibi özel adlar) ek atılmaz: "Yenimahalle" → "yenimahalle", "yeni" değil.
 */
const NEIGHBORHOOD_SUFFIX = /\s+(mahallesi|mahalesi|mahalle|mah\.?|mh\.?)$/u;

/**
 * Mahalle karşılaştırma anahtarı: Türkçe küçük harf, sondaki ayrı "Mahallesi/Mahalle/Mah./Mh." kelimesi (bir kez)
 * atılır, noktalama ve tüm boşluklar yok sayılır. "Yeni  Mahalle Mah." ≡ "Yenimahalle" ≡ "yenimahalle".
 */
export function neighborhoodKey(input: string): string {
  let s = turkishLower(input).normalize('NFC').trim().replace(/\s+/g, ' ');
  s = s.replace(NEIGHBORHOOD_SUFFIX, '');
  return s.replace(/[\s.,'’\-_/]+/g, '');
}

/** Girdiyi listedeki mahallelerden biriyle eşler; listedeki kanonik adı döner. */
export function matchNeighborhood(input: string | null | undefined, list: readonly string[] | null | undefined): string | null {
  if (!input || !list?.length) return null;
  const key = neighborhoodKey(input);
  if (!key) return null;
  for (const name of list) {
    if (neighborhoodKey(name) === key) return name;
  }
  return null;
}

/** Işın atma ile nokta-halka testi. point/ring: [lng, lat]. Sınır üstü dahil sayılmaz garantisi yok. */
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Nokta poligonun içinde mi (delikler hariç). */
export function pointInPolygon(point: LatLng, polygon: GeoJsonPolygon | null | undefined): boolean {
  if (!polygon || polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates)) return false;
  const [outer, ...holes] = polygon.coordinates;
  if (!outer || outer.length < 3) return false;
  if (!pointInRing(point.lng, point.lat, outer)) return false;
  return !holes.some((h) => h.length >= 3 && pointInRing(point.lng, point.lat, h));
}

const EARTH_RADIUS_M = 6371008.8;

/** Kuş uçuşu mesafe (metre). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

export interface ZoneQuery {
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface ZoneMatch<Z extends ZoneLike> {
  zone: Z;
  /** Mahalle eşleşmesinde listedeki kanonik ad. */
  neighborhood: string | null;
  via: DeliveryZoneKind;
  distanceM?: number;
}

/**
 * Adres/konum için bölgeyi bulur. Aktif bölgeler `sort` sırasıyla denenir, ilk eşleşen döner.
 * Yarıçap bölgesinin merkezi şube konumudur (`center`).
 */
export function resolveZone<Z extends ZoneLike>(
  zones: readonly Z[],
  query: ZoneQuery,
  opts: { center?: LatLng | null } = {},
): ZoneMatch<Z> | null {
  const point = isValidLatLng({ lat: query.lat ?? undefined, lng: query.lng ?? undefined })
    ? { lat: query.lat as number, lng: query.lng as number }
    : null;
  const ordered = zones
    .filter((z) => z.isActive !== false)
    .map((z, i) => ({ z, i }))
    .sort((a, b) => (a.z.sort ?? 0) - (b.z.sort ?? 0) || a.i - b.i)
    .map((x) => x.z);

  for (const zone of ordered) {
    if (zone.kind === 'neighborhoods') {
      const name = matchNeighborhood(query.neighborhood, zone.neighborhoods);
      if (name) return { zone, neighborhood: name, via: 'neighborhoods' };
    } else if (zone.kind === 'polygon') {
      if (point && pointInPolygon(point, zone.polygon)) return { zone, neighborhood: null, via: 'polygon' };
    } else if (zone.kind === 'radius') {
      if (point && opts.center && isValidLatLng(opts.center) && zone.radiusM && zone.radiusM > 0) {
        const d = haversineMeters(opts.center, point);
        if (d <= zone.radiusM) return { zone, neighborhood: null, via: 'radius', distanceM: Math.round(d) };
      }
    }
  }
  return null;
}

/** Tüm aktif mahalle listelerinin birleşimi (storefront mahalle seçici için). */
export function allNeighborhoods(zones: readonly ZoneLike[]): string[] {
  const seen = new Map<string, string>();
  for (const z of zones) {
    if (z.isActive === false || z.kind !== 'neighborhoods') continue;
    for (const n of z.neighborhoods ?? []) {
      const key = neighborhoodKey(n);
      if (key && !seen.has(key)) seen.set(key, n);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'tr'));
}
