// Canlı ortam önyüklemesi (00 §12a madde 10; 15 §14): bayrakları üretim varsayılanlarıyla garanti eder. Demo verisi
// OLUŞTURMAZ (canlı ortamda seed çalışmaz). Her dağıtımda çalışır; idempotenttir:
//   - eksik bayrak eklenir: signup_open açık, wa_onboarding açık, campaigns_global kapalı, llm_parsing kapalı,
//     platform_wa_alerts açık, sms_fallback yalnız Netgsm tanımlıysa açık;
//   - var olan bayrağa dokunulmaz (platform yöneticisinin /admin/bayraklar kararı korunur); tek istisna hiç elle
//     değiştirilmemiş sms_fallback: SMS yapılandırmasını izler (packages/db/src/bootstrap.ts).
// Veritabanında demo işletme (is_demo) varsa uyarır; silmez.
//
// Kullanım (sunucuda; canlı ortam iş akışı scripts/vps/deploy.sh bunu kendisi çalıştırır):
//   docker compose exec -T api node --import tsx /app/scripts/bootstrap-production.ts
// Yerelde:
//   pnpm exec tsx --env-file=.env scripts/bootstrap-production.ts

import { countDemoTenants, createDb, ensureProductionFlags, isSmsConfigured } from '../packages/db/src/index';

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Hata: DATABASE_URL tanımlı değil.');
    return 1;
  }
  const smsConfigured = isSmsConfigured(process.env);
  const handle = createDb(url, { max: 1, applicationName: 'bootstrap-production' });
  try {
    const flags = await handle.db.transaction((tx) => ensureProductionFlags(tx, { smsConfigured, signupOpen: true }));
    console.log(`Bayraklar (SMS: ${smsConfigured ? 'Netgsm tanımlı' : 'Netgsm yok, SMS yedeği kapalı başlar'}):`);
    for (const f of flags) {
      const note = f.action === 'created' ? 'yeni' : f.action === 'updated' ? 'SMS yapılandırmasına göre güncellendi' : 'dokunulmadı';
      console.log(`  ${f.key.padEnd(18)} ${f.enabled ? 'açık' : 'kapalı'} (${note})`);
    }
    const demo = await countDemoTenants(handle.db);
    if (demo > 0) {
      console.warn(`UYARI: veritabanında ${demo} demo işletme (is_demo) var. Canlı ortamda demo verisi olmamalı (00 §12a madde 10); elle inceleyin.`);
    }
    return 0;
  } catch (err) {
    console.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exitCode = await main();
