import type { NextRequest } from 'next/server';

// SSE geçidi: /api/v1/panel/stream isteğini API'ye akış olarak aktarır.
// Next'in genel /api rewrite'ı gzip sıkıştırması yüzünden olay akışını tamponlayabilir;
// bu uç "no-transform" ile her olayı anında iletir (sipariş kaçmaz, 14 §7.1).

export const dynamic = 'force-dynamic';

const API = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export async function GET(request: NextRequest): Promise<Response> {
  const headers = new Headers({ Accept: 'text/event-stream' });
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId) headers.set('last-event-id', lastEventId);
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
  const ua = request.headers.get('user-agent');
  if (ua) headers.set('user-agent', ua);

  let upstream: Response;
  try {
    upstream = await fetch(`${API}/api/v1/panel/stream${request.nextUrl.search}`, {
      headers,
      signal: request.signal,
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { error: { code: 'upstream_unavailable', message: 'Sunucuya ulaşılamadı. Bağlantı yeniden denenecek.' } },
      { status: 502 },
    );
  }

  const contentType = upstream.headers.get('content-type') ?? 'text/event-stream';
  if (!upstream.ok || !contentType.includes('text/event-stream')) {
    const body = await upstream.text().catch(() => '');
    return new Response(body, { status: upstream.status, headers: { 'content-type': contentType, 'cache-control': 'no-store' } });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
}
