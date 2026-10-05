// Operasyon uyarısı (lib/alert.ts): kanal yoksa yalnız log, kanal varsa zaman aşımlı POST, aynı uyarı soğumalı,
// ağırlık süzgeci, kişisel veri sızıntısına karşı maskeleme. Hiçbir koşulda hata YUKARI ÇIKMAZ (denetim B9/1.6).
// Veritabanı gerekmez: fetch `setHttpFetch` ile değiştirilir.

import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALERT_DEFAULT_MIN_SEVERITY,
  alert,
  resetAlertCooldown,
  resolveAlertConfig,
  sendAlert,
  type AlertConfig,
} from '../src/lib/alert';
import { setHttpFetch } from '../src/wa/http';

interface Line {
  level: string;
  msg: string;
  obj: Record<string, unknown>;
}

function captureLog(): { log: FastifyBaseLogger; lines: Line[] } {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (obj: unknown, msg?: string) => {
      lines.push({ level, msg: msg ?? (typeof obj === 'string' ? obj : ''), obj: (obj ?? {}) as Record<string, unknown> });
    };
  const logger = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal') } as Record<
    string,
    unknown
  >;
  logger.child = () => logger;
  return { log: logger as unknown as FastifyBaseLogger, lines };
}

const WEBHOOK = 'https://uyari.example.test/kanca';
const cfg = (over: Partial<AlertConfig> = {}): AlertConfig => ({ ALERT_WEBHOOK_URL: WEBHOOK, DEPLOY_ENV: 'production', ...over });

/** Çağrıları toplayan sahte fetch. */
function stubFetch(opts: { status?: number; throws?: boolean } = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  setHttpFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    if (opts.throws) throw new Error('ağ yok');
    const status = opts.status ?? 204;
    // 204/205/304 gövdesiz durumlardır: `new Response('', {status:204})` TypeError atar ve sahte fetch'i çökertir
    return new Response([204, 205, 304].includes(status) ? null : '', { status });
  });
  return calls;
}

// Geliştirici makinesinde tanımlı olabilecek ortam değişkeni testi etkilemesin (sendAlert ortama düşer)
let savedEnv: { url?: string | undefined; min?: string | undefined };
beforeEach(() => {
  savedEnv = { url: process.env.ALERT_WEBHOOK_URL, min: process.env.ALERT_MIN_SEVERITY };
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.ALERT_MIN_SEVERITY;
  resetAlertCooldown();
});
afterEach(() => {
  if (savedEnv.url === undefined) delete process.env.ALERT_WEBHOOK_URL;
  else process.env.ALERT_WEBHOOK_URL = savedEnv.url;
  if (savedEnv.min === undefined) delete process.env.ALERT_MIN_SEVERITY;
  else process.env.ALERT_MIN_SEVERITY = savedEnv.min;
  setHttpFetch(null);
  resetAlertCooldown();
});

describe('resolveAlertConfig', () => {
  it('config önce, sonra ortam; geçersiz adres ve geçersiz ağırlık yok sayılır', () => {
    expect(resolveAlertConfig(cfg(), {})).toMatchObject({ webhookUrl: WEBHOOK, minSeverity: ALERT_DEFAULT_MIN_SEVERITY });
    expect(resolveAlertConfig(undefined, { ALERT_WEBHOOK_URL: WEBHOOK, ALERT_MIN_SEVERITY: 'critical' })).toMatchObject({
      webhookUrl: WEBHOOK,
      minSeverity: 'critical',
    });
    // http/https dışı adres (ör. yanlışlıkla girilen dosya yolu) kanal sayılmaz
    expect(resolveAlertConfig(cfg({ ALERT_WEBHOOK_URL: '/tmp/uyari' }), {}).webhookUrl).toBeNull();
    expect(resolveAlertConfig(cfg({ ALERT_WEBHOOK_URL: 'file:///etc/passwd' }), {}).webhookUrl).toBeNull();
    expect(resolveAlertConfig(cfg({ ALERT_MIN_SEVERITY: 'cok-acil' }), {}).minSeverity).toBe(ALERT_DEFAULT_MIN_SEVERITY);
  });
});

