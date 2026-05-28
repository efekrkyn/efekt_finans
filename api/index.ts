/**
 * Vercel Functions catch-all — tüm /api/* istekleri buraya gelir.
 * server.ts'teki fetchHandler'ı doğrudan reuse ediyoruz.
 * Bun.serve sarmalayıcısı sadece Bun runtime'da çalışır (skip edilir burada).
 */
import { fetchHandler } from '../src/server';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

// Hata yakalama — handler patlarsa Vercel'a 500 yerine net JSON hata mesajı dön
export default async function handler(req: Request): Promise<Response> {
  try {
    return await fetchHandler(req);
  } catch (err: any) {
    console.error('[api] handler crashed:', err?.stack || err);
    return new Response(
      JSON.stringify({ error: 'Backend hatası', detail: err?.message || String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
