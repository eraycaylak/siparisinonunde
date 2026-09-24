import {
  Ban,
  BellRing,
  Bike,
  Check,
  CheckCheck,
  ChefHat,
  Circle,
  CircleX,
  Globe,
  Hourglass,
  MessageCircle,
  PackageCheck,
  Pause,
  Phone,
  Repeat,
  ShoppingBag,
  Sparkles,
  Undo2,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  CHANNEL_BADGE_LABELS,
  FULFILLMENT_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  ORDERING_STATE_UI_LABELS,
  type FulfillmentType,
  type OrderChannel,
  type OrderStatus,
  type OrderingState,
} from '@/lib/labels';

// Sipariş durumu → renk + ikon + Türkçe kelime (12 §3.3). Renk yalnız pekiştirir.

export const ORDER_STATUS_ICONS: Record<OrderStatus, LucideIcon> = {
  awaiting_customer: Hourglass,
  new: BellRing,
  accepted: Check,
  preparing: ChefHat,
  ready: PackageCheck,
  on_the_way: Bike,
  delivered: CheckCheck,
  rejected: CircleX,
  cancelled: Ban,
};

const STATUS_CLASSES: Record<OrderStatus, string> = {
  awaiting_customer: 'bg-status-awaiting_customer-bg text-status-awaiting_customer-fg border-status-awaiting_customer-fg/30',
  new: 'bg-status-new-bg text-status-new-fg border-status-new-fg',
  accepted: 'bg-status-accepted-bg text-status-accepted-fg border-status-accepted-fg/30',
  preparing: 'bg-status-preparing-bg text-status-preparing-fg border-status-preparing-fg/30',
  ready: 'bg-status-ready-bg text-status-ready-fg border-status-ready-fg/40',
  on_the_way: 'bg-status-on_the_way-bg text-status-on_the_way-fg border-status-on_the_way-fg/30',
  delivered: 'bg-transparent text-status-delivered-fg border-status-delivered-fg/40',
  rejected: 'bg-transparent text-status-rejected-fg border-status-rejected-fg/40',
  cancelled: 'bg-transparent text-status-cancelled-fg border-status-cancelled-fg/40',
};

/** Durum için Tailwind renk sınıfları (kart kenarı vb. için). */
export function statusClasses(status: OrderStatus): string {
  return STATUS_CLASSES[status];
}

export interface StatusBadgeProps {
  status: OrderStatus;
  size?: 'sm' | 'md' | 'lg';
  /** Ek bilgi: "20.35", "Burak", "Kapalıyız · Müşteri" … ("Onaylandı · 20.35"). */
  detail?: string | null;
  /** Bekleyen ret (durum değil, 00 §7): "Reddediliyor · 27 sn". Kalan saniye verilirse gösterilir. */
  pendingRejectSeconds?: number | null;
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'gap-1 px-2 py-0.5 text-xs [&_svg]:size-3.5',
  md: 'gap-1.5 px-2.5 py-1 text-sm [&_svg]:size-4',
  lg: 'gap-2 px-3 py-1.5 text-base [&_svg]:size-5',
} as const;

export function StatusBadge({ status, size = 'md', detail, pendingRejectSeconds, className }: StatusBadgeProps) {
  const pending = typeof pendingRejectSeconds === 'number' && status === 'new';
  const Icon = pending ? Undo2 : ORDER_STATUS_ICONS[status];
  const base = pending ? 'Reddediliyor' : ORDER_STATUS_LABELS[status];
  const text = pending ? `${base} · ${Math.max(0, Math.ceil(pendingRejectSeconds as number))} sn` : detail ? `${base} · ${detail}` : base;
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border font-semibold tabular-nums',
        SIZE_CLASSES[size],
        STATUS_CLASSES[status],
        pending && 'border-dashed',
        className,
      )}
    >
      <Icon aria-hidden className="shrink-0" />
      <span>{text}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Şube sipariş alma durumu (12 §3.3 son paragraf, 04 §2.2)

const ORDERING_CLASSES: Record<OrderingState, { dot: string; text: string }> = {
  open: { dot: 'fill-status-ready-fg text-status-ready-fg', text: 'text-fg' },
  busy: { dot: 'fill-warning text-warning', text: 'text-warning' },
  paused: { dot: '', text: 'text-fg-muted' },
  closed: { dot: 'fill-fg-muted text-fg-muted', text: 'text-fg-muted' },
};

export interface OrderingStateBadgeProps {
  state: OrderingState;
  /** "+15 dk", "20.15'e kadar", "11.00'de açılır" */
  detail?: string | null;
  className?: string;
}

export function OrderingStateBadge({ state, detail, className }: OrderingStateBadgeProps) {
  const c = ORDERING_CLASSES[state];
  const label = ORDERING_STATE_UI_LABELS[state];
  const text = detail ? (state === 'busy' ? `${label} (${detail})` : `${label} · ${detail}`) : label;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold', c.text, className)}>
      {state === 'paused' ? (
        <Pause aria-hidden className="size-4" />
      ) : (
        <Circle aria-hidden className={cn('size-3', c.dot)} />
      )}
      <span>{text}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Kanal ve teslim türü rozetleri (12 §3.5)

const CHANNEL_ICONS: Record<OrderChannel, LucideIcon> = {
  wa_link: MessageCircle,
  wa_ai: Sparkles,
  web: Globe,
  table_qr: Utensils,
  wa_flow: MessageCircle,
  wa_reorder: Repeat,
  manual: Phone,
};

export function ChannelBadge({ channel, className }: { channel: OrderChannel; className?: string }) {
  const Icon = CHANNEL_ICONS[channel];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-medium text-fg-muted', className)}>
      <Icon aria-hidden className="size-4" />
      {CHANNEL_BADGE_LABELS[channel]}
    </span>
  );
}

const FULFILLMENT_ICONS: Record<FulfillmentType, LucideIcon> = {
  delivery: Bike,
  pickup: ShoppingBag,
  dine_in: Utensils,
};

export function FulfillmentBadge({ type, className }: { type: FulfillmentType; className?: string }) {
  const Icon = FULFILLMENT_ICONS[type];
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-medium text-fg', className)}>
      <Icon aria-hidden className="size-4" />
      {FULFILLMENT_TYPE_LABELS[type]}
    </span>
  );
}
