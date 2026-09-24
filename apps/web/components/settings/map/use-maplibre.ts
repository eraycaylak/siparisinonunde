'use client';

// MapLibre GL (14 §1: harita, OpenFreeMap stili). Tarayıcıda dinamik yüklenir; WebGL yoksa ya da stil
// yüklenemezse 'error' durumuna düşer ve bileşen elle giriş seçeneğini gösterir.

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Map as MlMap } from 'maplibre-gl';

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
/** Yozgat Merkez (pilot bölge, 00 §12a). */
export const DEFAULT_CENTER = { lat: 39.8181, lng: 34.8147 } as const;

export type MaplibreModule = typeof import('maplibre-gl');
export type MapStatus = 'loading' | 'ready' | 'error';

export function useMaplibre(
  containerRef: RefObject<HTMLDivElement | null>,
  opts: { center: { lat: number; lng: number }; zoom?: number },
): { map: MlMap | null; lib: MaplibreModule | null; status: MapStatus } {
  const [state, setState] = useState<{ map: MlMap | null; lib: MaplibreModule | null; status: MapStatus }>({ map: null, lib: null, status: 'loading' });
  const initial = useRef(opts);

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    const el = containerRef.current;
    if (!el) return;
    (async () => {
      try {
        const lib = await import('maplibre-gl');
        if (cancelled) return;
        map = new lib.Map({
          container: el,
          style: MAP_STYLE_URL,
          center: [initial.current.center.lng, initial.current.center.lat],
          zoom: initial.current.zoom ?? 13,
          attributionControl: { compact: true },
          cooperativeGestures: false,
        });
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        let loaded = false;
        const timer = window.setTimeout(() => {
          if (!loaded && !cancelled) setState((s) => (s.status === 'loading' ? { ...s, status: 'error' } : s));
        }, 12_000);
        map.on('load', () => {
          loaded = true;
          window.clearTimeout(timer);
          if (!cancelled) setState({ map, lib, status: 'ready' });
        });
        map.on('error', (e) => {
          if (!loaded && !cancelled && /style|webgl/i.test(String((e as { error?: Error }).error?.message ?? ''))) {
            setState({ map: null, lib, status: 'error' });
          }
        });
      } catch {
        if (!cancelled) setState({ map: null, lib: null, status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
      try {
        map?.remove();
      } catch {
        /* yok say */
      }
    };
  }, [containerRef]);

  return state;
}

const EARTH_R = 6371008.8;

/** Merkez + yarıçaptan (m) daire poligonu (GeoJSON [lng, lat] halka). */
export function circleRing(center: { lat: number; lng: number }, radiusM: number, steps = 64): number[][] {
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const d = radiusM / EARTH_R;
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return ring;
}

/** GeoJSON kaynağını oluşturur ya da günceller. */
export function setGeoJsonSource(map: MlMap, id: string, data: object) {
  const src = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
  if (src?.setData) src.setData(data);
  else map.addSource(id, { type: 'geojson', data: data as never });
}

export function featureCollection(features: object[]): object {
  return { type: 'FeatureCollection', features };
}
