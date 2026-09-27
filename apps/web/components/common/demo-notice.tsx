import { Info } from 'lucide-react';
import { DEMO_NOTICE, isDemoBannerEnabled } from '@/lib/site';

/**
 * Demo verili ortamda (NEXT_PUBLIC_DEMO_BANNER=1: Cloudflare gizli staging; 15 §13) pazarlama, vitrin, takip ve giriş
 * sayfalarının üstünde görünen uyarı: siparişler örnektir, gerçek kişisel veri girilmemeli.
 * Varsayılan kapalı (00 §12a madde 10): canlı ortamda, demo verisi olmayan Cloudflare ortamında ve yerel geliştirmede hiçbir
 * şey çizmez.
 */
export function DemoNotice() {
  if (!isDemoBannerEnabled()) return null;
  return (
    <div role="note" className="border-b border-warning/40 bg-warning-bg px-4 py-2 text-fg print:hidden">
      <p className="mx-auto flex max-w-6xl items-start justify-center gap-2 text-sm">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <span>
          <strong className="font-semibold">{DEMO_NOTICE.title}</strong> {DEMO_NOTICE.body}
        </span>
      </p>
    </div>
  );
}
