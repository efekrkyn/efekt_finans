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
