'use client';

import { useId, useRef, useState } from 'react';
import { ImageUp, Link2, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch, errorMessage, isApiError } from '@/lib/api';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Logo/kapak alanı: POST /panel/uploads (menü dilimi) ile yükleme; yükleme kullanılamazsa görsel adresi girilir.
 * Boyut yetersizse reddedilmez, uyarı gösterilir (12 §5.2).
 */
export function ImageField({
  label,
  hint,
  value,
  onChange,
  minWidth,
  minHeight,
  aspect = 'square',
  error,
}: {
  label: string;
  hint: string;
  value: string | null;
  onChange: (url: string | null) => void;
  minWidth: number;
  minHeight: number;
  aspect?: 'square' | 'wide';
  error?: string;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [urlMode, setUrlMode] = useState(false);
  const [lowRes, setLowRes] = useState(false);

  async function upload(file: File) {
    setUploadError(null);
    if (file.size > MAX_BYTES) {
      setUploadError('Görsel en fazla 5 MB olabilir.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    setUploading(true);
    try {
      const res = await apiFetch<{ url: string }>('/panel/uploads', { method: 'POST', body: form });
      onChange(res.url);
    } catch (err) {
      if (isApiError(err) && (err.status === 404 || err.status === 0)) {
        setUrlMode(true);
        setUploadError('Görsel yükleme şu an kullanılamıyor. Görselin adresini yapıştırabilirsiniz.');
      } else {
        setUploadError(errorMessage(err, 'Görsel yüklenemedi.'));
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-fg" id={`${inputId}-label`}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={
            aspect === 'square'
              ? 'flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface'
              : 'flex h-20 w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface'
          }
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="size-full object-cover"
              onLoad={(e) => setLowRes(e.currentTarget.naturalWidth < minWidth || e.currentTarget.naturalHeight < minHeight)}
            />
          ) : (
            <ImageUp aria-hidden className="size-6 text-fg-muted" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-labelledby={`${inputId}-label`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={uploading}>
            <ImageUp aria-hidden />
            {value ? 'Değiştir' : 'Görsel yükle'}
          </Button>
          <Button variant="ghost" onClick={() => setUrlMode((v) => !v)} aria-expanded={urlMode}>
            <Link2 aria-hidden />
            Adres gir
          </Button>
          {value ? (
            <Button variant="ghost" onClick={() => onChange(null)}>
              <Trash2 aria-hidden />
              Kaldır
            </Button>
          ) : null}
        </div>
      </div>
      {urlMode ? (
        <Input
          type="url"
          inputMode="url"
          placeholder="https://… ya da /api/v1/uploads/…"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          aria-label={`${label} adresi`}
        />
      ) : null}
      <p className="text-sm text-fg-muted">{hint}</p>
      {lowRes && value ? (
        <p className="flex items-center gap-1.5 text-sm text-warning">
          <TriangleAlert aria-hidden className="size-4" />
          Bu görsel bulanık görünebilir (en az {minWidth}×{minHeight} px önerilir).
        </p>
      ) : null}
      {uploadError ? <p className="text-sm font-medium text-destructive">{uploadError}</p> : null}
      {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
