import { yahooFinance } from './yahoo.js';
import { computeTechnicalIndicators, TechnicalIndicators } from './technical-indicators.js';
import { fetchIsYatirimQuote, fetchIsYatirimCompanyName } from './isyatirim.js';

export interface BISTPeriodData {
  date: string;
  periodLabel: string;
  totalRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  ebitda?: number;
  netIncome?: number;
  currentAssets?: number;
  nonCurrentAssets?: number;
  totalAssets?: number;
  currentLiabilities?: number;
  nonCurrentLiabilities?: number;
  netDebt?: number;
  stockholdersEquity?: number;
  freeCashFlow?: number;
}

export interface BISTAnalysisResult {
  ticker: string;
  companyName: string;
  currentPrice: number;
  marketCap: number;
  trailingPE?: number;
  priceToBook?: number;
  evToEbitda?: number;
  currency: string;
  quarterly: BISTPeriodData[];
  annual: BISTPeriodData[];
  scorecard: {
    revenueGrowthQoQ?: number;
    revenueGrowthYoY?: number;
    netIncomeGrowthQoQ?: number;
    netIncomeGrowthYoY?: number;
    ebitdaGrowthQoQ?: number;
    ebitdaGrowthYoY?: number;
  };
  historicalPrices: { date: string; close: number }[];
  technicalIndicators?: TechnicalIndicators;
  dataSource?: 'yahoo' | 'isyatirim-fallback';
}

