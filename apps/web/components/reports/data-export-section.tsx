'use client';

// Raporlar ekranındaki "Verilerinizi indirin" bloğu (04 §11.6). Kendi ekran kimliği yoktur: Raporlar
// sayfasının (P-32…P-35) altındaki bir bloktur — P-32 gün sonu kasa özetidir, bu blok değil.
//
// Uç nokta (`GET /panel/exports/{orders,customers}.{csv,json}`) bir önceki turda yazılmıştı ama panelde hiçbir
// yerden çağrılmıyordu: kullanım koşullarındaki "verilerinizi dışa aktarabilirsiniz" taahhüdü yalnız elle URL
// yazarak kullanılabiliyordu. Blok Raporlar'a konuldu (Ayarlar yerine), çünkü sayfa zaten owner/manager'a açık,
// zaten tarih aralığıyla çalışıyor ve dosyanın içeriği buradaki rakamların aynısı.
//
// Karar veren mantık `data-export.ts`de ve birim testli. Bu dosya yalnız ekranı çizer.

import { useRef, useState, type FormEvent } from 'react';
import { Download, Info } from 'lucide-react';
import { Section } from '@/components/settings/settings-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, type RadioOption } from '@/components/ui/radio-group';
import { Select, type SelectOption } from '@/components/ui/select';
import { toIstanbulDateKey } from '@/lib/format';
import {
  EXPORT_DEFAULT_DAYS,
  EXPORT_MAX_DAYS,
  addDays,
  exportErrorMessage,
  exportFallbackFilename,
  exportUrl,
  fetchExportFile,
  personalDataGate,
  validateExportRange,
  type ExportFormat,
  type ExportKind,
  type RangeProblem,
} from './data-export';

const KIND_OPTIONS: readonly RadioOption<ExportKind>[] = [
  { value: 'orders', label: 'Siparişler', description: 'Sipariş no, durum, kanal, tutarlar, ürünler. Test siparişleri dosyaya girmez.' },
  { value: 'customers', label: 'Müşteriler', description: 'Ad, telefon, WhatsApp durumu, not. Silinmesini isteyen müşteriler dosyada yer almaz.' },
];

const FORMAT_OPTIONS: readonly SelectOption[] = [
  { value: 'csv', label: 'CSV — Excel ile açılır' },
  { value: 'json', label: 'JSON — başka bir programa aktarmak için' },
];

/**
 * Blob adresi tıklamadan hemen sonra geçersiz kılınmaz: tarayıcı dosyayı tıklamadan SONRA okur, adresi aynı
 * anda iptal etmek büyük dosyada indirmeyi yarıda kesebilir. Küçük dosyalarda (müşteri KVKK JSON'u,
 * kurtarma kodları) bu görünmez; toplu dışa aktarma birkaç MB olabilir, o yüzden burada beklenir.
 */
const REVOKE_DELAY_MS = 1_000;

/** Tarayıcıya dosyayı kaydettirir (müşteri KVKK dosyasıyla aynı yol: components/customers). */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  // İşlev tıklama anında yakalanır: zamanlayıcı geç çalışsa da elindeki `revokeObjectURL`'i çağırır
  const revoke = URL.revokeObjectURL.bind(URL);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Çapa DOM'a eklenir: Firefox kopuk öğenin programatik tıklamasını yok sayabilir (kurtarma kodlarıyla aynı yol)
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => revoke(url), REVOKE_DELAY_MS);
}

export interface DataExportSectionProps {
  /**
   * Destek görünümü (impersonation). Açıkken sunucu `includePersonal` isteğini 403 ile reddeder,
   * bu yüzden kutu hiç gösterilmez (05 A-09).
   */
  supportSession?: boolean;
}

