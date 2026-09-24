'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, MapPin, MapPinned, Pencil, Plus, Search, Trash2, Undo2 } from 'lucide-react';
import { DELIVERY_ZONE_KIND_LABELS, formatTL, parseTRY, type DeliveryZoneKind } from '@siparis/core';
import type { ZoneCreate, ZoneDto } from '@siparis/core/settings/contracts';
import { ZONE_RADIUS_LIMITS, polygonFromPoints, validatePolygon } from '@siparis/core/settings/validation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Sheet } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { apiFetch, errorMessage } from '@/lib/api';
import { SETTINGS_KEYS, useBranchId, useBranchSettings, useZones } from './api';
import { ZoneMap } from './map/zone-map';
import { Section, SettingsError, SettingsLoading, issuesOf } from './settings-shell';
import { TagInput } from './tag-input';

type LngLat = [number, number];

interface Draft {
  id: string | null;
  name: string;
  kind: DeliveryZoneKind;
  neighborhoods: string[];
  points: LngLat[];
  closed: boolean;
  radiusKm: string;
  fee: string;
  min: string;
  eta: string;
  isActive: boolean;
}

const kurusToInput = (k: number) => (k / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');

function newDraft(kind: DeliveryZoneKind = 'neighborhoods'): Draft {
  return { id: null, name: '', kind, neighborhoods: [], points: [], closed: false, radiusKm: '3', fee: '0', min: '150', eta: '30', isActive: true };
}

function fromZone(z: ZoneDto): Draft {
  const ring = z.polygon?.coordinates[0] ?? [];
  return {
    id: z.id,
    name: z.name,
    kind: z.kind,
    neighborhoods: z.neighborhoods,
    points: ring.slice(0, -1).map((p) => [p[0]!, p[1]!] as LngLat),
    closed: ring.length >= 4,
    radiusKm: z.radiusM ? String(z.radiusM / 1000).replace('.', ',') : '3',
    fee: kurusToInput(z.feeKurus),
    min: kurusToInput(z.minOrderKurus),
    eta: String(z.etaMinutes),
    isActive: z.isActive,
  };
}

function summary(z: ZoneDto): string {
  if (z.kind === 'neighborhoods') return `${z.neighborhoods.length} mahalle: ${z.neighborhoods.slice(0, 4).join(', ')}${z.neighborhoods.length > 4 ? '…' : ''}`;
  if (z.kind === 'radius') return `Şubeden ${((z.radiusM ?? 0) / 1000).toLocaleString('tr-TR')} km`;
  return `Haritada alan · ${(z.polygon?.coordinates[0]?.length ?? 1) - 1} köşe`;
}

/** Teslimat bölgeleri (04 §7.5, P-17): liste + düzenleyici (mahalle etiketleri / çokgen / yarıçap) + adres testi. */
export function ZonesManager() {
  const branchId = useBranchId();
  const branch = useBranchSettings(branchId);
  const zones = useZones(branchId);
  const [draft, setDraft] = useState<Draft | null>(null);

  if (!branchId) return <SettingsError error={new Error('Şube bulunamadı')} />;
  if (zones.isPending || branch.isPending) return <SettingsLoading />;
  if (zones.isError) return <SettingsError error={zones.error} onRetry={() => void zones.refetch()} />;
  if (branch.isError) return <SettingsError error={branch.error} onRetry={() => void branch.refetch()} />;

  const center = branch.data.lat != null && branch.data.lng != null ? { lat: branch.data.lat, lng: branch.data.lng } : null;
  const items = zones.data.items;

  return (
    <div className="flex flex-col gap-4">
      {!branch.data.acceptsDelivery ? (
        <p className="rounded-md bg-info-bg p-3 text-sm text-fg">
          Paket servis kapalı. Bölgeler yalnız paket servis açıkken kullanılır.{' '}
          <Link className="font-semibold underline" href="/panel/ayarlar/sube">
            Şube ayarları
          </Link>
        </p>
      ) : null}
      <Section title="Bölgeler" description="Adres birden çok bölgeye uyarsa listedeki ilk bölge geçerlidir.">
        {items.length === 0 ? (
          <EmptyState
            icon={MapPinned}
            title="Henüz bölge yok"
            description="Mahalle listesiyle başlamak en kolayıdır. Haritada alan çizebilir ya da şubeden yarıçap verebilirsiniz."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
                <MapPin aria-hidden className="size-5 shrink-0 text-fg-muted" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                    {z.name}
                    <Badge variant="outline" size="sm">
                      {DELIVERY_ZONE_KIND_LABELS[z.kind]}
                    </Badge>
                    {!z.isActive ? (
                      <Badge variant="neutral" size="sm">
                        Pasif
                      </Badge>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-fg-muted">{summary(z)}</span>
                  <span className="text-sm text-fg">
                    Ücret {z.feeKurus ? formatTL(z.feeKurus) : 'ücretsiz'} · En az {formatTL(z.minOrderKurus)} · {z.etaMinutes} dk
                  </span>
                </div>
                <Button variant="secondary" onClick={() => setDraft(fromZone(z))}>
                  <Pencil aria-hidden />
                  Düzenle
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDraft(newDraft('neighborhoods'))}>
            <Plus aria-hidden />
            Bölge ekle
          </Button>
          {center ? (
            <Button variant="secondary" onClick={() => setDraft({ ...newDraft('radius'), name: 'Yakın çevre' })}>
              3 km hazır bölge
            </Button>
          ) : null}
        </div>
      </Section>

      <ZoneCheck />

      <Sheet open={draft !== null} onOpenChange={(o) => !o && setDraft(null)} title={draft?.id ? 'Bölgeyi düzenle' : 'Yeni bölge'} size="lg">
        {draft ? (
          <ZoneEditor
            branchId={branchId}
            draft={draft}
            setDraft={(fn) => setDraft((d) => (d ? fn(d) : d))}
            center={center}
            otherZones={items.filter((z) => z.id !== draft.id)}
            onClose={() => setDraft(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function ZoneEditor({
  branchId,
  draft,
  setDraft,
  center,
  otherZones,
  onClose,
}: {
  branchId: string;
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  center: { lat: number; lng: number } | null;
  otherZones: ZoneDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const radiusM = Math.round(Number(draft.radiusKm.replace(',', '.')) * 1000);
  const polygon = draft.points.length >= 3 ? polygonFromPoints(draft.points) : null;

  function localErrors(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!draft.name.trim()) e.name = 'Bölgeye bir ad verin.';
    if (draft.kind === 'neighborhoods' && draft.neighborhoods.length === 0) e.neighborhoods = 'En az bir mahalle ekleyin.';
    if (draft.kind === 'polygon') {
      const p = polygon ? validatePolygon(polygon) : 'Haritada en az 3 nokta işaretleyin.';
      if (p) e.polygon = p;
      else if (!draft.closed) e.polygon = 'Çizimi bitirmek için "Bitir"e basın.';
    }
    if (draft.kind === 'radius') {
      if (!Number.isFinite(radiusM) || radiusM < ZONE_RADIUS_LIMITS.min || radiusM > ZONE_RADIUS_LIMITS.max) e.radiusM = 'Yarıçap 0,1–30 km olmalı.';
      if (!center) e.radiusM = 'Önce şube konumunu seçin.';
    }
    for (const [k, v] of [
      ['feeKurus', draft.fee],
      ['minOrderKurus', draft.min],
    ] as const) {
      const n = parseTRY(v || '0');
      if (n === null || n < 0) e[k] = 'Geçerli bir tutar girin.';
    }
    const eta = Number(draft.eta);
    if (!Number.isInteger(eta) || eta < 0 || eta > 600) e.etaMinutes = 'Süreyi dakika olarak girin.';
    return e;
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const e = localErrors();
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: ZoneCreate = {
      branchId,
      name: draft.name.trim(),
      kind: draft.kind,
      neighborhoods: draft.kind === 'neighborhoods' ? draft.neighborhoods : [],
      polygon: draft.kind === 'polygon' ? polygon : null,
      radiusM: draft.kind === 'radius' ? radiusM : null,
      feeKurus: parseTRY(draft.fee || '0') ?? 0,
      minOrderKurus: parseTRY(draft.min || '0') ?? 0,
      etaMinutes: Number(draft.eta),
      isActive: draft.isActive,
    };
    setSaving(true);
    try {
      if (draft.id) {
        const { branchId: _b, ...patch } = body;
        await apiFetch(`/panel/zones/${draft.id}`, { method: 'PATCH', body: patch });
      } else {
        await apiFetch('/panel/zones', { method: 'POST', body });
      }
      await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.zones(branchId) });
      await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.onboarding });
      toast.success('Bölge kaydedildi.');
      onClose();
    } catch (err) {
      setErrors(issuesOf(err));
      toast.error(errorMessage(err, 'Bölge kaydedilemedi.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setSaving(true);
    try {
      await apiFetch(`/panel/zones/${draft.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.zones(branchId) });
      toast.success('Bölge silindi.');
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Silinemedi.'));
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const neighborhoodErr = errors.neighborhoods ?? Object.entries(errors).find(([k]) => k.startsWith('neighborhoods.'))?.[1];

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      <Field label="Bölge adı" required error={errors.name}>
        <Input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={60} placeholder="Ör. Yakın, Merkez, Uzak" />
      </Field>
      <RadioGroup
        legend="Bölge türü"
        variant="chips"
        value={draft.kind}
        onValueChange={(v) => set('kind', v)}
        options={[
          { value: 'neighborhoods', label: 'Mahalle listesi' },
          { value: 'polygon', label: 'Haritada çiz' },
          { value: 'radius', label: 'Yarıçap' },
        ]}
      />

      {draft.kind === 'neighborhoods' ? (
        <TagInput
          label="Mahalleler"
          values={draft.neighborhoods}
          onChange={(v) => set('neighborhoods', v)}
          placeholder="Mahalle adı yazıp Enter'a basın"
          hint="Virgülle ayırarak birden çok mahalleyi aynı anda ekleyebilirsiniz. Bir mahalle yalnız bir bölgede olabilir."
          error={neighborhoodErr}
        />
      ) : null}

      {draft.kind === 'polygon' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-muted">Haritaya dokunarak alanın köşelerini sırayla işaretleyin, sonra “Bitir”e basın.</p>
          <ZoneMap center={center} mode="polygon" points={draft.points} closed={draft.closed} radiusM={null} otherZones={otherZones} onAddPoint={(p) => set('points', [...draft.points, p])} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={!draft.points.length || draft.closed} onClick={() => set('points', draft.points.slice(0, -1))}>
              <Undo2 aria-hidden />
              Geri al
            </Button>
            <Button variant="secondary" size="sm" disabled={draft.points.length < 3 || draft.closed} onClick={() => set('closed', true)}>
              <Check aria-hidden />
              Bitir
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!draft.points.length}
              onClick={() => setDraft((d) => ({ ...d, points: [], closed: false }))}
            >
              <Trash2 aria-hidden />
              Temizle
            </Button>
            <span className="self-center text-sm text-fg-muted">{draft.points.length} nokta{draft.closed ? ' · tamamlandı' : ''}</span>
          </div>
          {errors.polygon ? <p className="text-sm font-medium text-destructive">{errors.polygon}</p> : null}
        </div>
      ) : null}

      {draft.kind === 'radius' ? (
        <div className="flex flex-col gap-2">
          {!center ? (
            <p className="rounded-md bg-warning-bg p-3 text-sm text-fg">
              Yarıçaplı bölge için önce{' '}
              <Link className="font-semibold underline" href="/panel/ayarlar/sube">
                şube konumunu
              </Link>{' '}
              haritadan seçin.
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            {['1', '2', '3', '5'].map((km) => (
              <Button key={km} variant={draft.radiusKm === km ? 'primary' : 'secondary'} size="sm" aria-pressed={draft.radiusKm === km} onClick={() => set('radiusKm', km)}>
                {km} km
              </Button>
            ))}
            <Field label="Yarıçap (km)" className="w-32" error={errors.radiusM}>
              <Input value={draft.radiusKm} onChange={(e) => set('radiusKm', e.target.value.replace(/[^\d,.]/g, ''))} inputMode="decimal" />
            </Field>
          </div>
          <ZoneMap center={center} mode="radius" points={[]} closed={false} radiusM={Number.isFinite(radiusM) ? radiusM : null} otherZones={otherZones} />
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Teslimat ücreti (TL)" error={errors.feeKurus}>
          <Input value={draft.fee} onChange={(e) => set('fee', e.target.value.replace(/[^\d,.]/g, ''))} inputMode="decimal" />
        </Field>
        <Field label="En az sepet (TL)" error={errors.minOrderKurus}>
          <Input value={draft.min} onChange={(e) => set('min', e.target.value.replace(/[^\d,.]/g, ''))} inputMode="decimal" />
        </Field>
        <Field label="Tahmini süre (dk)" error={errors.etaMinutes}>
          <Input value={draft.eta} onChange={(e) => set('eta', e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={3} />
        </Field>
      </div>
      <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} label="Bölge etkin" description="Pasif bölgeye sipariş alınmaz." />

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        {draft.id ? (
          <Button variant="ghost" className="me-auto text-destructive" onClick={() => setConfirmDelete(true)} disabled={saving}>
            <Trash2 aria-hidden />
            Sil
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Vazgeç
        </Button>
        <Button type="submit" size="lg" loading={saving}>
          Kaydet
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Bölge silinsin mi?"
        description={`"${draft.name}" bölgesine artık sipariş alınmaz.`}
        confirmLabel="Sil"
        onConfirm={() => void remove()}
        loading={saving}
      />
    </form>
  );
}

/** "Bu adrese teslimat var mı?" (04 §7.5) — mahalle adıyla deneme. */
function ZoneCheck() {
  const branchId = useBranchId();
  const [value, setValue] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function check(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ match: null | { zoneName: string; feeKurus: number; minOrderKurus: number; etaMinutes: number; neighborhood: string | null } }>(
        '/panel/zones/check',
        { method: 'POST', body: { branchId, neighborhood: value.trim() } },
      );
      const m = res.match;
      setResult(
        m
          ? `Evet · ${m.zoneName} bölgesi · ${m.feeKurus ? formatTL(m.feeKurus) : 'ücretsiz teslimat'} · en az ${formatTL(m.minOrderKurus)} · ${m.etaMinutes} dk`
          : 'Hayır · bu mahalle hiçbir bölgede yok. Müşteriye gel-al önerilir.',
      );
    } catch (err) {
      setResult(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Bu adrese teslimat var mı?" description="Mahalle adını yazıp deneyin.">
      <form onSubmit={check} className="flex flex-wrap items-end gap-2">
        <Field label="Mahalle" className="min-w-0 flex-1">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Ör. Aşağınohutlu" />
        </Field>
        <Button type="submit" variant="secondary" loading={busy}>
          <Search aria-hidden />
          Dene
        </Button>
      </form>
      {result ? (
        <p className="text-base font-semibold text-fg" role="status">
          {result}
        </p>
      ) : null}
    </Section>
  );
}
