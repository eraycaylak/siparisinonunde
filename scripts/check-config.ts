// Yapılandırma denetimi (15 §4, §14): API'nin açılışta uyguladığı kuralların aynısı (apps/api/src/config.ts loadConfig,
// üretimde productionConfigErrors). Canlı ortam iş akışı yeni imajı derledikten sonra, çalışan konteynerlere DOKUNMADAN
// önce çalıştırır; hata varsa dağıtım burada durur ve eski sürüm çalışmaya devam eder. Gizli değerler yazılmaz.
//   docker compose run --rm --no-deps -T api node --import tsx /app/scripts/check-config.ts

import { loadConfig, productionConfigWarnings, webPushConfigWarnings } from '../apps/api/src/config';

try {
  const config = loadConfig(process.env);
  console.log(
    `Yapılandırma geçerli (NODE_ENV=${config.NODE_ENV}, DEPLOY_ENV=${config.DEPLOY_ENV}, WhatsApp=${config.PLATFORM_WA_PROVIDER}, SMS=${config.SMS_PROVIDER}, ` +
      `2FA zorunlu=${config.ADMIN_TOTP_REQUIRED ? 'evet' : 'hayır'}, Web Push=${config.pushEnabled ? 'açık' : 'kapalı'}).`,
  );
  for (const w of [...productionConfigWarnings(config), ...webPushConfigWarnings(config)]) console.log(`Uyarı: ${w}`);
} catch (err) {
  console.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
