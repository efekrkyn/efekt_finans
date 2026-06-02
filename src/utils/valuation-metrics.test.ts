import { expect, test } from 'bun:test';
import { computeValuationMetrics } from './valuation-metrics';

test('computeValuationMetrics > computes complete data correctly', () => {
  const result = computeValuationMetrics({
    marketCap: 1000,
    freeCashFlow: 100,
    ebitda: 200,
    netDebt: 400,
    netIncome: 50,
    totalRevenue: 1000,
    revenueGrowthYoY: 0.2
  });

  // fcfYield = 100 / 1000 = 0.1
  expect(result.fcfYield).toBeCloseTo(0.1, 4);
  // netDebtToEbitda = 400 / 200 = 2
  expect(result.netDebtToEbitda).toBeCloseTo(2, 4);
  // ebitdaMargin = 200 / 1000 = 0.2
  expect(result.ebitdaMargin).toBeCloseTo(0.2, 4);
  // evToFcf = (1000 + 400) / 100 = 14
  expect(result.evToFcf).toBeCloseTo(14, 4);

  // Quality score checks:
  // 1. FCF > 0 ? 100 > 0 (YES)
  // 2. Net Income > 0 ? 50 > 0 (YES)
  // 3. NetDebt/EBITDA < 3 ? 2 < 3 (YES)
  // 4. EBITDA Margin > 15% ? 0.2 > 0.15 (YES)
  // 5. Rev Growth > 0 ? 0.2 > 0 (YES)
  expect(result.qualityScore).toBe(5);
  expect(result.qualityLabel).toBe('Güçlü');
  
  expect(result.breakdown.every(b => b.passed)).toBe(true);
});

test('computeValuationMetrics > handles missing and undefined inputs safely', () => {
  const result = computeValuationMetrics({});

  expect(result.fcfYield).toBeUndefined();
  expect(result.netDebtToEbitda).toBeUndefined();
  expect(result.ebitdaMargin).toBeUndefined();
  expect(result.evToFcf).toBeUndefined();

  // All fail, score 0
  expect(result.qualityScore).toBe(0);
  expect(result.qualityLabel).toBe('Zayıf');
  expect(result.breakdown.every(b => !b.passed)).toBe(true);
});

test('computeValuationMetrics > avoids division by zero', () => {
  const result = computeValuationMetrics({
    marketCap: 0,
    freeCashFlow: 0,
    ebitda: 0,
    netDebt: 100,
    totalRevenue: 0
  });

  expect(result.fcfYield).toBeUndefined();
  expect(result.netDebtToEbitda).toBeUndefined();
  expect(result.ebitdaMargin).toBeUndefined();
  expect(result.evToFcf).toBeUndefined();
});

test('computeValuationMetrics > handles negative values for quality score properly', () => {
  const result = computeValuationMetrics({
    marketCap: 1000,
    freeCashFlow: -50,
    ebitda: 200,
    netDebt: 800,
    netIncome: -10,
    totalRevenue: 1000,
    revenueGrowthYoY: -0.1
  });

  expect(result.fcfYield).toBeCloseTo(-0.05, 4);
  expect(result.netDebtToEbitda).toBeCloseTo(4, 4);
  expect(result.ebitdaMargin).toBeCloseTo(0.2, 4);
  
  // Quality checks:
  // FCF > 0 ? NO
  // Net Income > 0 ? NO
  // NetDebt/EBITDA < 3 ? (4 < 3) NO
  // EBITDA Margin > 15% ? (0.2 > 0.15) YES
  // Rev Growth > 0 ? NO
  expect(result.qualityScore).toBe(1);
  expect(result.qualityLabel).toBe('Zayıf');
});

test('computeValuationMetrics > calculates Piotroski F-Score correctly', () => {
  const result = computeValuationMetrics({
    marketCap: 1000,
    netIncome: 100, // 1. Positive Net Income (+1)
    operatingCashFlow: 150, // 2. Positive OCF (+1) & 4. CFO > Net Income (+1)
    totalAssets: 2000,
    longTermDebt: 500,
    currentAssets: 500,
    currentLiabilities: 250,
    sharesOutstanding: 1000,
    grossProfit: 400,
    totalRevenue: 1000,
    prevPeriod: {
      netIncome: 80, // ROA = 100/2000 = 0.05, prevROA = 80/1800 = 0.044 -> 3. Higher ROA (+1)
      totalAssets: 1800,
      longTermDebt: 600, // Debt Ratio = 500/2000 = 0.25, prev = 600/1800 = 0.33 -> 5. Lower Debt Ratio (+1)
      currentAssets: 400,
      currentLiabilities: 250, // CR = 500/250 = 2, prev = 400/250 = 1.6 -> 6. Higher CR (+1)
      sharesOutstanding: 1000, // Shares didn't increase -> 7. No New Shares (+1)
      grossProfit: 300,
      totalRevenue: 800, // Margin = 400/1000 = 0.4, prev = 300/800 = 0.375 -> 8. Higher Margin (+1)
                         // Turnover = 1000/2000 = 0.5, prev = 800/1800 = 0.44 -> 9. Higher Turnover (+1)
    }
  });

  expect(result.piotroskiScore).toBe(9);

  // Test missing data
  const resultMissing = computeValuationMetrics({
    netIncome: 100,
    totalAssets: 2000,
    prevPeriod: {
      totalAssets: 1800
    }
  });
  expect(resultMissing.piotroskiScore).toBeUndefined();
});
