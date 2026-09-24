import { Construction } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

export interface ComingSoonProps {
  title: string;
  description?: string;
  /** Başlık gösterilsin mi (panel/admin sayfalarında evet). */
  withHeader?: boolean;
}

/** Diğer dilimlerin dolduracağı sayfalar için yer tutucu. */
export function ComingSoon({ title, description, withHeader = true }: ComingSoonProps) {
  return (
    <div>
      {withHeader ? <PageHeader title={title} description={description} /> : null}
      <EmptyState
        icon={Construction}
        title="Bu bölüm hazırlanıyor"
        description="Bu ekran bir sonraki güncellemeyle burada olacak."
      />
    </div>
  );
}
