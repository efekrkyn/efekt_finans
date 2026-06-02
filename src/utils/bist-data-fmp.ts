import { fmpClient } from './fmp.js';
import { computeTechnicalIndicators, TechnicalIndicators } from './technical-indicators.js';
import { fetchIsYatirimQuote, fetchIsYatirimCompanyName } from './isyatirim.js';
import type { BISTPeriodData, BISTAnalysisResult } from './bist-data.js';

function getQuarterLabel(dateObj: Date): string {
  const month = dateObj.getMonth() + 1;
  const year = dateObj.getFullYear();
  if (month <= 3) return `${year}/03`;
  if (month <= 6) return `${year}/06`;
  if (month <= 9) return `${year}/09`;
  return `${year}/12`;
}

export async function fetchBISTData(ticker: string): Promise<BISTAnalysisResult> {
  const formattedTicker = ticker.toUpperCase().endsWith('.IS')
    ? ticker.toUpperCase()
    : `${ticker.toUpperCase()}.IS`;

  let quote: any = null;
  let usedFallback = false;
  let fallbackHistory: { date: string; close: number }[] = [];

  try {
    const qRes = await fmpClient.quote(formattedTicker);
    if (!qRes || qRes.length === 0) throw new Error('Sonuç bulunamadı');
    quote = qRes[0];
  } catch (err) {
    const msg = (err as Error).message || '';
    console.warn(`[bist-data] FMP hatası, İş Yatırım fallback deneniyor: ${formattedTicker} - ${msg}`);
    const iy = await fetchIsYatirimQuote(ticker);
    if (iy && iy.price > 0) {
      const fallbackName = (await fetchIsYatirimCompanyName(ticker)) || ticker.toUpperCase();
      quote = {
        name: fallbackName,
        price: iy.price,
        marketCap: iy.marketCap,
        multiples: {
          trailingPE: undefined,
          priceToBook: undefined,
          evToEbitda: undefined,
        },
        currency: 'TRY',
        changesPercentage: iy.change,
        dayHigh: iy.high,
        dayLow: iy.low,
        volume: iy.volume,
      };
      fallbackHistory = iy.history || [];
      usedFallback = true;
    } else {
      throw new Error(`Hisse senedi verisi bulunamadı (${formattedTicker}): FMP yanıt vermedi ve İş Yatırım yedek kaynağı da başarısız oldu.`);
    }
  }

  const companyName = quote.name || quote.symbol || ticker;
  const currentPrice = quote.price || 0;
  const marketCap = quote.marketCap || 0;
  const trailingPE = quote.pe;
  const priceToBook = quote.priceToBook; // Note: FMP quote may not have this directly, but we'll try
  const currency = quote.currency || 'TRY';

  let quarterly: BISTPeriodData[] = [];
  let annual: BISTPeriodData[] = [];

  if (!usedFallback) {
    try {
      const [incQ, bsQ, incA, bsA] = await Promise.all([
        fmpClient.incomeStatement(formattedTicker, 8, 'quarter').catch(() => []),
        fmpClient.balanceSheet(formattedTicker, 8, 'quarter').catch(() => []),
        fmpClient.incomeStatement(formattedTicker, 5, 'annual').catch(() => []),
        fmpClient.balanceSheet(formattedTicker, 5, 'annual').catch(() => [])
      ]);

      const mapFmpData = (inc: any[], bs: any[], isAnnual: boolean): BISTPeriodData[] => {
        const bsMap = new Map(bs.map(b => [b.date.substring(0, 7), b]));
        return inc.map(i => {
          const b = bsMap.get(i.date.substring(0, 7)) || {};
          const d = new Date(i.date);
          return {
            date: i.date,
            periodLabel: isAnnual ? String(d.getFullYear()) : getQuarterLabel(d),
            totalRevenue: i.revenue,
            grossProfit: i.grossProfit,
            operatingIncome: i.operatingIncome,
            ebitda: i.ebitda,
            netIncome: i.netIncome,
            currentAssets: b.totalCurrentAssets,
            nonCurrentAssets: b.totalNonCurrentAssets,
            totalAssets: b.totalAssets,
            currentLiabilities: b.totalCurrentLiabilities,
            nonCurrentLiabilities: b.totalNonCurrentLiabilities,
            netDebt: b.netDebt,
            stockholdersEquity: b.totalStockholdersEquity,
            freeCashFlow: undefined // FMP provides this in cash-flow-statement, skip for now to save API calls
          };
        }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      };

      quarterly = mapFmpData(incQ, bsQ, false);
      annual = mapFmpData(incA, bsA, true);
    } catch (err) {
      console.error('FMP Financials fetch failed:', (err as Error).message);
    }
  }

  const scorecard: BISTAnalysisResult['scorecard'] = {};
  if (quarterly.length >= 2) {
    const latest = quarterly[quarterly.length - 1];
    const prev = quarterly[quarterly.length - 2];
    if (latest.totalRevenue && prev.totalRevenue) scorecard.revenueGrowthQoQ = ((latest.totalRevenue - prev.totalRevenue) / prev.totalRevenue) * 100;
    if (latest.netIncome && prev.netIncome) scorecard.netIncomeGrowthQoQ = ((latest.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100;
    if (latest.ebitda && prev.ebitda) scorecard.ebitdaGrowthQoQ = ((latest.ebitda - prev.ebitda) / Math.abs(prev.ebitda)) * 100;

    if (quarterly.length >= 5) {
      const sameQuarterLastYear = quarterly[quarterly.length - 5];
      if (latest.totalRevenue && sameQuarterLastYear.totalRevenue) scorecard.revenueGrowthYoY = ((latest.totalRevenue - sameQuarterLastYear.totalRevenue) / sameQuarterLastYear.totalRevenue) * 100;
      if (latest.netIncome && sameQuarterLastYear.netIncome) scorecard.netIncomeGrowthYoY = ((latest.netIncome - sameQuarterLastYear.netIncome) / Math.abs(sameQuarterLastYear.netIncome)) * 100;
      if (latest.ebitda && sameQuarterLastYear.ebitda) scorecard.ebitdaGrowthYoY = ((latest.ebitda - sameQuarterLastYear.ebitda) / Math.abs(sameQuarterLastYear.ebitda)) * 100;
    }
  }

  let evToEbitda: number | undefined;
  if (quarterly.length > 0) {
    const latest = quarterly[quarterly.length - 1];
    if (latest.ebitda && latest.ebitda > 0) {
      const ev = marketCap + (latest.netDebt || 0);
      evToEbitda = ev / (latest.ebitda * 4);
    }
  }

  let historicalPrices: { date: string; close: number }[] = [];
  let technicalIndicators: TechnicalIndicators | undefined;

  if (usedFallback && fallbackHistory.length > 0) {
    historicalPrices = fallbackHistory;
    technicalIndicators = computeTechnicalIndicators(historicalPrices);
  } else {
    try {
      const today = new Date();
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(today.getFullYear() - 1);
      
      const histResult = await fmpClient.historical(
        formattedTicker, 
        oneYearAgo.toISOString().split('T')[0], 
        today.toISOString().split('T')[0]
      );

      historicalPrices = (histResult?.historical || [])
        .map(h => ({ date: h.date, close: h.close }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      if (historicalPrices.length > 0) {
        technicalIndicators = computeTechnicalIndicators(historicalPrices);
      }
    } catch (err) {
      console.error(`[bist-data] Error fetching historical prices for ${formattedTicker}:`, err);
    }
  }

  return {
    ticker: ticker.toUpperCase(),
    companyName,
    currentPrice,
    marketCap,
    multiples: {
      trailingPE,
      priceToBook,
      evToEbitda,
    },
    currency,
    quarterly,
    annual,
    scorecard,
    historicalPrices,
    technicalIndicators,
    dataSource: usedFallback ? 'isyatirim-fallback' : 'fmp'
  };
}
