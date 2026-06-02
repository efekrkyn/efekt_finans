/**
 * Derin Rapor "sentez çekirdeği".
 *
 * getReportBundle(): tüm sayısal/teknik veriyi tek bir tipli ReportBundle'da toplar.
 * ALTIN KURAL: tüm sayılar burada (ve dcf.ts'te) hesaplanır; LLM yalnızca düzyazı yazar.
 *
 * Karar mantığı (tier / duruş / hedef aralık) saf yardımcılara ayrıldı ki ağ bağlantısı
 * olmadan test edilebilsin. searchTavily dışarıdan enjekte edilir (server.ts ile döngüsel
 * import'tan kaçınmak için).
 */

import { fetchBISTData, type BISTAnalysisResult } from './bist-data';
import { computeDcf, type DcfResult } from './dcf';
import type { TechnicalIndicators } from './technical-indicators';
import { computeValuationMetrics, type ValuationMetrics } from './valuation-metrics.js';
import { executeChronosForecast } from '../tools/finance/chronos-forecast.js';

export type DataTier = 'tam' | 'kısıtlı';
export type StanceLabel = 'Pozitif' | 'Nötr' | 'Negatif';

export type SearchFn = (
  query: string,
  opts?: { topic?: 'news' | 'general'; days?: number },
) => Promise<string>;

export interface ReportBundle {
  ticker: string;
  companyName: string;
  currentPrice: number;
  marketCap: number;
  currency: string;
  dataSource: 'yahoo' | 'isyatirim-fallback' | 'fmp' | 'borsajs';
  tier: DataTier;
  multiples: { trailingPE?: number; priceToBook?: number; evToEbitda?: number };
  scorecard: BISTAnalysisResult['scorecard'];
  technicals?: TechnicalIndicators;
  latestFinancials: {
    date: string;
    periodLabel: string;
    freeCashFlow?: number;
    ebitda?: number;
    netDebt?: number;
    netIncome?: number;
    totalRevenue?: number;
  } | null;
  dcf: DcfResult;
  news: string | null;
  peerContext: string | null;
  targetRange: { low: number; high: number; basis: 'dcf' | 'teknik' } | null;
  stance: { label: StanceLabel; rationale: string };
  valuation?: ValuationMetrics;
  chronosForecast?: {
    day_30_low: number;
    day_30_median: number;
    day_30_high: number;
  };
}

/** dataSource → veri katmanı. İş Yatırım ve borsajs fallback'i finansal periyot içermez. */
export function mapTier(dataSource?: 'yahoo' | 'isyatirim-fallback' | 'fmp' | 'borsajs'): DataTier {
  return (dataSource === 'isyatirim-fallback' || dataSource === 'borsajs') ? 'kısıtlı' : 'tam';
}

/** 12 aylık hedef aralık: DCF mümkünse sensitivity grid min/max; değilse 52-hafta bandı. */
export function deriveTargetRange(
  dcf: DcfResult,
  historicalPrices?: { date: string; close: number }[],
): { low: number; high: number; basis: 'dcf' | 'teknik' } | null {
  if (dcf.feasible && dcf.sensitivity && dcf.sensitivity.length > 0) {
    const fvs = dcf.sensitivity.map(s => s.fairValue).filter(v => isFinite(v) && v > 0);
    if (fvs.length > 0) {
      return { low: Math.min(...fvs), high: Math.max(...fvs), basis: 'dcf' };
    }
  }
  if (historicalPrices && historicalPrices.length >= 20) {
    const closes = historicalPrices.slice(-252).map(h => h.close).filter(c => isFinite(c) && c > 0);
    if (closes.length > 0) {
      return { low: Math.min(...closes), high: Math.max(...closes), basis: 'teknik' };
    }
  }
  return null;
}

/** Duruş: DCF upside + teknik sinyal birleşimi (deterministik). */
export function deriveStance(args: {
  dcfFeasible: boolean;
  upsidePct?: number;
  signal?: TechnicalIndicators['signal'];
}): { label: StanceLabel; rationale: string } {
  const { dcfFeasible, upsidePct, signal } = args;
  const up = typeof upsidePct === 'number' && isFinite(upsidePct) ? upsidePct : undefined;

  let label: StanceLabel = 'Nötr';
  if (dcfFeasible && typeof up === 'number') {
    if (up > 15 && signal !== 'SAT') label = 'Pozitif';
    else if (up < -15 || signal === 'SAT') label = 'Negatif';
    else label = 'Nötr';
  } else {
    // Tier 2 / DCF yok → yalnızca teknik
    if (signal === 'AL') label = 'Pozitif';
    else if (signal === 'SAT') label = 'Negatif';
    else label = 'Nötr';
  }

  const parts: string[] = [];
  if (typeof up === 'number') parts.push(`DCF ${up >= 0 ? '+' : ''}${up.toFixed(0)}% potansiyel`);
  if (signal) parts.push(`teknik sinyal ${signal}`);
  const rationale = parts.length > 0 ? parts.join(', ') : 'yeterli sinyal yok';
  return { label, rationale };
}

