import { fetchBISTData as fetchBISTDataYahoo } from './bist-data-yahoo.js';
import { fetchBISTData as fetchBISTDataFMP } from './bist-data-fmp.js';
import { TechnicalIndicators } from './technical-indicators.js';

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
  longTermDebt?: number;
  stockholdersEquity?: number;
  freeCashFlow?: number;
  operatingCashFlow?: number;
  sharesOutstanding?: number;
}

export interface BISTAnalysisResult {
  ticker: string;
  companyName: string;
  currentPrice: number;
  marketCap: number;
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
  multiples: {
    trailingPE?: number;
    priceToBook?: number;
    evToEbitda?: number;
  };
  historicalPrices: { date: string; close: number; high?: number; low?: number }[];
  technicalIndicators?: TechnicalIndicators;
  dataSource: 'fmp' | 'isyatirim-fallback' | 'yahoo' | 'borsajs';
}

import { fetchBISTData as fetchBISTDataBorsaJS } from './bist-data-borsajs.js';

export async function fetchBISTData(ticker: string): Promise<BISTAnalysisResult> {
  // Eğer ortam değişkenlerinde BIST_DATA_SOURCE=yahoo tanımlıysa Yahoo'yu kullan
  // Eğer borsajs tanımlıysa onu kullan
  if (process.env.BIST_DATA_SOURCE === 'yahoo') {
    return fetchBISTDataYahoo(ticker);
  } else if (process.env.BIST_DATA_SOURCE === 'borsajs') {
    return fetchBISTDataBorsaJS(ticker);
  } else {
    // Varsayılan: FMP
    return fetchBISTDataFMP(ticker);
  }
}
