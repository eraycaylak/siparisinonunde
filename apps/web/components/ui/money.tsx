import { cn } from '@/lib/cn';
import { formatMoney, type MoneyStyle } from '@/lib/format';

export interface MoneyProps {
  /** Tutar (kuruş, integer). */
  kurus: number;
  /** 'symbol' (varsayılan) "123,45 ₺" · 'text' "123,45 TL" · 'short' "150 TL". */
  moneyStyle?: MoneyStyle;
  className?: string;
}

/** Kuruş → "123,45 ₺" (tabular-nums, satır bölünmez). Tutarlar yalnız sunucudan gelir (00 §10). */
export function Money({ kurus, moneyStyle = 'symbol', className }: MoneyProps) {
  return <span className={cn('tabular-nums whitespace-nowrap', className)}>{formatMoney(kurus, moneyStyle)}</span>;
}
