// API test yardımcıları: gerçek siparis_test veritabanı + buildApp + inject.
// Kullanım:
//   let ctx: TestContext;
//   beforeAll(async () => { ctx = await createTestContext(); });
//   afterAll(async () => { await ctx.close(); });
// Her test dosyası şemayı sıfırlar (dosyalar sırayla çalışır; vitest.config.ts api projesi).

import type { TenantRole } from '@siparis/core';
import {
  branches,
  createDb,
  memberships,
  nextOrderNumber,
  openingHours,
  orderItems,
  orders,
  resetDatabase,
  subscriptions,
  tenants,
  users,
  type Database,
  type DbHandle,
  type Sql,
} from '@siparis/db';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { hashPassword } from '../src/lib/password';
import { createSession, SESSION_COOKIE, SESSION_TTL } from '../src/services/auth/sessions';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://siparis:siparis@localhost:5432/siparis_test';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    APP_BASE_URL: 'http://localhost:3000',
    SESSION_SECRET: 'test-session-secret-0123456789',
    TRACKING_SECRET: 'test-tracking-secret',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    DEV_TOOLS: '1',
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'siparis-uploads-')),
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export interface TestUser {
  id: string;
  email: string;
  phone: string | null;
  password: string;
  name: string;
}

export interface TestTenant {
  tenantId: string;
  branchId: string;
  slug: string;
  owner: TestUser;
  /** Sahibin oturum çerezi ("sid=…") */
  ownerCookie: string;
}

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  sql: Sql;
  handle: DbHandle;
  config: Config;
  close(): Promise<void>;
  /** Tüm tabloları boşaltır (şema kalır). */
  truncateAll(): Promise<void>;
  createUser(opts?: Partial<Omit<TestUser, 'id'>> & { isPlatformAdmin?: boolean; platformRole?: string | null }): Promise<TestUser>;
  addMember(tenantId: string, userId: string, role: TenantRole, branchId?: string | null): Promise<void>;
  /**
   * Tenant + şube (7/24 açık) + sahip + üyelik + deneme aboneliği; sahibin çerezi hazır. WhatsApp modu varsayılan
   * 'own' (mevcut testler işletmeye özel numarayla yazılmıştır); ortak numara testleri waMode 'shared' verir
   * (wa-helpers setupSharedTenant 'shared' satırını da açar).
   */
  createTenantWithOwner(opts?: { name?: string; slug?: string; waMode?: 'shared' | 'own'; waCode?: string | null }): Promise<TestTenant>;
  /** Tenant'a rol ile personel ekler ve çerezini döner. */
  createStaff(tenantId: string, role: TenantRole, opts?: { branchId?: string | null }): Promise<{ user: TestUser; cookie: string }>;
  /** Doğrudan oturum (scrypt olmadan hızlı): "sid=…" */
  sessionCookie(userId: string, opts?: { tenantId?: string | null; kind?: 'user' | 'courier' | 'impersonation'; readOnly?: boolean; ttlMs?: number }): Promise<string>;
  /** Gerçek /auth/login (hız sınırına takılmamak için her çağrı farklı IP). */
  loginAs(login: string, password: string): Promise<{ cookie: string; res: LightMyRequestResponse }>;
  /** inject kısayolu: çerez ve JSON gövde. */
  request(opts: { method: InjectOptions['method']; url: string; cookie?: string; body?: unknown; headers?: Record<string, string> }): Promise<LightMyRequestResponse>;
  /** Minimal sipariş satırı (1 kalem) — geçiş/yalıtım testleri için. */
  createOrder(opts: {
    tenantId: string;
    branchId: string;
    status?: (typeof orders.$inferInsert)['status'];
    totalKurus?: number;
    extra?: Partial<typeof orders.$inferInsert>;
  }): Promise<typeof orders.$inferSelect>;
}

