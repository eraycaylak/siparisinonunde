import { defineConfig } from 'vitest/config';

// Kök Vitest yapılandırması. apps/web kendi test düzenini kurar (burada yok).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          root: './packages/db',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          // API testleri aynı siparis_test veritabanını paylaşır: dosyalar sırayla, tek süreçte.
          fileParallelism: false,
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
