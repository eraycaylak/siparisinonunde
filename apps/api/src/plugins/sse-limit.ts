// SSE bağlantı sınırı (açık soru 5: "SSE bağlantısı için ÜST SINIR YOK").
//
// Sorun: /panel/stream her açılışta bir kalıcı HTTP bağlantısı + 15 sn'lik ping zamanlayıcısı + (varlık yazan
// roller için) dakikada bir UPDATE demektir. Çok sekme açan tek bir işletme ya da birkaç şube, 1/4 vCPU + 1 GiB
// kutuda soket ve zamanlayıcı bütçesini kendi başına tüketebilir. Veritabanı bağlantısı akış başına AYRILMAZ
// (havuz paylaşılır, LISTEN tek bağlantıdadır), bu yüzden sınırın gerekçesi `max_connections` değil süreç
// kaynaklarıdır — ama sınırsız akış sayısı panelin tamamını yavaşlatır.
//
// KARAR: sınır aşıldığında EN ESKİ bağlantı kapatılır, yeni bağlantı REDDEDİLMEZ.
// Gerekçe (CLAUDE.md kural 4 "sipariş kaçmaz"):
//   - Kapatılan akış veri kaybı DEĞİLDİR: EventSource `retry` ile kendiliğinden döner ve `Last-Event-ID` ile
//     kaçırdığı olayları tekrar oynatır (lib/sse openBranchStream). Yani kapatma geçici, kayıp yok.
//   - Yeni bağlantıyı reddetmek ise KALICI körlüktür: unutulmuş/arka plandaki sekmeler slotları tutarken,
//     mutfaktaki kişinin yeni açtığı ekran hiçbir zaman sipariş göstermez. Sipariş tam o ekranda kaçar.
//   - Çırpınmaya karşı: kapatılan akışa `retry` olarak SSE_EVICTED_RETRY_MS yazılır (varsayılan 3 sn yerine
//     30 sn). Böylece slotlar anında birbirini kovalamaz, yavaş bir devir olur ve her zaman EN YENİ
//     (insanın baktığı) ekran ayakta kalır.
// Sınır aşıldığında operasyon uyarısı gider (lib/alert): "bu işletme sınırda" bilgisi sessiz kalmaz.

import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { alert, type AlertConfig } from '../lib/alert';

/** Şube başına aynı anda açık panel akışı. Mutfak + kasa + sahip + 2 yedek sekme rahatça sığar. */
export const SSE_MAX_PER_BRANCH = 8;
/** İşletme başına (tüm şubeler) aynı anda açık panel akışı. */
export const SSE_MAX_PER_TENANT = 24;
/** Kapatılan akışın geri dönmesi için verilen gecikme (ms); varsayılan 3 sn'lik retry'ı ezer. */
export const SSE_EVICTED_RETRY_MS = 30_000;

export interface SseLimits {
  perBranch: number;
  perTenant: number;
}

export interface SseLimitConfig extends AlertConfig {
  SSE_MAX_PER_BRANCH?: string | number | undefined;
  SSE_MAX_PER_TENANT?: string | number | undefined;
}

