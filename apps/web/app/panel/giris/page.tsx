import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm } from '@/components/auth/login-form';
import { ScreenLoading } from '@/components/common/screen-state';

export const metadata: Metadata = { title: 'İşletme girişi' };

export default function PanelLoginPage() {
  return (
    <AuthLayout title="İşletme girişi" description="Siparişlerinizi yönetmek için giriş yapın.">
      <Suspense fallback={<ScreenLoading />}>
        <LoginForm variant="panel" />
      </Suspense>
    </AuthLayout>
  );
}
