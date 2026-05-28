/**
 * DEBUG step 2: config export'unu kaldır, sadece default function bırak.
 * 'runtime: nodejs' literal string @vercel/node tarafından tanınmıyor olabilir.
 * vercel.json'daki functions.maxDuration zaten yeterli.
 */

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return new Response(
    JSON.stringify({
      ok: true,
      path: url.pathname,
      method: req.method,
      msg: 'Step 2: config kaldırıldı',
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
