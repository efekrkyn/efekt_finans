export interface PriceBar {
  date: string;
  close: number;
}

export interface TechnicalIndicators {
  rsi?: number;
  macd?: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  };
  sma20?: number;
  sma50?: number;
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
  };
  stochasticRsi?: number;
  signal: 'AL' | 'SAT' | 'NÖTR';
  rsiSignal: 'AŞIRI ALIM' | 'AŞIRI SATIM' | 'NÖTR';
}

import { SMA, RSI, MACD, EMA, BollingerBands, StochasticRSI, NotEnoughDataError } from 'trading-signals';

// Main technical indicators entrypoint
export function computeTechnicalIndicators(bars: PriceBar[]): TechnicalIndicators {
  const closePrices = bars.map(b => b.close);
  const latestPrice = closePrices[closePrices.length - 1];

  const sma20Indicator = new SMA(20);
  const sma50Indicator = new SMA(50);
  const rsiIndicator = new RSI(14);
  const stochRsiIndicator = new StochasticRSI(14);
  const macdIndicator = new MACD(new EMA(12), new EMA(26), new EMA(9));
  const bollingerIndicator = new BollingerBands(20, 2);

  for (const price of closePrices) {
    sma20Indicator.update(price, false);
    sma50Indicator.update(price, false);
    rsiIndicator.update(price, false);
    stochRsiIndicator.update(price, false);
    macdIndicator.update(price, false);
    bollingerIndicator.update(price, false);
  }

  let sma20: number | undefined;
  try { 
    const r = sma20Indicator.getResult();
    if (r !== null && r !== undefined) sma20 = Number(r.valueOf()); 
  } catch {}
  
  let sma50: number | undefined;
  try { 
    const r = sma50Indicator.getResult();
    if (r !== null && r !== undefined) sma50 = Number(r.valueOf()); 
  } catch {}

  let rsi: number | undefined;
  try { 
    const r = rsiIndicator.getResult();
    if (r !== null && r !== undefined) rsi = Number(r.valueOf()); 
  } catch {}

  let stochasticRsi: number | undefined;
  try {
    const sr = stochRsiIndicator.getResult();
    if (sr !== null && sr !== undefined) stochasticRsi = Number(sr.valueOf()) * 100;
  } catch {}

  let macdResult: { macdLine: number; signalLine: number; histogram: number } | undefined;
  try {
    const m = macdIndicator.getResult();
    if (m) {
      macdResult = {
        macdLine: Number(m.macd.valueOf()),
        signalLine: Number(m.signal.valueOf()),
        histogram: Number(m.histogram.valueOf())
      };
    }
  } catch {}

  let bollingerResult: { upper: number; middle: number; lower: number; percentB: number } | undefined;
  try {
    const b = bollingerIndicator.getResult();
    if (b) {
      const upper = Number(b.upper.valueOf());
      const middle = Number(b.middle.valueOf());
      const lower = Number(b.lower.valueOf());
      const percentB = (latestPrice - lower) / (upper - lower);
      bollingerResult = { upper, middle, lower, percentB };
    }
  } catch {}

  // 4. Generate Trading Signals
  let buySignals = 0;
  let sellSignals = 0;

  // SMA cross signal
  if (sma20 && sma50) {
    if (latestPrice > sma20) buySignals++;
    else sellSignals++;

    if (sma20 > sma50) buySignals++;
    else sellSignals++;
  }

  // RSI signal
  let rsiSignal: TechnicalIndicators['rsiSignal'] = 'NÖTR';
  if (rsi) {
    if (rsi >= 70) {
      sellSignals++;
      rsiSignal = 'AŞIRI ALIM';
    } else if (rsi <= 30) {
      buySignals++;
      rsiSignal = 'AŞIRI SATIM';
    }
  }

  // MACD signal
  if (macdResult) {
    if (macdResult.histogram > 0) buySignals++;
    else sellSignals++;
  }

  let signal: TechnicalIndicators['signal'] = 'NÖTR';
  if (buySignals >= 3) {
    signal = 'AL';
  } else if (sellSignals >= 3) {
    signal = 'SAT';
  }

  return {
    rsi,
    macd: macdResult,
    sma20,
    sma50,
    bollinger: bollingerResult,
    stochasticRsi,
    signal,
    rsiSignal
  };
}
