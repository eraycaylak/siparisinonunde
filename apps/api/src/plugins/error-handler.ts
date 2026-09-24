// Hata işleyici: 14 §6 biçimi. ZodError ve şema doğrulama hataları → 400 validation_error.

import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { OrderTransitionError } from '@siparis/core';
import { AppError } from '../lib/errors';

function body(code: string, message: string, details?: unknown) {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

const STATUS_CODES: Record<number, [string, string]> = {
  400: ['bad_request', 'Geçersiz istek.'],
  401: ['unauthorized', 'Oturum açmanız gerekiyor.'],
  403: ['forbidden', 'Bu işlem için yetkiniz yok.'],
  404: ['not_found', 'Kayıt bulunamadı.'],
  405: ['method_not_allowed', 'Bu metot desteklenmiyor.'],
  406: ['not_acceptable', 'İstek biçimi desteklenmiyor.'],
  409: ['conflict', 'Çakışma.'],
  413: ['payload_too_large', 'Gönderilen veri çok büyük.'],
  415: ['unsupported_media_type', 'İçerik türü desteklenmiyor.'],
  429: ['rate_limited', 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.'],
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, request, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode === 429) {
        const retry = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
        if (retry) reply.header('retry-after', String(retry));
      }
      return reply.status(err.statusCode).send(body(err.code, err.message, err.details));
    }
    if (err instanceof OrderTransitionError) {
      const status = err.code === 'invalid_transition' ? 409 : 400;
      return reply.status(status).send(body(err.code, err.message));
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send(
        body('validation_error', 'Gönderilen bilgiler geçersiz.', {
          issues: err.validation.map((v) => ({ path: v.instancePath, message: v.message, params: v.params })),
          context: err.validationContext,
        }),
      );
    }
    if (err instanceof ZodError) {
      return reply.status(400).send(
        body('validation_error', 'Gönderilen bilgiler geçersiz.', {
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
        }),
      );
    }
    if (isResponseSerializationError(err)) {
      request.log.error({ err, issues: err.cause.issues }, 'yanıt şeması uyuşmuyor');
      return reply.status(500).send(body('internal_error', 'Beklenmeyen bir hata oluştu.'));
    }
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      const [code, message] = STATUS_CODES[status] ?? ['bad_request', 'Geçersiz istek.'];
      return reply.status(status).send(body(code, message, { reason: err.message }));
    }
    request.log.error({ err }, 'beklenmeyen hata');
    return reply.status(500).send(body('internal_error', 'Beklenmeyen bir hata oluştu.'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(body('not_found', 'Adres bulunamadı.', { method: request.method, url: request.url.split('?')[0] }));
  });
}
