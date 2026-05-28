/**
 * Vercel Functions catch-all — tüm /api/* istekleri buraya gelir.
 *
 * NOT: Vercel Node runtime'da Request.url path-only ('/api/health') geliyor,
 * tam URL değil. server.ts'in fetchHandler'ı new URL(req.url) yapmadan önce
 * base ekleyen normalize edilmiş Request veriyoruz.
 */
import { fetchHandler } from '../src/server';

export default async function handler(req: Request): Promise<Response> {
  try {
    // Vercel path-only URL veriyorsa, host header ile tam URL'e çevir
    let normalized = req;
    if (!req.url.startsWith('http')) {
      const host = req.headers.get('host') || 'localhost';
      const proto = req.headers.get('x-forwarded-proto') || 'https';
      const fullUrl = `${proto}://${host}${req.url}`;
      normalized = new Request(fullUrl, req);
    }
    return await fetchHandler(normalized);
  } catch (err: any) {
    console.error('[api] handler crashed:', err?.stack || err);
    return new Response(
      JSON.stringify({ error: 'Backend hatası', detail: err?.message || String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
