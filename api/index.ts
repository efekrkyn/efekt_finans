/**
 * Vercel Functions catch-all — tüm /api/* istekleri buraya gelir.
 * server.ts'teki fetchHandler'ı doğrudan reuse ediyoruz.
 * Bun.serve sarmalayıcısı sadece Bun runtime'da çalışır (skip edilir burada).
 */
import { fetchHandler } from '../src/server.js';

export const config = {
  // Node.js runtime — Bun beta'ya bağlı kalmıyoruz, yahoo-finance2 + langchain Node'da çalışıyor.
  runtime: 'nodejs',
  maxDuration: 30, // AI çağrıları 20-25 sn sürebilir
};

export default async function handler(req: Request): Promise<Response> {
  return fetchHandler(req);
}
