// Platform yöneticisi oluşturur ya da mevcut kullanıcıyı platform yöneticisi yapar (00 §4 platform rolleri).
// Üretimde seed ÇALIŞTIRILMAZ; ilk admin bu betikle açılır. Parola loglara yazılmaz; verilmezse güçlü bir
// parola üretilir ve yalnız bir kez ekrana basılır.
//
// Kullanım (sunucuda, konteyner içinde):
//   docker compose run --rm api node --import tsx /app/scripts/create-admin.ts \
//     --email eray@siparisinonunde.com --name "Eray" [--role platform_owner] [--password ...] [--reset-password]
// Telefonu kaybeden yöneticinin iki adımlı doğrulamasını sıfırlama (tek başına kullanılır; tüm oturumları kapatır):
//   docker compose run --rm api node --import tsx /app/scripts/create-admin.ts --email eray@siparisinonunde.com --reset-totp
// Yerelde:
//   pnpm exec tsx --env-file=.env scripts/create-admin.ts --email admin@example.com --name "Admin"
// Parola ortam değişkeniyle de verilebilir (kabuk geçmişine düşmesin). `read` değişkeni dışa aktarmaz; export
// edilmezse `-e ADMIN_PASSWORD` konteynere boş gider ve betik rastgele parola üretir:
//   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD && docker compose run --rm -e ADMIN_PASSWORD api node --import tsx \
//     /app/scripts/create-admin.ts --email ... [--reset-password]; unset ADMIN_PASSWORD

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { PLATFORM_ROLES, type PlatformRole } from '../packages/core/src/enums';
import { createDb, hashPasswordForSeed } from '../packages/db/src/index';

const MIN_PASSWORD = 12;

function fail(msg: string): never {
  console.error(`Hata: ${msg}`);
  process.exit(1);
}

