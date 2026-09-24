import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { SignupForm } from '@/components/auth/signup-form';
import { ScreenLoading } from '@/components/common/screen-state';
import { TRIAL_DAYS } from '@/lib/plans';

export const metadata: Metadata = { title: 'Ücretsiz dene' };

export default function PanelSignupPage() {
  return (
    <AuthLayout
      wide
      title="İşletme hesabını aç"
      description={`${TRIAL_DAYS} gün ücretsiz, bize kart vermeden. Hesabını açınca kurulum adımları seni karşılar.`}
    >
      <Suspense fallback={<ScreenLoading />}>
        <SignupForm />
      </Suspense>
    </AuthLayout>
  );
}
