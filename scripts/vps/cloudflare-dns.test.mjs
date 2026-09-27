// scripts/vps/cloudflare-dns.mjs testleri: yerel sahte Cloudflare API sunucusuna (node:http) karşı gerçek HTTP ile.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CfPermissionError, check, createClient, cutover, fqdn, isIPv4, isPrivateIPv4, routeHost, status } from './cloudflare-dns.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'cloudflare-dns.mjs');
const ZONE = 'yemekgelsin.net';
const IP = '203.0.113.10';
const TOKEN = 'dogru-token-0123456789';

let state;
let server;
let apiBase;
let seq = 0;
const nid = (p) => `${p}${++seq}`;

function freshState() {
  return {
    zones: [{ id: 'z1', name: ZONE, status: 'active', account: { id: 'acc1' } }],
    records: [{ id: nid('r'), zone: 'z1', type: 'TXT', name: ZONE, content: '"v=spf1 -all"', proxied: false, ttl: 1 }],
    domains: [
      { id: nid('d'), hostname: ZONE, service: 'siparisinonunde-dev', zone_id: 'z1', zone_name: ZONE },
      { id: nid('d'), hostname: `www.${ZONE}`, service: 'siparisinonunde-dev', zone_id: 'z1', zone_name: ZONE },
      { id: nid('d'), hostname: `durum.${ZONE}`, service: 'baska-worker', zone_id: 'z1', zone_name: ZONE },
    ],
    routes: [
      { id: nid('w'), pattern: `${ZONE}/*`, script: 'siparisinonunde-dev' },
      { id: nid('w'), pattern: `blog.${ZONE}/*`, script: 'baska-worker' },
    ],
    ssl: 'full',
    perms: { zoneRead: true, dnsRead: true, dnsEdit: true, workers: true, routes: true, sslRead: true, sslEdit: true },
    fail500: 0,
    conflictOnce: false,
    // Bu adlarda A kaydı oluşturma kalıcı olarak başarısız (çakışma dışı hata)
    failA: new Set(),
    restoreFails: false,
    calls: [],
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
const ok = (res, result, info) => send(res, 200, { success: true, errors: [], messages: [], result, ...(info ? { result_info: info } : {}) });
const fail = (res, status, code, message) => send(res, status, { success: false, errors: [{ code, message }], messages: [], result: null });
const denied = (res) => fail(res, 403, 10000, 'Authentication error');

function page(res, items, url) {
  const per = Number(url.searchParams.get('per_page') ?? 20);
  const p = Number(url.searchParams.get('page') ?? 1);
  const total = Math.max(1, Math.ceil(items.length / per));
  ok(res, items.slice((p - 1) * per, p * per), { page: p, per_page: per, total_pages: total, count: items.length });
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/^\/client\/v4/, '');
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : null;
  state.calls.push(`${req.method} ${path}`);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(res, 401, 1000, 'Invalid API Token');
  if (state.fail500 > 0) {
    state.fail500--;
    return fail(res, 500, 0, 'geçici hata');
  }
  const P = state.perms;
  let m;
  if (req.method === 'GET' && path === '/zones') {
    if (!P.zoneRead) return ok(res, []);
    return ok(res, state.zones.filter((z) => z.name === url.searchParams.get('name')));
  }
  if ((m = /^\/zones\/(\w+)\/dns_records(?:\/(\w+))?$/.exec(path))) {
    const [, zid, rid] = m;
    if (req.method === 'GET') {
      if (!P.dnsRead) return denied(res);
      const name = url.searchParams.get('name');
      return page(res, state.records.filter((r) => r.zone === zid && (!name || r.name === name)), url);
    }
    if (!P.dnsEdit) return denied(res);
    if (req.method === 'POST') {
      const occupied = state.domains.some((d) => d.hostname === json.name);
      if (json.type === 'A' && (occupied || state.conflictOnce)) {
        state.conflictOnce = false;
        return fail(res, 400, 81053, 'An A, AAAA, or CNAME record with that host already exists.');
      }
      if (json.type === 'A' && state.failA.has(json.name)) return fail(res, 400, 9005, 'Content for A record is invalid.');
      const rec = { id: nid('r'), zone: zid, ...json };
      state.records.push(rec);
      return ok(res, rec);
    }
    const rec = state.records.find((r) => r.id === rid);
    if (!rec) return fail(res, 404, 81044, 'Record does not exist.');
    if (req.method === 'PATCH') {
      Object.assign(rec, json);
      return ok(res, rec);
    }
    if (req.method === 'DELETE') {
      state.records = state.records.filter((r) => r.id !== rid);
      return ok(res, { id: rid });
    }
  }
  if ((m = /^\/accounts\/(\w+)\/workers\/domains(?:\/(\w+))?$/.exec(path))) {
    if (!P.workers) return denied(res);
    const [, , did] = m;
    if (req.method === 'GET') return page(res, state.domains.filter((d) => d.zone_id === url.searchParams.get('zone_id')), url);
    if (req.method === 'DELETE') {
      state.domains = state.domains.filter((d) => d.id !== did);
      return ok(res, null);
    }
    // Attach to Domain: aynı adda A/AAAA/CNAME varsa reddedilir
    if (req.method === 'PUT' && !did) {
      if (state.restoreFails || state.records.some((r) => r.name === json.hostname && ['A', 'AAAA', 'CNAME'].includes(r.type))) {
        return fail(res, 409, 100117, 'Hostname already has externally managed DNS records');
      }
      const dom = { id: nid('d'), hostname: json.hostname, service: json.service, zone_id: json.zone_id, zone_name: ZONE, environment: json.environment };
      state.domains.push(dom);
      return ok(res, dom);
    }
  }
  if ((m = /^\/zones\/(\w+)\/workers\/routes(?:\/(\w+))?$/.exec(path))) {
    if (!P.routes) return denied(res);
    const [, , wid] = m;
    if (req.method === 'GET') return page(res, state.routes, url);
    if (req.method === 'DELETE') {
      state.routes = state.routes.filter((r) => r.id !== wid);
      return ok(res, { id: wid });
    }
  }
  if (path === '/zones/z1/settings/ssl') {
    if (req.method === 'GET') return P.sslRead ? ok(res, { id: 'ssl', value: state.ssl }) : denied(res);
    if (req.method === 'PATCH') {
      if (!P.sslEdit) return denied(res);
      state.ssl = json.value;
      return ok(res, { id: 'ssl', value: state.ssl });
    }
  }
  return fail(res, 404, 7003, `bilinmeyen yol ${req.method} ${path}`);
}

before(async () => {
  server = createServer((req, res) => {
    handler(req, res).catch((err) => fail(res, 500, 0, String(err)));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${server.address().port}/client/v4`;
});

after(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  state = freshState();
});

const client = (token = TOKEN) => createClient({ token, apiBase, retryDelayMs: 1 });
const aRecords = () => state.records.filter((r) => r.type === 'A').map((r) => ({ name: r.name, content: r.content, proxied: r.proxied, ttl: r.ttl })).sort((x, y) => x.name.localeCompare(y.name));
const expectedA = [ZONE, `*.${ZONE}`, `hooks.${ZONE}`, `www.${ZONE}`].sort().map((name) => ({ name, content: IP, proxied: true, ttl: 1 }));
const run = (extra = {}) => cutover({ cf: client(), zone: ZONE, ip: IP, conflictDelayMs: 1, ...extra });

test('geçiş: Worker alan adları kalkar, proxy\'li A kayıtları yazılır, başka Worker\'lar ve kayıtlar korunur', async () => {
  const r = await run();
  assert.deepEqual(aRecords(), expectedA);
  assert.deepEqual(state.domains.map((d) => d.hostname), [`durum.${ZONE}`]);
  assert.deepEqual(state.routes.map((x) => x.pattern), [`blog.${ZONE}/*`]);
  assert.ok(state.records.some((x) => x.type === 'TXT' && x.content === '"v=spf1 -all"'));
  // İzin deneme kaydı iz bırakmaz
  assert.ok(!state.records.some((x) => x.name.startsWith('_yemekgelsin-izin-denetimi')));
  assert.equal(state.ssl, 'full');
  assert.ok(r.changes.includes(`${ZONE}: Worker Custom Domain kaldırıldı (siparisinonunde-dev)`));
  assert.ok(r.changes.includes(`${ZONE}: A → VPS (proxy'li) oluşturuldu`));
  assert.ok(r.changes.some((c) => c.startsWith('Worker rotası silindi')));
  // Kök alan adında Custom Domain silinmeden A yazılmaz (kesinti: ad başına saniyeler)
  const iDel = state.calls.findIndex((c) => c.startsWith('DELETE /accounts/acc1/workers/domains/'));
  const iPost = state.calls.findIndex((c, i) => c === 'POST /zones/z1/dns_records' && i > state.calls.indexOf('GET /zones/z1/settings/ssl'));
  assert.ok(iDel !== -1 && iDel < iPost);
});

test('idempotent: ikinci çalıştırma hiçbir şeyi değiştirmez', async () => {
  await run();
  const before2 = JSON.stringify({ records: state.records, domains: state.domains, routes: state.routes });
  const r = await run();
  assert.deepEqual(r.changes, []);
  assert.equal(JSON.stringify({ records: state.records, domains: state.domains, routes: state.routes }), before2);
});

test('var olan kayıtlar düzeltilir: başka IP\'li A güncellenir, fazla A/AAAA/CNAME silinir, proxy açılır', async () => {
  state.domains = [];
  state.records.push(
    { id: nid('r'), zone: 'z1', type: 'A', name: ZONE, content: '198.51.100.7', proxied: false, ttl: 300 },
    { id: nid('r'), zone: 'z1', type: 'A', name: ZONE, content: '198.51.100.8', proxied: true, ttl: 1 },
    { id: nid('r'), zone: 'z1', type: 'AAAA', name: ZONE, content: '2001:db8::1', proxied: true, ttl: 1 },
    { id: nid('r'), zone: 'z1', type: 'CNAME', name: `www.${ZONE}`, content: 'eski.example.com', proxied: true, ttl: 1 },
  );
  const r = await run();
  assert.deepEqual(aRecords(), expectedA);
  assert.ok(!state.records.some((x) => x.type === 'AAAA' || x.type === 'CNAME'));
  assert.ok(r.changes.includes(`${ZONE}: A kaydı VPS'e güncellendi (proxy'li)`));
  assert.ok(r.changes.includes(`${ZONE}: fazla A kaydı silindi (198.51.100.8)`));
  assert.ok(r.changes.includes(`www.${ZONE}: CNAME kaydı silindi (eski.example.com)`));
});

test('DNS yazma izni yok: Zone > DNS > Edit denir ve HİÇBİR ŞEYE dokunulmaz (Worker alan adları yerinde)', async () => {
  state.perms.dnsEdit = false;
  await assert.rejects(run(), (err) => err instanceof CfPermissionError && /Zone > DNS > Edit/.test(err.message) && /Specific zone > yemekgelsin\.net/.test(err.message));
  assert.equal(state.domains.length, 3);
  assert.equal(state.routes.length, 2);
  assert.deepEqual(aRecords(), []);
});

test('bölge görünmüyor: Zone > Zone > Read; token geçersiz: anlaşılır ileti', async () => {
  state.perms.zoneRead = false;
  await assert.rejects(run(), /Zone > Zone > Read/);
  state.perms.zoneRead = true;
  await assert.rejects(cutover({ cf: client('yanlis-token'), zone: ZONE, ip: IP }), /CLOUDFLARE_API_TOKEN geçersiz/);
});

test('SSL/TLS "Flexible": düzeltilebiliyorsa Full (strict) yapılır; düzeltilemiyorsa DNS\'e dokunmadan durur', async () => {
  state.ssl = 'flexible';
  state.perms.sslEdit = false;
  await assert.rejects(run(), (err) => /Full \(strict\)/.test(err.message) && /Zone > Zone Settings > Edit/.test(err.message));
  assert.equal(state.domains.length, 3);
  assert.deepEqual(aRecords(), []);

  state.perms.sslEdit = true;
  const r = await run();
  assert.equal(state.ssl, 'strict');
  assert.ok(r.changes.includes('SSL/TLS modu "flexible" → "strict" (Full (strict))'));
  assert.deepEqual(aRecords(), expectedA);
});

test('SSL modu okunamıyorsa uyarı verilir, geçiş sürer', async () => {
  state.perms.sslRead = false;
  const r = await run();
  assert.match(r.warnings.join('\n'), /SSL\/TLS modu okunamadı/);
  assert.deepEqual(aRecords(), expectedA);
});

test('Worker alan adları listelenemiyor: kök henüz VPS\'te değilse durur (Workers Scripts > Edit); zaten VPS\'teyse sürer', async () => {
  state.perms.workers = false;
  await assert.rejects(run(), (err) => /Account > Workers Scripts > Edit/.test(err.message) && /DNS'e dokunulmadı/.test(err.message));
  assert.deepEqual(aRecords(), []);

  state.domains = [];
  state.records.push({ id: nid('r'), zone: 'z1', type: 'A', name: ZONE, content: IP, proxied: true, ttl: 1 });
  const r = await run();
  assert.match(r.warnings.join('\n'), /listelenemedi/);
  assert.deepEqual(aRecords(), expectedA);
});

test('rota izni yoksa uyarı; geçici 5xx yeniden denenir; A kaydı çakışması kısa bekleyip yeniden denenir', async () => {
  state.perms.routes = false;
  state.fail500 = 2;
  state.conflictOnce = true;
  const r = await run();
  assert.match(r.warnings.join('\n'), /Worker rotaları okunamadı/);
  assert.deepEqual(aRecords(), expectedA);
});

test('A kaydı yazılamazsa az önce kaldırılan Worker Custom Domain geri bağlanır; diğer adlar yine taşınır', async () => {
  state.failA.add(`www.${ZONE}`);
  await assert.rejects(run(), (err) => err instanceof CfPermissionError && /DNS geçişi tamamlanamadı/.test(err.message) && /www\.yemekgelsin\.net yeniden Worker'a bağlandı/.test(err.message));
  // www Worker'da kaldı (kayıtsız değil); kök, vitrinler ve hooks VPS'te
  const www = state.domains.find((d) => d.hostname === `www.${ZONE}`);
  assert.ok(www, 'www yeniden bağlanmalı');
  assert.equal(www.service, 'siparisinonunde-dev');
  assert.equal(www.zone_id, 'z1');
  assert.equal(www.environment, 'production');
  assert.ok(state.calls.includes('PUT /accounts/acc1/workers/domains'));
  assert.deepEqual(aRecords().map((r) => r.name), [ZONE, `*.${ZONE}`, `hooks.${ZONE}`].sort());

  // Sorun giderilince yeniden çalıştırma geçişi tamamlar
  state.failA.clear();
  await run();
  assert.deepEqual(aRecords(), expectedA);
  assert.deepEqual(state.domains.map((d) => d.hostname), [`durum.${ZONE}`]);
});

test('geri bağlama da başarısızsa ileti adın kayıtsız kalmış olabileceğini ve ne yapılacağını söyler', async () => {
  state.failA.add(ZONE);
  state.restoreFails = true;
  await assert.rejects(run(), (err) => /DİKKAT: yemekgelsin\.net Worker'a geri bağlanamadı/.test(err.message) && /only_dns/.test(err.message) && /Domains/.test(err.message));
  assert.ok(!state.domains.some((d) => d.hostname === ZONE));
});

test('Worker alan adı izin iletisi iki izni de söyler (Workers Scripts + Workers Routes)', async () => {
  state.perms.workers = false;
  await assert.rejects(run(), (err) => /"Account > Workers Scripts > Edit" ve "Zone > Workers Routes > Edit"/.test(err.message));
});

test('sayfalama: 100\'den fazla rota listelenir', async () => {
  state.routes = Array.from({ length: 130 }, (_, i) => ({ id: nid('w'), pattern: `s${i}.baska.example/*`, script: 'x' }));
  state.routes.push({ id: nid('w'), pattern: `www.${ZONE}/*`, script: 'siparisinonunde-dev' });
  const r = await run();
  assert.equal(state.routes.length, 130);
  assert.ok(r.changes.includes(`Worker rotası silindi: www.${ZONE}/* (siparisinonunde-dev)`));
});

test('check: salt okunur denetim + DNS yazma denemesi; geçiş yapılmış mı söyler; status Worker alan adlarını verir', async () => {
  const c1 = await check({ cf: client(), zone: ZONE, ip: IP });
  assert.equal(c1.cutoverDone, false);
  assert.deepEqual(c1.attached, [`${ZONE} (siparisinonunde-dev)`, `www.${ZONE} (siparisinonunde-dev)`]);
  assert.deepEqual(aRecords(), []);
  assert.equal(state.domains.length, 3);

  const s1 = await status({ cf: client(), zone: ZONE });
  assert.deepEqual(s1.workerDomains.map((d) => d.hostname), [ZONE, `www.${ZONE}`, `durum.${ZONE}`]);

  state.perms.dnsEdit = false;
  await assert.rejects(check({ cf: client(), zone: ZONE, ip: IP }), /Zone > DNS > Edit/);
  state.perms.dnsEdit = true;
  state.perms.workers = false;
  await assert.rejects(check({ cf: client(), zone: ZONE, ip: IP }), /Workers Scripts > Edit/);
  state.perms.workers = true;

  await run();
  const c2 = await check({ cf: client(), zone: ZONE, ip: IP });
  assert.equal(c2.cutoverDone, true);
  assert.deepEqual(c2.attached, []);
  const s2 = await status({ cf: client(), zone: ZONE });
  assert.deepEqual(s2.apexA, [IP]);
});

test('yardımcılar: IPv4, özel adres, ad ve rota', () => {
  assert.equal(isIPv4('203.0.113.10'), true);
  assert.equal(isIPv4('256.1.1.1'), false);
  assert.equal(isIPv4('01.2.3.4'), false);
  assert.equal(isPrivateIPv4('10.0.0.5'), true);
  assert.equal(isPrivateIPv4('192.168.1.1'), true);
  assert.equal(isPrivateIPv4('203.0.113.10'), false);
  assert.equal(fqdn('@', ZONE), ZONE);
  assert.equal(fqdn('*', ZONE), `*.${ZONE}`);
  assert.equal(fqdn(`www.${ZONE}`, ZONE), `www.${ZONE}`);
  assert.equal(routeHost('https://www.yemekgelsin.net/*'), 'www.yemekgelsin.net');
});

test('özel IP ve geçersiz IP reddedilir', async () => {
  await assert.rejects(run({ ip: '192.168.1.10' }), /özel\/ayrılmış/);
  await assert.rejects(run({ ip: 'vps.example.com' }), /IPv4/);
  assert.equal(state.calls.length, 0);
});

function cli(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

test('komut satırı: GitHub biçiminde ::error::, çıkış 1; token loga yazılmaz; başarıda değişiklikler listelenir', async () => {
  state.perms.dnsEdit = false;
  const env = { CLOUDFLARE_API_TOKEN: TOKEN, CF_API_BASE: apiBase, GITHUB_ACTIONS: 'true' };
  const bad = await cli(['cutover', '--zone', ZONE, '--ip', IP], env);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^::error::Token yemekgelsin\.net DNS kayıtlarını değiştiremiyor\..*Zone > DNS > Edit/m);
  assert.ok(!bad.out.includes(TOKEN));

  state.perms.dnsEdit = true;
  const good = await cli(['cutover', '--zone', ZONE, '--ip', IP], env);
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /değişti: yemekgelsin\.net: A → VPS/);
  assert.ok(!good.out.includes(TOKEN));

  const st = await cli(['status', '--zone', ZONE], env);
  assert.equal(st.code, 0, st.out);
  assert.deepEqual(JSON.parse(st.out.trim()), { workerDomains: [{ hostname: `durum.${ZONE}`, service: 'baska-worker' }], apexA: [IP] });

  const noToken = await cli(['check', '--zone', ZONE, '--ip', IP], { CF_API_BASE: apiBase });
  assert.equal(noToken.code, 1);
  assert.match(noToken.out, /Hata: CLOUDFLARE_API_TOKEN yok/);
});
