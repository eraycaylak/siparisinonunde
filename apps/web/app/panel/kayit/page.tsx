import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { SignupForm } from '@/components/auth/signup-form';
import { ScreenLoading } from '@/components/common/screen-state';
import { buttonVariants } from '@/components/ui/button';
import { TRIAL_DAYS } from '@/lib/plans';
import { SIGNUP_SOON, probeSignupStatus } from '@/lib/signup-status';

export const metadata: Metadata = { title: 'Ücretsiz dene' };

// Kayıt açık mı her istekte sorulur (signup_open; 00 §12a madde 10): kapalıyken (Cloudflare ortamı, acil durdurma) form
// yerine "Kayıtlar çok yakında açılıyor" bilgisi ve iletişim formu bağlantısı gösterilir.
export default async function PanelSignupPage() {
  await connection();
  const status = await probeSignupStatus();
  if (status === 'closed') {
    return (
      <AuthLayout
        title={SIGNUP_SOON.title}
        description={SIGNUP_SOON.body}
        footer={
          <>
            Hesabın var mı?{' '}
            <Link href="/panel/giris" className="font-semibold text-fg underline underline-offset-4">
              Giriş yap
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href={SIGNUP_SOON.href} className={buttonVariants({ variant: 'primary', block: true })}>
            {SIGNUP_SOON.cta}
          </Link>
          <Link href="/nasil-calisir" className={buttonVariants({ variant: 'secondary', block: true })}>
            Nasıl çalışır?
          </Link>
        </div>
      </AuthLayout>
    );
  }
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
