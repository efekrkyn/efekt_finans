/**
 * DEBUG: Minimal handler — server.ts import'unu geçici devre dışı bıraktım.
 * /api/health çalışırsa, sorun server.ts içinde bir top-level import.
 * Çalışmazsa Vercel function setup sorunlu.
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
};

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return new Response(
    JSON.stringify({
      ok: true,
      path: url.pathname,
      method: req.method,
      msg: 'Minimal handler çalışıyor — server.ts import devre dışı',
      ts: new Date().toISOString(),
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
