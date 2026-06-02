import { Ticker } from 'borsajs';
import { computeTechnicalIndicators } from './technical-indicators.js';
import type { BISTAnalysisResult, BISTPeriodData } from './bist-data.js';

export async function fetchBISTData(ticker: string): Promise<BISTAnalysisResult> {
  const formattedTicker = ticker.toUpperCase().replace('.IS', '');
  
  const borsaTicker = new Ticker(formattedTicker);
  
  let info: any;
  try {
    info = await borsaTicker.getInfo();
  } catch (err) {
    throw new Error(`borsajs getInfo hatası (${formattedTicker}): ${(err as Error).message}`);
  }

  if (!info) {
    throw new Error(`Hisse senedi verisi bulunamadı (${formattedTicker}) - borsajs`);
  }

  let historyRows: any[] = [];
  try {
    historyRows = await borsaTicker.getHistory({ period: '2y', interval: '1d' });
  } catch (err) {
    console.warn(`[bist-data-borsajs] ${formattedTicker} tarihçe alınamadı: ${(err as Error).message}`);
  }

  const historicalPrices = historyRows
    .filter(h => h.time && h.close !== undefined)
    .map(h => ({
      date: new Date(h.time * 1000).toISOString().split('T')[0],
      close: h.close,
      high: h.high,
      low: h.low
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const technicalIndicators = historicalPrices.length > 0 
    ? computeTechnicalIndicators(historicalPrices) 
    : undefined;

  const currentPrice = info.last ?? info.close ?? 0;
  // borsajs might not provide marketCap natively in getInfo, if not we leave it 0
  const marketCap = info.marketCap ?? 0;
  
  return {
    ticker: formattedTicker + '.IS',
    companyName: info.description || formattedTicker,
    currentPrice,
    marketCap,
    multiples: {
      trailingPE: info.pe,
      priceToBook: info.pb,
      evToEbitda: undefined,
    },
    currency: info.currency || 'TRY',
    quarterly: [],
    annual: [],
    scorecard: {},
    historicalPrices,
    technicalIndicators,
    dataSource: 'borsajs' // Map it as borsajs tier
  };
}
