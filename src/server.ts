import { join } from 'path';
import { fetchBISTData } from './utils/bist-data.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { checkEnv } from './utils/env-check.js';
import { yahooFinance as yf, yahooFinance } from './utils/yahoo.js';

checkEnv();
import { callLlm, streamLlmWithMessages } from './model/llm.js';
import { Agent } from './agent/agent.js';
import { InMemoryChatHistory } from './utils/in-memory-chat-history.js';

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

async function searchTavily(query: string): Promise<string> {
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
        max_results: 5
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
        const end = new Date();
        const start = new Date();
        const days = range === '1m' ? 30 : range === '3m' ? 90 : range === '6m' ? 180 : range === '1y' ? 365 : 1825;
        start.setDate(end.getDate() - days);
        
        const history = await yf.chart(symbol, { period1: start, period2: end, interval: '1d' });
        const points = (history.quotes || [])
          .filter((q: any) => typeof q.close === 'number' && typeof q.open === 'number')
          .map((q: any) => ({
            date: q.date,
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume
          }));
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
        const history = await yf.chart(symbol, { period1: start, period2: end, interval: '1d' });
        const closes = history.quotes.map(q => q.close).filter((v): v is number => typeof v === 'number');
        const { computeTechnicalIndicators } = await import('./utils/technical-indicators.js');
        const bars = closes.map((c, i) => ({ date: `day${i}`, close: c }));
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
          
          const quote: any = await yf.quote(ticker);
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

    // 1.2. API: Yabancı varlık (ABD hisse, döviz, kripto)
    if (path === '/api/asset') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) return new Response(JSON.stringify({error:'symbol zorunlu'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      try {
        
        const quote: any = await yf.quote(symbol);
        return new Response(JSON.stringify({
          ticker: symbol,
          companyName: quote.longName || quote.shortName || symbol,
          currentPrice: quote.regularMarketPrice,
          marketCap: quote.marketCap || null,
          currency: quote.currency || 'USD',
          change: quote.regularMarketChangePercent || 0,
          dayHigh: quote.regularMarketDayHigh,
          dayLow: quote.regularMarketDayLow,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
          volume: quote.regularMarketVolume,
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
      
      return new Response(new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            const startTime = Date.now();
            log('info', 'ai-analysis', { ticker });
            const financials = await fetchBISTData(ticker);
            
            const query = `${financials.companyName} (${ticker}) hisse son dakika haberleri gelişmeleri`;
            log('info', 'tavily_search', { query });
            const searchResults = await searchTavily(query);
            
            const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
            const prompt = `
Aşağıda Borsa İstanbul'da işlem gören ${financials.companyName} (${financials.ticker}) şirketine ait en güncel finansal veriler ve internetten derlenen son haberler yer almaktadır.

Lütfen raporunun tam en başına hazırlayan bilgisini ve rapor tarihini şu şekilde ekle:
Hazırlayan: BIST Finansal Analisti & Portföy Yöneticisi
Tarih: ${today}

### HİSSE PİYASA VERİLERİ:
- Güncel Fiyat: ${financials.currentPrice} TRY
- Piyasa Değeri: ${financials.marketCap}
- F/K Oranı: ${financials.trailingPE || 'Veri Yok'}
- PD/DD Oranı: ${financials.priceToBook || 'Veri Yok'}
- FD/FAVÖK Oranı: ${financials.evToEbitda || 'Veri Yok'}

### ÇEYREKLİK PERFORMANS DEĞİŞİMLERİ (Fintables Karnesi):
- Satışlar Çeyreklik Büyüme (QoQ): ${financials.scorecard.revenueGrowthQoQ?.toFixed(1) || 'Veri Yok'}%
- Satışlar Yıllık Büyüme (YoY): ${financials.scorecard.revenueGrowthYoY?.toFixed(1) || 'Veri Yok'}%
- FAVÖK Çeyreklik Büyüme (QoQ): ${financials.scorecard.ebitdaGrowthQoQ?.toFixed(1) || 'Veri Yok'}%
- FAVÖK Yıllık Büyüme (YoY): ${financials.scorecard.ebitdaGrowthYoY?.toFixed(1) || 'Veri Yok'}%
- Net Kâr Çeyreklik Büyüme (QoQ): ${financials.scorecard.netIncomeGrowthQoQ?.toFixed(1) || 'Veri Yok'}%
- Net Kâr Yıllık Büyüme (YoY): ${financials.scorecard.netIncomeGrowthYoY?.toFixed(1) || 'Veri Yok'}%

### İNTERNETTEN ALINAN SON HABERLER / GELİŞMELER:
${searchResults}

### GÖREV:
Bu verileri ve haberleri detaylıca analiz et. Şunları içeren profesyonel bir Türkçe analiz raporu yaz:
1. **Finansal Sağlık Değerlendirmesi:** Gelir tablosu, büyüme oranları ve çarpanların (F/K, PD/DD) durumunu yorumla.
2. **Haber ve Gelişmelerin Yorumu:** İnternetten derlenen haberlerin hisse üzerindeki olumlu/olumsuz etkilerini analiz et.
3. **Gelecek Beklentisi ve Tahmin:** Şirketin önümüzdeki dönemdeki performansı ve hisse senedinin yönü hakkında profesyonel, objektif bir tahminde bulun. Yatırım tavsiyesi olmadığını belirt.

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
            ], { model: 'deepseek-chat' });

            for await (const chunk of stream) {
              const content = chunk.content;
              if (typeof content === 'string' && content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ analysisChunk: content })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
            log('info', 'ai-analysis_done', { ticker, durationMs: Date.now() - startTime });
          } catch (err) {
            log('error', 'ai-analysis_error', { error: (err as Error).message });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
            controller.close();
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
        
        const searchResults = await yahooFinance.search(query, {
          quotesCount: 8,
          newsCount: 0,
        });

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
        const result: any = await yf.chart(symbol, { period1: start, period2: end, interval: '1d', events: 'div' });
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
              trailingPE: d.trailingPE,
              priceToBook: d.priceToBook,
              evToEbitda: d.evToEbitda,
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
            try {
              const q = await yahooFinance.quote(sym);
              return {
                ticker: sym.replace('.IS',''),
                companyName: q.shortName || sym,
                change: q.regularMarketChangePercent || 0,
                price: q.regularMarketPrice || 0,
                marketCap: q.marketCap || 0
              };
            } catch { return null; }
          })
        );
        const results = quotes.filter(q => q !== null);
        cacheSet('heatmap', results, 5 * 60 * 1000);
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
        const promises = tickers.map(t => yahooFinance.quote(t).catch(() => null));
        const results = await Promise.all(promises);
        
        const summary = {
          xu100: results[0] ? { price: results[0].regularMarketPrice, change: results[0].regularMarketChangePercent } : null,
          usdtry: results[1] ? { price: results[1].regularMarketPrice, change: results[1].regularMarketChangePercent } : null,
          eurtry: results[2] ? { price: results[2].regularMarketPrice, change: results[2].regularMarketChangePercent } : null,
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
        period1.setFullYear(period1.getFullYear() - years);
        
        const history = await yahooFinance.historical(ticker + '.IS', {
          period1: period1,
          interval: '1d'
        });

        if (!history || history.length === 0) throw new Error('Veri bulunamadı.');

        let initialCapital = 100000;
        let capital = initialCapital;
        let position = 0;
        
        const resultData = [];
        const initialPrice = history[0].close;
        const baselineShares = initialCapital / initialPrice;

        let smas = [];
        if (strategy === 'sma') {
           for (let i = 0; i < history.length; i++) {
             const slice20 = history.slice(Math.max(0, i-20), i+1);
             const slice50 = history.slice(Math.max(0, i-50), i+1);
             const sma20 = slice20.reduce((s, d) => s + d.close, 0) / slice20.length;
             const sma50 = slice50.reduce((s, d) => s + d.close, 0) / slice50.length;
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

    if (path === '/api/portfolio-optimize' && req.method === 'POST') {
      const authErr = requireApiKey();
      if (authErr) return authErr;
      
      return new Response(new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            const body = await req.json() as { portfolio: any[] };
            const portfolio = body.portfolio || [];
            
            
            const enrichedPortfolio = await Promise.all(portfolio.map(async (p: any) => {
               try {
                 const q = await yahooFinance.quote(p.ticker + '.IS');
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
            ], { model: 'deepseek-v4-pro' });

            for await (const chunk of stream) {
              const content = chunk.content;
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
            controller.close();
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
      
      return new Response(new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
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
            ], { model: 'deepseek-v4-pro' });

            for await (const chunk of stream) {
              const content = chunk.content;
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
            controller.close();
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
      
      return new Response(new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            const currentDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
            const query = `Türkiye makroekonomi ${currentDate} güncel enflasyon TCMB faiz kararı dolar kuru beklentileri borsa istanbul etkisi`;
            log('info', 'tavily_search', { query });
            const searchResults = await searchTavily(query);
            
            const prompt = `Bugünün tarihi: ${currentDate}. Aşağıda Türkiye ekonomisi ve TCMB faiz kararlarıyla ilgili en güncel haber ve veriler var:\n\n${searchResults}\n\nSen uzman bir makroekonomist ve fon yöneticisisin. "Makroekonomi & Merkez Bankası Raporu (${currentDate})" başlığı altında, güncel enflasyon, faiz oranları ve döviz kuru durumunu analiz et. Borsa İstanbul'daki farklı sektörlere (Bankacılık, Sanayi, İhracatçılar vb.) olası etkilerini maddeler halinde açıkla. Lütfen raporda tarihin ${currentDate} olduğunu belirt ve eski ayların (örneğin Mart) verilerini geçmiş veriler olarak değerlendirip, odak noktanı tam olarak içinde bulunduğumuz ${currentDate} dönemine ve beklentilerine ver. Raporu okunaklı bir Markdown formatında yaz.`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir makroekonomistsin.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-v4-pro' });

            for await (const chunk of stream) {
              const content = chunk.content;
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
            controller.close();
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
      
      return new Response(new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            const query = `Borsa İstanbul ${ticker} şirketi sektörü ve en büyük 3 rakibi, güncel kıyaslamaları ve pazar payı`;
            log('info', 'tavily_search', { query });
            const searchResults = await searchTavily(query);
            
            const prompt = `Aşağıda ${ticker} şirketi ve rakipleriyle ilgili arama sonuçları var:\n\n${searchResults}\n\nSen bir BİST analistisin. ${ticker} hissesi için "Akıllı Sektör & Rakip Kıyaslaması" raporu hazırla. Önce şirketin sektördeki en büyük 3 rakibini belirle, sonra büyüme, kârlılık, pazar payı ve beklentiler açısından kıyasla. Raporu Markdown formatında ve karşılaştırmalı maddeler halinde akıcı bir şekilde yaz.`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST finansal analistisin.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-v4-pro' });

            for await (const chunk of stream) {
              const content = chunk.content;
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
            controller.close();
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
      
      return new Response(new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            const today = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
            const query = `Borsa İstanbul güncel KAP (Kamuyu Aydınlatma Platformu) bildirimleri ve şirket haberleri ${today}`;
            log('info', 'tavily_search', { query });
            const searchResults = await searchTavily(query);
            
            const prompt = `
Aşağıda internetten derlenen Borsa İstanbul güncel KAP bildirimleri ve önemli şirket haberleri yer almaktadır:
${searchResults}

Sen uzman bir finansal analistsin. Bu haberleri inceleyerek Borsa İstanbul yatırımcıları için "Günün Önemli KAP Bildirimleri" adında kısa ve çok net bir özet rapor hazırla. Sadece piyasayı etkileyebilecek (temettü, bedelsiz, yeni ihale, birleşme, kâr açıklaması vb.) olaylara odaklan. Uzun ve gereksiz metinleri at.
Markdown formatında hazırla.
`;
            
            const stream = streamLlmWithMessages([
              new SystemMessage('Sen uzman bir BIST finansal analisti ve haber editörüsün.'),
              new HumanMessage(prompt)
            ], { model: 'deepseek-chat' });

            for await (const chunk of stream) {
              const content = chunk.content;
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (err) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`));
            controller.close();
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
      return new Response(new ReadableStream({
        async start(controller) {
          try {
            const body = await req.json() as { query?: string, sessionId?: string, model?: string, context?: string };
            const query = body.query;
            const contextStr = body.context;
            const sessionId = body.sessionId || 'default';
            const selectedModel = body.model || 'deepseek-v4-pro';
            if (!query) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: 'Query is required' })}\n\n`));
              controller.close();
              return;
            }

            const finalQuery = contextStr ? `[EK BİLGİ - Kullanıcının Ekranındaki Veriler:\n${contextStr}]\n\nKullanıcı Sorusu: ${query}` : query;

            if (!chatSessions[sessionId]) {
              chatSessions[sessionId] = new InMemoryChatHistory(selectedModel, 15);
            }
            const history = chatSessions[sessionId];
            touchSession(sessionId);
            
            const agent = await Agent.create({ 
              model: selectedModel,
              memoryEnabled: false // Disable vector DB memory (memory_search) which takes too long, keep chat history only.
            });
            let fullAnswer = '';

            for await (const event of agent.run(finalQuery, history)) {
              if (event.type === 'thinking') {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'thinking', message: event.message })}\n\n`));
              } else if (event.type === 'tool_start') {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'tool_start', tool: event.tool, args: event.args })}\n\n`));
              } else if (event.type === 'done') {
                fullAnswer = event.answer || '';
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'done', answer: event.answer })}\n\n`));
              } else if (event.type === 'stream_progress') {
                // If stream progress wants to be sent
              }
            }

            // Save history
            history.saveUserQuery(query);
            if (fullAnswer) {
              await history.saveAnswer(fullAnswer);
            }

            controller.close();
          } catch (err: any) {
            console.error('[API] Chat error:', err);
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`));
            controller.close();
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

// Bun runtime ise + bu dosya doğrudan çalıştırıldıysa Bun.serve başlat.
// Vercel Functions ortamında fetchHandler api/[[...slug]].ts üzerinden çağrılır;
// Bun yok ya da import edilmişse listen etmemeli (port çakışmasını önler).
const isMain = (import.meta as any).main === true;
if (isMain && typeof (globalThis as any).Bun !== 'undefined' && (globalThis as any).Bun.serve) {
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
