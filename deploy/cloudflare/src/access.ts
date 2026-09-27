// Worker'ın erişim ve yönlendirme kuralları (15 §13). Saf fonksiyonlar: scripts/access.test.mjs ile denenir
// (node --test; Node'un tür ayıklamasıyla çalışır, bu yüzden yalnız silinebilir TypeScript sözdizimi kullanılır).
//
// - Site herkese açıktır: pazarlama, vitrin (/s/*), takip (/t/*), yasal sayfalar, panel/admin giriş ekranları ve API.
// - HTTP Basic (DEV_PASSWORD) yalnız geliştirici araçlarını korur: /dev/* ve /api/v1/dev/*.
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

const PROTECTED_PREFIXES = ['/dev', '/api/v1/dev'];

/** Parola isteyen yol mu: /dev, /dev/…, /api/v1/dev, /api/v1/dev/… (ör. /devices korunmaz; /dev;x korunur). */
export function isProtectedPath(pathname: string): boolean {
  const p = normalizePathForAuth(pathname);
  return PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix) && !/^[a-z0-9_-]/.test(p.slice(prefix.length)));
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
