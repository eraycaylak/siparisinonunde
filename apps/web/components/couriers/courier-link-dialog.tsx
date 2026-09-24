'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { Copy, RefreshCw } from 'lucide-react';
import type { CourierLoginLink } from '@siparis/core/settings/contracts';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch, errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';

/**
 * Kurye giriş bağlantısı (00 §4: tek kullanımlık, 15 dk içinde açılmalı, oturum 12 saat): QR + kopyala.
 */
export function CourierLinkDialog({ courier, onOpenChange }: { courier: { userId: string; name: string } | null; onOpenChange: (open: boolean) => void }) {
  const [link, setLink] = useState<CourierLoginLink | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(userId: string) {
    setLoading(true);
    setError(null);
    setLink(null);
    setQr(null);
    try {
      const res = await apiFetch<CourierLoginLink>(`/panel/couriers/${userId}/login-link`, { method: 'POST' });
      setLink(res);
      setQr(await QRCode.toDataURL(res.url, { errorCorrectionLevel: 'M', margin: 2, width: 280 }));
    } catch (err) {
      setError(errorMessage(err, 'Bağlantı oluşturulamadı.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (courier) void create(courier.userId);
    else {
      setLink(null);
      setQr(null);
    }
  }, [courier]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success('Bağlantı kopyalandı.');
    } catch {
      toast.error('Kopyalanamadı; bağlantıyı elle seçin.');
    }
  }

  return (
    <Dialog
      open={courier !== null}
      onOpenChange={onOpenChange}
      title={`${courier?.name ?? 'Kurye'} için giriş bağlantısı`}
      description="Kurye telefonuyla QR kodu okutsun ya da bağlantıyı WhatsApp'tan gönderin. Bağlantı tek kullanımlıktır."
      footer={
        <>
          <Button variant="secondary" onClick={() => courier && void create(courier.userId)} disabled={loading}>
            <RefreshCw aria-hidden />
            Yeni bağlantı
          </Button>
          <Button onClick={() => void copy()} disabled={!link}>
            <Copy aria-hidden />
            Kopyala
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {loading ? <Spinner label="Bağlantı oluşturuluyor" /> : null}
        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Kurye giriş QR kodu" width={240} height={240} className="rounded-md border border-border bg-white" />
        ) : null}
        {link ? (
          <>
            <p className="w-full break-all rounded-md bg-surface p-2 font-mono text-xs text-fg" data-testid="courier-link-url">
              {link.url}
            </p>
            <p className="text-sm text-fg-muted">{formatTime(link.expiresAt)}’e kadar açılmalı. Açıldıktan sonra oturum 12 saat sürer.</p>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
