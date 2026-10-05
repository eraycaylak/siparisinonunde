// Operasyon uyarısı — tek giriş noktası (denetim B9 / 1.6; 06 §9.x "alarm ve nöbet").
//
// Üretimde hiçbir otomatik uyarı kanalı yoktu: veritabanı düşmesi, worker çökme döngüsü, kalıcı iş hatası ve DLQ
// birikmesi yalnız bir log satırıydı. Bu dosya o satırın yanına tek bir dış kanal koyar:
//   - `ALERT_WEBHOOK_URL` tanımlıysa JSON gövdeli POST atılır (Slack/Telegram köprüsü, Better Stack, kendi uç noktamız).
//   - Tanımsızsa yalnız `log.error` ile yetinilir — uyarı kanalı yokluğu uygulamayı DURDURMAZ.
// Kurallar:
//   - Ateşle-ve-unut: `alert()` hiçbir zaman beklenmez, hiçbir zaman hata atmaz (çağıran iş yolu uyarı yüzünden
//     başarısız olmaz). Zaman aşımlı (ALERT_TIMEOUT_MS); hata yutulur, yalnız `log.warn` ile görünür.
//   - Aynı uyarı dakikalarca tekrarlamaz: bellek içi soğuma (ALERT_COOLDOWN_MS, anahtar başına). Bellek içi olması
//     bilinçli: tek container tek worker (00 §12a madde 10) ve soğuma kaybı yalnız "bir uyarı fazla gider" demektir.
//   - Kişisel veri gönderilmez (CLAUDE.md kural 7): `data` alanına telefon/adres/isim YAZILMAZ; yine de emniyet için
//     uzun rakam dizileri ve uzun metinler kırpılır (jobs/system `safeError` ile aynı yaklaşım).

import { type FastifyBaseLogger } from 'fastify';
import { fetchWithTimeout } from '../wa/http';

/** Uyarı ağırlığı (artan). `ALERT_MIN_SEVERITY` bu sıraya göre süzer. */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** Webhook'a verilen süre: kuyruk şeridini bekletmemek için kısa. */
export const ALERT_TIMEOUT_MS = 5_000;
/** Aynı soğuma anahtarıyla gelen uyarılar bu süre boyunca tek kez gönderilir. */
export const ALERT_COOLDOWN_MS = 10 * 60_000;
/** `ALERT_MIN_SEVERITY` verilmezse gönderilen en düşük ağırlık. */
export const ALERT_DEFAULT_MIN_SEVERITY: AlertSeverity = 'warning';
/** Uyarı metni ve bağlam değerlerinde izin verilen en uzun metin. */
const MAX_TEXT = 500;

/**
 * Uyarı kanalı yapılandırması. Alanlar `apps/api/src/config.ts`'e eklenene kadar (bkz. raporda DIŞ BAĞIMLILIK)
 * ortamdan okunur; eklendiğinde `Config` nesnesi aynı adları taşıdığı için burada değişiklik gerekmez
 * (`Config` yapısal olarak bu arayüze atanabilir).
 */
export interface AlertConfig {
  ALERT_WEBHOOK_URL?: string | undefined;
  ALERT_MIN_SEVERITY?: string | undefined;
  NODE_ENV?: string | undefined;
  DEPLOY_ENV?: string | undefined;
}

export interface AlertContext {
  log: FastifyBaseLogger;
  config?: AlertConfig | undefined;
}

export interface AlertInput {
  /** Makine tarafından okunan uyarı türü (ör. `job_failed_permanent`, `jobs_dlq_threshold`, `order_new_watch`). */
  kind: string;
  /** Türkçe, insan okuyacak tek satır. */
  message: string;
  severity?: AlertSeverity;
  /** Kişisel veri İÇERMEYEN bağlam (sayılar, kimlikler, iş türleri). */
  data?: Record<string, unknown>;
  /** Soğuma anahtarı; verilmezse `kind`. Aynı türün farklı nedenlerini ayırmak için kullanılır. */
  dedupeKey?: string;
  /** Bu uyarı için özel soğuma süresi (0 = soğuma yok). */
  cooldownMs?: number;
}

export type AlertOutcome = 'sent' | 'no_channel' | 'cooldown' | 'below_min_severity' | 'failed';

export interface AlertResult {
  outcome: AlertOutcome;
  /** Webhook yanıt kodu (gönderildiyse). */
  status?: number;
}

/** Son gönderim anları (soğuma). Süreç belleğindedir; yeniden başlatma soğumayı sıfırlar. */
const lastSentAt = new Map<string, number>();

/** Testler ve uzun süreli süreçler için soğuma belleğini boşaltır. */
export function resetAlertCooldown(): void {
  lastSentAt.clear();
}

function isSeverity(v: unknown): v is AlertSeverity {
  return typeof v === 'string' && (ALERT_SEVERITIES as readonly string[]).includes(v);
}

/** http/https adresi mi (yapılandırma hatası sessizce yanlış yere POST atmasın). */
function isWebhookUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Yapılandırmayı çözer: önce `config` (configSchema ile doğrulanmış), yoksa ortam değişkeni. Geçersiz adres ya da
 * geçersiz ağırlık yok sayılır (uyarı kanalı yanlış yapılandırma yüzünden uygulamayı düşürmez).
 */
