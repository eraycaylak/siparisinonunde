#!/usr/bin/env node
// Cloudflare DNS geçişi (00 §12a madde 10; 15 §14): yemekgelsin.net'i Cloudflare Worker'ından (dev ortamı, Custom
// Domain) Türkiye VPS'ine taşır. Canlı ortam iş akışı bunu YALNIZ VPS üzerindeki sağlık denetimi geçtikten sonra çalıştırır.
// Idempotenttir: ikinci çalıştırmada değişiklik yapmaz.
//
//   check   : token'ın bölgeyi görebildiğini ve DNS kayıtlarını okuyabildiğini denetler (sunucuya dokunmadan önce).
//   cutover : 1) DNS yazma iznini zararsız bir TXT kaydı açıp silerek dener (izin yoksa HİÇBİR ŞEYE dokunmadan durur:
//                Custom Domain silinip A kaydı yazılamazsa site kapanırdı),
//             2) SSL/TLS modu "Flexible"/"Off" ise "Full (strict)" yapar (aksi halde Caddy'nin HTTPS yönlendirmesiyle
//                sonsuz döngü olur; yapamazsa durur, DNS'e dokunmaz),
//             3) dev Worker'ına (siparisinonunde-dev) giden bölge rotalarını siler,
//             4) her ad için sırayla: Worker Custom Domain'i varsa siler (Workers Domains API) ve HEMEN ardından proxy'li
//                (turuncu bulut) A kaydını VPS IP'sine yazar (TTL otomatik); aynı adlardaki CNAME/AAAA ve fazla A
//                kayıtlarını siler. Adlar: yemekgelsin.net, www, * (vitrinler), hooks. A kaydı yazılamazsa az önce
//                kaldırılan Custom Domain geri bağlanır (PUT /accounts/{id}/workers/domains; ad kayıtsız kalıp site
//                kapanmasın). Bir ad başarısız olursa diğerleri yine yapılır, sonunda hata verilir.
//   status  : Worker'a bağlı alan adlarını ve kökün A kayıtlarını JSON yazar (dev iş akışının staging denetimi).
//
// Kullanım:
//   CLOUDFLARE_API_TOKEN=… node scripts/vps/cloudflare-dns.mjs cutover --zone yemekgelsin.net --ip 203.0.113.10
//   [--records @,www,*,hooks] [--worker-hosts yemekgelsin.net,www.yemekgelsin.net] [--worker-service siparisinonunde-dev]
// Ortam: CLOUDFLARE_API_TOKEN (zorunlu), CLOUDFLARE_ACCOUNT_ID (isteğe bağlı; yoksa bölgenin hesabı), CF_API_BASE (test).
// Gereken token izinleri (bölge: yemekgelsin.net): Zone > Zone > Read, Zone > DNS > Edit; Custom Domain listelemek/silmek
// (ve gerekirse geri bağlamak) için Account > Workers Scripts > Edit + Zone > Workers Routes > Edit (dev ortamının "Edit
// Cloudflare Workers" token'ında ve bölge izinlerinde vardır); SSL modunu düzeltmek gerekirse Zone > Zone Settings > Edit.
// Token değeri hiçbir zaman yazılmaz.

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_API_BASE = 'https://api.cloudflare.com/client/v4';
export const DEFAULT_RECORDS = ['@', 'www', '*', 'hooks'];
export const DEFAULT_WORKER_SERVICE = 'siparisinonunde-dev';
export const RECORD_COMMENT = 'Yemek Gelsin canlı ortam (Türkiye VPS; deploy-production)';

export class CfError extends Error {
  constructor(message, { status = 0, code = 0, path = '' } = {}) {
    super(message);
    this.name = 'CfError';
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

/** Token'da eksik izin: ileti, eklenecek izni adıyla söyler. */
export class CfPermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CfPermissionError';
  }
}

const INVALID_TOKEN_CODES = new Set([1000, 6003, 6111, 9106]);

/** HTTP 403 ya da Cloudflare "Authentication error" (10000): izin eksik. */
export function isPermissionError(err) {
  return err instanceof CfError && (err.status === 403 || err.code === 10000 || err.code === 9109);
}

/** Geçersiz ya da süresi dolmuş token. */
export function isInvalidToken(err) {
  return err instanceof CfError && (err.status === 401 || INVALID_TOKEN_CODES.has(err.code)) && err.code !== 10000 && err.code !== 9109;
}

