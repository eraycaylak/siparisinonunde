// scripts/vps/deploy.sh (günlük süzgeci) ve scripts/backup.sh (--pre-deploy) testleri: gerçek bash ile.
//   - Tanı çıktısı GitHub Actions'a (Türkiye dışı) gider: kişisel veri (IP, telefon, e-posta, istek ayrıntısı) çıkmamalı,
//     sorun gidermeye yarayan uyarı/hata iletileri kalmalı (CLAUDE.md kural 7).
//   - Güncelleme öncesi yedek yalnız veritabanıdır ve sayıya göre saklanır (sık dağıtım diski doldurmasın).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(HERE, 'deploy.sh');
const BACKUP = join(HERE, '..', 'backup.sh');
const tmp = mkdtempSync(join(tmpdir(), 'yemekgelsin-deploy-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const LOGS = [
  // Caddy erişim ve istek hata günlükleri: hiç yazılmamalı
  '{"level":"info","ts":1759000000.1,"logger":"http.log.access.log0","msg":"handled request","request":{"remote_ip":"85.105.1.2","client_ip":"85.105.1.2","uri":"/s/bozok-pide"}}',
  '{"level":"error","ts":1759000000.2,"logger":"http.log.error","msg":"dial tcp: connection refused","request":{"remote_ip":"85.105.1.3","uri":"/api/v1/store/x"}}',
  // Caddy sertifika hatası: kalmalı (alan adı kişisel veri değildir)
  '{"level":"error","ts":1759000000.3,"logger":"tls.obtain","msg":"could not get certificate from issuer","identifier":"yemekgelsin.net","error":"HTTP 403 urn:ietf:params:acme:error:unauthorized"}',
  '{"level":"info","ts":1759000000.4,"logger":"tls","msg":"certificate obtained successfully"}',
  // API (pino): bilgi düzeyi istek günlüğü atlanır; hata iletisi kalır ama istek alanları ve içindeki kişisel veri gitmez
  '{"level":30,"time":1759000000,"req":{"method":"GET","url":"/api/v1/health","remoteAddress":"85.105.1.4"},"msg":"incoming request"}',
  '{"level":50,"time":1759000000,"req":{"remoteAddress":"2a02:ff0:1::5","url":"/api/v1/store/bozok/orders"},"err":{"type":"Error","message":"duplicate key (phone)=(+905321234567) user ali@example.com"},"msg":"request errored"}',
  '{"level":40,"time":1759000000,"msg":"yavaş sorgu"}',
  // Düz metin (Node/Next/migrate): kalır, IP/telefon maskelenir
  'Error: connect ECONNREFUSED 172.18.0.3:5432 from 2001:db8:85a3:0:0:8a2e:370:7334',
  'Migration 0012 failed: telefon 0532 123 45 67',
  '  ▲ Next.js 16.0.0',
].join('\n');

const PII = ['85.105.1.', '172.18.0.3', '2a02:ff0:1::5', '2001:db8:85a3', '905321234567', '0532 123 45 67', 'ali@example.com', '/s/bozok-pide', '/api/v1/store', 'remoteAddress', 'remote_ip'];

function sanitize(input, env = process.env) {
  const r = spawnSync('bash', [DEPLOY, 'sanitize-logs'], { input, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('günlük süzgeci: kişisel veri yazılmaz, sorun gidermeye yarayan uyarı/hatalar kalır (jq ile)', () => {
  const out = sanitize(LOGS);
  for (const p of PII) assert.ok(!out.includes(p), `çıktıda "${p}" olmamalı:\n${out}`);
  assert.match(out, /^ERROR \| tls\.obtain \| could not get certificate from issuer \| HTTP 403 urn:ietf:params:acme:error:unauthorized$/m);
  assert.match(out, /^ERROR \| request errored \| duplicate key \(phone\)=\(<no>\) user <e-posta>$/m);
  assert.match(out, /^WARN \| yavaş sorgu$/m);
  assert.match(out, /^Error: connect ECONNREFUSED <ip>:5432 from <ip>$/m);
  assert.match(out, /^Migration 0012 failed: telefon <tel>$/m);
  assert.match(out, /Next\.js 16\.0\.0/);
  assert.ok(!/certificate obtained successfully|incoming request|handled request/.test(out), 'bilgi düzeyi satırlar atlanmalı');
});

test('günlük süzgeci: jq yoksa JSON satırları hiç yazılmaz, düz metin yine maskelenir', () => {
  const bin = join(tmp, 'bin-nojq');
  mkdirSync(bin, { recursive: true });
  for (const tool of ['bash', 'sed', 'grep']) {
    const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(found, join(bin, tool));
  }
  const out = sanitize(LOGS, { PATH: bin });
  for (const p of PII) assert.ok(!out.includes(p), `çıktıda "${p}" olmamalı:\n${out}`);
  assert.ok(!out.includes('{'), 'JSON satırı kalmamalı');
  assert.match(out, /ECONNREFUSED <ip>:5432/);
});

/** backup.sh'i geçici bir depo kopyasında sahte `docker compose` ile çalıştırır (gerçek .env ve Docker gerekmez). */
function backupSandbox() {
  const root = mkdtempSync(join(tmp, 'repo-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(BACKUP, join(root, 'scripts', 'backup.sh'));
  const stub = join(root, 'compose-stub.sh');
  // exec -T postgres pg_dump → sahte döküm; pg_restore --list → başarılı; ps → çalışan servis yok (görsel yedeği atlanır)
  writeFileSync(
    stub,
    '#!/usr/bin/env bash\nset -e\nargs="$*"\ncase "$args" in\n  *pg_dump*) printf "PGDMP-sahte" ;;\n  *pg_restore*) cat >/dev/null ;;\n  *"ps --status running"*) echo postgres ;;\n  *) ;;\nesac\n',
  );
  chmodSync(stub, 0o755);
  const backups = join(root, 'backups');
  return { root, stub, backups };
}

function runBackup(sb, args) {
  return spawnSync('bash', [join(sb.root, 'scripts', 'backup.sh'), ...args], {
    env: { PATH: process.env.PATH, COMPOSE: sb.stub, BACKUP_DIR: sb.backups, BACKUP_PING_URL: '', BACKUP_REMOTE: '' },
    encoding: 'utf8',
  });
}

test('backup.sh --pre-deploy: yalnız veritabanı, son 5 döküm kalır, günlük yedeklere dokunmaz', () => {
  const sb = backupSandbox();
  mkdirSync(sb.backups, { mode: 0o700 });
  const old = ['20260901T010000Z', '20260902T010000Z', '20260903T010000Z', '20260904T010000Z', '20260905T010000Z', '20260906T010000Z'];
  for (const st of old) writeFileSync(join(sb.backups, `pre-deploy-db-siparis-${st}.dump`), 'x');
  writeFileSync(join(sb.backups, 'db-siparis-20260101T031500Z.dump'), 'gunluk');
  writeFileSync(join(sb.backups, 'uploads-20260101T031500Z.tar.gz'), 'gorsel');

  const r = runBackup(sb, ['--pre-deploy']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = readdirSync(sb.backups).sort();
  const pre = files.filter((f) => f.startsWith('pre-deploy-db-'));
  assert.equal(pre.length, 5, files.join('\n'));
  // En eski ikisi silindi, yenisi eklendi
  assert.ok(!pre.includes('pre-deploy-db-siparis-20260901T010000Z.dump'));
  assert.ok(!pre.includes('pre-deploy-db-siparis-20260902T010000Z.dump'));
  assert.ok(pre.some((f) => !old.some((st) => f.includes(st))), 'yeni döküm yazılmalı');
  // Günlük yedekler ve görseller olduğu gibi; görsel arşivi alınmadı
  assert.ok(files.includes('db-siparis-20260101T031500Z.dump'));
  assert.deepEqual(files.filter((f) => f.startsWith('uploads-')), ['uploads-20260101T031500Z.tar.gz']);
  assert.match(r.stdout, /yalnız veritabanı; son 5 döküm saklanır/);
  assert.ok(!/İkinci konuma|BACKUP_REMOTE tanımlı değil/.test(r.stdout), 'pre-deploy ikinci konuma kopyalamaz');
});

test('backup.sh (günlük): db-*.dump yazar, pre-deploy dökümlerini silmez; bilinmeyen seçenek reddedilir', () => {
  const sb = backupSandbox();
  mkdirSync(sb.backups, { mode: 0o700 });
  writeFileSync(join(sb.backups, 'pre-deploy-db-siparis-20260906T010000Z.dump'), 'x');
  const r = runBackup(sb, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = readdirSync(sb.backups);
  assert.ok(files.some((f) => /^db-siparis-\d{8}T\d{6}Z\.dump$/.test(f)), files.join('\n'));
  assert.ok(files.includes('pre-deploy-db-siparis-20260906T010000Z.dump'));

  const bad = runBackup(sb, ['--bilinmeyen']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Bilinmeyen seçenek/);
});
