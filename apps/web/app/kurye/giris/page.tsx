import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { ScreenLoading } from '@/components/common/screen-state';
import { CourierLogin } from '@/components/courier/courier-login';

export const metadata: Metadata = { title: 'Kurye girişi', referrer: 'no-referrer' };

export default function CourierLoginPage() {
  return (
    <AuthLayout
      title="Kurye girişi"
      description="İşletmenizin gönderdiği link ile giriş yapılır. Oturum vardiya boyunca (12 saat) açık kalır."
    >
      <Suspense fallback={<ScreenLoading />}>
        <CourierLogin />
      </Suspense>
    </AuthLayout>
  );
}