let ipCounter = 1;
const nextIp = () => `10.0.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;

/** Oturum çerezini yanıttan çıkarır ("sid=…"). */
export function cookieFrom(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
  if (!c) throw new Error('Yanıtta oturum çerezi yok');
  return `${SESSION_COOKIE}=${c.value}`;
}

export async function createTestContext(opts: { config?: Config } = {}): Promise<TestContext> {
  await resetDatabase(TEST_DATABASE_URL);
  const config = opts.config ?? testConfig();
  const handle = createDb(TEST_DATABASE_URL, { max: 8, applicationName: 'siparis-test' });
  const app = await buildApp({ config, db: handle, logger: false });
  const db = handle.db;

  const ctx: TestContext = {
    app,
    db,
    sql: handle.sql,
    handle,
    config,

    async close() {
      await app.close();
      await handle.close();
    },

    async truncateAll() {
      const rows = await handle.sql<{ tablename: string }[]>`
        select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'`;
      if (rows.length) {
        await handle.sql.unsafe(`truncate ${rows.map((r) => `"${r.tablename}"`).join(', ')} restart identity cascade`);
      }
    },

    async createUser(o = {}) {
      const password = o.password ?? 'test1234';
      const email = (o.email ?? `u-${randomUUID().slice(0, 8)}@test.local`).toLowerCase();
      const [u] = await db
        .insert(users)
        .values({
          email,
          phone: o.phone ?? null,
          name: o.name ?? 'Test Kullanıcı',
          passwordHash: await hashPassword(password),
          isPlatformAdmin: o.isPlatformAdmin ?? false,
          platformRole: (o.platformRole as (typeof users.$inferInsert)['platformRole']) ?? null,
        })
        .returning();
      return { id: u!.id, email, phone: u!.phone, password, name: u!.name };
    },

    async addMember(tenantId, userId, role, branchId = null) {
      await db.insert(memberships).values({ tenantId, userId, role, branchId });
    },

    async createTenantWithOwner(o = {}) {
      const slug = o.slug ?? `test-${randomUUID().slice(0, 8)}`;
      const [t] = await db
        .insert(tenants)
        // Canlı işletme (web_live_at dolu): storefront sipariş alır
        .values({
          name: o.name ?? `Test İşletme ${slug}`,
          slug,
          lifecycleStage: 'trial',
          planCode: 'pro',
          webLiveAt: new Date(),
          waMode: o.waMode ?? 'own',
          waCode: o.waCode ?? null,
        })
        .returning();
      const [b] = await db.insert(branches).values({ tenantId: t!.id, name: 'Merkez', lat: 39.8181, lng: 34.8147 }).returning();
      await db
        .insert(openingHours)
        .values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ tenantId: t!.id, branchId: b!.id, weekday, opensAt: '00:00', closesAt: '00:00' })));
      await db.insert(subscriptions).values({ tenantId: t!.id, planCode: 'pro', status: 'trialing', trialEndsAt: new Date(Date.now() + 14 * 86400000) });
      const owner = await ctx.createUser({ name: 'Test Sahip' });
      await ctx.addMember(t!.id, owner.id, 'owner');
      const ownerCookie = await ctx.sessionCookie(owner.id, { tenantId: t!.id });
      return { tenantId: t!.id, branchId: b!.id, slug, owner, ownerCookie };
    },

    async createStaff(tenantId, role, o = {}) {
      const user = await ctx.createUser({ name: `Test ${role}` });
      await ctx.addMember(tenantId, user.id, role, o.branchId ?? null);
      const cookie = await ctx.sessionCookie(user.id, { tenantId, kind: role === 'courier' ? 'courier' : 'user' });
      return { user, cookie };
    },

    async sessionCookie(userId, o = {}) {
      const kind = o.kind ?? 'user';
      const { token } = await createSession(db, {
        userId,
        kind,
        tenantId: o.tenantId ?? null,
        ttlMs: o.ttlMs ?? (kind === 'courier' ? SESSION_TTL.courier : kind === 'impersonation' ? SESSION_TTL.impersonation : SESSION_TTL.user),
        readOnly: o.readOnly ?? kind === 'impersonation',
      });
      return `${SESSION_COOKIE}=${token}`;
    },

    async loginAs(login, password) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': nextIp() },
        payload: { login, password },
      });
      expect(res.statusCode, res.body).toBe(200);
      return { cookie: cookieFrom(res), res };
    },

    async request(r) {
      const headers: Record<string, string> = { ...(r.headers ?? {}) };
      if (r.cookie) headers.cookie = r.cookie;
      return app.inject({
        method: r.method,
        url: r.url,
        headers,
        ...(r.body !== undefined ? { payload: r.body as InjectOptions['payload'] } : {}),
      });
    },

    async createOrder(o) {
      return db.transaction(async (tx) => {
        const number = await nextOrderNumber(tx, o.tenantId);
        const total = o.totalKurus ?? 20000;
        const [order] = await tx
          .insert(orders)
          .values({
            tenantId: o.tenantId,
            branchId: o.branchId,
            number,
            status: o.status ?? 'new',
            channel: 'web',
            fulfillmentType: 'pickup',
            paymentMethod: 'pay_at_counter',
            subtotalKurus: total,
            totalKurus: total,
            customerName: 'Test Müşteri',
            customerPhone: '+905321234567',
            ...o.extra,
          })
          .returning();
        await tx.insert(orderItems).values({
          tenantId: o.tenantId,
          orderId: order!.id,
          name: 'Test Ürün',
          unitPriceKurus: total,
          quantity: 1,
          lineTotalKurus: total,
        });
        return order!;
      });
    },
  };
  return ctx;
}

/** Yalıtım beklentisi: başka tenant'ın kaydına erişim 404 (ya da rol yoksa 403). */
export function expectIsolated(res: LightMyRequestResponse): void {
  expect([403, 404], `beklenen 403/404, gelen ${res.statusCode}: ${res.body}`).toContain(res.statusCode);
}

/** 14 §6 hata biçimi. */
export function expectError(res: LightMyRequestResponse, status: number, code: string): void {
  expect(res.statusCode, res.body).toBe(status);
  const body = res.json() as { error?: { code?: string; message?: string } };
  expect(body.error?.code).toBe(code);
  expect(typeof body.error?.message).toBe('string');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
