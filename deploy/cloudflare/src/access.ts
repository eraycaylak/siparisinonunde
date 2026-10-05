// Worker'ın erişim ve yönlendirme kuralları (15 §13). Saf fonksiyonlar: scripts/access.test.mjs ile denenir
// (node --test; Node'un tür ayıklamasıyla çalışır, bu yüzden yalnız silinebilir TypeScript sözdizimi kullanılır).
//
// - Alan adı kipinde (DEPLOY_MODE=domain; CANLI ORTAM, https://yemekgelsin.net; 00 §12a madde 10) site herkese açıktır ve
//   parola yoktur. Geliştirici araçlarının yolları (/dev/*, /api/v1/dev/*) Worker'da doğrudan 404 döner (isDevToolsPath;
//   src/mode.ts blockDevTools); container'da da kapalıdırlar (DEV_TOOLS=0).
// - Gizli staging kipinde (DEPLOY_MODE=staging; yalnız isteğe bağlı Türkiye VPS'i canlıdayken, yalnız workers.dev) sitenin
//   TAMAMI parolalıdır (HTTP Basic, DEV_PASSWORD); yalnız sağlık uçları (/api/v1/health, /api/v1/health/worker) açıktır.
// - www.<alan adı>/* → https://<alan adı>/* (301); workers.dev adresindeki sayfa gezinmeleri (GET text/html) özel alan
//   adına geçici (302) yönlenir. API ve webhook istekleri workers.dev'de de çalışmaya devam eder (yedek adres).

/**
 * Yetki denetimi için yol: yüzde kodlaması çözülür (Fastify ve Next yolu çözerek eşler; "/api/v1/%64ev" de korunmalı),
 * ardışık eğik çizgiler teke iner, küçük harfe çevrilir.
 */
export function normalizePathForAuth(pathname: string): string {
  let p = pathname;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      decoded = p.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    }
    if (decoded === p) break;
    p = decoded;
  }
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
}

const DEV_TOOLS_PREFIXES = ['/dev', '/api/v1/dev'];

/**
 * Geliştirici araçlarının yolu mu: /dev, /dev/…, /api/v1/dev, /api/v1/dev/… (ör. /devices değil; /dev;x ve kodlanmış
 * biçimler de sayılır). Canlı ortamda Worker bu yollara 404 döner.
 */
export function isDevToolsPath(pathname: string): boolean {
  const p = normalizePathForAuth(pathname);
  return DEV_TOOLS_PREFIXES.some((prefix) => p.startsWith(prefix) && !/^[a-z0-9_-]/.test(p.slice(prefix.length)));
}

/** Dağıtım kipi: domain (canlı ortam, yemekgelsin.net) | staging (gizli, workers.dev, demo verili). */
export type DeployMode = 'domain' | 'staging';

export function normalizeDeployMode(raw: string | undefined | null): DeployMode {
  return (raw ?? '').trim() === 'staging' ? 'staging' : 'domain';
}

/** Gelen webhook yollarının öneki (ortak numara ve işletmenin kendi numarası; apps/api routes/webhooks/wa.ts). */
export const WEBHOOK_PATH_PREFIX = '/api/v1/webhooks/';

/**
 * Gelen webhook yolu mu: yalnız bu yolların gövdesi, container alamadığında R2 tamponuna yazılır
 * (src/webhook-spool.ts; denetim 1.7). Yüzde kodlanmış biçimler de sayılır.
 */
export function isWebhookPath(pathname: string): boolean {
  return normalizePathForAuth(pathname).startsWith(WEBHOOK_PATH_PREFIX);
}

const HEALTH_PATHS = ['/api/v1/health', '/api/v1/health/worker'];

/** İzleme uçları (parolasız; gizli staging'de de açık). */
export function isHealthPath(pathname: string): boolean {
  const p = normalizePathForAuth(pathname).replace(/\/+$/, '');
  return HEALTH_PATHS.includes(p);
}

/**
 * HTTP Basic (DEV_PASSWORD) gereken yol mu: yalnız gizli staging'de, sağlık uçları dışında her şey. Canlı ortamda (alan
 * adı kipi) parola sorulmaz; geliştirici araçları orada 404'tür (isDevToolsPath).
 */
export function requiresAuth(pathname: string, mode: DeployMode): boolean {
  return mode === 'staging' && !isHealthPath(pathname);
}

/** Tarayıcı sayfa gezintisi mi (bekleme sayfası ve workers.dev yönlendirmesi yalnız bunlara uygulanır). */
export function isNavigation(method: string, accept: string | null): boolean {
  return (method === 'GET' || method === 'HEAD') && (accept ?? '').includes('text/html');
}

export type RedirectDecision = { status: 301 | 302 | 308; location: string } | null;

/**
 * Kanonik adrese yönlendirme kararı. siteUrl: APP_BASE_URL (ör. https://yemekgelsin.net). siteUrl'nin kendisi bir
 * workers.dev adresiyse (yedek yapılandırma) workers.dev yönlendirmesi yapılmaz.
 */
export function redirectFor(url: URL, method: string, accept: string | null, siteUrl: string): RedirectDecision {
  let canonical: URL;
  try {
    canonical = new URL(siteUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const canonicalHost = canonical.hostname.toLowerCase();
  if (host === canonicalHost) return null;
  const target = `${canonical.origin}${url.pathname}${url.search}`;
  if (host === `www.${canonicalHost}`) {
    // Gövdeli isteklerde yöntem korunur (308); tarayıcı gezintileri ve GET/HEAD kalıcı 301
    return { status: method === 'GET' || method === 'HEAD' ? 301 : 308, location: target };
  }
  const canonicalIsWorkersDev = canonicalHost.endsWith('.workers.dev');
  if (host.endsWith('.workers.dev') && !canonicalIsWorkersDev && isNavigation(method, accept)) {
    const p = normalizePathForAuth(url.pathname);
    if (!p.startsWith('/api/')) return { status: 302, location: target };
  }
  return null;
}

/**
 * Veri dönemi (DATA_EPOCH) değeri: "2" → "2", boş/tanımsız → "" (ilk, öneksiz dönem). Yalnız rakam (en çok 6).
 * Container'a açılışta ortam değişkeni olarak verilir ve container'ın ömrü boyunca sabit kalır (15 §13).
 */
export function normalizeEpoch(epoch: string | undefined | null): string {
  const e = (epoch ?? '').trim();
  if (e === '') return '';
  if (!/^[0-9]{1,6}$/.test(e)) throw new Error(`DATA_EPOCH geçersiz: "${e}" (yalnız rakam, en çok 6 hane)`);
  return e;
}

export type BackupTarget = { prefix: string; kind: 'db' | 'uploads' };

/**
 * Container → http://yedek.internal/<yol> isteğinin R2 hedefi. Dönem Worker'ın o anki DATA_EPOCH'undan DEĞİL, yolun
 * kendisinden okunur: container açılışta aldığı dönemi yola yazar (entrypoint.sh: /e2/db). Böylece yeniden dağıtım
 * sırasında hâlâ çalışan eski container'ın son yedeği yeni döneme düşmez. Dönemsiz yol (/db; ilk sürümün entrypoint'i)
 * öneksiz eski anahtarlara gider, asla güncel döneme değil.
 */
export function parseBackupPath(pathname: string): BackupTarget | null {
  const m = /^\/+(?:(e[0-9]{1,6})\/+)?(db|uploads)$/.exec(pathname);
  if (!m) return null;
  return { prefix: m[1] ? `${m[1]}/` : '', kind: m[2] as BackupTarget['kind'] };
}