// Format date into a readable quarter label like "2024/09"
function getQuarterLabel(dateObj: Date): string {
  const month = dateObj.getMonth() + 1;
  const year = dateObj.getFullYear();
  if (month <= 3) return `${year}/03`;
  if (month <= 6) return `${year}/06`;
  if (month <= 9) return `${year}/09`;
  return `${year}/12`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Yahoo Finance 429 (Too Many Requests) için exponential backoff + retry.
// 2 deneme yeterli — fazla retry IP'yi daha çok yorar ve fallback'a geçişi geciktirir.
async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message || '';
      const is429 = msg.includes('429') || msg.toLowerCase().includes('too many requests') || msg.toLowerCase().includes('crumb');
      if (!is429 || attempt === maxAttempts) throw err;
      const wait = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250); // 500/1000/2000/4000ms + jitter
      console.warn(`[bist-data] ${label} 429 alındı, ${wait}ms beklenip tekrar denenecek (deneme ${attempt}/${maxAttempts})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export async function fetchBISTData(ticker: string): Promise<BISTAnalysisResult> {
  const formattedTicker = ticker.toUpperCase().endsWith('.IS')
    ? ticker.toUpperCase()
    : `${ticker.toUpperCase()}.IS`;

  // 1. Fetch Quote for current market data — 429 olursa retry, sonra İş Yatırım fallback
  let quote: any = null;
  let usedFallback = false;
  try {
    quote = await withRetry(`quote(${formattedTicker})`, () => yahooFinance.quote(formattedTicker));
    if (!quote) throw new Error('Sonuç bulunamadı');
  } catch (err) {
    const msg = (err as Error).message || '';
    const is429 = msg.includes('429') || msg.toLowerCase().includes('too many requests') || msg.toLowerCase().includes('crumb');
    if (is429) {
      // Yahoo öldü — İş Yatırım fallback'i dene
      console.warn(`[bist-data] Yahoo 429, İş Yatırım fallback deneniyor: ${formattedTicker}`);
      const iy = await fetchIsYatirimQuote(ticker);
      if (iy && iy.price > 0) {
        const fallbackName = (await fetchIsYatirimCompanyName(ticker)) || ticker.toUpperCase();
        quote = {
          shortName: fallbackName,
          longName: fallbackName,
          regularMarketPrice: iy.price,
          marketCap: iy.marketCap || 0,
          trailingPE: undefined, // İş Yatırım public endpoint F/K vermiyor
          priceToBook: undefined,
          currency: 'TRY',
          regularMarketChangePercent: iy.change,
          regularMarketDayHigh: iy.high,
          regularMarketDayLow: iy.low,
          regularMarketVolume: iy.volume,
        };
        usedFallback = true;
      } else {
        throw new Error(`Hisse senedi verisi bulunamadı (${formattedTicker}): Yahoo Finance şu an istek limiti uyguluyor (429) ve İş Yatırım yedek kaynağı da yanıt vermedi.`);
      }
    } else {
      throw new Error(`Hisse senedi verisi bulunamadı (${formattedTicker}): ${msg}`);
    }
  }

  const companyName = quote.shortName || quote.longName || ticker;
  const currentPrice = quote.regularMarketPrice || 0;
  const marketCap = quote.marketCap || 0;
  const trailingPE = quote.trailingPE;
  const priceToBook = quote.priceToBook;
  const currency = quote.currency || 'TRY';

  // 2. Fetch quarterly financials (we need last 6-8 quarters to calculate YoY growth of quarters)
  let quarterlyRaw: any[] = [];
  try {
    quarterlyRaw = await withRetry(`quarterly(${formattedTicker})`, () =>
      yahooFinance.fundamentalsTimeSeries(formattedTicker, {
        period1: '2023-01-01',
        period2: new Date().toISOString().split('T')[0],
        type: 'quarterly',
        module: 'all'
      })
    );
  } catch (err) {
    console.error('Quarterly fetch failed:', (err as Error).message);
  }

  // 3. Fetch annual financials
  let annualRaw: any[] = [];
  try {
    annualRaw = await withRetry(`annual(${formattedTicker})`, () =>
      yahooFinance.fundamentalsTimeSeries(formattedTicker, {
        period1: '2020-01-01',
        period2: new Date().toISOString().split('T')[0],
        type: 'annual',
        module: 'all'
      })
    );
  } catch (err) {
    console.error('Annual fetch failed:', (err as Error).message);
  }

  const mapPeriodData = (entry: any, isAnnual: boolean): BISTPeriodData => {
    const d = new Date(entry.date);
    return {
      date: d.toISOString().split('T')[0],
      periodLabel: isAnnual ? String(d.getFullYear()) : getQuarterLabel(d),
      totalRevenue: entry.totalRevenue || entry.operatingRevenue,
      grossProfit: entry.grossProfit,
      operatingIncome: entry.operatingIncome || entry.EBIT,
      ebitda: entry.EBITDA || entry.normalizedEBITDA,
      netIncome: entry.netIncome || entry.netIncomeContinuousOperations,
      currentAssets: entry.currentAssets,
      nonCurrentAssets: entry.totalNonCurrentAssets,
      totalAssets: entry.totalAssets,
      currentLiabilities: entry.currentLiabilities,
      nonCurrentLiabilities: entry.totalNonCurrentLiabilitiesNetMinorityInterest,
      netDebt: entry.netDebt,
      stockholdersEquity: entry.stockholdersEquity || entry.commonStockEquity,
      freeCashFlow: entry.freeCashFlow
    };
  };

  // Sort periods ascending by date
  const quarterly = (quarterlyRaw || [])
    .map(e => mapPeriodData(e, false))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const annual = (annualRaw || [])
    .map(e => mapPeriodData(e, true))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // 4. Calculate Scorecard and growth metrics
  // QoQ: Quarter over previous Quarter (e.g. Q3 24 vs Q2 24)
  // YoY: Quarter over same Quarter last year (e.g. Q3 24 vs Q3 23)
  const scorecard: BISTAnalysisResult['scorecard'] = {};

  if (quarterly.length >= 2) {
    const latest = quarterly[quarterly.length - 1];
    const prev = quarterly[quarterly.length - 2];

    if (latest.totalRevenue && prev.totalRevenue) {
      scorecard.revenueGrowthQoQ = ((latest.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100;
    }
    if (latest.netIncome && prev.netIncome) {
      scorecard.netIncomeGrowthQoQ = ((latest.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100;
    }
    if (latest.ebitda && prev.ebitda) {
      scorecard.ebitdaGrowthQoQ = ((latest.ebitda - prev.ebitda) / Math.abs(prev.ebitda)) * 100;
    }

    // Try to find same quarter last year (4 quarters back)
    if (quarterly.length >= 5) {
      const sameQuarterLastYear = quarterly[quarterly.length - 5];
      if (latest.totalRevenue && sameQuarterLastYear.totalRevenue) {
        scorecard.revenueGrowthYoY = ((latest.totalRevenue - sameQuarterLastYear.totalRevenue) / sameQuarterLastYear.totalRevenue) * 100;
      }
      if (latest.netIncome && sameQuarterLastYear.netIncome) {
        scorecard.netIncomeGrowthYoY = ((latest.netIncome - sameQuarterLastYear.netIncome) / Math.abs(sameQuarterLastYear.netIncome)) * 100;
      }
      if (latest.ebitda && sameQuarterLastYear.ebitda) {
        scorecard.ebitdaGrowthYoY = ((latest.ebitda - sameQuarterLastYear.ebitda) / Math.abs(sameQuarterLastYear.ebitda)) * 100;
      }
    }
  }

  // Calculate EV/EBITDA if possible
  let evToEbitda: number | undefined;
  if (quarterly.length > 0) {
    const latest = quarterly[quarterly.length - 1];
    const ebitda = latest.ebitda;
    const netDebt = latest.netDebt || 0;
    if (ebitda && ebitda > 0) {
      // Annualize quarterly EBITDA for EV/EBITDA calculation, or use latest TTM/Annual. Let's do simple EV / (latest EBITDA * 4) for quarterly
      const ev = marketCap + netDebt;
      evToEbitda = ev / (ebitda * 4);
    }
  }

  // 5. Fetch historical prices (1 year) and compute technical indicators
  let historicalPrices: { date: string; close: number }[] = [];
  let technicalIndicators: TechnicalIndicators | undefined;

  try {
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    const histResult = await withRetry(`historical(${formattedTicker})`, () =>
      yahooFinance.historical(formattedTicker, {
        period1: oneYearAgo.toISOString().split('T')[0],
        period2: today.toISOString().split('T')[0],
        interval: '1d'
      })
    );

    historicalPrices = (histResult || [])
      .filter(h => h.date && h.close !== undefined && h.close !== null)
      .map(h => ({
        date: new Date(h.date).toISOString().split('T')[0],
        close: h.close
      }));

    if (historicalPrices.length > 0) {
      technicalIndicators = computeTechnicalIndicators(historicalPrices);
    }
  } catch (err) {
    console.error(`[bist-data] Error fetching historical prices for ${formattedTicker}:`, err);
  }

  return {
    ticker: ticker.toUpperCase(),
    companyName,
    currentPrice,
    marketCap,
    trailingPE,
    priceToBook,
    evToEbitda,
    currency,
    quarterly,
    annual,
    scorecard,
    historicalPrices,
    technicalIndicators,
    dataSource: usedFallback ? 'isyatirim-fallback' : 'yahoo'
  };
}