function positiveInt(value: string | number | undefined, fallback: number): number {
  const n = typeof value === 'number' ? value : Number((value ?? '').toString().trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : fallback;
}

/**
 * Sınırları çözer. Alanlar `apps/api/src/config.ts`'e eklenene kadar ortamdan okunur (lib/alert.ts ile aynı
 * yaklaşım); eklendiğinde `Config` aynı adları taşıdığı için burada değişiklik gerekmez.
 */
export function resolveSseLimits(config?: SseLimitConfig, env: Record<string, string | undefined> = process.env): SseLimits {
  return {
    perBranch: positiveInt(config?.SSE_MAX_PER_BRANCH ?? env.SSE_MAX_PER_BRANCH, SSE_MAX_PER_BRANCH),
    perTenant: positiveInt(config?.SSE_MAX_PER_TENANT ?? env.SSE_MAX_PER_TENANT, SSE_MAX_PER_TENANT),
  };
}

interface Entry {
  res: ServerResponse;
  tenantId: string;
  branchId: string;
}

export interface SseAdmission {
  /** Bu açılış yüzünden kapatılan eski bağlantı sayısı. */
  evicted: number;
  /** Slotu elle bırakır (akış 'close' olayı da bırakır; iki kez çağrılması güvenlidir). */
  release: () => void;
}

export interface SseLimiterOptions {
  log: FastifyBaseLogger;
  config?: SseLimitConfig | undefined;
  limits?: SseLimits | undefined;
}

/**
 * Açık akışların kaydı. `Set` ekleme sırasını korur → kümedeki ilk eleman EN ESKİ bağlantıdır; çıkarma O(1)'dir.
 */
export class SseConnectionLimiter {
  private readonly byBranch = new Map<string, Set<Entry>>();
  private readonly byTenant = new Map<string, Set<Entry>>();
  private readonly log: FastifyBaseLogger;
  private readonly config: SseLimitConfig | undefined;
  readonly limits: SseLimits;

  constructor(opts: SseLimiterOptions) {
    this.log = opts.log;
    this.config = opts.config;
    this.limits = opts.limits ?? resolveSseLimits(opts.config);
  }

  branchCount(branchId: string): number {
    return this.byBranch.get(branchId)?.size ?? 0;
  }

  tenantCount(tenantId: string): number {
    return this.byTenant.get(tenantId)?.size ?? 0;
  }

  /** Teşhis: tüm açık akış sayısı. */
  get size(): number {
    let n = 0;
    for (const set of this.byTenant.values()) n += set.size;
    return n;
  }

  /**
   * Yeni akışı kaydeder ve gerekirse en eskileri kapatır. Kapatma hedefi hiçbir zaman yeni akışın kendisi
   * değildir (kendisi kümelerin SONUNDADIR), bu yüzden az önce açılan ekran hep ayakta kalır.
   */
  admit(res: ServerResponse, key: { tenantId: string; branchId: string }): SseAdmission {
    const entry: Entry = { res, tenantId: key.tenantId, branchId: key.branchId };
    const branchSet = this.setOf(this.byBranch, key.branchId);
    const tenantSet = this.setOf(this.byTenant, key.tenantId);
    branchSet.add(entry);
    tenantSet.add(entry);

    const release = () => this.remove(entry);
    res.once('close', release);
    // 'close' BİR KEZ yayılır: bağlantı bu kayıttan ÖNCE koptuysa (stream.ts'te akış açılırken yapılan
    // veritabanı turları sırasında istemci gidebilir) olay bir daha gelmez ve slot sonsuza kadar tutulur —
    // stream.ts'teki varlık zamanlayıcısının öğrendiği aynı ders. Ölü kayıt hem sayaçları yanıltır hem de
    // kümelerin en başında durduğu için sonraki her açılışta sahte bir "sınır aşıldı" uyarısı üretir.
    // Kopmuş yanıtta `destroyed` true olur (`writableEnded` olmaz), bu yüzden ölçüt odur.
    if (res.destroyed || res.writableEnded) {
      release();
      return { evicted: 0, release };
    }

    let evicted = 0;
    evicted += this.trim(branchSet, this.limits.perBranch, entry);
    evicted += this.trim(tenantSet, this.limits.perTenant, entry);
    if (evicted > 0) {
      alert(
        { log: this.log, config: this.config },
        {
          kind: 'sse_connection_limit',
          severity: 'warning',
          message: `Panel canlı akış sınırı aşıldı; en eski ${evicted} bağlantı kapatıldı.`,
          data: {
            tenantId: key.tenantId,
            branchId: key.branchId,
            branchOpen: branchSet.size,
            tenantOpen: tenantSet.size,
            perBranch: this.limits.perBranch,
            perTenant: this.limits.perTenant,
            evicted,
          },
          dedupeKey: `sse_connection_limit:${key.branchId}`,
        },
      );
    }
    return { evicted, release };
  }

  private setOf(map: Map<string, Set<Entry>>, id: string): Set<Entry> {
    let set = map.get(id);
    if (!set) {
      set = new Set();
      map.set(id, set);
    }
    return set;
  }

  private remove(entry: Entry): void {
    const branchSet = this.byBranch.get(entry.branchId);
    if (branchSet) {
      branchSet.delete(entry);
      if (branchSet.size === 0) this.byBranch.delete(entry.branchId);
    }
    const tenantSet = this.byTenant.get(entry.tenantId);
    if (tenantSet) {
      tenantSet.delete(entry);
      if (tenantSet.size === 0) this.byTenant.delete(entry.tenantId);
    }
  }

  /** Küme sınırın üstündeyse en eskileri kapatır; `keep` (yeni akış) asla kapatılmaz. */
  private trim(set: Set<Entry>, limit: number, keep: Entry): number {
    let evicted = 0;
    while (set.size > limit) {
      let target: Entry | null = null;
      for (const e of set) {
        if (e !== keep) {
          target = e;
          break;
        }
      }
      if (!target) break;
      this.remove(target);
      this.closeEvicted(target);
      evicted++;
    }
    return evicted;
  }

  private closeEvicted(entry: Entry): void {
    const res = entry.res;
    try {
      if (!res.writableEnded && res.headersSent) {
        // Önce yavaş retry, sonra neden: istemci geri döndüğünde Last-Event-ID ile kaçırdığını alır
        res.write(`retry: ${SSE_EVICTED_RETRY_MS}\n\n`);
        res.write(`event: limit\ndata: ${JSON.stringify({ reason: 'too_many_streams', retryMs: SSE_EVICTED_RETRY_MS })}\n\n`);
      }
      res.end();
    } catch (err) {
      this.log.warn({ err }, 'sınır aşımında SSE bağlantısı kapatılamadı');
    }
  }
}

/** Uygulama başına tek örnek. `app.decorate` yerine WeakMap: testlerdeki her buildApp kendi sayacını alır. */
const limiters = new WeakMap<FastifyInstance, SseConnectionLimiter>();

export function sseLimiter(app: FastifyInstance): SseConnectionLimiter {
  let limiter = limiters.get(app);
  if (!limiter) {
    limiter = new SseConnectionLimiter({ log: app.log, config: app.config as unknown as SseLimitConfig });
    limiters.set(app, limiter);
  }
  return limiter;
}
