import { join } from 'path';
import { fetchBISTData } from './utils/bist-data.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { checkEnv } from './utils/env-check.js';

checkEnv();
import YahooFinance from 'yahoo-finance2';
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
  if (!process.env.GOOGLE_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({error: 'API_KEY tanımlı değil'}), {
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

console.log(`===================================================`);
console.log(`🚀 BIST Fintables Dashboard Server starting...`);
console.log(`===================================================`);

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
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
        const yf = new YahooFinance({ suppressNotices:['yahooSurvey','ripHistorical'] });
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
        const yf = new YahooFinance({ suppressNotices: ['yahooSurvey','ripHistorical'] });
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
      try {
        if (!rateLimit(req, 20, 60000)) return new Response('Rate limited', {status:429, headers:{'Access-Control-Allow-Origin':'*'}});
        const cached = cacheGet(`analysis:${ticker}`);
        if (cached) return new Response(JSON.stringify(cached), { headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
        const startTime = Date.now();
        log('info', 'analysis', { ticker });
        const data = await fetchBISTData(ticker);
        cacheSet(`analysis:${ticker}`, data, 1000 * 60 * 5); // 5 mins
        log('info', 'analysis_done', { ticker, durationMs: Date.now() - startTime });
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      } catch (err) {
        console.error(`[API] Analiz hatası (${ticker}):`, err);
        return new Response(JSON.stringify({ error: (err as Error).message }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
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
            ], { model: 'gemini-flash-latest' });

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
        const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
        const searchResults = await yahooFinance.search(query, {
          quotesCount: 8,
          newsCount: 0,
        });

        // Filter BIST tickers (ending with .IS or of exchange IST)
        const bistResults = (searchResults.quotes || [])
          .filter((q: any) => typeof q?.symbol === 'string' && (q.symbol.endsWith('.IS') || q.exchange === 'IST'))
          .map((q: any) => {
            const symbol: string = q.symbol;
            return {
              ticker: symbol.split('.')[0],
              symbol,
              name: q.shortname || q.longname || symbol,
              exchange: q.exchange,
            };
          });

        cacheSet(`search:${query}`, bistResults, 1000 * 60 * 10); // 10 mins
        return new Response(JSON.stringify(bistResults), {
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
          model: 'gemini-flash-latest',
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
        const yf = new YahooFinance({ suppressNotices:['yahooSurvey','ripHistorical'] });
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

    // 2.7. API: Market Summary (Top Bar)
    if (path === '/api/market-summary') {
      try {
        const cached = cacheGet('market-summary');
        if (cached) return new Response(JSON.stringify(cached), { headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
        const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
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

    // 3. API: Advanced AI Chat with Dexter Agent (SSE)
    if (path === '/api/chat' && req.method === 'POST') {
      return new Response(new ReadableStream({
        async start(controller) {
          try {
            const body = await req.json() as { query?: string, sessionId?: string };
            const query = body.query;
            const sessionId = body.sessionId || 'default';
            if (!query) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', error: 'Query is required' })}\n\n`));
              controller.close();
              return;
            }

            if (!chatSessions[sessionId]) {
              chatSessions[sessionId] = new InMemoryChatHistory('gemini-flash-latest', 15);
            }
            const history = chatSessions[sessionId];
            touchSession(sessionId);
            
            const agent = await Agent.create({ 
              model: 'gemini-flash-latest',
              memoryEnabled: false // Disable vector DB memory (memory_search) which takes too long, keep chat history only.
            });
            let fullAnswer = '';

            for await (const event of agent.run(query, history)) {
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

    // Serve Static Dashboard
    let filePath = join(DIST_DIR, path === '/' ? 'index.html' : path);
    let file = Bun.file(filePath);

    // Single Page Application routing fallback
    if (!(await file.exists())) {
      filePath = join(DIST_DIR, 'index.html');
      file = Bun.file(filePath);
    }

    // Serve static file
    if (await file.exists()) {
      const isHashedAsset = filePath.includes('/assets/') && /-[a-zA-Z0-9]{6,}\.(js|css)$/.test(filePath);
      return new Response(file, {
        headers: isHashedAsset
          ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
          : { 'Cache-Control': 'no-cache' }
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`🌐 Server running at: http://localhost:${server.port}`);
console.log(`📁 Static files served from: ${DIST_DIR}`);