/** Aynı adda kayıt var (Custom Domain kaydı henüz kalkmadı): kısa bekleyip yeniden denenir. */
export function isRecordConflict(err) {
  return err instanceof CfError && ([81053, 81057, 81058].includes(err.code) || /already exists/i.test(err.message));
}

/** Worker Custom Domain işlemleri (listele, sil, geri bağla) için gereken izinler. */
export const WORKER_DOMAIN_PERMISSIONS = ['Account > Workers Scripts > Edit', 'Zone > Workers Routes > Edit'];

export function permissionHint(zone, permission) {
  const list = (Array.isArray(permission) ? permission : [permission]).map((p) => `"${p}"`).join(' ve ');
  return (
    `Cloudflare > My Profile > API Tokens > token'ı düzenleyin (Edit) ve Permissions'a ${list} ekleyin ` +
    `(Zone Resources: Include > Specific zone > ${zone}). Sonra iş akışını yeniden çalıştırın (15 §14).`
  );
}

/** Basit Cloudflare API istemcisi: başarısız yanıtta CfError; 429/5xx yeniden denenir; listeler sayfalanır. */
export function createClient({ token, apiBase = DEFAULT_API_BASE, fetchImpl = globalThis.fetch, retryDelayMs = 1500, retries = 3 }) {
  if (!token) throw new CfPermissionError("CLOUDFLARE_API_TOKEN yok (GitHub > Settings > Secrets and variables > Actions).");
  const base = apiBase.replace(/\/+$/, '');

  async function request(method, path, { query, body } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    let attempt = 0;
    for (;;) {
      attempt++;
      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (attempt <= retries) {
          await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
          continue;
        }
        throw new CfError(`Cloudflare API'ye ulaşılamadı (${method} ${path}): ${err instanceof Error ? err.message : err}`, { path });
      }
      if ((res.status === 429 || res.status >= 500) && attempt <= retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
        continue;
      }
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok || !json || json.success === false) {
        const first = json?.errors?.[0] ?? {};
        throw new CfError(`Cloudflare API hatası (${method} ${path}): HTTP ${res.status}${first.code ? `, kod ${first.code}` : ''}${first.message ? `: ${first.message}` : ''}`, {
          status: res.status,
          code: Number(first.code) || 0,
          path,
        });
      }
      return json;
    }
  }

  return {
    get: async (path, query) => (await request('GET', path, { query })).result,
    post: async (path, body) => (await request('POST', path, { body })).result,
    patch: async (path, body) => (await request('PATCH', path, { body })).result,
    put: async (path, body) => (await request('PUT', path, { body })).result,
    del: async (path) => (await request('DELETE', path)).result,
    /** Sayfalı liste (per_page 100). */
    async list(path, query = {}) {
      const out = [];
      for (let page = 1; page <= 50; page++) {
        const json = await request('GET', path, { query: { ...query, page, per_page: 100 } });
        const items = Array.isArray(json.result) ? json.result : [];
        out.push(...items);
        const total = json.result_info?.total_pages ?? 1;
        if (page >= total || items.length === 0) break;
      }
      return out;
    },
  };
}

// --- Yardımcılar ----------------------------------------------------------------------------------------

export function isIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip ?? ''));
  return Boolean(m && m.slice(1).every((p) => Number(p) <= 255 && String(Number(p)) === p));
}

