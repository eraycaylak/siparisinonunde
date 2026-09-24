'use client';

import { useEffect, useRef, useState } from 'react';
import type { Marker } from 'maplibre-gl';
import { Crosshair, MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_CENTER, useMaplibre } from './use-maplibre';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Haritada pin seçimi: tıkla ya da pini sürükle; harita açılmazsa enlem/boylam elle girilir (04 §3.5). */
export function LocationPicker({ value, onChange }: { value: LatLng | null; onChange: (v: LatLng | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { map, lib, status } = useMaplibre(ref, { center: value ?? DEFAULT_CENTER, zoom: value ? 15 : 13 });
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [geoError, setGeoError] = useState<string | null>(null);

  // Tıklayınca pin
  useEffect(() => {
    if (!map) return;
    const handler = (e: { lngLat: { lat: number; lng: number } }) => onChangeRef.current({ lat: round(e.lngLat.lat), lng: round(e.lngLat.lng) });
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [map]);

  // Pin konumu değer ile senkron
  useEffect(() => {
    if (!map || !lib) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new lib.Marker({ draggable: true, color: '#14233A' }).setLngLat([value.lng, value.lat]).addTo(map);
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLngLat();
        onChangeRef.current({ lat: round(p.lat), lng: round(p.lng) });
      });
    } else {
      markerRef.current.setLngLat([value.lng, value.lat]);
    }
  }, [map, lib, value]);

  function useMyLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Tarayıcınız konum paylaşımını desteklemiyor.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const v = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) };
        onChange(v);
        map?.flyTo({ center: [v.lng, v.lat], zoom: 16 });
      },
      () => setGeoError('Konum alınamadı. Haritada işaretleyin.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-72 w-full overflow-hidden rounded-lg border border-border bg-surface sm:h-80">
        <div ref={ref} className="absolute inset-0" aria-label="Şube konumu haritası" role="application" />
        {status !== 'ready' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-fg-muted">
            {status === 'error' ? (
              <>
                <MapPinOff aria-hidden className="size-6" />
                Harita yüklenemedi. Konumu aşağıya elle girebilirsiniz.
              </>
            ) : (
              'Harita yükleniyor…'
            )}
          </div>
        ) : null}
      </div>
      <p className="text-sm text-fg-muted">Haritaya dokunarak şubenizin yerini işaretleyin; pini sürükleyerek düzeltebilirsiniz.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-36 flex-col gap-1 text-sm font-semibold text-fg">
          Enlem
          <Input
            inputMode="decimal"
            value={value ? String(value.lat) : ''}
            onChange={(e) => {
              const lat = Number(e.target.value.replace(',', '.'));
              if (Number.isFinite(lat) && lat >= -90 && lat <= 90) onChange({ lat, lng: value?.lng ?? DEFAULT_CENTER.lng });
            }}
          />
        </label>
        <label className="flex w-36 flex-col gap-1 text-sm font-semibold text-fg">
          Boylam
          <Input
            inputMode="decimal"
            value={value ? String(value.lng) : ''}
            onChange={(e) => {
              const lng = Number(e.target.value.replace(',', '.'));
              if (Number.isFinite(lng) && lng >= -180 && lng <= 180) onChange({ lat: value?.lat ?? DEFAULT_CENTER.lat, lng });
            }}
          />
        </label>
        <Button variant="secondary" onClick={useMyLocation}>
          <Crosshair aria-hidden />
          Konumumu kullan
        </Button>
      </div>
      {geoError ? <p className="text-sm text-destructive">{geoError}</p> : null}
    </div>
  );
}

function round(v: number) {
  return Math.round(v * 1e6) / 1e6;
}
