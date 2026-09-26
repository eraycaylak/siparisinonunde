// İstek logu: URL'deki kişisel veri ve yetki belirteçleri maskelenir (CLAUDE.md kural 7, KVKK log asgarisi).
// Sorgu dizesi değerleri (ör. ?phone=, ?q=) ve yolda taşınan belirteçler (takip linki, webhook adresi) loga girmez.

const MASK = '***';

/**
 * Yolda belirteç taşıyan uçlar: /store/track/<token>…, /webhooks/wa/<token>…, ortak numara /webhooks/wa/shared/<token>…
 * (ortak numaranın belirteci platformun tek girişidir; 360dialog'da imza olmadığından tek kimlik doğrulamadır).
 */
const TOKEN_PATHS = [/(\/store\/track\/)[^/?#]+/, /(\/webhooks\/wa\/(?:shared\/)?)[^/?#]+/];

/** Log için URL: sorgu değerleri ve yol belirteçleri maskeli ("?phone=***"). */
export function redactUrlForLog(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  let path = q === -1 ? url : url.slice(0, q);
  for (const re of TOKEN_PATHS) path = path.replace(re, `$1${MASK}`);
  if (q === -1) return path;
  const keys = url
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((pair) => `${pair.split('=')[0]}=${MASK}`);
  return keys.length ? `${path}?${keys.join('&')}` : path;
}

interface LoggableRequest {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number } | null;
}

/** Fastify `req` log serileştiricisi (varsayılanın maskeli karşılığı). */
export const logSerializers = {
  req(req: LoggableRequest) {
    return {
      method: req.method,
      url: redactUrlForLog(req.url),
      hostname: req.hostname,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    };
  },
};
