import { join } from 'path';
import { fetchBISTData } from './utils/bist-data';
import { fetchIsYatirimQuote } from './utils/isyatirim';
import { getReportBundle } from './utils/report-data';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { checkEnv } from './utils/env-check';
import { fmpClient } from './utils/fmp.js';
import { yahooFinance } from './utils/yahoo.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

checkEnv();
process.on('unhandledRejection', r => console.error('unhandledRejection', String(r)));
process.on('uncaughtException', e => console.error('uncaughtException', (e as Error)?.message));
import { callLlm, streamLlmWithMessages } from './model/llm';
import { InMemoryChatHistory } from './utils/in-memory-chat-history';
// Agent lazy import edilir (sadece /api/chat içinde) — agent zinciri
// tools/registry → cron-tool/heartbeat-tool → gateway/cron'a bağlı,
// bunlar Vercel'da ignored. Health/analysis için yüklemeye gerek yok.

const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 1000 * 60 * 60; // 1 saat
const sessionLastSeen = new Map<string, number>();

const chatSessions: Record<string, InMemoryChatHistory> = {};

const apiCache = new Map<string, {data: any, exp: number}>();
function cacheGet(key: string) { const v = apiCache.get(key); if (v && v.exp > Date.now()) return v.data; return null; }
function cacheSet(key: string, data: any, ttlMs: number) { apiCache.set(key, {data, exp: Date.now()+ttlMs}); }
// Hata durumunda son başarılı cevabı (TTL'i bitmiş bile olsa) dön — Yahoo 429 fallback'i için
function cacheGetStale(key: string) { const v = apiCache.get(key); return v ? v.data : null; }

const rateLimits = new Map<string, number[]>();
function rateLimit(req: Request, max: number, windowMs: number): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
  const key = `${ip}:${new URL(req.url).pathname}`;
  const now = Date.now();
  const hits = (rateLimits.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) return false;
  hits.push(now); rateLimits.set(key, hits);
  return true;
}

function log(level: 'info'|'warn'|'error', msg: string, meta?: object) {
  const entry = { ts: new Date().toISOString(), level, msg, ...(meta||{}) };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}


function touchSession(id: string) {
  sessionLastSeen.set(id, Date.now());
  if (sessionLastSeen.size > MAX_SESSIONS) {
    const oldest = [...sessionLastSeen.entries()].sort((a,b) => a[1]-b[1])[0][0];
    delete chatSessions[oldest];
    sessionLastSeen.delete(oldest);
  }
  for (const [k, t] of sessionLastSeen) {
    if (Date.now() - t > SESSION_TTL_MS) {
      delete chatSessions[k];
      sessionLastSeen.delete(k);
    }
  }
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DIST_DIR = join(process.cwd(), 'dashboard', 'dist');

function requireApiKey(): Response | null {
  if (!process.env.DEEPSEEK_API_KEY && !process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({error: 'LLM API_KEY tanımlı değil (DEEPSEEK / GOOGLE / OPENAI / ANTHROPIC)'}), {
      status: 503, headers: {'Content-Type':'application/json'}
    });
  }
  return null;
}

async function searchTavily(
  query: string,
  opts?: { topic?: 'news' | 'general'; days?: number }
): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || apiKey.startsWith('your-')) {
    return 'Haber bulunamadı (Tavily API anahtarı eksik veya geçersiz).';
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: 'basic',
        max_results: 5,
        // Güncellik filtresi: topic='news' + days=N son N günün haberlerini getirir
        ...(opts?.topic ? { topic: opts.topic } : {}),
        ...(opts?.days ? { days: opts.days } : {})
      })
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const results = data.results || [];
    return results.map((r: any, idx: number) => {
      return `[Haber ${idx + 1}] Başlık: ${r.title}\nLink: ${r.url}\nİçerik: ${r.content}\n`;
    }).join('\n');
  } catch (err) {
    console.error('Tavily search failed:', err);
    return `Arama hatası: ${(err as Error).message}`;
  }
}

/**
 * Ortak fetch handler — hem Bun.serve hem Vercel Functions için aynı logic.
 * Web Standard Request → Response imzası.
 */
