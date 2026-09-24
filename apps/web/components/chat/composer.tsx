'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Lock, SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export interface ComposerProps {
  disabled?: boolean;
  /** Pencere kapalıysa açıklama */
  disabledReason?: string | null;
  sending?: boolean;
  onSend: (text: string) => Promise<boolean> | boolean;
  placeholder?: string;
}

/** Yanıt kutusu: Enter gönderir, Shift+Enter yeni satır. */
export function Composer({ disabled, disabledReason, sending, onSend, placeholder = 'Mesaj yazın…' }: ComposerProps) {
  const [text, setText] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || disabled || sending) return;
    const ok = await onSend(t);
    if (ok) setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  if (disabled && disabledReason) {
    return (
      <div className="flex items-start gap-3 border-t border-border bg-surface p-3 text-sm text-fg-muted" role="status">
        <Lock aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p>{disabledReason}</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-surface-raised p-3">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Yanıt</span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={4096}
          placeholder={placeholder}
          disabled={disabled}
          className="max-h-40 min-h-hit resize-none"
        />
      </label>
      <Button type="submit" size="icon" aria-label="Gönder" loading={sending} disabled={disabled || !text.trim()} className="size-hit">
        {sending ? null : <SendHorizontal aria-hidden />}
      </Button>
    </form>
  );
}
