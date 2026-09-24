'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { createQueryClient, isApiError } from '@/lib/api';
import { ME_QUERY_KEY } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={theme}
      richColors
      closeButton
      duration={5000}
      toastOptions={{ style: { fontSize: '16px' } }}
    />
  );
}

/** Uygulama sağlayıcıları: React Query + bildirim tostları. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState<QueryClient>(() => {
    const qc: QueryClient = createQueryClient({
      // Oturum düşerse (401) me sorgusunu tazele; koruyucular giriş sayfasına yönlendirir.
      onQueryError: (error, queryKey) => {
        if (isApiError(error) && error.status === 401 && queryKey[0] !== ME_QUERY_KEY[0]) {
          void qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
        }
      },
    });
    return qc;
  });
  return (
    <QueryClientProvider client={client}>
      {children}
      <ThemedToaster />
    </QueryClientProvider>
  );
}
