import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { listMigrationFiles } from '../src/migrate';
import * as schema from '../src/schema/index';

const tables = Object.values(schema as Record<string, unknown>).filter((v): v is PgTable => v instanceof PgTable);

// tenant_id taşımayan ya da nullable olan platform tabloları (07 §1.6 istisnaları)
const PLATFORM_TABLES = new Set([
  'tenants',
  'users',
  'sessions',
  'feature_flags',
  'audit_log',
  'leads',
  'legal_acceptances',
  'wa_webhook_events',
  'jobs',
  'sms_messages',
]);

describe('şema', () => {
  it('14 §4 tablolarının hepsi tanımlı', () => {
    const names = new Set(tables.map((t) => getTableConfig(t).name));
    for (const n of [
      'tenants', 'branches', 'users', 'sessions', 'memberships', 'courier_login_links', 'categories', 'products',
      'option_groups', 'options', 'product_option_groups', 'price_change_batches', 'opening_hours', 'special_days',
      'delivery_zones', 'customers', 'customer_addresses', 'orders', 'order_items', 'order_item_options', 'order_events',
      'order_acks', 'order_verification_codes', 'otp_verifications', 'storefront_link_tokens', 'reviews',
      'cancellation_requests', 'branch_events', 'wa_accounts', 'conversations', 'messages', 'wa_webhook_events',
      'sms_messages', 'notifications', 'jobs', 'audit_log', 'feature_flags', 'subscriptions', 'admin_notes', 'leads',
      'legal_acceptances',
    ]) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('kiracı tablolarında tenant_id NOT NULL', () => {
    for (const t of tables) {
      const cfg = getTableConfig(t);
      if (PLATFORM_TABLES.has(cfg.name)) continue;
      const col = cfg.columns.find((c) => c.name === 'tenant_id');
      expect(col, `${cfg.name}.tenant_id`).toBeDefined();
      expect(col!.notNull, `${cfg.name}.tenant_id not null`).toBe(true);
    }
  });

  it('tablo adları çoğul snake_case', () => {
    for (const t of tables) {
      const name = getTableConfig(t).name;
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('para kolonları integer *_kurus', () => {
    for (const t of tables) {
      for (const c of getTableConfig(t).columns) {
        if (c.name.endsWith('_kurus')) expect(c.getSQLType(), `${c.name}`).toBe('integer');
      }
    }
  });

  it('migration dosyaları numaralı ve temel aralıkta başlıyor', async () => {
    const files = await listMigrationFiles();
    expect(files[0]).toBe('0000_init.sql');
    expect(files).toContain('0001_branch_events_notify.sql');
    for (const f of files) expect(f).toMatch(/^\d{4}_[\w-]+\.sql$/);
  });
});
