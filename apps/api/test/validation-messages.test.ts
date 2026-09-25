// API doğrulama hataları (14 §6): 400 validation_error + Türkçe genel mesaj + alan yolları ve Türkçe alan mesajları.
// Şemadaki özel (Türkçe) mesajlar korunur; Zod'un İngilizce varsayılanları Türkçeleşir.

import { createOrderRequestSchema } from '@siparis/core';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VALIDATION_ERROR_MESSAGE, turkishIssueMessage, turkishIssues } from '../src/lib/validation-messages';
import { registerErrorHandler } from '../src/plugins/error-handler';

function issuesOf(schema: z.ZodType, value: unknown) {
  const r = schema.safeParse(value);
  if (r.success) throw new Error('beklenen hata yok');
  return turkishIssues(r.error.issues as never);
}

describe('turkishIssueMessage', () => {
  it('zorunlu, çok kısa, çok uzun, geçersiz biçim, seçim, sayı', () => {
    const s = z.object({
      name: z.string().min(2),
      code: z.string().min(1),
      note: z.string().max(5),
      email: z.email(),
      id: z.uuid(),
      kind: z.enum(['a', 'b']),
      qty: z.number().int().min(1).max(10),
      ok: z.literal(true),
      tags: z.array(z.string()).min(1),
      pattern: z.string().regex(/^\d{6}$/),
    });
    const m = Object.fromEntries(
      issuesOf(s, { code: '', note: '123456', email: 'x', id: 'y', kind: 'c', qty: 0, ok: false, tags: [], pattern: 'abc' }).map((i) => [i.field, i.message]),
    );
    expect(m).toMatchObject({
      name: 'Bu alan zorunlu.',
      code: 'Bu alan zorunlu.',
      note: 'Çok uzun: en fazla 5 karakter olabilir.',
      email: 'Geçerli bir e-posta adresi yazın.',
      id: 'Geçersiz kimlik.',
      kind: 'Geçersiz seçim.',
      qty: 'En az 1 olmalı.',
      ok: 'Bu onay gerekli.',
      tags: 'En az bir seçim yapın.',
      pattern: 'Geçersiz biçim.',
    });
    expect(issuesOf(z.object({ name: z.string().min(3) }), { name: 'ab' })[0]).toMatchObject({
      path: '/name',
      field: 'name',
      message: 'Çok kısa: en az 3 karakter olmalı.',
      code: 'too_small',
    });
    expect(issuesOf(z.object({ n: z.number() }), { n: 'x' })[0]!.message).toBe('Sayı olmalı.');
    expect(issuesOf(z.object({ n: z.number().max(3) }), { n: 9 })[0]!.message).toBe('En fazla 3 olabilir.');
    expect(issuesOf(z.object({ a: z.object({ b: z.string() }) }), { a: {} })[0]).toMatchObject({ path: '/a/b', field: 'a.b' });
    expect(issuesOf(z.object({}).strict(), { fazla: 1 })[0]!.message).toBe('Tanınmayan alan: fazla.');
  });

  it('şemadaki özel Türkçe mesaj korunur', () => {
    expect(turkishIssueMessage({ code: 'too_small', message: 'Adınızı yazın.', origin: 'string', minimum: 2 })).toBe('Adınızı yazın.');
    expect(issuesOf(z.object({ r: z.string().min(20, 'Gerekçe en az 20 karakter olmalı.') }), { r: 'kısa' })[0]!.message).toBe(
      'Gerekçe en az 20 karakter olmalı.',
    );
  });
});

describe('hata işleyici', () => {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  beforeAll(async () => {
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorHandler(app);
    app.post('/siparis', { schema: { body: createOrderRequestSchema } }, async () => ({ ok: true }));
    app.post('/elle', async () => {
      z.object({ phone: z.string().min(10) }).parse({ phone: '12' });
      return { ok: true };
    });
    app.get('/sorgu', { schema: { querystring: z.object({ date: z.iso.date() }) } }, async () => ({ ok: true }));
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('şema doğrulaması: 400 validation_error, Türkçe genel mesaj, alan yolları ve Türkçe alan mesajları', async () => {
    const res = await app.inject({ method: 'POST', url: '/siparis', payload: { customerName: 'A', items: [], acceptPreInfo: false } });
    expect(res.statusCode).toBe(400);
    const e = res.json().error;
    expect(e.code).toBe('validation_error');
    expect(e.message).toBe(VALIDATION_ERROR_MESSAGE);
    expect(e.message).toBe('Gönderilen bilgilerde hata var.');
    expect(e.details.context).toBe('body');
    const byField = e.details.fields as Record<string, string>;
    expect(byField.customerName).toBe('Çok kısa: en az 2 karakter olmalı.');
    // Telefon Akış A gel-al için şemada isteğe bağlı (zorunluluğu rota uygular)
    expect(byField.customerPhone).toBeUndefined();
    expect(byField.acceptPreInfo).toBe('Bu onay gerekli.');
    expect(byField.idempotencyKey).toBe('Bu alan zorunlu.');
    const key = e.details.issues.find((i: { field: string }) => i.field === 'idempotencyKey');
    expect(key).toMatchObject({ path: '/idempotencyKey', code: 'invalid_type' });
    // İngilizce Zod metni sızmaz
    expect(JSON.stringify(e)).not.toMatch(/Invalid input|Too small|Too big|expected/);
  });

  it('elle fırlatılan ZodError ve sorgu parametresi de aynı biçimde', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/elle', payload: {} });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().error).toMatchObject({
      code: 'validation_error',
      message: 'Gönderilen bilgilerde hata var.',
      details: { fields: { phone: 'Çok kısa: en az 10 karakter olmalı.' }, issues: [{ path: '/phone', field: 'phone' }] },
    });
    const r2 = await app.inject({ method: 'GET', url: '/sorgu?date=dun' });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().error.details).toMatchObject({ context: 'querystring', fields: { date: 'Geçerli bir tarih yazın.' } });
  });
});
