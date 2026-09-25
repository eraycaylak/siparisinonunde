'use client';

// Panel geneli yeni sipariş alarmı (04 §4.5 "Başka ekrandayken", CLAUDE.md kural 4 "Sipariş kaçmaz"): canlı liste
// sorgusu ve sipariş olayları panel kabuğunda tek yerde dinlenir; döngüsel ses, kırmızı "YENİ SİPARİŞ" bandı,
// sekme başlığı sayacı ve "Ses kapalı" bandı menü, sohbet ve ayar ekranlarında da çalışır. Vardiya durumu da burada
// tutulur: ekranlar arasında gezinirken "Siparişleri almaya başla" yeniden sorulmaz (tam yenilemede ses kilidi
// düştüğü için canlı ekranda yeniden sorulur, 04 §4.1).
// Web Push (00 §10 alarm t=0 "ses + push", 04 §4.1 "Web Push izni (ilk sefer)"): vardiya başlatma ve "Sesi aç"
// dokunuşunda izin istenir ve cihaz abone edilir (kullanıcı bu cihazda kapattıysa açılmaz); panel açılışında mevcut
// abonelik sessizce sunucuya yeniden bildirilir. Destek görünümünde (impersonation) push'a hiç dokunulmaz.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { SAFETY_POLL_INTERVAL_MS, type OrderAlarmPayload } from '@siparis/core/contracts/events';
import type { ActiveOrdersResponse, OrderCard } from '@siparis/core/orders/contracts';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { STREAM_RECONNECTED, usePanelEvent } from '@/components/panel/stream-provider';
import { ORDERS_ACTIVE_KEY, applySummary, isOrderEventPayload, orderActions, orderDetailKey } from '@/components/orders/api';
import { enablePush, isPushOptedOut, isPushSupported, registerPanelServiceWorker, syncPushSubscription } from '@/components/push/push-client';
import { useApiQuery } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/format';
import { alarmSound, ScreenWake } from './alarm-sound';
import { alarmingOrdersOf, bandOrdersOf, isHighLevel, newOrdersOf, orderAnchorHref, withNewOrderCount } from './alarm-state';
import { ShiftStart } from './shift-start';
import { useNow } from './use-now';

const DEVICE_LABEL_KEY = 'siparisinonunde:device-label';
/** Vardiya başlatmadaki bildirim uyarısı (izin engelli / iOS ana ekran) cihaz başına günde en çok bir kez. */
const PUSH_HINT_KEY = 'siparisinonunde:push-hint-at';
const PUSH_HINT_EVERY_MS = 24 * 60 * 60_000;

