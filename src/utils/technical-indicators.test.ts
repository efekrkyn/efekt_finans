import { expect, test } from 'bun:test';
import { computeTechnicalIndicators, PriceBar } from './technical-indicators';

const generateBaselineBars = (length: number): PriceBar[] => {
  return Array.from({ length }, (_, i) => ({
    date: '2024-01-01',
    close: 100 + i * 2 + Math.sin(i) * 5,
  }));
};

test('computeTechnicalIndicators > returns correct shape and baseline values', () => {
  const bars = generateBaselineBars(60);
  const result = computeTechnicalIndicators(bars);

  // Expected baseline values for 60 bars (derived from manual calculation)
  // SMA 20
  expect(result.sma20).toBeDefined();
  expect(result.sma20).toBeCloseTo(199.196, 2);

  // SMA 50
  expect(result.sma50).toBeDefined();
  expect(result.sma50).toBeCloseTo(168.998, 2);

  // RSI
  expect(result.rsi).toBeDefined();
  expect(result.rsi).toBeGreaterThanOrEqual(0);
  expect(result.rsi).toBeLessThanOrEqual(100);
  expect(result.rsi).toBeGreaterThan(82.5); // 83.575 +/- 1.0
  expect(result.rsi).toBeLessThan(84.6);

  // MACD
  expect(result.macd).toBeDefined();
  if (result.macd) {
    // Histogram should be exactly MACD line - Signal line
    expect(result.macd.histogram).toBeCloseTo(result.macd.macdLine - result.macd.signalLine, 5);
    // Baseline histogram was positive (0.402)
    expect(result.macd.histogram).toBeGreaterThan(0);
  }

  // Signals
  expect(result.signal).toBe('AL');
  expect(result.rsiSignal).toBe('AŞIRI ALIM');
});

test('computeTechnicalIndicators > insufficient data', () => {
  const bars = generateBaselineBars(10);
  const result = computeTechnicalIndicators(bars);

  // With 10 bars, RSI, MACD, and SMA50/SMA20 are undefined
  expect(result.rsi).toBeUndefined();
  expect(result.macd).toBeUndefined();
  expect(result.sma50).toBeUndefined();
  expect(result.sma20).toBeUndefined();

  // But function still returns valid signal shape
  expect(result.signal).toBeDefined();
  expect(result.rsiSignal).toBeDefined();
  expect(result.signal).toBe('NÖTR');
  expect(result.rsiSignal).toBe('NÖTR');
});