/** Özel/ayrılmış adres mi (A kaydı olarak yayınlanmamalı). */
export function isPrivateIPv4(ip) {
  const [a, b] = String(ip).split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** '@' → bölge, 'www' → www.bölge, tam ad olduğu gibi. */
export function fqdn(name, zone) {
  const n = String(name).trim().toLowerCase().replace(/\.$/, '');
  if (n === '@' || n === zone) return zone;
  return n.endsWith(`.${zone}`) ? n : `${n}.${zone}`;
}

/** Rota deseninin ana makinesi: "www.yemekgelsin.net/*" → "www.yemekgelsin.net". */
export function routeHost(pattern) {
  return String(pattern).replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
}

function hostMatches(host, names) {
  return names.some((n) => n === host || (n.startsWith('*.') && host.endsWith(n.slice(1))) || (host.startsWith('*.') && n.endsWith(host.slice(1))));
}

// --- İşlemler -------------------------------------------------------------------------------------------

/** Bölge (Zone > Zone > Read). */
export async function findZone(cf, zone) {
  let zones;
  try {
    zones = await cf.get('/zones', { name: zone });
  } catch (err) {
    if (isInvalidToken(err)) throw new CfPermissionError(`CLOUDFLARE_API_TOKEN geçersiz ya da süresi dolmuş (${err.message}). Yeni token oluşturup GitHub secret'ını güncelleyin (15 §14).`);
    if (isPermissionError(err)) throw new CfPermissionError(`Token ${zone} bölgesini göremiyor. ${permissionHint(zone, 'Zone > Zone > Read')}`);
    throw err;
  }
  const z = Array.isArray(zones) ? zones.find((x) => x.name === zone) : null;
  if (!z) {
    throw new CfPermissionError(`Token ${zone} bölgesini göremiyor (bölge bu hesapta değil ya da izin eksik). ${permissionHint(zone, 'Zone > Zone > Read')}`);
  }
  return { id: z.id, name: z.name, status: z.status, accountId: z.account?.id ?? null };
}

async function listRecords(cf, z, name) {
  try {
    return await cf.list(`/zones/${z.id}/dns_records`, { name });
  } catch (err) {
    if (isPermissionError(err)) throw new CfPermissionError(`Token ${z.name} DNS kayıtlarını okuyamıyor. ${permissionHint(z.name, 'Zone > DNS > Edit')}`);
    throw err;
  }
}

/** Worker Custom Domain'leri (Account > Workers Scripts). İzin yoksa null. */
async function listWorkerDomains(cf, accountId, z) {
  try {
    const all = await cf.list(`/accounts/${accountId}/workers/domains`, { zone_id: z.id });
    return all.filter((d) => !d.zone_id || d.zone_id === z.id);
  } catch (err) {
    if (isPermissionError(err)) return null;
    throw err;
  }
}

function apexPointsTo(records, ip) {
  const a = records.filter((r) => r.type === 'A');
  return a.length > 0 && a.every((r) => r.content === ip);
}

/**
 * Durum: Worker'a bağlı alan adları (izin yoksa null) ve kökün A kayıtları.
 * @returns {Promise<{zone: object, workerDomains: {hostname: string, service: string}[] | null, apexA: string[]}>}
 */
export async function status({ cf, zone, accountId }) {
  const z = await findZone(cf, zone);
  const account = accountId || z.accountId;
  const domains = account ? await listWorkerDomains(cf, account, z) : null;
  const apex = await listRecords(cf, z, zone);
  return {
    zone: z,
    workerDomains: domains === null ? null : domains.map((d) => ({ hostname: d.hostname, service: d.service })),
    apexA: apex.filter((r) => r.type === 'A').map((r) => r.content),
  };
}

/**
 * Sunucuya dokunmadan önceki denetim: bölge (Zone Read), DNS yazma (zararsız TXT aç/sil; Caddy DNS-01 ve geçiş için),
 * Worker alan adlarını listeleme (geçiş henüz yapılmadıysa).
 */
export async function check({ cf, zone, ip, accountId, workerHosts, log = () => {} }) {
  const warnings = [];
  const z = await findZone(cf, zone);
  if (z.status !== 'active') warnings.push(`${zone} bölgesinin durumu "${z.status}" (active değil); DNS ve sertifika gecikebilir.`);
  const apex = await listRecords(cf, z, zone);
  await probeDnsEdit(cf, z);
  const cutoverDone = apexPointsTo(apex, ip);
  const account = accountId || z.accountId;
  const hosts = (workerHosts ?? [zone, `www.${zone}`]).map((h) => fqdn(h, zone));
  const domains = account ? await listWorkerDomains(cf, account, z) : null;
  let attached = [];
  if (domains === null) {
    const msg = `Token Worker Custom Domain'lerini listeleyemiyor. ${permissionHint(zone, WORKER_DOMAIN_PERMISSIONS)}`;
    if (!cutoverDone) throw new CfPermissionError(`${msg} (DNS geçişinde ${hosts.join(', ')} Worker'dan ayrılmalı.)`);
    warnings.push(`${msg} Geçiş zaten yapılmış görünüyor; devam ediliyor.`);
  } else {
    attached = domains.filter((d) => hosts.includes(String(d.hostname).toLowerCase())).map((d) => `${d.hostname} (${d.service})`);
  }
  log(`Cloudflare: ${zone} bölgesi görünüyor (${z.status}); DNS yazılabiliyor; ${cutoverDone ? 'kök alan adı zaten VPS\'i gösteriyor' : 'kök alan adı henüz VPS\'i göstermiyor'}${attached.length ? `; Worker'a bağlı: ${attached.join(', ')}` : ''}.`);
  return { zone: z, cutoverDone, attached, warnings };
}

async function ensureStrictSsl(cf, z, changes, warnings) {
  let current;
  try {
    current = (await cf.get(`/zones/${z.id}/settings/ssl`))?.value;
  } catch (err) {
    if (isPermissionError(err)) {
      warnings.push(`SSL/TLS modu okunamadı (izin yok). Cloudflare > ${z.name} > SSL/TLS > Overview'da modun "Full (strict)" olduğundan emin olun ("Flexible" sonsuz yönlendirme döngüsü yapar).`);
      return;
    }
    throw err;
  }
  if (current !== 'off' && current !== 'flexible') return;
  try {
    await cf.patch(`/zones/${z.id}/settings/ssl`, { value: 'strict' });
    changes.push(`SSL/TLS modu "${current}" → "strict" (Full (strict))`);
  } catch (err) {
    if (isPermissionError(err)) {
      throw new CfPermissionError(
        `${z.name} SSL/TLS modu "${current}": proxy'li kayıtlarla sitede sonsuz yönlendirme döngüsü olur. DNS'e dokunulmadı. ` +
          `Cloudflare > ${z.name} > SSL/TLS > Overview'da modu "Full (strict)" yapın ya da ${permissionHint(z.name, 'Zone > Zone Settings > Edit')}`,
      );
    }
    throw err;
  }
}

async function upsertA(cf, z, name, ip, changes, { conflictRetries = 10, conflictDelayMs = 3000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const records = await listRecords(cf, z, name);
    for (const r of records.filter((x) => x.type === 'CNAME' || x.type === 'AAAA')) {
      await dnsWrite(z, () => cf.del(`/zones/${z.id}/dns_records/${r.id}`));
      changes.push(`${name}: ${r.type} kaydı silindi (${r.content})`);
    }
    const a = records.filter((x) => x.type === 'A');
    if (a.length === 0) {
      try {
        await dnsWrite(z, () => cf.post(`/zones/${z.id}/dns_records`, { type: 'A', name, content: ip, proxied: true, ttl: 1, comment: RECORD_COMMENT }));
      } catch (err) {
        // Custom Domain'in kaydı henüz kalkmadı: bekle, yeniden listele
        if (isRecordConflict(err) && attempt < conflictRetries) {
          await new Promise((r) => setTimeout(r, conflictDelayMs));
          continue;
        }
        throw err;
      }
      changes.push(`${name}: A → VPS (proxy'li) oluşturuldu`);
      return;
    }
    const [keep, ...extra] = a;
    if (keep.content !== ip || keep.proxied !== true || keep.ttl !== 1) {
      await dnsWrite(z, () => cf.patch(`/zones/${z.id}/dns_records/${keep.id}`, { content: ip, proxied: true, ttl: 1, comment: RECORD_COMMENT }));
      changes.push(`${name}: A kaydı VPS'e güncellendi (proxy'li)`);
    }
    for (const r of extra) {
      await dnsWrite(z, () => cf.del(`/zones/${z.id}/dns_records/${r.id}`));
      changes.push(`${name}: fazla A kaydı silindi (${r.content})`);
    }
    return;
  }
}

/**
 * A kaydı yazılamayan ad için az önce kaldırılan Worker Custom Domain'lerini geri bağlar (Workers Domains API "attach":
 * PUT /accounts/{id}/workers/domains). Dönüş: operatöre yazılacak açıklama.
 */
async function restoreWorkerDomains(cf, account, z, removed, changes) {
  const notes = [];
  for (const d of removed) {
    try {
      await cf.put(`/accounts/${account}/workers/domains`, {
        hostname: d.hostname,
        service: d.service,
        zone_id: z.id,
        environment: d.environment || 'production',
      });
      changes.push(`${d.hostname}: Worker Custom Domain geri bağlandı (${d.service}; A kaydı yazılamadı)`);
      notes.push(`${d.hostname} yeniden Worker'a bağlandı; site Cloudflare ortamında açık kaldı.`);
    } catch (err) {
      notes.push(
        `DİKKAT: ${d.hostname} Worker'a geri bağlanamadı (${err instanceof Error ? err.message : err}); bu ad şu an DNS kaydı olmadan ` +
          `kalmış olabilir (site kapalı). Hemen: Cloudflare > Workers & Pages > ${d.service} > Domains'ten ${d.hostname}'i ekleyin ` +
          `ya da sorunu giderip iş akışını "only_dns" ile yeniden çalıştırın (15 §14).`,
      );
    }
  }
  return notes.join(' ');
}

async function dnsWrite(z, fn) {
  try {
    return await fn();
  } catch (err) {
    if (isPermissionError(err)) throw new CfPermissionError(`Token ${z.name} DNS kayıtlarını değiştiremiyor. ${permissionHint(z.name, 'Zone > DNS > Edit')}`);
    throw err;
  }
}

export const PROBE_NAME = '_yemekgelsin-izin-denetimi';

/** DNS yazma izni: zararsız bir TXT kaydı açılıp hemen silinir (Cloudflare'de "kuru çalıştırma" yok). */
export async function probeDnsEdit(cf, z) {
  const name = `${PROBE_NAME}.${z.name}`;
  // Önceki yarım denemeden kalan kayıt varsa temizlenir
  for (const r of await listRecords(cf, z, name)) await dnsWrite(z, () => cf.del(`/zones/${z.id}/dns_records/${r.id}`));
  const created = await dnsWrite(z, () =>
    cf.post(`/zones/${z.id}/dns_records`, { type: 'TXT', name, content: '"yemekgelsin deploy izin denetimi"', ttl: 60, comment: RECORD_COMMENT }),
  );
  if (created?.id) await dnsWrite(z, () => cf.del(`/zones/${z.id}/dns_records/${created.id}`));
}

/**
 * DNS geçişi (açıklama dosyanın başında). Sıra: DNS yazma izni → SSL → rotalar → ad ad (Custom Domain sil + A yaz).
 * @returns {Promise<{zone: object, changes: string[], warnings: string[]}>}
 */
export async function cutover({
  cf,
  zone,
  ip,
  accountId,
  records = DEFAULT_RECORDS,
  workerHosts,
  workerService = DEFAULT_WORKER_SERVICE,
  log = () => {},
  conflictDelayMs = 3000,
}) {
  if (!isIPv4(ip)) throw new CfPermissionError(`VPS IP'si geçerli bir IPv4 adresi değil: "${ip}".`);
  if (isPrivateIPv4(ip)) throw new CfPermissionError(`VPS IP'si özel/ayrılmış bir adres (${ip}); herkese açık IPv4 gerekir.`);
  const changes = [];
  const warnings = [];
  const z = await findZone(cf, zone);
  const names = records.map((r) => fqdn(r, zone));
  const hosts = (workerHosts ?? [zone, `www.${zone}`]).map((h) => fqdn(h, zone));

  // 1) DNS yazma izni (yoksa hiçbir şeye dokunulmaz)
  await probeDnsEdit(cf, z);

  // 2) SSL/TLS modu (Flexible ise proxy'li kayıtlarla döngü olur)
  await ensureStrictSsl(cf, z, changes, warnings);

  // Worker Custom Domain'leri (dev ortamı): listelenemiyorsa ve kök henüz VPS'i göstermiyorsa dur
  const account = accountId || z.accountId;
  const domains = account ? await listWorkerDomains(cf, account, z) : null;
  if (domains === null) {
    const apex = await listRecords(cf, z, zone);
    if (!apexPointsTo(apex, ip)) {
      throw new CfPermissionError(
        `Token Worker Custom Domain'lerini listeleyemiyor; ${hosts.join(', ')} Worker'dan ayrılamadı. DNS'e dokunulmadı. ${permissionHint(zone, WORKER_DOMAIN_PERMISSIONS)}`,
      );
    }
    warnings.push("Worker Custom Domain'leri listelenemedi (izin yok); kök alan adı zaten VPS'i gösterdiği için atlandı.");
  }

  // 3) Dev Worker'ına giden bölge rotaları (proxy'li trafikte Worker araya girmesin)
  try {
    const routes = await cf.list(`/zones/${z.id}/workers/routes`);
    for (const r of routes.filter((x) => x.script === workerService && hostMatches(routeHost(x.pattern), names))) {
      await cf.del(`/zones/${z.id}/workers/routes/${r.id}`);
      changes.push(`Worker rotası silindi: ${r.pattern} (${r.script})`);
    }
  } catch (err) {
    if (!isPermissionError(err)) throw err;
    warnings.push(`Worker rotaları okunamadı (Zone > Workers Routes izni yok). Cloudflare > ${zone} > Workers Routes'ta ${workerService}'e giden rota kalmadığını denetleyin.`);
  }

  // 4) Ad ad: Custom Domain'i kaldır, hemen A kaydını yaz (kesinti saniyelerle sınırlı). A yazılamazsa kaldırılan
  //    Custom Domain geri bağlanır: ad kayıtsız kalmaz, site Cloudflare ortamında açık kalır.
  const failures = [];
  for (const name of names) {
    const removed = [];
    try {
      const attached = (domains ?? []).filter((d) => String(d.hostname).toLowerCase() === name && hosts.includes(name));
      for (const d of attached) {
        try {
          await cf.del(`/accounts/${account}/workers/domains/${d.id}`);
        } catch (err) {
          if (isPermissionError(err)) {
            throw new CfPermissionError(`Worker Custom Domain silinemedi (${d.hostname}); bu ad Worker'da kaldı. ${permissionHint(zone, WORKER_DOMAIN_PERMISSIONS)}`);
          }
          throw err;
        }
        removed.push(d);
        changes.push(`${d.hostname}: Worker Custom Domain kaldırıldı (${d.service})`);
      }
      await upsertA(cf, z, name, ip, changes, { conflictDelayMs });
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      if (removed.length) msg += ` ${await restoreWorkerDomains(cf, account, z, removed, changes)}`;
      failures.push(msg);
    }
  }

  for (const c of changes) log(`değişti: ${c}`);
  if (changes.length === 0) log('Cloudflare DNS zaten güncel (değişiklik yok).');
  if (failures.length) throw new CfPermissionError(`DNS geçişi tamamlanamadı: ${failures.join(' | ')}`);
  return { zone: z, changes, warnings };
}

// --- Komut satırı -----------------------------------------------------------------------------------------

const list = (v, fallback) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : fallback);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      zone: { type: 'string' },
      ip: { type: 'string' },
      records: { type: 'string' },
      'worker-hosts': { type: 'string' },
      'worker-service': { type: 'string' },
    },
    strict: true,
  });
  const gh = process.env.GITHUB_ACTIONS === 'true';
  const say = (m) => console.log(m);
  const warn = (m) => console.log(gh ? `::warning::${m}` : `Uyarı: ${m}`);
  const zone = (values.zone ?? '').toLowerCase();
  if (!['check', 'cutover', 'status'].includes(command) || !zone) {
    console.error('Kullanım: cloudflare-dns.mjs <check|cutover|status> --zone <bölge> [--ip <IPv4>] [--records @,www,*,hooks] [--worker-hosts …] [--worker-service …]');
    process.exit(2);
  }
  try {
    const cf = createClient({ token: process.env.CLOUDFLARE_API_TOKEN, apiBase: process.env.CF_API_BASE || DEFAULT_API_BASE });
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || undefined;
    const workerHosts = list(values['worker-hosts'], undefined);
    if (command === 'status') {
      const s = await status({ cf, zone, accountId });
      say(JSON.stringify({ workerDomains: s.workerDomains, apexA: s.apexA }));
      return;
    }
    if (!values.ip) throw new CfPermissionError('--ip gerekli (VPS IPv4).');
    if (command === 'check') {
      const r = await check({ cf, zone, ip: values.ip, accountId, workerHosts, log: say });
      for (const w of r.warnings) warn(w);
      if (process.env.GITHUB_OUTPUT) {
        const { appendFileSync } = await import('node:fs');
        appendFileSync(process.env.GITHUB_OUTPUT, `cutover_done=${r.cutoverDone}\n`);
      }
      return;
    }
    const r = await cutover({
      cf,
      zone,
      ip: values.ip,
      accountId,
      records: list(values.records, DEFAULT_RECORDS),
      workerHosts,
      workerService: values['worker-service'] || DEFAULT_WORKER_SERVICE,
      log: say,
    });
    for (const w of r.warnings) warn(w);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(gh ? `::error::${msg}` : `Hata: ${msg}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
