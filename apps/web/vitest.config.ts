import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// apps/web birim testleri (lib/*). Çalıştır: pnpm --filter @siparis/web test
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    name: 'web',
    include: ['lib/**/*.test.ts', 'components/**/*.test.ts'],
    environment: 'node',
  },
});
