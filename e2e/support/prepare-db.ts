// webServer ön adımı: e2e veritabanı yoksa oluştur ve migration'ları uygula.
// API ve worker süreçleri boş bir veritabanına karşı açılmasın diye sunuculardan ÖNCE çalışır.
// Asıl sıfırlama (reset + migrate + seed) globalSetup'tadır (e2e/global-setup.ts).
//   pnpm exec tsx e2e/support/prepare-db.ts

import { ensureDatabase, runDbScript } from './db';

await ensureDatabase();
runDbScript('migrate');