export async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    
    // 0. API: Health Check
    if (path === '/api/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        uptime: process.uptime(),
        sessions: Object.keys(chatSessions).length,
        cacheSize: apiCache.size,
      }), {headers:{'Content-Type':'application/json', 'Access-Control-Allow-Origin': '*'}});
    }

    // 0.2 API: Price History
    if (path === '/api/price-history') {
      const ticker = url.searchParams.get('ticker');
      const range = url.searchParams.get('range') || '1y';
      if (!ticker) return new Response(JSON.stringify({error:'ticker zorunlu'}), {status:400, headers:{'Content-Type':'application/json'}});
      try {
        const symbol = ticker.endsWith('.IS') ? ticker : `${ticker}.IS`;
        const days = range === '1m' ? 30 : range === '3m' ? 90 : range === '6m' ? 180 : range === '1y' ? 365 : 1825;
        
        const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
        const { stdout } = await execFileAsync(pyEnv, ['src/python/price_history.py', symbol, days.toString()], { timeout: 15000 });
        
        const points = JSON.parse(stdout);
        if ((points as any).error) throw new Error((points as any).error);

        return new Response(JSON.stringify({ ticker, range, points }), {
          headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}
        });
      } catch (err) {
        return new Response(JSON.stringify({error:(err as Error).message}), {status:500, headers:{'Content-Type':'application/json'}});
      }
    }

    // 0.5. API: Technicals
    if (path === '/api/technicals') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) return new Response(JSON.stringify({error:'ticker zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      
      const cacheKey = `tech:${ticker}`;
      const cached = cacheGet(cacheKey);
      if (cached) return new Response(JSON.stringify(cached), { headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'} });

      try {
        log('info', 'fetch_technicals', { ticker });
        
        const symbol = ticker.endsWith('.IS') ? ticker : `${ticker}.IS`;
        const end = new Date();
        const start = new Date(); start.setDate(end.getDate() - 200);
        const yfResult = await (yahooFinance as any).historical(symbol, { period1: start, period2: end, interval: '1d' });
        const history = { quotes: yfResult.map((h: any) => ({ date: h.date, close: h.close, open: h.open, high: h.high, low: h.low, volume: h.volume })) || [] };
        const closes = history.quotes.map((q: any) => q.close).filter((v: any): v is number => typeof v === 'number');
        const { computeTechnicalIndicators } = await import('./utils/technical-indicators');
        const bars = closes.map((c: any, i: any) => ({ date: `day${i}`, close: c }));
        const indicators = computeTechnicalIndicators(bars);
        
        const result = {
          rsi14: indicators.rsi,
          sma20: indicators.sma20,
          sma50: indicators.sma50,
          macd: indicators.macd,
        };
        cacheSet(cacheKey, result, 1000 * 60 * 60); // 1 hour TTL
        
        return new Response(JSON.stringify(result), { headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch(err) {
        log('error', 'technicals_error', { error: (err as Error).message });
        return new Response(JSON.stringify({error:(err as Error).message}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
    }

    // 1. API: Analyze Stock
    if (path === '/api/analysis') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) {
        return new Response(JSON.stringify({ error: 'Hisse kodu (ticker) parametresi zorunludur' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      const isForeign = ticker.includes('=X') || ticker.includes('-USD') || (ticker.length <= 5 && !ticker.includes('.') && /^[A-Z]+$/.test(ticker) && !['THYAO','TUPRS','KCHOL','AKBNK','ASELS','BIMAS','EREGL','ISCTR','SAHOL','YKBNK','GARAN','SISE','FROTO','PGSUS','TOASO','TCELL','SASA','HEKTS','TTKOM','ALARK','MGROS','DOAS','KRDMD','KOZAL','PETKM','ENJSA','ASTOR','EKGYO','TTRAK','VAKBN','GUBRF','OYAKC','KORDS','SOKM','VESBE','ARCLK','ODAS','KMPUR','HALKB','ENKAI'].includes(ticker));
      
      try {
        if (!rateLimit(req, 20, 60000)) return new Response('Rate limited', {status:429, headers:{'Access-Control-Allow-Origin':'*'}});
        const cached = cacheGet(`analysis:${ticker}`);
        if (cached) return new Response(JSON.stringify(cached), { headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
        
        if (isForeign) {
          
          const quoteRes = await fmpClient.quote(ticker);
          const quote: any = quoteRes && quoteRes.length > 0 ? quoteRes[0] : null;
          const data = {
            ticker,
            companyName: quote.longName || quote.shortName || ticker,
            currentPrice: quote.regularMarketPrice,
            marketCap: quote.marketCap || null,
            currency: quote.currency || 'USD',
            change: quote.regularMarketChangePercent || 0,
            dayHigh: quote.regularMarketDayHigh,
            dayLow: quote.regularMarketDayLow,
            fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
            volume: quote.regularMarketVolume,
            assetType: ticker.includes('=X') ? 'FX' : ticker.includes('-USD') ? 'CRYPTO' : 'EQUITY'
          };
          cacheSet(`analysis:${ticker}`, data, 1000 * 60 * 60); // 1 saat fresh, sonra stale fallback
          return new Response(JSON.stringify(data), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
        }
        const startTime = Date.now();
        log('info', 'analysis', { ticker });
        const data = await fetchBISTData(ticker);
        cacheSet(`analysis:${ticker}`, data, 1000 * 60 * 60); // 1 saat fresh, sonra stale fallback // 5 mins
        log('info', 'analysis_done', { ticker, durationMs: Date.now() - startTime });
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        const msg = (err as Error).message || '';
        const is429 = msg.includes('429') || msg.toLowerCase().includes('too many requests') || msg.toLowerCase().includes('crumb');
        // 429 ise: önce stale cache (önceki başarılı sonuç) dene
        if (is429) {
          const stale = cacheGetStale(`analysis:${ticker}`);
          if (stale) {
            log('warn', 'serving_stale_due_to_429', { ticker });
            return new Response(JSON.stringify({ ...stale, _stale: true, _staleReason: 'Yahoo Finance rate-limit (429) — son başarılı veri gösteriliyor' }), {
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
          }
          console.error(`[API] Analiz hatası (${ticker}): 429 - stale cache de yok`);
          return new Response(JSON.stringify({ error: 'Yahoo Finance şu an istek limiti uyguluyor (429). Birkaç saniye sonra tekrar deneyin.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Retry-After': '30' },
          });
        }
        console.error(`[API] Analiz hatası (${ticker}):`, msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // 1.1b. API: Bilanço Ajandası (KAP + fallback takvim)
    if (path === '/api/agenda') {
      try {
        const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
        const { stdout } = await execFileAsync(pyEnv, ['src/python/kap_agenda.py'], { timeout: 15000 });
        const agenda = JSON.parse(stdout);
        return new Response(JSON.stringify(agenda), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      } catch (err) {
        return new Response(JSON.stringify({ events: [], error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // 1.1c. API: İş Yatırım Finansal Tablolar (isyatirimhisse)
    if (path === '/api/isyatirim-financials') {
      const ticker = url.searchParams.get('ticker') || url.searchParams.get('symbol');
      if (!ticker) return new Response(JSON.stringify({error:'ticker zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      try {
        const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
        const startYear = url.searchParams.get('start_year') || String(new Date().getFullYear() - 2);
        const endYear = url.searchParams.get('end_year') || String(new Date().getFullYear());
        const { stdout } = await execFileAsync(pyEnv, ['src/python/isyatirim_fetcher.py', ticker, startYear, endYear], { timeout: 20000 });
        const data = JSON.parse(stdout);
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // 1.1d. API: Gelişmiş Rasyo Analizi (FinanceToolkit + DefeatBeta)
    if (path === '/api/advanced-ratios') {
      const ticker = url.searchParams.get('ticker') || url.searchParams.get('symbol');
      if (!ticker) return new Response(JSON.stringify({error:'ticker zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      try {
        const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
        const args = ['src/python/finance_toolkit_proxy.py', ticker];
        const fmpKey = process.env.FMP_API_KEY;
        if (fmpKey) args.push(fmpKey);
        const { stdout } = await execFileAsync(pyEnv, args, { timeout: 30000 });
        // Filter out defeatbeta banner noise
        const lines = stdout.split('\n');
        const jsonLine = lines.find(l => l.trim().startsWith('{'));
        const data = JSON.parse(jsonLine || '{}');
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // 1.1e. API: AlphaAnalyst Emsal (Peer) Karşılaştırma
    if (path === '/api/alpha-analyst-peers') {
      const ticker = url.searchParams.get('ticker') || url.searchParams.get('symbol');
      if (!ticker) return new Response(JSON.stringify({error:'ticker zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      try {
        const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
        const { stdout } = await execFileAsync(pyEnv, ['src/python/alpha_analyst_peers.py', ticker], { timeout: 20000 });
        const data = JSON.parse(stdout);
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // 1.2. API: Yabancı varlık (ABD hisse, döviz, kripto)
    if (path === '/api/asset') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return new Response(JSON.stringify({error:'symbol zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      try {
        const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
        const { stdout } = await execFileAsync(pyEnv, ['src/python/asset_fetcher.py', symbol]);
        const quote = JSON.parse(stdout);
        if (quote.error || !quote.companyName) throw new Error(quote.error || 'Varlık bulunamadı');

        return new Response(JSON.stringify({
          ticker: symbol,
          companyName: quote.companyName,
          currentPrice: quote.currentPrice,
          marketCap: quote.marketCap || null,
          currency: quote.currency || 'USD',
          change: quote.change || 0,
          dayHigh: quote.dayHigh,
          dayLow: quote.dayLow,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
          volume: quote.volume,
          assetType: symbol.includes('=X') ? 'FX' : symbol.includes('-USD') ? 'CRYPTO' : 'EQUITY'
        }), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch (err) {
        return new Response(JSON.stringify({error:(err as Error).message}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
    }

    // 1.5. API: AI Analysis
    if (path === '/api/ai-analysis') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) {
        return new Response(JSON.stringify({ error: 'Hisse kodu (ticker) parametresi zorunludur' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      if (!rateLimit(req, 10, 60000)) return new Response('Rate limited', {status:429, headers:{'Access-Control-Allow-Origin':'*'}});
      
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          try {
            const startTime = Date.now();
            log('info', 'ai-analysis', { ticker });
            const financials = await fetchBISTData(ticker);
            
            const query = `${financials.companyName} (${ticker}) hisse son dakika haberleri gelişmeleri`;
            log('info', 'tavily_search', { query });
            const searchResults = await searchTavily(query);
            
            let chronosText = 'Chronos tahmini alınamadı veya hesaplanıyor.';
            try {
              log('info', 'chronos_forecast', { ticker });
              const { getChronosForecast } = await import('./tools/finance/chronos-forecast.js');
              const chronosTicker = ticker.includes('.') ? ticker : `${ticker}.IS`;
              const result = await getChronosForecast.func({ ticker: chronosTicker, days: 30 });
              chronosText = typeof result === 'string' ? result : String(result);
            } catch (e) {
              log('error', 'chronos_error', { error: (e as Error).message });
            }
            
            const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
            const prompt = `
Aşağıda Borsa İstanbul'da işlem gören ${financials.companyName} (${financials.ticker}) şirketine ait en güncel finansal veriler, Chronos AI tahminleri ve internetten derlenen son haberler yer almaktadır.

Lütfen raporunun tam en başına hazırlayan bilgisini ve rapor tarihini şu şekilde ekle:
Hazırlayan: BIST Finansal Analisti & Portföy Yöneticisi
Tarih: ${today}

### HİSSE PİYASA VERİLERİ:
- Güncel Fiyat: ${financials.currentPrice} TRY
- Piyasa Değeri: ${financials.marketCap}
- F/K Oranı: ${financials.multiples?.trailingPE?.toFixed(1) || 'Veri Yok'}
- PD/DD Oranı: ${financials.multiples?.priceToBook?.toFixed(1) || 'Veri Yok'}
- FD/FAVÖK Oranı: ${financials.multiples?.evToEbitda?.toFixed(1) || 'Veri Yok'}

### ÇEYREKLİK PERFORMANS DEĞİŞİMLERİ (Fintables Karnesi):
- Satışlar Çeyreklik Büyüme (QoQ): ${financials.scorecard.revenueGrowthQoQ?.toFixed(1) || 'Veri Yok'}%
- Satışlar Yıllık Büyüme (YoY): ${financials.scorecard.revenueGrowthYoY?.toFixed(1) || 'Veri Yok'}%
- FAVÖK Çeyreklik Büyüme (QoQ): ${financials.scorecard.ebitdaGrowthQoQ?.toFixed(1) || 'Veri Yok'}%
- FAVÖK Yıllık Büyüme (YoY): ${financials.scorecard.ebitdaGrowthYoY?.toFixed(1) || 'Veri Yok'}%
- Net Kâr Çeyreklik Büyüme (QoQ): ${financials.scorecard.netIncomeGrowthQoQ?.toFixed(1) || 'Veri Yok'}%
- Net Kâr Yıllık Büyüme (YoY): ${financials.scorecard.netIncomeGrowthYoY?.toFixed(1) || 'Veri Yok'}%

### İNTERNETTEN ALINAN SON HABERLER / GELİŞMELER:
${searchResults}

### CHRONOS AI 30 GÜNLÜK FİYAT TAHMİNİ (MAKİNE ÖĞRENMESİ):
${chronosText}

### GÖREV:
Bu verileri, haberleri ve Chronos makine öğrenmesi tahminini detaylıca analiz et. Şunları içeren profesyonel bir Türkçe analiz raporu yaz:
1. **Finansal Sağlık Değerlendirmesi:** Gelir tablosu, büyüme oranları ve çarpanların (F/K, PD/DD) durumunu yorumla.
2. **Haber ve Gelişmelerin Yorumu:** İnternetten derlenen haberlerin hisse üzerindeki olumlu/olumsuz etkilerini analiz et.
3. **Gelecek Beklentisi ve Tahmin:** Şirketin önümüzdeki dönemdeki performansı ve hisse senedinin yönü hakkında profesyonel bir tahminde bulun. Chronos 30 Günlük fiyat hedeflerini mutlaka yorumuna dahil et. Yatırım tavsiyesi olmadığını belirt.

Analizini markdown formatında yaz. Profesyonel, net ve finansal jargona uygun olsun.

Sonda analizini bitirirken, raporun EN ALTINA şu formatta duyarlılık puanlarını ekle:
[SENTIMENT]: positive: <olumlu_yüzdesi>, neutral: <nötr_yüzdesi>, negative: <olumsuz_yüzdesi>
Örn: [SENTIMENT]: positive: 65, neutral: 25, negative: 10
Değerlerin toplamı 100 olmalıdır. Bu satır dışında raporun geri kalanı tamamen markdown olmalıdır.
`;

            log('info', 'llm_call', { ticker });
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST finansal analisti ve portföy yöneticisisin.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-chat', signal: req.signal });

            for await (const chunk of stream) {
              if (req.signal.aborted) break;
              const content = chunk.content;
              if (typeof content === 'string' && content) {
                safeEnqueue(`data: ${JSON.stringify({ analysisChunk: content })}\n\n`);
              }
            }
            safeEnqueue(`data: [DONE]\n\n`);
            safeClose();
            log('info', 'ai-analysis_done', { ticker, durationMs: Date.now() - startTime });
          } catch (err) {
            log('error', 'ai-analysis_error', { error: (err as Error).message });
            safeEnqueue(`data: ${JSON.stringify({ error: 'İşlem sırasında bir hata oluştu.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 1.6b API: Derin Rapor — deterministik DCF + hedef fiyat + duruş (sayılar kodda, LLM sadece düzyazı)
    if (path === '/api/deep-report') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) {
        return new Response(JSON.stringify({ error: 'Hisse kodu (ticker) parametresi zorunludur' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const authErr = requireApiKey();
      if (authErr) return authErr;
      if (!rateLimit(req, 10, 60000)) return new Response('Rate limited', { status: 429, headers: { 'Access-Control-Allow-Origin': '*' } });

      const drRaw = parseFloat(url.searchParams.get('discountRate') || '');
      const discountRate = isFinite(drRaw) ? Math.min(0.60, Math.max(0.05, drRaw)) : 0.30;
      const symbol = ticker.toUpperCase();
      const cacheKey = `deep-report:${symbol}:${discountRate.toFixed(2)}`;

      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          const send = (obj: any) => safeEnqueue(`data: ${JSON.stringify(obj)}\n\n`);
          const done = () => safeEnqueue('data: [DONE]\n\n');
          try {
            const startTime = Date.now();
            log('info', 'deep-report', { ticker: symbol, discountRate });

            // Cache hit → özet + metni parçalayıp replay et
            const cached = cacheGet(cacheKey);
            if (cached && cached.summary && typeof cached.text === 'string') {
              send({ summary: cached.summary });
              const txt: string = cached.text;
              for (let i = 0; i < txt.length; i += 400) send({ chunk: txt.slice(i, i + 400) });
              done();
              safeClose();
              log('info', 'deep-report_cache_hit', { ticker: symbol });
              return;
            }

            const bundle = await getReportBundle(symbol, { discountRate, search: searchTavily });

            // Gelişmiş rasyoları paralel çek (deep report zenginleştirme)
            let advancedRatios: any = null;
            try {
              const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
              const arArgs = ['src/python/finance_toolkit_proxy.py', symbol];
              const fmpKey = process.env.FMP_API_KEY;
              if (fmpKey) arArgs.push(fmpKey);
              const { stdout: arOut } = await execFileAsync(pyEnv, arArgs, { timeout: 20000 });
              const arLines = arOut.split('\n');
              const arJson = arLines.find(l => l.trim().startsWith('{'));
              if (arJson) advancedRatios = JSON.parse(arJson);
            } catch { /* gelişmiş rasyolar opsiyonel */ }

            const humanizeTRY = (n?: number): string => {
              if (n === undefined || n === null || !isFinite(n)) return 'Veri Yok';
              const abs = Math.abs(n);
              if (abs >= 1e9) return `${(n / 1e9).toFixed(2)} milyar TL`;
              if (abs >= 1e6) return `${(n / 1e6).toFixed(2)} milyon TL`;
              return `${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`;
            };
            const num = (n?: number, dgt = 2): string => (typeof n === 'number' && isFinite(n) ? n.toFixed(dgt) : 'Veri Yok');
            const pct = (n?: number): string => (typeof n === 'number' && isFinite(n) ? `${n.toFixed(1)}%` : 'Veri Yok');
            const pctDec = (n?: number): string => (typeof n === 'number' && isFinite(n) ? `${(n * 100).toFixed(1)}%` : 'Veri Yok');

            const d = bundle.dcf;
            const tr = bundle.targetRange;
            const summary = {
              companyName: bundle.companyName,
              currency: bundle.currency,
              currentPrice: bundle.currentPrice,
              stance: bundle.stance.label,
              stanceRationale: bundle.stance.rationale,
              tier: bundle.tier,
              confidence: d.confidence,
              fairValue: d.feasible ? d.fairValuePerShare : null,
              upsidePct: d.feasible ? d.upsidePct : null,
              discountRate: d.assumptions.discountRate,
              targetLow: tr?.low ?? null,
              targetHigh: tr?.high ?? null,
              targetBasis: tr?.basis ?? null,
            };
            send({ summary });

            const dcfBlock = d.feasible
              ? `- Hesaplanabilir: EVET
- Adil değer/hisse: ${num(d.fairValuePerShare)} TL
- Yükseliş/düşüş potansiyeli: ${pct(d.upsidePct)}
- İskonto oranı (kullanıcı seçimi): ${pctDec(d.assumptions.discountRate)}
- Terminal büyüme: ${pctDec(d.assumptions.terminalGrowth)}
- Kullanılan büyüme oranı: ${pctDec(d.assumptions.growthRate)}
- Baz FCF: ${humanizeTRY(d.assumptions.baseFcf)} (${d.assumptions.fcfSource === 'ebitda-proxy' ? 'FAVÖK proxy' : 'raporlanmış'})
- Terminal değerin EV içindeki payı: ${pctDec(d.assumptions.terminalValuePct)}
- Güven: ${d.confidence}
- Uyarılar: ${d.caveats.join(' ')}`
              : `- Hesaplanabilir: HAYIR (yeterli finansal veri yok${bundle.tier === 'kısıtlı' ? '; yedek veri kaynağı kullanıldı' : ''})
- Uyarılar: ${d.caveats.join(' ')}`;

            const t = bundle.technicals;
            const techBlock = t
              ? `- RSI(14): ${num(t.rsi, 1)} (${t.rsiSignal})
${t.stochasticRsi !== undefined ? `- StochRSI(14): ${num(t.stochasticRsi, 1)}` : '- StochRSI(14): Veri Yok'}
- MACD histogram: ${t.macd ? num(t.macd.histogram, 3) : 'Veri Yok'}
- SMA20: ${num(t.sma20)} | SMA50: ${num(t.sma50)}
${t.bollinger ? `- Bollinger(20,2): Üst ${num(t.bollinger.upper)} / Orta ${num(t.bollinger.middle)} / Alt ${num(t.bollinger.lower)}; %B ${num(t.bollinger.percentB, 2)}` : '- Bollinger(20,2): Veri Yok'}
- Birleşik sinyal: ${t.signal}
${t.atr !== undefined ? `- ATR(14): ${num(t.atr, 2)}` : '- ATR(14): Veri Yok'}
${t.adx !== undefined ? `- ADX(14): ${num(t.adx, 1)}` : '- ADX(14): Veri Yok'}`
              : '- Teknik gösterge verisi yok';

            const targetBlock = tr
              ? `${num(tr.low)} – ${num(tr.high)} TL (dayanak: ${tr.basis === 'dcf' ? 'DCF duyarlılık aralığı' : '52-hafta teknik bant'})`
              : 'Hesaplanamadı';
            const v = bundle.valuation;
            const valuationBlock = v
              ? `- FCF Verimi: ${v.fcfYield !== undefined ? pctDec(v.fcfYield) : 'Veri Yok'}
- Net Borç/FAVÖK: ${v.netDebtToEbitda !== undefined ? num(v.netDebtToEbitda, 2) : 'Veri Yok'}
- FAVÖK Marjı: ${v.ebitdaMargin !== undefined ? pctDec(v.ebitdaMargin) : 'Veri Yok'}
- EV/FCF: ${v.evToFcf !== undefined ? num(v.evToFcf, 1) : 'Veri Yok'}
- Kalite Skoru: ${v.qualityScore}/${v.qualityMax} (${v.qualityLabel})
- Piotroski F-Skoru: ${v.piotroskiScore !== undefined ? `${v.piotroskiScore}/9` : 'Hesaplanamadı'}`
              : '- Değerleme verisi hesaplanamadı';

            const chronosBlock = bundle.chronosForecast
              ? `- 30 Günlük Tahmin: Kötümser ${num(bundle.chronosForecast.day_30_low)} | Medyan ${num(bundle.chronosForecast.day_30_median)} | İyimser ${num(bundle.chronosForecast.day_30_high)}`
              : '- ML Tahmini yok.';

            const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
            const prompt = `Bugünün tarihi: ${today}.

Aşağıda Borsa İstanbul'da işlem gören ${bundle.companyName} (${bundle.ticker}) için KODDA HESAPLANMIŞ kesin sayısal veriler var. Bu sayılar yer gerçeğidir (ground truth).

ÇOK ÖNEMLİ KURALLAR:
- Aşağıdaki sayıları AYNEN kullan. ASLA kendi sayı/oran/fiyat UYDURMA. Verilmeyen bir rakamı tahmin etme; "veri yok" de.
- Adil değer, hedef aralık, yükseliş potansiyeli ve duruş zaten hesaplandı; bunlarla ÇELİŞME.
- Veri katmanı "${bundle.tier}". "kısıtlı" ise tam finansal tablo yoktur; DCF atlanmış olabilir, bunu dürüstçe belirt.

### PİYASA VERİLERİ
- Güncel fiyat: ${num(bundle.currentPrice)} ${bundle.currency}
- Piyasa değeri: ${humanizeTRY(bundle.marketCap)}
- F/K: ${num(bundle.multiples.trailingPE)} | PD/DD: ${num(bundle.multiples.priceToBook)} | FD/FAVÖK: ${num(bundle.multiples.evToEbitda)}

### BÜYÜME KARNESİ
- Satış YoY: ${pct(bundle.scorecard.revenueGrowthYoY)} | QoQ: ${pct(bundle.scorecard.revenueGrowthQoQ)}
- FAVÖK YoY: ${pct(bundle.scorecard.ebitdaGrowthYoY)} | QoQ: ${pct(bundle.scorecard.ebitdaGrowthQoQ)}
- Net Kâr YoY: ${pct(bundle.scorecard.netIncomeGrowthYoY)} | QoQ: ${pct(bundle.scorecard.netIncomeGrowthQoQ)}

### SON DÖNEM FİNANSALLARI ${bundle.latestFinancials ? `(${bundle.latestFinancials.periodLabel})` : ''}
${bundle.latestFinancials ? `- Hasılat: ${humanizeTRY(bundle.latestFinancials.totalRevenue)}
- FAVÖK: ${humanizeTRY(bundle.latestFinancials.ebitda)}
- Net Kâr: ${humanizeTRY(bundle.latestFinancials.netIncome)}
- Serbest Nakit Akışı: ${humanizeTRY(bundle.latestFinancials.freeCashFlow)}
- Net Borç: ${humanizeTRY(bundle.latestFinancials.netDebt)}` : '- Finansal tablo verisi yok (yedek kaynak).'}

### DCF DEĞERLEME (kodda hesaplandı)
${dcfBlock}

### DEĞERLEME & KALİTE (kodda)
${valuationBlock}

### 12 AYLIK HEDEF FİYAT ARALIĞI (kodda)
${targetBlock}

### TEKNİK GÖRÜNÜM (kodda)
${techBlock}

### YAPAY ZEKA TAHMİNİ (Chronos ML)
${chronosBlock}

### GELİŞMİŞ RASYOLAR (DefeatBeta/FinanceToolkit)
${advancedRatios && !advancedRatios.error ? `Kaynak: ${advancedRatios.source}
${advancedRatios.profitability && Object.keys(advancedRatios.profitability).length > 0 ? `Kârlılık: ${Object.entries(advancedRatios.profitability).map(([k,v]) => `${k}=${v}`).join(' | ')}` : ''}
${advancedRatios.solvency && Object.keys(advancedRatios.solvency).length > 0 ? `Borçluluk: ${Object.entries(advancedRatios.solvency).map(([k,v]) => `${k}=${v}`).join(' | ')}` : ''}
${advancedRatios.valuation && Object.keys(advancedRatios.valuation).length > 0 ? `Değerleme: ${Object.entries(advancedRatios.valuation).map(([k,v]) => `${k}=${typeof v === 'number' && v > 1e9 ? humanizeTRY(v as number) : v}`).join(' | ')}` : ''}` : '- Gelişmiş rasyo verisi mevcut değil.'}

### DURUŞ (kodda): ${bundle.stance.label} — ${bundle.stance.rationale}

### SON HABERLER (internet)
${bundle.news || 'Haber bulunamadı.'}

### SEKTÖR & EMSAL BAĞLAMI (internet)
${bundle.peerContext || 'Emsal verisi bulunamadı.'}

### GÖREV
Yukarıdaki verilere dayanarak profesyonel, Türkçe, markdown bir DERİN YATIRIM RAPORU yaz. Şu bölümleri sırayla kullan:
1. **Özet (TL;DR)** — duruş, adil değer ve hedefin tek paragraflık gerekçesi.
2. **Finansal Sağlık** — büyüme karnesi ve son finansalların yorumu.
3. **Değerleme** — DCF varsayımlarını (iskonto, terminal büyüme, baz FCF) açıkla; F/K, PD/DD, FD/FAVÖK çarpanlarıyla çapraz kontrol et.
4. **Teknik Görünüm** — RSI/MACD/SMA ve birleşik sinyali yorumla.
5. **Emsal Karşılaştırma** — sektör bağlamına göre niteliksel kıyas (uydurma rakam yok).
6. **Haber & Katalizör** — haberlerin olası etkisi.
7. **Boğa & Ayı Senaryosu** — her iki tarafı da güçlü biçimde savun; her senaryoda "Bu tez şu olursa yanlış: ..." cümlesi ekle.
8. **Sonuç & Riskler** — net sonuç ve ana riskler. Sonunda mutlaka şu cümle yer alsın: "Bu rapor yatırım danışmanlığı kapsamında değildir."

ÜSLUP: Profesyonel ve net. Şu kelimeleri KULLANMA: "derinlemesine, kaldıraç sağlamak, sağlam (robust), kapsamlı, kusursuz, ayrıca, üstelik". Üçlü sıralamalardan kaçın. Paragraf başına en fazla bir uzun tire (—).

Raporun EN ALTINA şu satırı ekle (yalnızca bu satır markdown dışıdır):
[SENTIMENT]: positive: <x>, neutral: <y>, negative: <z>
Değerlerin toplamı 100 olmalı.`;

            log('info', 'deep-report_llm', { ticker: symbol });
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST finansal analisti ve portföy yöneticisisin. Yalnızca sana verilen kesin sayıları kullanırsın; rakam uydurmazsın.'),
              new HumanMessage(prompt),
            ], { model: 'deepseek-chat', signal: req.signal });

            let fullText = '';
            for await (const chunk of stream) {
              if (req.signal.aborted) break;
              const content = chunk.content;
              if (typeof content === 'string' && content) {
                fullText += content;
                send({ chunk: content });
              }
            }
            cacheSet(cacheKey, { summary, text: fullText }, 30 * 60 * 1000);
            done();
            safeClose();
            log('info', 'deep-report_done', { ticker: symbol, durationMs: Date.now() - startTime, tier: bundle.tier, dcfFeasible: d.feasible });
          } catch (err) {
            log('error', 'deep-report_error', { error: (err as Error).message });
            send({ error: (err as Error).message });
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // 1.7. API: Compare Multiple Stocks
    if (path === '/api/compare') {
      const tickersParam = url.searchParams.get('tickers') || '';
      if (!tickersParam) {
        return new Response(JSON.stringify({ error: 'Hisse kodları (tickers) parametresi zorunludur' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      try {
        const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
        console.log(`[API] Karşılaştırılıyor: ${tickers.join(', ')}`);
        
        const promises = tickers.map(ticker => fetchBISTData(ticker).catch(err => {
          console.error(`[API] Karşılaştırma verisi çekilemedi (${ticker}):`, err);
          return null;
        }));
        
        const results = await Promise.all(promises);
        const validResults = results.filter(Boolean);
        
        return new Response(JSON.stringify(validResults), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        console.error(`[API] Karşılaştırma hatası:`, err);
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // 2. API: Search BIST Stocks
    if (path === '/api/search') {
      const query = url.searchParams.get('q') || '';
      if (!query || query.length < 2) {
        return new Response(JSON.stringify([]), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      try {
        const cached = cacheGet(`search:${query}`);
        if (cached) return new Response(JSON.stringify(cached), { headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
        log('info', 'search', { query });
        
        const searchResultsRes = await fmpClient.search(query, 'istanbul', 20);
        // Map to Yahoo Finance shape to avoid breaking LLM prompts
        const searchResults = {
          quotes: searchResultsRes.map(r => ({ symbol: r.symbol, shortname: r.name, longname: r.name, exchange: r.exchangeShortName }))
        };

        const allResults = (searchResults.quotes || [])
          .filter((q: any) => typeof q?.symbol === 'string')
          .map((q: any) => {
            const symbol: string = q.symbol;
            const isBist = symbol.endsWith('.IS') || q.exchange === 'IST';
            const market = isBist ? 'BIST' : symbol.includes('=X') ? 'FX' : symbol.includes('-USD') ? 'CRYPTO' : 'US';
            return {
              ticker: isBist ? symbol.split('.')[0] : symbol,
              symbol,
              name: q.shortname || q.longname || symbol,
              exchange: q.exchange,
              market
            };
          });

        cacheSet(`search:${query}`, allResults, 1000 * 60 * 10); // 10 mins
        return new Response(JSON.stringify(allResults), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        console.error(`[API] Arama hatası:`, err);
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // 2.5. API: AI Fund Creation & Recommendations
    if (path === '/api/ai-fund') {
      const theme = url.searchParams.get('theme');
      if (!theme) {
        return new Response(JSON.stringify({ error: 'Fon teması (theme) parametresi zorunludur' }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      const authErr = requireApiKey();
      if (authErr) return authErr;

      try {
        console.log(`[API] AI Fon Önerisi oluşturuluyor Tema: "${theme}"`);
        
        const prompt = `
Kullanıcı senden belirli bir temaya veya yatırım amacına yönelik bir Yatırım Fonu sepeti oluşturmanı ve mevcut TEFAS yatırım fonlarını önermeni istiyor.

Kullanıcının İstediği Fon Teması/Amacı: "${theme}"

Lütfen aşağıdaki kurallara harfiyen uyarak detaylı bir analiz ve öneri raporu hazırla:

1. **Özel Hisse Portföyü (Custom BIST Fund):**
   - Bu temaya en uygun Borsa İstanbul (BIST) hisse senetlerinden oluşan 5 ile 8 hisselik özel bir portföy oluştur.
   - Her hisse için % cinsinden portföy ağırlığı belirle (Toplamı %100 olmalı).
   - Hisselerin neden seçildiğini birer cümleyle çok net açıkla.

2. **Gerçek TEFAS Fonu Önerileri (Existing Mutual Funds):**
   - Türkiye'de işlem gören gerçek TEFAS yatırım fonlarından (örn: AFT, MAC, YAY, IPB, TI3 vb.) bu temaya en uygun 2 veya 3 tanesini öner.
   - Bu fonların neden uygun olduğunu belirt.

3. **Risk Analizi ve Uyarılar:**
   - Seçilen stratejinin risklerini belirt.
   - Yazının en sonunda mutlaka "Bu bir yatırım tavsiyesi değildir." uyarısına yer ver.

Yanıtını çok şık ve temiz bir **markdown** formatında, listeler, başlıklar ve kalın yazılar kullanarak oluştur. Hisse kodlarını (ticker) \`THYAO\` gibi değil, normal kalın yazı ve parantez ile **(THYAO)** şeklinde yazabilirsin veya link formatında yazabilirsin.
        `;

        const result = await callLlm(prompt, {
          model: 'deepseek-v4-pro',
          systemPrompt: 'Sen üst düzey, profesyonel bir BIST ve TEFAS Portföy Yöneticisisin. Müşterilerine stratejik, analitik ve risksiz portföy sepetleri tasarlarsın.'
        });

        return new Response(JSON.stringify({ recommendation: result.response }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        console.error(`[API] AI Fon Önerisi hatası:`, err);
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    // 2.6. API: KAP Disclosures (Tavily üzerinden filtrelenmiş)
    if (path === '/api/kap') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) return new Response(JSON.stringify({error:'ticker zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      try {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey || apiKey.startsWith('your-')) {
          return new Response(JSON.stringify({disclosures: [], note: 'TAVILY_API_KEY tanımlı değil — KAP verisi yok'}), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
        }
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            api_key: apiKey,
            query: `site:kap.org.tr ${ticker} özel durum açıklaması bildirim`,
            search_depth: 'basic',
            max_results: 10,
            include_domains: ['kap.org.tr']
          })
        });
        const data = await response.json() as any;
        const disclosures = (data.results || []).map((r: any) => ({
          title: r.title,
          url: r.url,
          snippet: r.content?.slice(0, 200) || '',
          publishedDate: r.published_date || null
        }));
        return new Response(JSON.stringify({ticker, disclosures}), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch (err) {
        return new Response(JSON.stringify({error:(err as Error).message, disclosures:[]}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
    }

    // 2.65. API: Dividends history
    if (path === '/api/dividends') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) return new Response(JSON.stringify({error:'ticker zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      try {
        const symbol = ticker.endsWith('.IS') ? ticker : `${ticker}.IS`;
        
        const end = new Date();
        const start = new Date(); start.setFullYear(end.getFullYear() - 5);
        const divResult = await fmpClient.dividends(symbol);
        const result: any = { events: { dividends: divResult?.historical?.reduce((acc: any, d: any) => { acc[new Date(d.date).getTime()/1000] = { amount: d.adjDividend }; return acc; }, {}) || {} } };
        const dividends = (result.events?.dividends || []).map((d: any) => ({
          date: d.date,
          amount: d.amount
        })).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return new Response(JSON.stringify({ticker, dividends}), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch (err) {
        return new Response(JSON.stringify({error:(err as Error).message, dividends:[]}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
    }

    // 2.66. API: Stock Screener
    if (path === '/api/screener') {
      try {
        const minPE = parseFloat(url.searchParams.get('minPE') || '-999999');
        const maxPE = parseFloat(url.searchParams.get('maxPE') || '999999');
        const minPB = parseFloat(url.searchParams.get('minPB') || '-999999');
        const maxPB = parseFloat(url.searchParams.get('maxPB') || '999999');
        const minRevGrowth = parseFloat(url.searchParams.get('minRevGrowth') || '-999999');
        
        const BIST_TICKERS = ['THYAO','TUPRS','KCHOL','AKBNK','ASELS','BIMAS','EREGL','ISCTR','SAHOL','YKBNK','GARAN','SISE','FROTO','PGSUS','TOASO','TCELL','SASA','HEKTS','TTKOM','ALARK','MGROS','DOAS','KRDMD','KOZAL','PETKM','ENJSA','ASTOR','EKGYO','TTRAK','VAKBN','GUBRF','OYAKC','KORDS','SOKM','VESBE','ARCLK','ODAS','KMPUR','HALKB','ENKAI'];
        
        const results = await Promise.all(BIST_TICKERS.map(async t => {
          try {
            const d = await fetchBISTData(t);
            return {
              ticker: d.ticker,
              companyName: d.companyName,
              currentPrice: d.currentPrice,
              trailingPE: d.multiples?.trailingPE,
              priceToBook: d.multiples?.priceToBook,
              evToEbitda: d.multiples?.evToEbitda,
              revenueGrowthYoY: d.scorecard?.revenueGrowthYoY,
              netIncomeGrowthYoY: d.scorecard?.netIncomeGrowthYoY,
              ebitdaGrowthYoY: d.scorecard?.ebitdaGrowthYoY,
            };
          } catch { return null; }
        }));
        
        const filtered = results
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .filter(r => {
            if (r.trailingPE != null) { if (r.trailingPE < minPE || r.trailingPE > maxPE) return false; }
            else if (minPE > -999999 || maxPE < 999999) return false;
            if (r.priceToBook != null) { if (r.priceToBook < minPB || r.priceToBook > maxPB) return false; }
            else if (minPB > -999999 || maxPB < 999999) return false;
            if (r.revenueGrowthYoY != null && r.revenueGrowthYoY < minRevGrowth) return false;
            return true;
          });
        
        return new Response(JSON.stringify({count: filtered.length, results: filtered}), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch (err) {
        return new Response(JSON.stringify({error:(err as Error).message}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
    }

    if (path === '/api/heatmap') {
      try {
        const cached = cacheGet('heatmap');
        if (cached) return new Response(JSON.stringify(cached), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});

        const bist30Symbols = ['AKBNK.IS','ALARK.IS','ARCLK.IS','ASELS.IS','ASTOR.IS','BIMAS.IS','BRSAN.IS','CWDEN.IS','ENKAI.IS','EREGL.IS','FROTO.IS','GARAN.IS','GUBRF.IS','HEKTS.IS','ISCTR.IS','KCHOL.IS','KONTR.IS','KOZAL.IS','KOZAA.IS','KRDMD.IS','MIATK.IS','ODAS.IS','OYAKC.IS','PETKM.IS','PGSUS.IS','SAHOL.IS','SASA.IS','SISE.IS','TCELL.IS','THYAO.IS','TOASO.IS','TUPRS.IS','YKBNK.IS'];
        
        
        const quotes = await Promise.all(
          bist30Symbols.map(async (sym) => {
            const bare = sym.replace('.IS','');
            // 1) FMP dene
            try {
              const qRes = await fmpClient.quote(sym);
              const q: any = qRes && qRes.length > 0 ? qRes[0] : null;
              if (q && q.price) {
                return {
                  ticker: bare,
                  companyName: q.name || bare,
                  change: q.changesPercentage ?? 0,
                  price: q.price ?? 0,
                  marketCap: q.marketCap ?? 0
                };
              }
            } catch { /* FMP fallback */ }

            // 2) İş Yatırım fallback
            try {
              const iy = await fetchIsYatirimQuote(bare);
              if (iy && iy.price) {
                return {
                  ticker: bare,
                  companyName: bare,
                  change: iy.change ?? 0,
                  price: iy.price,
                  marketCap: iy.marketCap ?? 0
                };
              }
            } catch { /* her iki kaynak da başarısız */ }

            return null;
          })
        );
        const results = quotes.filter(q => q !== null);
        // Boş sonucu cache'leme — geçici hata 5 dk boyunca heatmap'i boş bırakmasın
        if (results.length > 0) cacheSet('heatmap', results, 5 * 60 * 1000);
        return new Response(JSON.stringify(results), {headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch (err) {
        return new Response(JSON.stringify({error:(err as Error).message}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
    }

    // 2.7. API: Market Summary (Top Bar)
    if (path === '/api/market-summary') {
      try {
        const cached = cacheGet('market-summary');
        if (cached) return new Response(JSON.stringify(cached), { headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
        
        const tickers = ['XU100.IS', 'TRY=X', 'EURTRY=X'];
        const promises = tickers.map(t => fmpClient.quote(t).catch(() => null));
        const results = await Promise.all(promises);
        
        const validQuotes = results
          .filter((q: any) => q && q.length > 0)
          .map((q: any) => q[0]);

        const summary = {
          xu100: validQuotes[0] ? { price: validQuotes[0].price, change: validQuotes[0].changesPercentage } : null,
          usdtry: validQuotes[1] ? { price: validQuotes[1].price, change: validQuotes[1].changesPercentage } : null,
          eurtry: validQuotes[2] ? { price: validQuotes[2].price, change: validQuotes[2].changesPercentage } : null,
        };

        cacheSet('market-summary', summary, 1000 * 60); // 1 minute
        return new Response(JSON.stringify(summary), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }

    if (path === '/api/backtest' && req.method === 'POST') {
      try {
        const body = await req.json() as { ticker: string, strategy: string, years: number };
        const ticker = body.ticker || 'THYAO';
        const years = body.years || 1;
        const strategy = body.strategy || 'sma';

        
        const period1 = new Date();
        const start = new Date(); start.setDate(start.getDate() - (years * 365));
        const yfResult = await (yahooFinance as any).historical(ticker + '.IS', { period1: start, period2: new Date(), interval: '1d' }).catch(() => []);
        const history = yfResult;

        if (!history || history.length === 0) throw new Error('Veri bulunamadı.');

        let initialCapital = 100000;
        let capital = initialCapital;
        let position = 0;
        
        const resultData = [];
        const initialPrice = history[0].close;
        const baselineShares = initialCapital / initialPrice;

        let smas: any[] = [];
        if (strategy === 'sma') {
           for (let i = 0; i < history.length; i++) {
             const sma20 = history.slice(Math.max(0, i-20), i+1).reduce((s: number, d: any) => s + d.close, 0) / Math.min(20, i+1);
             const sma50 = history.slice(Math.max(0, i-50), i+1).reduce((s: number, d: any) => s + d.close, 0) / Math.min(50, i+1);
             smas.push({ sma20, sma50 });
           }
        }

        for (let i = 0; i < history.length; i++) {
           const price = history[i].close;
           const date = history[i].date.toISOString().slice(0, 10);
           
           if (strategy === 'sma' && i > 50) {
              const prev = smas[i-1];
              const curr = smas[i];
              if (prev.sma20 <= prev.sma50 && curr.sma20 > curr.sma50 && position === 0) {
                 position = capital / price;
                 capital = 0;
              }
              else if (prev.sma20 >= prev.sma50 && curr.sma20 < curr.sma50 && position > 0) {
                 capital = position * price;
                 position = 0;
              }
           }
           
           const currentPortfolioValue = capital + (position * price);
           const currentBaselineValue = baselineShares * price;
           
           resultData.push({
             date,
             Strateji: Math.round(currentPortfolioValue),
             "AlTut": Math.round(currentBaselineValue)
           });
        }
        
        const finalPortfolioValue = capital + (position * history[history.length-1].close);
        const finalBaselineValue = baselineShares * history[history.length-1].close;
        
        const returnPct = ((finalPortfolioValue - initialCapital) / initialCapital) * 100;
        const baselinePct = ((finalBaselineValue - initialCapital) / initialCapital) * 100;

        return new Response(JSON.stringify({
          data: resultData,
          metrics: {
            strategyReturn: returnPct.toFixed(2),
            baselineReturn: baselinePct.toFixed(2)
          }
        }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    }

    if (path === '/api/paper-portfolio' && req.method === 'GET') {
      try {
        let pf;
        if (process.env.ALPACA_API_KEY) {
          const { getAlpacaPortfolio } = await import('./portfolio/alpaca');
          pf = await getAlpacaPortfolio();
        } else {
          const { readPortfolio } = await import('./portfolio/store');
          pf = readPortfolio();
        }
        return new Response(JSON.stringify(pf), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }


    if (path === '/api/paper-trader/run' && req.method === 'POST') {
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };

          try {
            const { spawn } = await import('child_process');
            const bunPath = process.env.BUN_PATH || 'bun';
            const child = spawn(bunPath, ['run', 'scripts/paper-trader.ts'], { cwd: process.cwd() });
            
            child.stdout.on('data', (data: Buffer) => {
              const text = data.toString('utf-8');
              safeEnqueue(`data: ${JSON.stringify({ chunk: text })}\n\n`);
            });
            child.stderr.on('data', (data: Buffer) => {
              const text = data.toString('utf-8');
              safeEnqueue(`data: ${JSON.stringify({ chunk: text })}\n\n`);
            });
            child.on('close', (code: number) => {
              safeEnqueue(`data: [DONE]\n\n`);
              safeClose();
            });
            child.on('error', (err: any) => {
              console.error(err);
              safeEnqueue(`data: ${JSON.stringify({ error: 'Paper-trader çalıştırılamadı.' })}\n\n`);
              safeClose();
            });

            // Handle client disconnect
            req.signal.addEventListener('abort', () => {
              closed = true;
              child.kill('SIGKILL');
            });
          } catch (err: any) {
            console.error(err);
            safeEnqueue(`data: ${JSON.stringify({ error: 'Paper-trader çalıştırılamadı.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (path === '/api/portfolio-optimize' && req.method === 'POST') {
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          try {
            const body = await req.json() as { portfolio: any[] };
            const portfolio = body.portfolio || [];
            
            
            const enrichedPortfolio = await Promise.all(portfolio.map(async (p: any) => {
               try {
                 const qRes = await fmpClient.quote(p.ticker + '.IS');
                 const q: any = qRes && qRes.length > 0 ? qRes[0] : null;
                 return { ...p, currentPrice: q.regularMarketPrice, companyName: q.shortName };
               } catch(e) {
                 return p;
               }
            }));
            
            const prompt = `
Aşağıda kullanıcının mevcut Borsa İstanbul portföyü yer almaktadır:
${JSON.stringify(enrichedPortfolio, null, 2)}

Sen üst düzey bir portföy yöneticisisin. Bu portföyü risk, sektörel çeşitlilik, ağırlıklar ve güncel piyasa koşulları açısından incele.
Raporunu Markdown formatında şu başlıklarla hazırla:
1. Portföy Özeti ve Kârlılık Durumu
2. Risk Analizi ve Çeşitlendirme
3. Güçlü ve Zayıf Yönler
4. Aksiyon Önerileri (Hangi hisselerde ağırlık artırılabilir/azaltılabilir?)
`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST finansal analisti ve portföy yöneticisisin.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-v4-pro', signal: req.signal });

            for await (const chunk of stream) {
              if (req.signal.aborted) break;
              const content = chunk.content;
              if (content) {
                safeEnqueue(`data: ${JSON.stringify({ chunk: content })}\n\n`);
              }
            }
            safeEnqueue(`data: [DONE]\n\n`);
            safeClose();
          } catch (err) {
            safeEnqueue(`data: ${JSON.stringify({ error: 'İşlem sırasında bir hata oluştu.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (path === '/api/sentiment') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) {
        return new Response(JSON.stringify({ error: 'Ticker required' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      try {
        const query = `Borsa İstanbul ${ticker} hissesi güncel haberler sosyal medya analiz yorumları`;
        log('info', 'tavily_search_sentiment', { query });
        const searchResults = await searchTavily(query);
        
        const prompt = `Sen finansal bir duyarlılık analizi yapan yapay zekasın. Yalnızca JSON formatında yanıt verirsin. Aşağıda ${ticker} hissesiyle ilgili internetten toplanan son güncel haberler ve yorumlar yer almaktadır:\n\n${searchResults}\n\nYukarıdaki metni analiz et ve yatırımcıların bu hisse hakkındaki genel hissiyatını bul. JSON formatında şu anahtarları içeren bir yanıt döndür:\n- score (0 ile 100 arası bir sayı. 0 tam panik/negatif, 100 tam coşku/pozitif, 50 nötr)\n- summary (Bu skorun nedenini açıklayan 2-3 cümlelik çok net bir özet.)\n\nSADECE JSON YANITI VER, BAŞKA METİN YAZMA. Örn: {"score": 75, "summary": "Şirketin aldığı yeni ihaleler yatırımcılar arasında pozitif karşılandı."}`;
        
        const result = await callLlm(prompt, { model: 'deepseek-chat' });
        const responseText = typeof result.response === 'string' 
          ? result.response 
          : (result.response as any)?.content ?? String(result.response);
        
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : responseText;

        return new Response(jsonStr, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    }

    if (path === '/api/dividend-planner' && req.method === 'POST') {
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          try {
            const body = await req.json() as { portfolio: any[], monthlyAddition: number };
            const portfolio = body.portfolio || [];
            
            const prompt = `Aşağıda kullanıcının Borsa İstanbul hisse portföyü ve aylık ekleyebileceği tasarruf miktarı yer almaktadır:
Portföy: ${JSON.stringify(portfolio, null, 2)}
Aylık Eklenecek Tutar: ${body.monthlyAddition} TL

Sen uzman bir Temettü Emekliliği Planlayıcısısın (AI Dividend Planner). BIST şirketlerinin geçmiş temettü verimlerini ve büyüme potansiyellerini hesaba katarak, bu yatırımcı için 5, 10 ve 20 yıllık bir temettü projeksiyonu çiz. 
Raporu Markdown formatında hazırla. Özellikle şunlara değin:
1. Portföydeki hisselerin temettü potansiyelleri (Temettü şampiyonları var mı?)
2. Aylık eklemelerle birlikte bileşik getirinin (kartopu etkisinin) gücü.
3. 5, 10 ve 20 yıl sonra tahmini ulaşılacak pasif aylık temettü geliri.
4. Çeşitlendirme tavsiyeleri (Sadece eregl, froto vb. mi var?).`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST Temettü Emeklilik analistisin.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-v4-pro', signal: req.signal });

            for await (const chunk of stream) {
              if (req.signal.aborted) break;
              const content = chunk.content;
              if (content) {
                safeEnqueue(`data: ${JSON.stringify({ chunk: content })}\n\n`);
              }
            }
            safeEnqueue(`data: [DONE]\n\n`);
            safeClose();
          } catch (err) {
            safeEnqueue(`data: ${JSON.stringify({ error: 'İşlem sırasında bir hata oluştu.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (path === '/api/macro-analysis') {
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          try {
            const currentDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
            const query = `Türkiye makroekonomi ${currentDate} güncel enflasyon TCMB faiz kararı dolar kuru beklentileri borsa istanbul etkisi`;
            log('info', 'tavily_search', { query });
            const searchResults = await searchTavily(query);
            
            const prompt = `Bugünün tarihi: ${currentDate}. Aşağıda Türkiye ekonomisi ve TCMB faiz kararlarıyla ilgili en güncel haber ve veriler var:\n\n${searchResults}\n\nSen uzman bir makroekonomist ve fon yöneticisisin. "Makroekonomi & Merkez Bankası Raporu (${currentDate})" başlığı altında, güncel enflasyon, faiz oranları ve döviz kuru durumunu analiz et. Borsa İstanbul'daki farklı sektörlere (Bankacılık, Sanayi, İhracatçılar vb.) olası etkilerini maddeler halinde açıkla. Lütfen raporda tarihin ${currentDate} olduğunu belirt ve eski ayların (örneğin Mart) verilerini geçmiş veriler olarak değerlendirip, odak noktanı tam olarak içinde bulunduğumuz ${currentDate} dönemine ve beklentilerine ver. Raporu okunaklı bir Markdown formatında yaz.`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir makroekonomistsin.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-v4-pro', signal: req.signal });

            for await (const chunk of stream) {
              if (req.signal.aborted) break;
              const content = chunk.content;
              if (content) {
                safeEnqueue(`data: ${JSON.stringify({ chunk: content })}\n\n`);
              }
            }
            safeEnqueue(`data: [DONE]\n\n`);
            safeClose();
          } catch (err) {
            safeEnqueue(`data: ${JSON.stringify({ error: 'İşlem sırasında bir hata oluştu.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (path === '/api/alerts/parse' && req.method === 'POST') {
      const authErr = requireApiKey();
      if (authErr) return authErr;
      try {
        const body = await req.json() as { query: string };
        if (!body.query) throw new Error('Query required');
        
        const prompt = `Kullanıcının yazdığı doğal dildeki borsa alarm cümlesini analiz et. SADECE JSON formatında yanıt ver. 
Format: {"ticker": "HİSSE KODU (örn: THYAO)", "condition": "above" VEYA "below", "price": SAYISAL_FIYAT}
Eğer kullanıcı hisse adını yazmışsa, BIST koduna çevir (örn: Türk Hava Yolları -> THYAO). Fiyat virgüllüyse noktaya çevir.
Kullanıcı metni: "${body.query}"`;

        const result = await callLlm(prompt, { model: 'deepseek-chat' });
        const responseText = typeof result.response === 'string'
          ? result.response
          : (result.response as any)?.content ?? String(result.response);
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
        return new Response(jsonStr, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
    }

    if (path === '/api/peer-compare') {
      const ticker = url.searchParams.get('ticker');
      if (!ticker) {
        return new Response(JSON.stringify({ error: 'Ticker required' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          try {
            const query = `Borsa İstanbul ${ticker} şirketi sektörü ve en büyük 3 rakibi, güncel kıyaslamaları ve pazar payı`;
            log('info', 'tavily_search', { query });
            const searchResults = await searchTavily(query);
            
            const prompt = `Aşağıda ${ticker} şirketi ve rakipleriyle ilgili arama sonuçları var:\n\n${searchResults}\n\nSen bir BİST analistisin. ${ticker} hissesi için "Akıllı Sektör & Rakip Kıyaslaması" raporu hazırla. Önce şirketin sektördeki en büyük 3 rakibini belirle, sonra büyüme, kârlılık, pazar payı ve beklentiler açısından kıyasla. Raporu Markdown formatında ve karşılaştırmalı maddeler halinde akıcı bir şekilde yaz.`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST finansal analistisin.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-v4-pro', signal: req.signal });

            for await (const chunk of stream) {
              if (req.signal.aborted) break;
              const content = chunk.content;
              if (content) {
                safeEnqueue(`data: ${JSON.stringify({ chunk: content })}\n\n`);
              }
            }
            safeEnqueue(`data: [DONE]\n\n`);
            safeClose();
          } catch (err) {
            safeEnqueue(`data: ${JSON.stringify({ error: 'İşlem sırasında bir hata oluştu.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    if (path === '/api/kap-news') {
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          const encoder = new TextEncoder();
          /* closed flag moved out */
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          try {
            const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
            const query = `Borsa İstanbul güncel KAP (Kamuyu Aydınlatma Platformu) bildirimleri ve şirket haberleri ${today}`;
            log('info', 'tavily_search', { query });
            // topic=news + days=3 → sadece son günlerin haberleri (eski tarihli sonuçları ele)
            const searchResults = await searchTavily(query, { topic: 'news', days: 3 });

            const prompt = `
Bugünün tarihi: ${today}.

Aşağıda internetten derlenen Borsa İstanbul güncel KAP bildirimleri ve önemli şirket haberleri yer almaktadır:
${searchResults}

Sen uzman bir finansal analistsin. Bu haberleri inceleyerek Borsa İstanbul yatırımcıları için kısa ve çok net bir özet rapor hazırla. Sadece piyasayı etkileyebilecek (temettü, bedelsiz, yeni ihale, birleşme, kâr açıklaması vb.) olaylara odaklan. Uzun ve gereksiz metinleri at.

ÖNEMLİ KURALLAR:
- Raporun başlığı "${today} — Önemli KAP Bildirimleri" olsun. Başlıkta MUTLAKA bugünün tarihini (${today}) kullan; haber metinlerindeki eski tarihleri başlık olarak ASLA kullanma.
- Her bildirimin kendi yayın tarihi biliniyorsa, ilgili maddenin yanında parantez içinde belirt.
- Yalnızca son birkaç günün gelişmelerini dahil et; çok eski haberleri atla.
Markdown formatında hazırla.
`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST finansal analisti ve haber editörüsün.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-chat', signal: req.signal });

            for await (const chunk of stream) {
              if (req.signal.aborted) break;
              const content = chunk.content;
              if (content) {
                safeEnqueue(`data: ${JSON.stringify({ chunk: content })}\n\n`);
              }
            }
            safeEnqueue(`data: [DONE]\n\n`);
            safeClose();
          } catch (err) {
            safeEnqueue(`data: ${JSON.stringify({ error: 'İşlem sırasında bir hata oluştu.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // 3. API: Advanced AI Chat with Efekt Agent (SSE)
    if (path === '/api/chat' && req.method === 'POST') {
      let closed = false; return new Response(new ReadableStream({
        cancel() { closed = true; },
        async start(controller) {
          /* closed flag moved out */
          const encoder = new TextEncoder();
          const safeEnqueue = (s: string) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
          const safeClose   = () => { if (closed) return; closed = true; try { controller.close(); } catch {} };
          try {
            const body = await req.json() as { query?: string, sessionId?: string, model?: string, context?: string, history?: { role: string, content: string }[] };
            const query = body.query;
            const contextStr = body.context;
            const historyData = body.history;
            const sessionId = body.sessionId || 'default';
            const selectedModel = body.model || 'deepseek-v4-pro';
            if (!query) {
              safeEnqueue(`data: ${JSON.stringify({ type: 'error', error: 'Query is required' })}\n\n`);
              safeClose();
              return;
            }

            const actionPrompt = `[DASHBOARD AKSİYONLARI] Kullanıcı NET olarak isterse şu tool'ları çağır: open_deep_report (derin DCF raporu), open_compare (2+ hisse kıyas), open_portfolio_analysis (portföy), open_kap_news (günün KAP). Belirsizse çağırma, sor.`;
            const finalQuery = contextStr ? `[EK BİLGİ - Kullanıcının Ekranındaki Veriler:\n${contextStr}]\n\n${actionPrompt}\n\nKullanıcı Sorusu: ${query}` : `${actionPrompt}\n\nKullanıcı Sorusu: ${query}`;

            const { pairChatMessages } = await import('./utils/chat-history-seed');
            const history = new InMemoryChatHistory(selectedModel, 15);
            if (Array.isArray(historyData)) {
              history.seedCompletedTurns(pairChatMessages(historyData));
            }
            touchSession(sessionId);
            
            // Lazy import
            const { Agent } = await import('./agent/agent');
            const { DASHBOARD_ACTION_TOOLS, DASHBOARD_ACTION_TOOL_NAMES } = await import('./tools/dashboard/index');
            const { mapActionEvent } = await import('./utils/dashboard-action-event');

            
            const agent = await Agent.create({
              model: selectedModel,
              memoryEnabled: false,
              signal: req.signal,
              extraTools: DASHBOARD_ACTION_TOOLS,
              allowedToolNames: ['get_financials', 'get_market_data', 'read_filings', 'screen_stocks', 'web_search'],
            });

            let fullAnswer = '';

            for await (const event of agent.run(finalQuery, history)) {
              if (req.signal.aborted) break;
              if (event.type === 'thinking') {
                safeEnqueue(`data: ${JSON.stringify({ type: 'thinking', message: event.message })}\n\n`);
              } else if (event.type === 'tool_start') {
                safeEnqueue(`data: ${JSON.stringify({ type: 'tool_start', tool: event.tool, args: event.args })}\n\n`);
                if (DASHBOARD_ACTION_TOOL_NAMES.has(event.tool)) {
                  const actionEvent = mapActionEvent(event.tool, event.args);
                  if (actionEvent) {
                    safeEnqueue(`data: ${JSON.stringify(actionEvent)}\n\n`);
                  }
                }
              } else if (event.type === 'done') {
                fullAnswer = event.answer || '';
                safeEnqueue(`data: ${JSON.stringify({ type: 'done', answer: event.answer })}\n\n`);
              } else if (event.type === 'stream_progress') {
                // If stream progress wants to be sent
              }
            }


            safeClose();
          } catch (err: any) {
            console.error('[API] Chat error:', err);
            safeEnqueue(`data: ${JSON.stringify({ type: 'error', error: 'İşlem sırasında bir hata oluştu.' })}\n\n`);
            safeClose();
          }
        }
      }), {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Serve Static Dashboard — sadece Bun runtime'da (Vercel'da static Vercel tarafından servis edilir)
    const isBunRuntime = typeof (globalThis as any).Bun !== 'undefined';
    if (isBunRuntime) {
      let filePath = join(DIST_DIR, path === '/' ? 'index.html' : path);
      let file = (globalThis as any).Bun.file(filePath);

      // SPA fallback
      if (!(await file.exists())) {
        filePath = join(DIST_DIR, 'index.html');
        file = (globalThis as any).Bun.file(filePath);
      }

      if (await file.exists()) {
        const isHashedAsset = filePath.includes('/assets/') && /-[a-zA-Z0-9]{6,}\.(js|css)$/.test(filePath);
        return new Response(file, {
          headers: isHashedAsset
            ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
            : { 'Cache-Control': 'no-cache' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
}

// Bun runtime ise Bun.serve başlat (Render + local).
if (typeof (globalThis as any).Bun !== 'undefined' && (globalThis as any).Bun.serve) {
  console.log(`===================================================`);
  console.log(`🚀 BIST Fintables Dashboard Server starting...`);
  console.log(`===================================================`);
  const server = (globalThis as any).Bun.serve({
    port: PORT,
    idleTimeout: 120,
    fetch: fetchHandler,
  });
  console.log(`🌐 Server running at: http://localhost:${server.port}`);
  console.log(`📁 Static files served from: ${DIST_DIR}`);
}

// NOT: Sunucu açılışında Yahoo'ya toplu istek atan warm-up bilerek devre dışı.
// Önceki sürümde 10 ticker'lık warm-up datacenter IP'sini Yahoo'nun kalıcı
// kara listesine sokuyordu. İstekler artık ihtiyaç olduğunda lazy yapılır
// ve 429 durumunda İş Yatırım fallback'i + stale-cache devreye girer.
