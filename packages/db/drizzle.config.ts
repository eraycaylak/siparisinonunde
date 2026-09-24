import { defineConfig } from 'drizzle-kit';

// Yalnız SQL üretimi için (drizzle-kit generate). Uygulama: src/migrate.ts (migrations/*.sql ad sırasıyla).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  migrations: { prefix: 'index' },
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://siparis:siparis@localhost:5432/siparis_dev' },
});