describe('sendAlert', () => {
  it('kanal yoksa yalnız loglar, hata atmaz', async () => {
    const { log, lines } = captureLog();
    const calls = stubFetch();
    const res = await sendAlert({ log, config: { ALERT_WEBHOOK_URL: undefined } }, { kind: 'test_kanal_yok', message: 'bir şey bozuldu' });
    expect(res.outcome).toBe('no_channel');
    expect(calls).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.level).toBe('error');
    expect(lines[0]!.obj).toMatchObject({ alert: 'test_kanal_yok', severity: 'warning' });
  });

  it('kanal varsa POST atar: gövdede tür, ağırlık, ortam ve bağlam', async () => {
    const { log } = captureLog();
    const calls = stubFetch();
    const res = await sendAlert({ log, config: cfg() }, { kind: 'jobs_dlq_threshold', severity: 'critical', message: '12 iş başarısız', data: { failed: 12 } });
    expect(res).toMatchObject({ outcome: 'sent', status: 204 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WEBHOOK);
    expect(calls[0]!.body).toMatchObject({
      service: 'yemekgelsin-api',
      env: 'production',
      kind: 'jobs_dlq_threshold',
      severity: 'critical',
      message: '12 iş başarısız',
      data: { failed: 12 },
    });
    expect(typeof calls[0]!.body.at).toBe('string');
  });

  it('soğuma: aynı anahtar dakikalarca tekrarlanmaz, farklı anahtar engellenmez', async () => {
    const { log } = captureLog();
    const calls = stubFetch();
    const input = { kind: 'job_failed_permanent', severity: 'critical' as const, message: 'x', dedupeKey: 'job_failed_permanent:sms.send' };
    expect((await sendAlert({ log, config: cfg() }, input)).outcome).toBe('sent');
    expect((await sendAlert({ log, config: cfg() }, input)).outcome).toBe('cooldown');
    expect((await sendAlert({ log, config: cfg() }, { ...input, dedupeKey: 'job_failed_permanent:wa.send' })).outcome).toBe('sent');
    expect(calls).toHaveLength(2);
    // cooldownMs = 0 → soğuma yok (eşik aşımı her koşuda görülmek istenirse)
    expect((await sendAlert({ log, config: cfg() }, { ...input, cooldownMs: 0 })).outcome).toBe('sent');
    // Soğumaya girmeyen uyarı da loglanır: kayıt her zaman tam
    expect(calls).toHaveLength(3);
  });

  it('ALERT_MIN_SEVERITY altındaki uyarı gönderilmez ama loglanır', async () => {
    const { log, lines } = captureLog();
    const calls = stubFetch();
    const config = cfg({ ALERT_MIN_SEVERITY: 'critical' });
    expect((await sendAlert({ log, config }, { kind: 'a', severity: 'warning', message: 'uyarı' })).outcome).toBe('below_min_severity');
    expect((await sendAlert({ log, config }, { kind: 'b', severity: 'critical', message: 'kritik' })).outcome).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(lines).toHaveLength(2);
  });

  it('webhook hata verirse ya da ulaşılamazsa uyarı yutulur (iş yolu etkilenmez)', async () => {
    const { log, lines } = captureLog();
    stubFetch({ status: 500 });
    expect(await sendAlert({ log, config: cfg() }, { kind: 'a', message: 'm' })).toMatchObject({ outcome: 'failed', status: 500 });
    resetAlertCooldown();
    setHttpFetch(null);
    stubFetch({ throws: true });
    expect(await sendAlert({ log, config: cfg() }, { kind: 'a', message: 'm' })).toMatchObject({ outcome: 'failed' });
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(2);
  });

  it('kişisel veri emniyeti: telefon benzeri rakam dizileri maskelenir, uzun metin kırpılır', async () => {
    const { log } = captureLog();
    const calls = stubFetch();
    await sendAlert(
      { log, config: cfg() },
      {
        kind: 'a',
        severity: 'critical',
        message: 'sms.send başarısız: +90 532 123 45 67 numarasına gönderilemedi',
        data: { to: '05321234567', note: 'x'.repeat(900), count: 3 },
      },
    );
    const body = calls[0]!.body as { message: string; data: Record<string, unknown> };
    expect(body.message).not.toContain('5321234567');
    expect(body.message).toContain('***');
    expect(body.data.to).toBe('***');
    expect(String(body.data.note)).toHaveLength(500);
    expect(body.data.count).toBe(3);
  });

  it('alert() ateşle-ve-unut: senkron döner, hata atmaz', async () => {
    const { log } = captureLog();
    const calls = stubFetch({ throws: true });
    expect(() => alert({ log, config: cfg() }, { kind: 'a', severity: 'critical', message: 'm' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
  });
});
