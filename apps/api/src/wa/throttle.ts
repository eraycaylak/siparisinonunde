// Numara başı basit hız sınırı (02 §7.6): Cloud 80/sn, Coexistence 20/sn → güvenli varsayılan 20/sn.
// Süreç belleğinde token bucket; kova boşsa kısa süre bekler (worker içinde). Alıcı başı ~6 sn aralık ise
// kuyruk zamanlamasıyla (conversation_bot_state.next_send_at) sağlanır: services/messaging/outbound.ts.

export const NUMBER_RATE_PER_SEC = 20;
export const PAIR_INTERVAL_MS = 6_000;

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

function refill(b: Bucket, now: number, ratePerSec: number) {
  b.tokens = Math.min(ratePerSec, b.tokens + ((now - b.updated) / 1000) * ratePerSec);
  b.updated = now;
}

/** Numara için bir gönderim izni alır; gerekirse bekler (en çok `maxWaitMs`). İzin alınamazsa false. */
export async function acquireNumberSlot(key: string, opts: { ratePerSec?: number; maxWaitMs?: number } = {}): Promise<boolean> {
  const rate = opts.ratePerSec ?? NUMBER_RATE_PER_SEC;
  const deadline = Date.now() + (opts.maxWaitMs ?? 5_000);
  for (;;) {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: rate, updated: now };
    refill(b, now, rate);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      buckets.set(key, b);
      return true;
    }
    buckets.set(key, b);
    const waitMs = Math.ceil(((1 - b.tokens) / rate) * 1000);
    if (now + waitMs > deadline) return false;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export function resetNumberSlots(): void {
  buckets.clear();
}