export function DataExportSection({ supportSession = false }: DataExportSectionProps) {
  const today = toIstanbulDateKey(new Date());
  const [kind, setKind] = useState<ExportKind>('orders');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [from, setFrom] = useState(() => addDays(today, -(EXPORT_DEFAULT_DAYS - 1)));
  const [to, setTo] = useState(today);
  const [includePersonal, setIncludePersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<RangeProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const gate = personalDataGate({ supportSession });
  const allRecords = kind === 'customers' && !from && !to;

  async function download(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setDone(null);
    // Sunucuya gitmeden görülebilen hatalar (aralık): metin sunucunun attığı mesajla aynı
    const found = validateExportRange(kind, from, to, today);
    if (found) {
      setProblem(found);
      (found.field === 'from' ? fromRef : toRef).current?.focus();
      return;
    }
    setProblem(null);
    setBusy(true);
    const input = { kind, format, from, to, includePersonal: gate.visible && includePersonal };
    try {
      const file = await fetchExportFile(exportUrl(input));
      const name = file.filename ?? exportFallbackFilename(input, today);
      saveBlob(file.blob, name);
      setDone(name);
    } catch (err) {
      setError(exportErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Verilerinizi indirin"
      description="Sipariş ve müşteri listeniz size aittir; istediğiniz zaman indirebilirsiniz. Dosya Türkiye saatine göre hazırlanır."
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => void download(e)} noValidate>
        <RadioGroup
          legend="Hangi dosyayı indirmek istiyorsunuz?"
          options={KIND_OPTIONS}
          value={kind}
          onValueChange={(next) => {
            setKind(next);
            // Boş tarihin anlamı dosya türüne göre DEĞİŞİR (siparişlerde son 30 gün, müşterilerde tüm kayıtlar).
            // Siparişlere dönerken boş alan bırakmak kullanıcıya hangi dönemin ineceğini söylemez: varsayılan geri konur.
            if (next === 'orders' && (!from || !to)) {
              setTo(today);
              setFrom(addDays(today, -(EXPORT_DEFAULT_DAYS - 1)));
            }
            setDone(null);
            setError(null);
            setProblem(null);
          }}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
          <Field
            label="Başlangıç tarihi"
            error={problem?.field === 'from' ? problem.message : undefined}
            hint={kind === 'customers' ? 'Boş bırakılabilir' : undefined}
          >
            <Input
              ref={fromRef}
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => {
                setFrom(e.target.value);
                setProblem(null);
              }}
            />
          </Field>
          <Field
            label="Bitiş tarihi"
            error={problem?.field === 'to' ? problem.message : undefined}
            hint={kind === 'customers' ? 'Boş bırakılabilir' : undefined}
          >
            <Input
              ref={toRef}
              type="date"
              value={to}
              max={today}
              onChange={(e) => {
                setTo(e.target.value);
                setProblem(null);
              }}
            />
          </Field>
          <Field label="Dosya biçimi">
            <Select value={format} options={FORMAT_OPTIONS} onChange={(e) => setFormat(e.target.value as ExportFormat)} />
          </Field>
        </div>

        {kind === 'customers' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom('');
                setTo('');
                setProblem(null);
              }}
              disabled={allRecords}
            >
              Tarih sınırını kaldır
            </Button>
            <span className="text-sm text-fg-muted">
              {allRecords ? 'Tarih sınırı yok: bütün müşteri listesi indirilecek.' : 'Tarihleri temizlerseniz bütün liste gelir.'}
            </span>
          </div>
        ) : null}

        {gate.visible ? (
          <Checkbox
            checked={includePersonal}
            onChange={(e) => setIncludePersonal(e.target.checked)}
            label="Telefon ve adresleri açık yaz"
            description="Kapalıyken telefon maskelidir (0*** *** 22 33) ve açık adres dosyada hiç yer almaz. Açtığınızda bu indirme, kimin indirdiğiyle birlikte denetim kaydına yazılır."
          />
        ) : (
          <p className="flex items-start gap-2 text-sm text-fg-muted">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {gate.reason}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" loading={busy}>
            <Download aria-hidden />
            {busy ? 'Hazırlanıyor…' : 'İndir'}
          </Button>
          <p className="text-sm text-fg-muted">
            En fazla {EXPORT_MAX_DAYS} günlük dönem; 10 dakikada 5 dosya. Büyük dosyada indirme birkaç saniye sürebilir.
          </p>
        </div>

        {/* Tek canlı bölge: hazırlanıyor → indirildi. Hata ayrı Alert'te (role="alert", anında okunur). */}
        <p className="text-sm text-fg" role="status" aria-live="polite">
          {busy ? 'Dosya hazırlanıyor, lütfen bekleyin.' : done ? `${done} indirildi.` : ''}
        </p>

        {error ? (
          <Alert variant="danger" title="Dosya indirilemedi">
            {error}
          </Alert>
        ) : null}
      </form>
    </Section>
  );
}
