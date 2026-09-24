import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm } from '@/components/auth/login-form';
import { ScreenLoading } from '@/components/common/screen-state';

export const metadata: Metadata = { title: 'Platform girişi' };

export default function AdminLoginPage() {
  return (
    <AuthLayout title="Platform girişi" description="Yalnız Siparişin Önünde ekibi içindir. Tüm işlemler kayıt altına alınır.">
      <Suspense fallback={<ScreenLoading />}>
        <LoginForm variant="admin" />
      </Suspense>
    </AuthLayout>
  );
}
