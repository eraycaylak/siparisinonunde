// Dilim 4 ortak yardımcıları: doğrulama hatası, tarih biçimleri.

import type { ValidationIssue } from '@siparis/core/settings/validation';
import { AppError } from '../../lib/errors';

/** 400 validation_error; ilk sorunun mesajı üst mesaj olur (web fieldErrorsOf ile alanlara dağıtır). */
export function validationError(issues: ValidationIssue[] | string, path = ''): AppError {
  const list = typeof issues === 'string' ? [{ path, message: issues }] : issues;
  return new AppError(400, 'validation_error', list[0]?.message ?? 'Gönderilen bilgiler geçersiz.', { issues: list });
}

export function assertNoIssues(issues: ValidationIssue[]): void {
  if (issues.length) throw validationError(issues);
}

export const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** Postgres unique ihlali. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err, i = 0; e && typeof e === 'object' && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}
