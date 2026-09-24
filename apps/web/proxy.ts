import { NextResponse, type NextRequest } from 'next/server';

// Alt alan adı → storefront (00 §2): "{slug}.<kök alan adı>/…" isteği "/s/{slug}/…" yoluna yazılır.
// NEXT_PUBLIC_ROOT_DOMAIN boşsa (yerel geliştirme) devre dışıdır; localhost'ta /s/{slug} doğrudan kullanılır.
// panel.<kök> ve admin.<kök> kökleri /panel ve /admin'e yönlenir.

const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '').toLowerCase().replace(/^\.+|\.+$/g, '');

/** Storefront olarak yorumlanmayacak alt alan adları (06 §3.4). */
const RESERVED = new Set(['www', 'api', 'hooks', 'status', 'static', 'cdn', 'mail']);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Alt alan adında olduğu gibi bırakılan yollar (takip sayfası, API, statik dosyalar). */
const PASSTHROUGH = ['/t/', '/s/', '/api/', '/_next/'];

export function resolveSubdomain(host: string, rootDomain: string): string | null {
  if (!rootDomain) return null;
  const h = host.toLowerCase().split(':')[0] ?? '';
  if (!h || h === rootDomain || h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  if (!h.endsWith(`.${rootDomain}`)) return null;
  const sub = h.slice(0, -(rootDomain.length + 1));
  if (!sub || sub.includes('.')) return null;
  return sub;
}

export function proxy(request: NextRequest) {
  const sub = resolveSubdomain(request.headers.get('host') ?? '', ROOT_DOMAIN);
  if (!sub || RESERVED.has(sub)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;

  if (sub === 'panel' || sub === 'admin') {
    if (pathname === '/') return NextResponse.rewrite(new URL(`/${sub}${search}`, request.url));
    return NextResponse.next();
  }

  if (!SLUG_RE.test(sub)) return NextResponse.next();
  if (PASSTHROUGH.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const target = new URL(`/s/${sub}${pathname === '/' ? '' : pathname}${search}`, request.url);
  return NextResponse.rewrite(target);
}

export const config = {
  // API, statik dosyalar ve meta dosyalar hariç.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|manifest.webmanifest).*)'],
};
