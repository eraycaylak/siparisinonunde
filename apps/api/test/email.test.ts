// E-posta kanalı (denetim 2026-10-04 madde 4.5): `sendEmail` sözleşmesi + sağlayıcı seçimi.
//
// Bu dosya aynı zamanda iskeletin GERÇEKTEN ÇAĞRILABİLİR olduğunun kanıtıdır: hiçbir akış henüz e-postaya
// bağlanmadığı için üründe çağıran yok; test doğrudan çağırır.
//
// Kanıtlanan değişmezler:
//   1. Yapılandırılmamış kanal SESSİZCE YUTMAZ: `skipped` + `provider_not_deliverable`, `log.error`, kayıt `failed`.
//   2. "Gönderildi" yalnız sağlayıcı kimlik döndürdüğünde söylenir ve kayıt o zaman `sent` olur.
//   3. Alıcı adresi ne günlüğe ne `notifications` satırına açık yazılır (CLAUDE.md değişmez kural 7).

import { notifications } from '@siparis/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEmailProvider } from '../src/email/index';
import { isEmailAddress, maskEmail } from '../src/email/types';
import { sendEmail } from '../src/services/messaging/email-send';
import { createTestContext, type TestContext, type TestTenant } from './helpers';
import { silentLog } from './wa-helpers';

let ctx: TestContext;
let t: TestTenant;

const deps = () => ({ db: ctx.db, config: ctx.config, log: silentLog });

/** Canlı ortam + taklit e-posta sağlayıcısı: hiçbir e-posta gidemeyen yapılandırma. */
const liveMockConfig = () => ({ ...ctx.config, NODE_ENV: 'production' as const, DEPLOY_ENV: 'production' as const, EMAIL_PROVIDER: 'mock' as const });

/** `log.error` satırlarını toplayan en küçük pino uyumlu kayıtçı. */
function captureLog() {
  const errors: string[] = [];
  const noop = () => {};
  const logger = {
    errors,
    level: 'info',
    error: (o: unknown, msg?: string) => {
      errors.push(typeof o === 'string' ? o : (msg ?? ''));
    },
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    silent: noop,
    child: () => logger,
  };
  return logger;
}

const emailRows = (tenantId: string, kind: string) =>
  ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.channel, 'email'), eq(notifications.kind, kind)));

beforeAll(async () => {
  ctx = await createTestContext();
  t = await ctx.createTenantWithOwner({ name: 'E-posta Kebap' });
});
afterAll(async () => {
  await ctx.close();
});

describe('maskEmail / isEmailAddress', () => {
  it('adresin yerel kısmı maskelenir, etki alanı görünür kalır', () => {
    expect(maskEmail('eray@yemekgelsin.net')).toBe('er***@yemekgelsin.net');
    // Kısa yerel kısımda bile en az 3 yıldız: uzunluk bilgisi sızmaz
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
    expect(maskEmail('')).toBe('***');
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail('@yok')).toBe('***');
  });

  it('adres doğrulaması sınırda yapılır', () => {
    expect(isEmailAddress('eray@yemekgelsin.net')).toBe(true);
    expect(isEmailAddress('  eray@yemekgelsin.net  ')).toBe(true);
    expect(isEmailAddress('eray@localhost')).toBe(false);
    expect(isEmailAddress('eray yemekgelsin.net')).toBe(false);
    expect(isEmailAddress('iki@adres,bir@alan.com')).toBe(false);
    expect(isEmailAddress('')).toBe(false);
  });
});

