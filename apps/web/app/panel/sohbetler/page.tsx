import type { Metadata } from 'next';
import { ChatInbox } from '@/components/chat/chat-inbox';

// Gelen kutusu (04 P-08): WhatsApp sohbetleri, yanıt, devralma — dilim 3.
export const metadata: Metadata = { title: 'Sohbetler' };

export default function Page() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="sr-only">Sohbetler</h1>
      <ChatInbox />
    </div>
  );
}