/**
 * Tek bir hisse için tüm rapor verisini toplar.
 * @param opts.discountRate ondalık (örn. 0.30)
 * @param opts.search Tavily arama fonksiyonu (server.ts'ten enjekte edilir); yoksa haber/emsal null kalır.
 */
export async function getReportBundle(
  ticker: string,
  opts: { discountRate?: number; search?: SearchFn } = {},
): Promise<ReportBundle> {
  const financials = await fetchBISTData(ticker);

  // DCF için yıllık periyot tercih edilir (daha stabil); yoksa son çeyrek.
  const lastAnnual = financials.annual[financials.annual.length - 1];
  const lastQuarter = financials.quarterly[financials.quarterly.length - 1];
  const base = lastAnnual ?? lastQuarter ?? null;

  const dcf = computeDcf({
    currentPrice: financials.currentPrice,
    marketCap: financials.marketCap,
    freeCashFlow: base?.freeCashFlow,
    ebitda: base?.ebitda,
    netDebt: base?.netDebt,
    growthYoY: financials.scorecard.ebitdaGrowthYoY ?? financials.scorecard.revenueGrowthYoY,
    discountRate: opts.discountRate,
  });

  let news: string | null = null;
  let peerContext: string | null = null;
  let chronosForecast: ReportBundle['chronosForecast'] = undefined;

  const asyncTasks: Promise<any>[] = [];

  if (opts.search) {
    const search = opts.search;
    asyncTasks.push(search(`${financials.companyName} (${ticker}) hisse son haberler gelişmeler`, { topic: 'news', days: 7 }).then(res => { news = res; }).catch(() => null));
    asyncTasks.push(search(`Borsa İstanbul ${financials.companyName} (${ticker}) sektörü rakipleri kıyaslama pazar payı`, { topic: 'general' }).then(res => { peerContext = res; }).catch(() => null));
  }

  asyncTasks.push(executeChronosForecast(ticker, 30).then(res => {
    if (res.success && res.data?.forecast) {
      chronosForecast = res.data.forecast;
    }
  }).catch(() => null));

  await Promise.all(asyncTasks);

  const stance = deriveStance({
    dcfFeasible: dcf.feasible,
    upsidePct: dcf.upsidePct,
    signal: financials.technicalIndicators?.signal,
  });

  return {
    ticker: financials.ticker,
    companyName: financials.companyName,
    currentPrice: financials.currentPrice,
    marketCap: financials.marketCap,
    currency: financials.currency,
    dataSource: financials.dataSource ?? 'fmp',
    tier: mapTier(financials.dataSource),
    multiples: {
      trailingPE: financials.multiples?.trailingPE,
      priceToBook: financials.multiples?.priceToBook,
      evToEbitda: financials.multiples?.evToEbitda,
    },
    scorecard: financials.scorecard,
    technicals: financials.technicalIndicators,
    latestFinancials: base
      ? {
          date: base.date,
          periodLabel: base.periodLabel,
          freeCashFlow: base.freeCashFlow,
          ebitda: base.ebitda,
          netDebt: base.netDebt,
          netIncome: base.netIncome,
          totalRevenue: base.totalRevenue,
        }
      : null,
    dcf,
    news,
    peerContext,
    targetRange: deriveTargetRange(dcf, financials.historicalPrices),
    stance,
    valuation: computeValuationMetrics({
      marketCap: financials.marketCap,
      freeCashFlow: base?.freeCashFlow,
      ebitda: base?.ebitda,
      netDebt: base?.netDebt,
      netIncome: base?.netIncome,
      totalRevenue: base?.totalRevenue,
      revenueGrowthYoY: financials.scorecard.revenueGrowthYoY,
      operatingCashFlow: base?.operatingCashFlow,
      totalAssets: base?.totalAssets,
      currentAssets: base?.currentAssets,
      currentLiabilities: base?.currentLiabilities,
      longTermDebt: base?.longTermDebt,
      grossProfit: base?.grossProfit,
      sharesOutstanding: base?.sharesOutstanding,
      prevPeriod: financials.annual.length >= 2 ? {
        netIncome: financials.annual[financials.annual.length - 2].netIncome,
        totalAssets: financials.annual[financials.annual.length - 2].totalAssets,
        longTermDebt: financials.annual[financials.annual.length - 2].longTermDebt,
        currentAssets: financials.annual[financials.annual.length - 2].currentAssets,
        currentLiabilities: financials.annual[financials.annual.length - 2].currentLiabilities,
        sharesOutstanding: financials.annual[financials.annual.length - 2].sharesOutstanding,
        grossProfit: financials.annual[financials.annual.length - 2].grossProfit,
        totalRevenue: financials.annual[financials.annual.length - 2].totalRevenue,
      } : undefined
    }),
    chronosForecast,
  };
}
