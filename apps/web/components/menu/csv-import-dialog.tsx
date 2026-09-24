'use client';

import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { toast } from 'sonner';
import type { MenuImportResponse, MenuImportRow } from '@siparis/core/menu/contracts';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { EXPORT_CSV_URL, menuApi, useInvalidateMenu } from './menu-api';

const ACTION_LABEL: Record<MenuImportRow['action'], string> = {
  create: 'Yeni',
  update: 'Güncellenecek',
  unchanged: 'Değişmiyor',
  error: 'Hatalı',
};
const ACTION_VARIANT = { create: 'info', update: 'warning', unchanged: 'neutral', error: 'danger' } as const;

/** P-14 CSV içe aktarma (04 §6.6 Faz 1 temel): dosya → doğrulama önizlemesi → içe aktar. */
export function CsvImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Menüyü CSV'den içe aktar" size="lg">
      {open ? <ImportForm onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function ImportForm({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidateMenu();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<MenuImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreview(null);
    if (file.size > 1_400_000) return setError('Dosya çok büyük (en fazla ~1,4 MB).');
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    setBusy(true);
    try {
      setPreview(await menuApi.importCsv(text, true));
    } catch (err) {
      setError(errorMessage(err, 'Dosya okunamadı.'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const apply = async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const res = await menuApi.importCsv(csv, false);
      await invalidate();
      toast.success(`İçe aktarıldı: ${res.summary.create} yeni, ${res.summary.update} güncellenen ürün.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'İçe aktarılamadı.'));
    } finally {
      setBusy(false);
    }
  };

  const s = preview?.summary;
  const actionable = s ? s.create + s.update : 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-fg-muted">
        Biçim: <strong className="text-fg">kategori;ürün;açıklama;fiyat</strong> — fiyatta ondalık virgül (125,50). Örnek dosya için önce{' '}
        <a href={EXPORT_CSV_URL} download className="font-semibold text-fg underline underline-offset-4">
          menüyü dışa aktarın
        </a>
        . Aynı kategori ve ad eşleşirse fiyat ve açıklama güncellenir.
      </p>
      <div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="menu-csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button variant="secondary" size="lg" loading={busy && !preview} onClick={() => fileRef.current?.click()}>
          <FileUp aria-hidden />
          {fileName ? 'Başka dosya seç' : 'CSV dosyası seç'}
        </Button>
        {fileName ? <span className="ms-3 text-sm text-fg-muted">{fileName}</span> : null}
      </div>
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {preview && s ? (
        <>
          <div className="flex flex-wrap gap-2" role="status">
            <Badge variant="info">Yeni: {s.create}</Badge>
            <Badge variant="warning">Güncellenecek: {s.update}</Badge>
            <Badge variant="neutral">Değişmeyen: {s.unchanged}</Badge>
            <Badge variant="danger">Hatalı: {s.error}</Badge>
          </div>
          {s.newCategories.length ? <p className="text-sm">Yeni kategoriler: {s.newCategories.join(', ')}</p> : null}
          {s.error ? <Alert variant="warning">Hatalı satırlar içe aktarılmaz; düzeltip dosyayı yeniden yükleyebilirsiniz.</Alert> : null}
          <Table>
            <THead>
              <TR>
                <TH>Satır</TH>
                <TH>Kategori · Ürün</TH>
                <TH className="text-end">Fiyat</TH>
                <TH>Durum</TH>
              </TR>
            </THead>
            <TBody>
              {preview.rows.map((r) => (
                <TR key={r.line} className={cn(r.action === 'error' && 'bg-status-new-bg')}>
                  <TD className="tabular-nums">{r.line}</TD>
                  <TD>
                    <span className="block text-xs text-fg-muted">{r.category || '—'}</span>
                    <span className="font-semibold">{r.name || '—'}</span>
                    {r.error ? <span className="block text-sm font-semibold text-destructive">{r.error}</span> : null}
                    {r.restrictedSuggested ? <span className="block text-sm text-warning">WhatsApp'ta satılamaz olarak eklenecek</span> : null}
                  </TD>
                  <TD className="text-end tabular-nums">{r.priceKurus !== null ? formatMoney(r.priceKurus) : '—'}</TD>
                  <TD>
                    <Badge variant={ACTION_VARIANT[r.action]} size="sm">
                      {ACTION_LABEL[r.action]}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
        <Button variant="secondary" size="lg" onClick={onClose}>
          Vazgeç
        </Button>
        <Button size="lg" disabled={!preview || actionable === 0} loading={busy && Boolean(preview)} onClick={() => void apply()}>
          İçe aktar{actionable ? ` · ${actionable} ürün` : ''}
        </Button>
      </div>
    </div>
  );
}
