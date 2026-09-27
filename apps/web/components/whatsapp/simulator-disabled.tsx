import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';

/**
 * Simülatör kapalı bildirimi: web simülatörle derlenmiş (NEXT_PUBLIC_DEV_TOOLS=1) ama API'nin geliştirici uçları yok
 * (gerçek WhatsApp bağlı, DEV_TOOLS=0; 15 §13). Sunucu sayfası ve istemci simülatörü (404) aynı metni gösterir.
 */
export function SimulatorDisabledNotice() {
  return (
    <Alert
      variant="info"
      title="Gerçek WhatsApp bağlı; simülatör kapalı"
      action={
        <Link href="/admin/whatsapp" className={buttonVariants({ variant: 'secondary' })}>
          WhatsApp kurulumunu aç
        </Link>
      }
    >
      Bu ortamda ortak numara Meta WhatsApp Cloud API’ye bağlı ve gerçek mesajlar gidip geliyor. Bu yüzden simülatör ve geliştirici uçları kapatıldı. Denemek için
      kendi telefonunuzdan ortak numaraya yazın; bağlantı durumu ve şablonlar: Admin › WhatsApp › WhatsApp kurulumu.
    </Alert>
  );
}
