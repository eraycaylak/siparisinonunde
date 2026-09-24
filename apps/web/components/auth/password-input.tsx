'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';

/** Parola alanı + göster/gizle (≥ 48 px dokunma hedefi). */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className="pe-14" {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Parolayı gizle' : 'Parolayı göster'}
        aria-pressed={visible}
        className="absolute end-0 top-0 flex size-hit items-center justify-center rounded-md text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {visible ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
});
