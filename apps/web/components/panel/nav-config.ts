// Panel navigasyonu ve rol görünürlüğü (04 §2.1, §2.3; 14 §5 izin matrisi özeti).
// UI yalnız gizler; yetki API'de uygulanır.

import {
  BellRing,
  Bike,
  Building2,
  ChartColumn,
  Clock,
  CreditCard,
  ListOrdered,
  MapPin,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  PhoneCall,
  QrCode,
  Receipt,
  Settings,
  Siren,
  Store,
  UserCog,
  UsersRound,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { TenantRole } from '@siparis/core/enums';

export interface PanelNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: readonly TenantRole[];
  /** Yalnız tam eşleşmede etkin (ör. /panel). */
  exact?: boolean;
  description?: string;
}

const OMC: readonly TenantRole[] = ['owner', 'manager', 'cashier'];
const OM: readonly TenantRole[] = ['owner', 'manager'];

export const PANEL_NAV: readonly PanelNavItem[] = [
  { href: '/panel', label: 'Canlı', icon: BellRing, roles: ['owner', 'manager', 'cashier', 'kitchen'], exact: true },
  { href: '/panel/siparisler', label: 'Siparişler', icon: ListOrdered, roles: OMC },
  { href: '/panel/telefon-siparisi', label: 'Telefon siparişi', icon: PhoneCall, roles: OMC },
  // Kasiyer ve mutfak yalnız "Tükendi" aç/kapa görür (04 §2.3 P-12).
  { href: '/panel/menu', label: 'Menü', icon: UtensilsCrossed, roles: ['owner', 'manager', 'cashier', 'kitchen'] },
  { href: '/panel/sohbetler', label: 'Sohbetler', icon: MessagesSquare, roles: OMC },
  { href: '/panel/musteriler', label: 'Müşteriler', icon: UsersRound, roles: OMC },
  { href: '/panel/raporlar', label: 'Raporlar', icon: ChartColumn, roles: OM },
  { href: '/panel/kuryeler', label: 'Kuryeler', icon: Bike, roles: OMC },
  { href: '/panel/ayarlar', label: 'Ayarlar', icon: Settings, roles: OM },
];

export const SETTINGS_NAV: readonly PanelNavItem[] = [
  { href: '/panel/ayarlar/isletme', label: 'İşletme bilgileri', description: 'Ad, künye, marka rengi, logo', icon: Store, roles: OM },
  { href: '/panel/ayarlar/sube', label: 'Şube ve sipariş durumu', description: 'Adres, hazırlık süresi, yoğun ve durdur', icon: Building2, roles: OM },
  { href: '/panel/ayarlar/saatler', label: 'Çalışma saatleri', description: 'Haftalık saatler ve özel günler', icon: Clock, roles: OM },
  { href: '/panel/ayarlar/bolgeler', label: 'Teslimat bölgeleri', description: 'Mahalleler, harita, ücret ve min. sepet', icon: MapPin, roles: OM },
  { href: '/panel/ayarlar/odeme', label: 'Ödeme yöntemleri', description: 'Kapıda nakit, kart, yemek kartı', icon: CreditCard, roles: OM },
  { href: '/panel/ayarlar/bildirimler', label: 'Müşteri bildirimleri', description: 'Hangi durumda mesaj gitsin', icon: MessageSquareText, roles: OM },
  { href: '/panel/ayarlar/alarm', label: 'Sipariş alarmı', description: 'Uyarı zinciri ve otomatik iptal süresi', icon: Siren, roles: OM },
  { href: '/panel/ayarlar/whatsapp', label: 'WhatsApp bağlantısı', description: 'Numara, bağlantı sağlığı, test mesajı', icon: MessageCircle, roles: OM },
  { href: '/panel/ayarlar/personel', label: 'Personel', description: 'Kullanıcılar, roller, kurye giriş linki', icon: UserCog, roles: OM },
  { href: '/panel/ayarlar/fis', label: 'Fiş', description: 'Mutfak ve paket fişi ayarları', icon: Receipt, roles: OM },
  { href: '/panel/ayarlar/qr', label: 'QR ve afiş', description: 'QR kod ve A5 afiş yazdırma', icon: QrCode, roles: OM },
];

/** Yol için kural: en uzun eşleşen öğe. Listede yoksa (ör. /panel/kurulum) herkes. */
export function isPathAllowed(pathname: string, role: TenantRole | null): boolean {
  if (!role) return false;
  const all = [...PANEL_NAV, ...SETTINGS_NAV];
  const match = all
    .filter((i) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!match) return role !== 'courier';
  return match.roles.includes(role);
}

export function navForRole(role: TenantRole | null): PanelNavItem[] {
  if (!role) return [];
  return PANEL_NAV.filter((i) => i.roles.includes(role));
}

export function settingsForRole(role: TenantRole | null): PanelNavItem[] {
  if (!role) return [];
  return SETTINGS_NAV.filter((i) => i.roles.includes(role));
}

export function isActive(pathname: string, item: Pick<PanelNavItem, 'href' | 'exact'>): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Telefonda alt sekmeler (04 §1.2): Canlı · Sohbetler · Menü · Diğer. */
export const MOBILE_TAB_HREFS = ['/panel', '/panel/sohbetler', '/panel/menu'] as const;