describe('getEmailProvider', () => {
  it('varsayılan mock', () => {
    expect(getEmailProvider(ctx.config).name).toBe('mock');
  });

  it('resend seçilip anahtar yoksa sessizce mock\'a DÜŞMEZ, hata fırlatır', () => {
    expect(() => getEmailProvider({ ...ctx.config, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: undefined, EMAIL_FROM: undefined })).toThrow(/Resend bilgileri eksik/);
  });

  it('resend bilgileri tamsa resend adaptörü', () => {
    const p = getEmailProvider({ ...ctx.config, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_anahtar', EMAIL_FROM: 'Yemek Gelsin <bildirim@yemekgelsin.net>' });
    expect(p.name).toBe('resend');
  });
});

describe('sendEmail', () => {
  it('test ortamında mock sağlayıcı: gönderilir ve notifications kaydı MASKELİ adresle yazılır', async () => {
    const r = await sendEmail(deps(), {
      tenantId: t.tenantId,
      purpose: 'ops_test',
      to: 'nobetci@yemekgelsin.net',
      subject: 'Kurulum doğrulaması',
      text: 'E-posta kanalı çalışıyor.',
    });
    expect(r.status).toBe('sent');
    expect(r.providerMessageId).toMatch(/^mock-email\./);

    const rows = await emailRows(t.tenantId, 'email_ops_test');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', channel: 'email' });
    expect(rows[0]!.providerRef).toBe(r.providerMessageId);
    expect(rows[0]!.sentAt).not.toBeNull();
    // Adres açık yazılmaz
    expect(rows[0]!.payload).toMatchObject({ purpose: 'ops_test', to: 'no***@yemekgelsin.net' });
    expect(JSON.stringify(rows[0]!.payload)).not.toContain('nobetci@');
  });

  it('canlı ortamda yapılandırılmamış kanal: "gönderildi" DENMEZ, loga hata yazılır, kayıt failed', async () => {
    const log = captureLog();
    const r = await sendEmail(
      { db: ctx.db, config: liveMockConfig(), log },
      { tenantId: t.tenantId, purpose: 'kvkk_request', to: 'basvuru@ornek.com', subject: 'Başvurunuz alındı', text: '30 gün içinde yanıtlanacak.' },
    );

    expect(r.status).not.toBe('sent');
    expect(r).toMatchObject({ status: 'skipped', reason: 'provider_not_deliverable' });
    expect(r.providerMessageId).toBeUndefined();
    expect(log.errors.join(' | ')).toContain('E-POSTA GÖNDERİLMEDİ');

    const rows = await emailRows(t.tenantId, 'email_kvkk_request');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed' });
    expect(rows[0]!.sentAt).toBeNull();
    expect(rows[0]!.error).toContain('yapılandırılmamış');
  });

  it('geçersiz alıcı / boş konu / boş gövde: atlanır ve hiçbir kayıt yazılmaz', async () => {
    const before = await emailRows(t.tenantId, 'email_invoice');
    expect(await sendEmail(deps(), { tenantId: t.tenantId, purpose: 'invoice', to: 'adres-degil', subject: 'Fatura', text: 'x' })).toMatchObject({
      status: 'skipped',
      reason: 'invalid_recipient',
    });
    expect(await sendEmail(deps(), { tenantId: t.tenantId, purpose: 'invoice', to: 'muhasebe@ornek.com', subject: '   ', text: 'x' })).toMatchObject({
      status: 'skipped',
      reason: 'empty_subject',
    });
    expect(await sendEmail(deps(), { tenantId: t.tenantId, purpose: 'invoice', to: 'muhasebe@ornek.com', subject: 'Fatura', text: '   ' })).toMatchObject({
      status: 'skipped',
      reason: 'empty_body',
    });
    expect(await emailRows(t.tenantId, 'email_invoice')).toHaveLength(before.length);
  });

  it('tenant\'a ait olmayan e-posta (lead bildirimi): gönderilir, notifications kaydı YAZILMAZ', async () => {
    // notifications.tenant_id NOT NULL'dur; ziyaretçi/platform e-postası uydurma bir tenant'a yazılmaz
    const r = await sendEmail(deps(), { purpose: 'lead_notice', to: 'satis@yemekgelsin.net', subject: 'Yeni demo talebi', text: 'Panelden bakın.' });
    expect(r.status).toBe('sent');
    const rows = await ctx.db.select().from(notifications).where(eq(notifications.kind, 'email_lead_notice'));
    expect(rows).toHaveLength(0);
  });
});