function takePushHint(): boolean {
  try {
    const last = Number(window.localStorage.getItem(PUSH_HINT_KEY) ?? 0);
    if (Date.now() - last < PUSH_HINT_EVERY_MS) return false;
    window.localStorage.setItem(PUSH_HINT_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

type ShiftState = 'pending' | 'started' | 'skipped';

interface NewOrderAlarmValue {
  kitchen: boolean;
  /** Ses bağlamı çalışıyor mu (kilit açık). */
  audioOn: boolean;
  /** Vardiya ekranı şu an açık mı (canlı ekran bu sırada ack göndermez). */
  shiftOpen: boolean;
  /** Döngüsel sesi çalan siparişler. */
  alarmingIds: ReadonlySet<string>;
  /** Kartta "Gördüm"/dokunuş: o siparişin döngüsel sesi susar. */
  markSeen: (id: string) => void;
  /** Ekranda görünen yeni siparişleri cihaz başına bir kez ack'ler (order_acks). */
  ack: (cards: readonly OrderCard[]) => void;
  /** Üst bardaki ses göstergesi: vardiya ekranını açar. */
  openShift: () => void;
  newOrders: OrderCard[];
  bandOrders: OrderCard[];
  alarming: OrderCard[];
  /** Banttaki "Gördüm": çalan tüm siparişleri susturur ve ack'ler. */
  silenceAll: () => void;
  /** "Sesi aç" bandı (kullanıcı jesti içinde). */
  enableSound: () => void;
  minimal: boolean;
}

const Ctx = createContext<NewOrderAlarmValue | null>(null);

export function useNewOrderAlarm(): NewOrderAlarmValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('NewOrderAlarmProvider eksik');
  return v;
}

function readDeviceLabel(): string {
  try {
    return window.localStorage.getItem(DEVICE_LABEL_KEY) ?? 'Panel';
  } catch {
    return 'Panel';
  }
}

/**
 * Panel kabuğunun (PanelShell) içinde, akış sağlayıcısının altında durur. Tüm panel rollerinde (sahip, yönetici,
 * kasiyer, mutfak) çalışır; mutfak yalnız onaylanan sipariş "ding"ini duyar, bant ve döngüsel alarm görmez.
 */
export function NewOrderAlarmProvider({
  businessName,
  kitchen,
  minimal,
  children,
}: {
  businessName: string;
  kitchen: boolean;
  /** Kurulum sihirbazı gibi sade ekranlar: "Ses kapalı" bandı yalnız bekleyen sipariş varken görünür. */
  minimal: boolean;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname() ?? '/panel';
  const onLive = pathname === '/panel';
  const me = useMe();
  const impersonating = Boolean(me.data?.impersonating);
  const [wake] = useState(() => new ScreenWake());
  const [audioOn, setAudioOn] = useState(false);
  const [shift, setShift] = useState<ShiftState>(() => (alarmSound.unlocked ? 'started' : 'pending'));
  const [shiftRequested, setShiftRequested] = useState(false);
  const [silenced, setSilenced] = useState<Set<string>>(() => new Set());
  const [escalated, setEscalated] = useState<Set<string>>(() => new Set());
  const acked = useRef(new Set<string>());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Canlı ekranla aynı anahtar: tek sorgu, tek önbellek (45 sn emniyet sorgusu arka planda da sürer)
  const q = useApiQuery<ActiveOrdersResponse>(ORDERS_ACTIVE_KEY, '/panel/orders/active', {
    refetchInterval: SAFETY_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    staleTime: 2_000,
  });

  useEffect(() => {
    const sync = () => setAudioOn(alarmSound.unlocked);
    const off = alarmSound.subscribe(sync);
    sync();
    return () => {
      off();
      alarmSound.stopLoop();
      wake.disable();
    };
  }, [wake]);

  // Ses başka yoldan açıldıysa ("Sesi aç" bandı) vardiya başlamış sayılır
  useEffect(() => {
    if (audioOn) setShift((s) => (s === 'pending' ? 'started' : s));
  }, [audioOn]);

  const refetchSoon = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void qc.invalidateQueries({ queryKey: ORDERS_ACTIVE_KEY }), 250);
  }, [qc]);
  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  usePanelEvent(['order.created', 'order.updated', 'order.alarm', 'resync', STREAM_RECONNECTED], (e) => {
    if (e.type === 'order.created' || e.type === 'order.updated') {
      if (!isOrderEventPayload(e.data)) return;
      const summary = e.data.order;
      if (summary.testKind === 'canary') return;
      const found = applySummary(qc, summary);
      void qc.invalidateQueries({ queryKey: orderDetailKey(summary.id) });
      // Yeni kartın kalemleri ve rozetleri için listeyi tazele
      if (!found || e.type === 'order.created' || e.data.change === 'cancel_request') refetchSoon();
      if (kitchen && e.data.to === 'accepted' && alarmSound.unlocked) alarmSound.ding(0.5);
      return;
    }
    if (e.type === 'order.alarm') {
      const p = e.data as OrderAlarmPayload;
      if (p?.orderId && p.step >= 2) setEscalated((s) => new Set(s).add(p.orderId));
      refetchSoon();
      return;
    }
    refetchSoon();
  });

  const items = q.data?.items;
  const newOrders = useMemo(() => newOrdersOf(items ?? []), [items]);
  const bandOrders = useMemo(() => bandOrdersOf(items ?? [], kitchen), [items, kitchen]);
  const alarming = useMemo(() => alarmingOrdersOf(items ?? [], silenced, kitchen), [items, silenced, kitchen]);
  const alarmingIds = useMemo(() => new Set(alarming.map((c) => c.id)), [alarming]);

  const ack = useCallback(
    (cards: readonly OrderCard[]) => {
      if (kitchen) return;
      let label: string | null = null;
      for (const c of cards) {
        if (acked.current.has(c.id)) continue;
        acked.current.add(c.id);
        label ??= readDeviceLabel();
        void orderActions.ack(c.id, label).catch(() => acked.current.delete(c.id));
      }
    },
    [kitchen],
  );

  const markSeen = useCallback((id: string) => {
    setSilenced((s) => (s.has(id) ? s : new Set(s).add(id)));
  }, []);
  const silenceAll = useCallback(() => {
    setSilenced((s) => new Set([...s, ...alarming.map((c) => c.id)]));
    ack(alarming);
  }, [alarming, ack]);

  // Panel açılışı: service worker'ı önceden kaydet (vardiya dokunuşunda abonelik beklemesin), izinli cihazın mevcut
  // aboneliğini bu oturuma yeniden bağla (çıkış/yeniden giriş, başka personel)
  const pushOwner = me.data ? `${me.data.user.id}:${me.data.tenant?.id ?? ''}` : null;
  useEffect(() => {
    if (impersonating || !pushOwner || !isPushSupported()) return;
    if (Notification.permission === 'denied' || isPushOptedOut()) return;
    void registerPanelServiceWorker()
      .then(() => syncPushSubscription())
      .catch(() => undefined);
  }, [impersonating, pushOwner]);

  /** Kullanıcı jesti içinde çağrılır: bildirim izni (ilk sefer) + bu cihazın aboneliği. Sessizdir; ayrıntı ayarlarda. */
  const startPush = useCallback(() => {
    if (impersonating) return;
    void enablePush({ respectOptOut: true }).then((res) => {
      if (res.ok) return;
      if ((res.reason === 'needs_home_screen' || res.reason === 'denied') && takePushHint()) {
        toast.info(
          res.reason === 'needs_home_screen'
            ? 'Panel kapalıyken bildirim almak için paneli ana ekrana ekleyin.'
            : 'Bildirim izni kapalı. Panel kapalıyken yeni sipariş bildirimi gelmez.',
          { action: { label: 'Nasıl açılır', onClick: () => router.push('/panel/ayarlar/bildirimler/cihaz') }, duration: 10_000 },
        );
      }
    });
  }, [impersonating, router]);

  const enableSound = useCallback(() => {
    // Kullanıcı jesti içinde: ses kilidini aç, ekranı açık tut, bildirim iznini iste
    void alarmSound.unlock();
    void wake.enable();
    startPush();
  }, [wake, startPush]);

  // "Gördüm" ile susturulan sipariş new kaldıkça 30 sn'de bir kısa hatırlatma (04 §4.5)
  const silencedStillNew = newOrders.some((c) => silenced.has(c.id) && !c.rejectionScheduledAt);
  useEffect(() => {
    if (!audioOn || kitchen || !silencedStillNew || alarming.length) return;
    const t = setInterval(() => alarmSound.ding(0.3), 30_000);
    return () => clearInterval(t);
  }, [audioOn, kitchen, silencedStillNew, alarming.length]);

  // Sekme başlığında sayaç; Next gezinmede başlığı yeniden yazdığı için saniyede bir yenilenir
  const titleCount = kitchen ? 0 : newOrders.length;
  useEffect(() => {
    const apply = () => {
      const next = withNewOrderCount(document.title, titleCount);
      if (next !== document.title) document.title = next;
    };
    apply();
    if (!titleCount) return;
    const t = setInterval(apply, 1_000);
    return () => {
      clearInterval(t);
      document.title = withNewOrderCount(document.title, 0);
    };
  }, [titleCount]);

  // Yeni sipariş gelince destekleyen cihazda titreşim (hangi ekranda olursa olsun)
  const prevBand = useRef(bandOrders.length);
  useEffect(() => {
    if (bandOrders.length > prevBand.current && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.([200, 100, 200]);
    }
    prevBand.current = bandOrders.length;
  }, [bandOrders.length]);

  const openShift = useCallback(() => setShiftRequested(true), []);
  const shiftOpen = shiftRequested || (shift === 'pending' && onLive);

  const value = useMemo<NewOrderAlarmValue>(
    () => ({
      kitchen,
      audioOn,
      shiftOpen,
      alarmingIds,
      markSeen,
      ack,
      openShift,
      newOrders,
      bandOrders,
      alarming,
      silenceAll,
      enableSound,
      minimal,
    }),
    [kitchen, audioOn, shiftOpen, alarmingIds, markSeen, ack, openShift, newOrders, bandOrders, alarming, silenceAll, enableSound, minimal],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <AlarmLoop alarming={alarming} escalated={escalated} audioOn={audioOn} kitchen={kitchen} />
      {shiftOpen ? (
        <ShiftStart
          businessName={businessName}
          wake={wake}
          waitingCount={bandOrders.length}
          onStarted={() => {
            setShift('started');
            setShiftRequested(false);
          }}
          // "Siparişleri almaya başla" dokunuşunun içinde (ses kilidiyle aynı anda, beklemeden): bildirim izni + abonelik
          onTap={startPush}
          onSkip={() => {
            setShift((s) => (s === 'started' ? s : 'skipped'));
            setShiftRequested(false);
          }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/** Döngüsel alarm (ses açıksa); 60 sn'yi geçen ya da sunucuda 2. adıma çıkan siparişte ses yükselir. */
function AlarmLoop({
  alarming,
  escalated,
  audioOn,
  kitchen,
}: {
  alarming: OrderCard[];
  escalated: ReadonlySet<string>;
  audioOn: boolean;
  kitchen: boolean;
}) {
  const now = useNow(1000);
  const high = isHighLevel(alarming, escalated, now);
  const count = alarming.length;
  useEffect(() => {
    if (!audioOn || kitchen || count === 0) {
      alarmSound.stopLoop();
      return;
    }
    alarmSound.startLoop(high ? 'high' : 'normal');
  }, [audioOn, kitchen, count, high]);
  return null;
}

/**
 * Üst bantlar (her panel ekranında): kırmızı "YENİ SİPARİŞ #n" bandı (dokununca canlı ekrandaki karta gider,
 * "Gördüm" sesi susturur) ve ses kilitliyken "Ses kapalı — [Sesi aç]" bandı (04 §4.1).
 */
export function NewOrderBands() {
  const alarm = useContext(Ctx);
  if (!alarm) return null;
  const { bandOrders, alarming, silenceAll, audioOn, shiftOpen, enableSound, minimal } = alarm;
  // Bant, yeni sipariş kaldıkça yerinde durur (susturunca kaybolup düzeni kaydırmaz); "Gördüm" yalnız çalan varken
  const first = alarming[0] ?? bandOrders[0];
  const showSoundOff = !audioOn && !shiftOpen && (!minimal || bandOrders.length > 0);
  return (
    <>
      {first ? (
        <Banner
          tone="alarm"
          icon={BellRing}
          action={
            alarming.length ? (
              <Button variant="secondary" size="md" onClick={silenceAll}>
                <BellOff aria-hidden /> Gördüm
              </Button>
            ) : null
          }
        >
          <Link href={orderAnchorHref(first.id)} className="inline-flex min-h-hit items-center underline-offset-4 hover:underline">
            YENİ SİPARİŞ #{first.number}
            {first.totalKurus != null ? ` · ${formatMoney(first.totalKurus)}` : ''}
            {bandOrders.length > 1 ? ` · +${bandOrders.length - 1} sipariş daha` : ''}
          </Link>
        </Banner>
      ) : null}
      {showSoundOff ? (
        <Banner
          tone="alarm"
          icon={VolumeX}
          action={
            <Button variant="secondary" size="md" onClick={enableSound}>
              <Volume2 aria-hidden /> Sesi aç
            </Button>
          }
        >
          Ses kapalı — yeni siparişleri duyamazsınız.
        </Banner>
      ) : null}
    </>
  );
}

/** Üst bar ses göstergesi (04 §2.2): "Ses açık" / kırmızı "Ses kapalı"; dokununca vardiya ekranı açılır. */
export function SoundIndicator() {
  const alarm = useContext(Ctx);
  if (!alarm) return null;
  const on = alarm.audioOn;
  return (
    <button
      type="button"
      onClick={alarm.openShift}
      aria-label={on ? 'Ses açık. Vardiya ekranını aç' : 'Ses kapalı. Sesi açmak için dokunun'}
      className={cn(
        'min-h-hit min-w-hit items-center justify-center gap-1.5 rounded-md px-2 text-sm font-semibold hover:bg-accent',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        // Dar telefonda üst bar yalnız sorun varken (ses kapalı) yer kaplar
        on ? 'hidden text-fg sm:inline-flex' : 'inline-flex text-status-new-fg',
      )}
    >
      {on ? <Volume2 aria-hidden className="size-5" /> : <VolumeX aria-hidden className="size-5" />}
      <span className={on ? 'hidden xl:inline' : 'hidden sm:inline'}>{on ? 'Ses açık' : 'Ses kapalı'}</span>
    </button>
  );
}
