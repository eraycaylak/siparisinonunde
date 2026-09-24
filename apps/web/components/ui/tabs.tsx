'use client';

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs bileşenleri <Tabs> içinde kullanılmalı');
  return ctx;
}

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

/** Erişilebilir sekmeler (WAI-ARIA tabs; ok tuşları, Home/End). */
export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const baseId = useId().replace(/:/g, '');
  const setValue = useCallback(
    (v: string) => {
      if (value === undefined) setInner(v);
      onValueChange?.(v);
    },
    [value, onValueChange],
  );
  return (
    <TabsContext.Provider value={{ value: current, setValue, baseId }}>
      <div className={cn('flex flex-col gap-4', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? []);
    const idx = tabs.findIndex((t) => t === document.activeElement);
    if (idx < 0) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex max-w-full gap-1 overflow-x-auto border-b border-border', className)}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
  disabled,
}: {
  value: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => ctx.setValue(value)}
      className={cn(
        '-mb-px inline-flex min-h-hit shrink-0 items-center gap-2 border-b-2 px-4 text-base font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        selected ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const ctx = useTabs();
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      tabIndex={0}
      className={cn('focus-visible:outline-2 focus-visible:outline-ring', className)}
    >
      {children}
    </div>
  );
}