export function resolveAlertConfig(config?: AlertConfig, env: Record<string, string | undefined> = process.env): {
  webhookUrl: string | null;
  minSeverity: AlertSeverity;
  deployEnv: string;
} {
  const rawUrl = (config?.ALERT_WEBHOOK_URL ?? env.ALERT_WEBHOOK_URL ?? '').trim();
  const rawMin = (config?.ALERT_MIN_SEVERITY ?? env.ALERT_MIN_SEVERITY ?? '').trim();
  return {
    webhookUrl: rawUrl && isWebhookUrl(rawUrl) ? rawUrl : null,
    minSeverity: isSeverity(rawMin) ? rawMin : ALERT_DEFAULT_MIN_SEVERITY,
    deployEnv: (config?.DEPLOY_ENV ?? env.DEPLOY_ENV ?? 'production').trim() || 'production',
  };
}

/** UUID: iç tanımlayıcıdır, kişisel veri değildir — maskelenirse uyarı hangi kaydı gösterdiğini kaybeder. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Metinden kişisel veri sızıntısını azaltır: uzun rakam dizileri (telefon) maskelenir, metin kırpılır.
 * Sınır koşulları, UUID/karma gibi tanımlayıcıların içindeki rakam öbeklerinin yanlışlıkla maskelenmesini önler
 * (ör. `…-dd9f87381621` sonundaki 8 hane telefon değildir).
 */
function scrubText(v: string): string {
  if (UUID_RE.test(v)) return v;
  return v.replace(/(?<![0-9A-Za-z-])\+?\d[\d\s-]{6,}\d(?![0-9A-Za-z-])/g, '***').slice(0, MAX_TEXT);
}

/** Bağlamı güvenli hale getirir: yalnız bir seviye, metinler maskeli ve kırpık, en çok 20 alan. */
function scrubData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data).slice(0, 20)) {
    if (typeof v === 'string') out[k] = scrubText(v);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => (typeof x === 'string' ? scrubText(x) : x));
    else out[k] = scrubText(JSON.stringify(v) ?? '');
  }
  return out;
}

/**
 * Uyarıyı loglar ve (yapılandırılmışsa) webhook'a gönderir. Hata ATMAZ.
 * Çağıranlar genelde `alert()` (ateşle-ve-unut) kullanır; bu işlev testler ve sırası önemli olan yerler içindir.
 */
export async function sendAlert(ctx: AlertContext, input: AlertInput): Promise<AlertResult> {
  const severity = input.severity ?? 'warning';
  const data = scrubData(input.data);
  const message = scrubText(input.message);
  // Kanal olsun olmasın uyarı her zaman loglanır: tek kayıt yeri log'dur
  const line = { alert: input.kind, severity, ...data };
  if (severity === 'critical' || severity === 'warning') ctx.log.error(line, message);
  else ctx.log.info(line, message);

  const { webhookUrl, minSeverity, deployEnv } = resolveAlertConfig(ctx.config);
  if (!webhookUrl) return { outcome: 'no_channel' };
  if (SEVERITY_RANK[severity] < SEVERITY_RANK[minSeverity]) return { outcome: 'below_min_severity' };

  const cooldownMs = input.cooldownMs ?? ALERT_COOLDOWN_MS;
  const key = input.dedupeKey ?? input.kind;
  const now = Date.now();
  const prev = lastSentAt.get(key);
  if (cooldownMs > 0 && prev != null && now - prev < cooldownMs) return { outcome: 'cooldown' };
  // Soğumayı gönderimden ÖNCE işaretle: yavaş/başarısız webhook aynı uyarıyı peş peşe tekrarlatmasın
  if (cooldownMs > 0) lastSentAt.set(key, now);

  try {
    const res = await fetchWithTimeout(
      webhookUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service: 'yemekgelsin-api',
          env: deployEnv,
          kind: input.kind,
          severity,
          message,
          data,
          at: new Date(now).toISOString(),
        }),
      },
      ALERT_TIMEOUT_MS,
    );
    if (!res.ok) {
      ctx.log.warn({ alert: input.kind, status: res.status }, 'uyarı webhook\'u hata döndü');
      return { outcome: 'failed', status: res.status };
    }
    return { outcome: 'sent', status: res.status };
  } catch (err) {
    // Uyarı gönderilemedi: yalnız günlüğe düşer, çağıran iş etkilenmez
    ctx.log.warn({ err, alert: input.kind }, 'uyarı webhook\'una ulaşılamadı');
    return { outcome: 'failed' };
  }
}

/**
 * Ateşle-ve-unut uyarı: çağıran beklemez, hata hiçbir koşulda yukarı çıkmaz.
 * Kuyruk/cron yolunda kullanılacak biçim budur (uyarı gecikmesi iş yolunu bekletmez).
 */
export function alert(ctx: AlertContext, input: AlertInput): void {
  void sendAlert(ctx, input).catch(() => {
    // sendAlert kendi içinde yutuyor; buradaki yakalama son emniyet (ör. log'un kendisi patlarsa)
  });
}
