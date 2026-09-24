'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { isApiError } from '@/lib/api';
import { useCourierExchange } from '@/lib/auth';

// Tek kullanımlık link: React geliştirme modunda efekt iki kez çalışsa da istek bir kez gider.
const exchanged = new Set<string>();

/** /kurye/giris?t=… → POST /api/v1/auth/courier/exchange → /kurye (00 §4: 15 dk, tek kullanım). */
export function CourierLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('t');
  const exchange = useCourierExchange();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!token) {
      setError('Giriş linki eksik. İşletmenizden yeni giriş linki isteyin.');
      return;
    }
    if (started.current || exchanged.has(token)) return;
    started.current = true;
    exchanged.add(token);
    // Token adres çubuğunda kalmasın.
    window.history.replaceState(null, '', '/kurye/giris');
    exchange.mutate(token, {
      onSuccess: () => router.replace('/kurye'),
      onError: (err) => {
        if (isApiError(err) && (err.status === 400 || err.status === 401 || err.status === 404 || err.status === 410 || err.code === 'invalid_link')) {
          setError('Bu giriş linki geçersiz ya da süresi dolmuş. İşletmenizden yeni giriş linki isteyin.');
        } else {
          setError('Giriş yapılamadı. İnternet bağlantınızı kontrol edip linki yeniden açın.');
        }
      },
    });
    // exchange nesnesi her render'da değişir; efekt yalnız token'a bağlı çalışır.
  }, [token]);

  if (error) {
    return (
      <Alert variant="danger" title="Giriş yapılamadı">
        {error}
      </Alert>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-fg-muted" role="status">
      <KeyRound aria-hidden className="size-8" />
      <Spinner size="lg" />
      <p className="text-base">Giriş yapılıyor…</p>
    </div>
  );
}
