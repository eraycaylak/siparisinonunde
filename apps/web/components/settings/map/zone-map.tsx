'use client';

import { useEffect, useRef } from 'react';
import type { Marker } from 'maplibre-gl';
import { MapPinOff } from 'lucide-react';
import type { ZoneDto } from '@siparis/core/settings/contracts';
import { DEFAULT_CENTER, circleRing, featureCollection, setGeoJsonSource, useMaplibre } from './use-maplibre';

type LngLat = [number, number];

const polygonFeature = (ring: number[][]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });

/**
 * Bölge haritası: çokgen çizimi (tıklayarak nokta ekle), yarıçap önizlemesi (şube merkezli daire) ve diğer bölgelerin
 * silik ana hatları. Çizim durumu üst bileşendedir.
 */
export function ZoneMap({
  center,
  mode,
  points,
  closed,
  radiusM,
  otherZones,
  onAddPoint,
}: {
  center: { lat: number; lng: number } | null;
  mode: 'polygon' | 'radius' | 'view';
  points: LngLat[];
  closed: boolean;
  radiusM: number | null;
  otherZones: ZoneDto[];
  onAddPoint?: (p: LngLat) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { map, lib, status } = useMaplibre(ref, { center: center ?? DEFAULT_CENTER, zoom: 13 });
  const addRef = useRef(onAddPoint);
  addRef.current = onAddPoint;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const closedRef = useRef(closed);
  closedRef.current = closed;
  const markerRef = useRef<Marker | null>(null);

  // Katmanlar (bir kez)
  useEffect(() => {
    if (!map) return;
    const empty = featureCollection([]);
    for (const id of ['others', 'draft-fill', 'draft-line', 'draft-points', 'radius']) setGeoJsonSource(map, id, empty);
    map.addLayer({ id: 'others-fill', type: 'fill', source: 'others', paint: { 'fill-color': '#6b7280', 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'others-line', type: 'line', source: 'others', paint: { 'line-color': '#6b7280', 'line-width': 1.5, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#1d4ed8', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#1d4ed8', 'line-width': 2 } });
    map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft-fill', paint: { 'fill-color': '#15803d', 'fill-opacity': 0.2 } });
    map.addLayer({ id: 'draft-line', type: 'line', source: 'draft-line', paint: { 'line-color': '#15803d', 'line-width': 2.5 } });
    map.addLayer({
      id: 'draft-points',
      type: 'circle',
      source: 'draft-points',
      paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#15803d', 'circle-stroke-width': 2.5 },
    });
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => {
      if (modeRef.current === 'polygon' && !closedRef.current) addRef.current?.([round(e.lngLat.lng), round(e.lngLat.lat)]);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [map]);

  // Şube işareti
  useEffect(() => {
    if (!map || !lib || !center) return;
    if (!markerRef.current) markerRef.current = new lib.Marker({ color: '#14233A' }).setLngLat([center.lng, center.lat]).addTo(map);
    else markerRef.current.setLngLat([center.lng, center.lat]);
  }, [map, lib, center]);

  // Diğer bölgeler
  useEffect(() => {
    if (!map) return;
    const features = otherZones
      .map((z) => {
        if (z.kind === 'polygon' && z.polygon?.coordinates[0]) return polygonFeature(z.polygon.coordinates[0]);
        if (z.kind === 'radius' && z.radiusM && center) return polygonFeature(circleRing(center, z.radiusM));
        return null;
      })
      .filter(Boolean) as object[];
    setGeoJsonSource(map, 'others', featureCollection(features));
  }, [map, otherZones, center]);

  // Çizim
  useEffect(() => {
    if (!map) return;
    const ring = [...points];
    setGeoJsonSource(map, 'draft-points', featureCollection(points.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))));
    const line = closed && ring.length >= 3 ? [...ring, ring[0]!] : ring;
    setGeoJsonSource(
      map,
      'draft-line',
      featureCollection(line.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }] : []),
    );
    setGeoJsonSource(map, 'draft-fill', featureCollection(ring.length >= 3 ? [polygonFeature([...ring, ring[0]!])] : []));
    if (mode === 'polygon') map.getCanvas().style.cursor = closed ? '' : 'crosshair';
    else map.getCanvas().style.cursor = '';
  }, [map, points, closed, mode]);

  // Yarıçap önizlemesi
  useEffect(() => {
    if (!map) return;
    const show = mode === 'radius' && center && radiusM && radiusM > 0;
    setGeoJsonSource(map, 'radius', featureCollection(show ? [polygonFeature(circleRing(center!, radiusM!))] : []));
    if (show) {
      const ring = circleRing(center!, radiusM!, 16);
      const lngs = ring.map((p) => p[0]!);
      const lats = ring.map((p) => p[1]!);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 32, duration: 300 },
      );
    }
  }, [map, mode, center, radiusM]);

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-lg border border-border bg-surface sm:h-96">
      <div ref={ref} className="size-full" role="application" aria-label="Teslimat bölgesi haritası" />
      {status === 'loading' || status === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-fg-muted">
          {status === 'error' ? (
            <>
              <MapPinOff aria-hidden className="size-6" />
              Harita yüklenemedi. Mahalle listesi ya da yarıçap ile bölge tanımlayabilirsiniz.
            </>
          ) : (
            'Harita yükleniyor…'
          )}
        </div>
      ) : null}
      {status === 'degraded' ? (
        <p className="pointer-events-none absolute inset-x-2 top-2 rounded-md bg-surface-raised/95 px-3 py-2 text-xs text-fg-muted shadow-sm">
          Harita altlığı şu an yüklenemedi; işaret ve çizim yine çalışır.
        </p>
      ) : null}
    </div>
  );
}

function round(v: number) {
  return Math.round(v * 1e6) / 1e6;
}