function usage(): never {
  console.log(
    [
      'Kullanım: create-admin --email <e-posta> --name <ad soyad> [--role <rol>] [--password <parola>] [--reset-password]',
      `Roller: ${PLATFORM_ROLES.join(', ')} (varsayılan platform_owner)`,
      'Parola verilmezse (ne --password ne ADMIN_PASSWORD) rastgele üretilir ve bir kez gösterilir.',
      'Kullanıcı zaten varsa platform yetkisi verilir; parolası yalnız --reset-password ile değişir.',
      '',
      'create-admin --email <e-posta> --reset-totp',
      '  Telefon kaybında: iki adımlı doğrulamayı (TOTP + kurtarma kodları) sıfırlar ve tüm oturumları kapatır.',
      '  Kişi ilk girişte /admin/guvenlik ekranından yeniden kurar. Kimliğini doğrulamadan çalıştırmayın.',
    ].join('\n'),
  );
  process.exit(0);
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      password: { type: 'string' },
      'reset-password': { type: 'boolean', default: false },
      'reset-totp': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) usage();

  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL tanımlı değil.');

  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Geçerli bir --email verin.');

  if (values['reset-totp']) {
    if (values.role || values.password || values['reset-password'] || values.name) {
      fail('--reset-totp tek başına kullanılır (--email ile); rol, ad ve parola değiştirmez.');
    }
    await resetTotp(url, email);
    return;
  }
  // Yeni kullanıcıda varsayılan platform_owner; mevcut kullanıcıda --role verilmezse rolü korunur
  const role = values.role as PlatformRole | undefined;
  if (role !== undefined && !(PLATFORM_ROLES as readonly string[]).includes(role)) fail(`Geçersiz rol: ${values.role}. Roller: ${PLATFORM_ROLES.join(', ')}`);

  let password = values.password ?? process.env.ADMIN_PASSWORD ?? '';
  let generated = false;
  if (!password) {
    password = randomBytes(18).toString('base64url');
    generated = true;
  }
  if (password.length < MIN_PASSWORD) fail(`Parola en az ${MIN_PASSWORD} karakter olmalı.`);

  const handle = createDb(url, { max: 1, applicationName: 'create-admin' });
  const sql = handle.sql;
  try {
    const existing = await sql<{ id: string; name: string; is_platform_admin: boolean }[]>`
      select id, name, is_platform_admin from users where email = ${email}`;
    if (existing.length) {
      const user = existing[0]!;
      const resetPassword = values['reset-password'];
      if (!resetPassword && (values.password || process.env.ADMIN_PASSWORD)) {
        fail('Kullanıcı zaten var; parolasını değiştirmek için --reset-password ekleyin.');
      }
      const hash = resetPassword ? await hashPasswordForSeed(password) : null;
      await sql.begin(async (tx) => {
        await tx`
          update users set
            is_platform_admin = true,
            platform_role = coalesce(${role ?? null}, platform_role, 'platform_owner'),
            name = coalesce(${values.name?.trim() || null}, name),
            password_hash = coalesce(${hash}, password_hash),
            disabled_at = null,
            updated_at = now()
          where id = ${user.id}`;
        await tx`
          insert into audit_log (actor_user_id, action, entity_type, entity_id, data)
          values (${user.id}, 'platform.admin_grant_cli', 'user', ${user.id}, ${JSON.stringify({ role: role ?? null, passwordReset: resetPassword })}::jsonb)`;
      });
      console.log(`Güncellendi: ${email}${role ? ` → ${role}` : ''} (platform yöneticisi)${resetPassword ? ', parola yenilendi' : ''}.`);
      if (resetPassword && generated) console.log(`Yeni parola (bir kez gösterilir): ${password}`);
      return;
    }

    const name = values.name?.trim();
    if (!name || name.length < 2) fail('Yeni kullanıcı için --name verin.');
    const hash = await hashPasswordForSeed(password);
    await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into users (email, name, password_hash, is_platform_admin, platform_role)
        values (${email}, ${name}, ${hash}, true, ${role ?? 'platform_owner'})
        returning id`;
      await tx`
        insert into audit_log (actor_user_id, action, entity_type, entity_id, data)
        values (${row!.id}, 'platform.admin_create_cli', 'user', ${row!.id}, ${JSON.stringify({ role: role ?? 'platform_owner' })}::jsonb)`;
    });
    console.log(`Oluşturuldu: ${email} (${role ?? 'platform_owner'}). Giriş: /admin/giris`);
    if (generated) console.log(`Parola (bir kez gösterilir, hemen bir parola yöneticisine kaydedin): ${password}`);
  } finally {
    await handle.close();
  }
}

/**
 * Operatör kurtarması (telefon kaybı): TOTP sırrı, bekleyen kurulum ve kurtarma kodları silinir, kullanıcının tüm
 * oturumları kapanır. Platform yöneticisi sonraki girişte /admin/guvenlik ekranına yönlenir ve yeniden kurar
 * (ADMIN_TOTP_REQUIRED açıkken kurmadan yönetim ekranları kapalıdır).
 */
async function resetTotp(url: string, email: string): Promise<void> {
  const handle = createDb(url, { max: 1, applicationName: 'create-admin' });
  const sql = handle.sql;
  try {
    const found = await sql<{ id: string; is_platform_admin: boolean; totp_enabled_at: Date | null }[]>`
      select id, is_platform_admin, totp_enabled_at from users where email = ${email}`;
    const user = found[0];
    if (!user) fail(`Kullanıcı bulunamadı: ${email}`);
    let revoked = 0;
    await sql.begin(async (tx) => {
      await tx`
        update users set
          totp_secret_enc = null,
          totp_pending_secret_enc = null,
          totp_enabled_at = null,
          totp_last_step = null,
          totp_recovery_hashes = '{}'::text[],
          updated_at = now()
        where id = ${user.id}`;
      const deleted = await tx`delete from sessions where user_id = ${user.id} returning id`;
      revoked = deleted.length;
      await tx`
        insert into audit_log (actor_user_id, action, entity_type, entity_id, data)
        values (${user.id}, 'platform.totp_reset_cli', 'user', ${user.id}, ${JSON.stringify({ wasEnabled: Boolean(user.totp_enabled_at), revokedSessions: revoked })}::jsonb)`;
    });
    console.log(
      `İki adımlı doğrulama sıfırlandı: ${email}${user.totp_enabled_at ? '' : ' (zaten kapalıydı)'}; ${revoked} oturum kapatıldı.` +
        (user.is_platform_admin ? ' Girişten sonra /admin/guvenlik ekranından yeniden kurun.' : ' Kullanıcı Ayarlar › Güvenlik ekranından yeniden kurabilir.'),
    );
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
