// Sohbet API yanıt tipleri (apps/api routes/panel/conversations.ts ve services/messaging/views.ts ile aynı biçim).

export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  code: string | null;
  sentBy: string | null;
  sentByUserId: string | null;
  sentByName?: string | null;
  status: string | null;
  errorCode: string | null;
  templateName: string | null;
  orderId: string | null;
  orderNumber?: number | null;
  createdAt: string;
  buttons?: { id: string; title: string }[];
  cta?: { label: string; url: string };
  list?: { buttonTitle: string; rows: { id: string; title: string; description?: string }[] };
  location?: { lat: number; lng: number; name?: string | null };
  locationRequest?: boolean;
  replyId?: string;
}

export interface ConversationItem {
  id: string;
  branchId: string;
  mode: 'bot' | 'human';
  humanUntil: string | null;
  humanActive: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  windowOpen: boolean;
  windowClosesAt: string | null;
  optedOut: boolean;
  customer: { id: string; name: string | null; phoneMasked: string | null; username: string | null; isBlocked: boolean };
  activeOrder: { id: string; number: number; status: string } | null;
}

export interface ListResult<T> {
  items: T[];
  nextCursor?: string;
}

export function customerLabel(c: ConversationItem['customer']): string {
  return c.name?.trim() || (c.username ? `@${c.username}` : null) || c.phoneMasked || 'WhatsApp müşterisi';
}
