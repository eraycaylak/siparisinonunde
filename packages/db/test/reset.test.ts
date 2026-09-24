import { afterEach, describe, expect, it } from 'vitest';
import { assertResettable, isResettableDbName } from '../src/reset';

const url = (name: string) => `postgres://u:p@localhost:5432/${name}`;

describe('reset güvenliği', () => {
  const prevAllow = process.env.ALLOW_DB_RESET;
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (prevAllow === undefined) delete process.env.ALLOW_DB_RESET;
    else process.env.ALLOW_DB_RESET = prevAllow;
    process.env.NODE_ENV = prevEnv;
  });

  it('dev/test ve paralel kopya adlarını kabul eder', () => {
    for (const n of ['siparis_dev', 'siparis_test', 'siparis_test_s2', 'siparis_dev_s5', 'siparis_e2e_test']) {
      expect(isResettableDbName(n), n).toBe(true);
    }
  });

  it('diğer adları reddeder', () => {
    for (const n of ['siparis', 'siparis_prod', 'siparis_test_x', 'siparis_dev_s', 'test', 'siparis_testing']) {
      expect(isResettableDbName(n), n).toBe(false);
    }
  });

  it('ALLOW_DB_RESET olmadan yalnız kalıba uyanlar sıfırlanır; üretimde hiçbiri', () => {
    delete process.env.ALLOW_DB_RESET;
    process.env.NODE_ENV = 'test';
    expect(() => assertResettable(url('siparis_test_s3'))).not.toThrow();
    expect(() => assertResettable(url('siparis_e2e_test'))).not.toThrow();
    expect(() => assertResettable(url('siparis'))).toThrow(/sıfırlanamaz/);
    process.env.ALLOW_DB_RESET = '1';
    expect(() => assertResettable(url('siparis'))).not.toThrow();
    process.env.NODE_ENV = 'production';
    expect(() => assertResettable(url('siparis_test'))).toThrow(/Üretimde/);
  });
});
