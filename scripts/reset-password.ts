// İşletme kullanıcısının (sahip, yönetici, kasiyer, mutfak) parolasını operatör olarak sıfırlar. Panelde parola
// sıfırlama akışı yoktur: personelin parolasını işletme sahibi Ayarlar › Personel'den değiştirir; sahibin parolasını
// destek hattı, kimliğini BAŞKA bir kanaldan doğruladıktan sonra (kayıtlı telefondan geri arama) bu betikle sıfırlar.
// Yeni parola bir kez gösterilir, kullanıcının tüm oturumları kapanır, audit_log'a 'user.password_reset_cli' yazılır.
// Platform yöneticileri için create-admin.ts --reset-password kullanılır.
//
// Kullanım (sunucuda, konteyner içinde):
//   docker compose run --rm api node --import tsx /app/scripts/reset-password.ts --email sahip@ornek.com
//   docker compose run --rm api node --import tsx /app/scripts/reset-password.ts --phone "0532 123 45 67"
// Parolayı kendiniz vermek için (kabuk geçmişine düşmesin; export şart, yoksa konteynere boş gider):
//   read -rs NEW_PASSWORD && export NEW_PASSWORD && docker compose run --rm -e NEW_PASSWORD api node --import tsx \
//     /app/scripts/reset-password.ts --email ...; unset NEW_PASSWORD
// Yerelde:
//   pnpm exec tsx --env-file=.env scripts/reset-password.ts --email demo@siparisinonunde.local

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { normalizeTrMobile } from '../packages/core/src/phone';
import { createDb, hashPasswordForSeed } from '../packages/db/src/index';

const MIN_PASSWORD = 8;

function fail(msg: string): never {
  console.error(`Hata: ${msg}`);
  process.exit(1);
}

function usage(): never {
  console.log(
    [
      'reset-password (--email <e-posta> | --phone <cep telefonu>)',
      '',
      'İşletme kullanıcısının parolasını sıfırlar ve tüm oturumlarını kapatır.',
      'Parola NEW_PASSWORD ortam değişkeninden alınır; yoksa rastgele üretilir ve bir kez gösterilir.',
      'Kimliği başka bir kanaldan (kayıtlı telefondan geri arama) doğrulamadan çalıştırmayın.',
    ].join('\n'),
  );
  process.exit(0);
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      phone: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) usage();
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL tanımlı değil.');

  const email = values.email?.trim().toLowerCase() || null;
  const phone = values.phone ? normalizeTrMobile(values.phone) : null;
  if (values.phone && !phone) fail('Geçerli bir cep telefonu verin (ör. 0532 123 45 67).');
  if ((email ? 1 : 0) + (phone ? 1 : 0) !== 1) fail('Tam olarak birini verin: --email ya da --phone.');

  let password = process.env.NEW_PASSWORD ?? '';
  const generated = !password;
  if (generated) password = randomBytes(12).toString('base64url');
  if (password.length < MIN_PASSWORD) fail(`Parola en az ${MIN_PASSWORD} karakter olmalı.`);

  const handle = createDb(url, { max: 1, applicationName: 'reset-password' });
  const sql = handle.sql;
  try {
    const found = email
      ? await sql<{ id: string; email: string | null; is_platform_admin: boolean; disabled_at: Date | null }[]>`
          select id, email, is_platform_admin, disabled_at from users where email = ${email}`
      : await sql<{ id: string; email: string | null; is_platform_admin: boolean; disabled_at: Date | null }[]>`
          select id, email, is_platform_admin, disabled_at from users where phone = ${phone}`;
    const user = found[0];
    if (!user) fail(`Kullanıcı bulunamadı: ${email ?? values.phone}`);
    if (user.is_platform_admin) fail('Bu bir platform yöneticisi; create-admin.ts --reset-password kullanın.');
    if (user.disabled_at) fail('Hesap kapatılmış; önce işletme sahibi personeli yeniden etkinleştirmeli.');

    const memberships = await sql<{ tenant_id: string; role: string; name: string }[]>`
      select m.tenant_id, m.role, t.name
      from memberships m join tenants t on t.id = m.tenant_id
      where m.user_id = ${user.id} and m.disabled_at is null`;
    if (!memberships.length) fail('Kullanıcının etkin bir işletme üyeliği yok.');

    const hash = await hashPasswordForSeed(password);
    let revoked = 0;
    await sql.begin(async (tx) => {
      await tx`update users set password_hash = ${hash}, updated_at = now() where id = ${user.id}`;
      const deleted = await tx`delete from sessions where user_id = ${user.id} returning id`;
      revoked = deleted.length;
      for (const m of memberships) {
        await tx`
          insert into audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, data)
          values (${m.tenant_id}, null, 'user.password_reset_cli', 'user', ${user.id},
                  ${JSON.stringify({ role: m.role, revokedSessions: revoked, generated })}::jsonb)`;
      }
    });
    const where = memberships.map((m) => `${m.name} (${m.role})`).join(', ');
    console.log(`Parola sıfırlandı: ${user.email ?? values.phone} · ${where}; ${revoked} oturum kapatıldı.`);
    if (generated) console.log(`Yeni parola (bir kez gösterilir; kişiye telefonda söyleyin, bir parola yöneticisine kaydetsin): ${password}`);
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
