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
  signal: 'AL' | 'SAT' | 'NÖTR';
  rsiSignal: 'AŞIRI ALIM' | 'AŞIRI SATIM' | 'NÖTR';
}

// Calculate EMA (Exponential Moving Average)
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const emas: number[] = [];
  const multiplier = 2 / (period + 1);

  // Initial EMA: simple average of first 'period' values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let prevEma = sum / period;
  emas.push(prevEma);

  for (let i = period; i < prices.length; i++) {
    const ema = prices[i] * multiplier + prevEma * (1 - multiplier);
    emas.push(ema);
    prevEma = ema;
  }

  // Pad the beginning with null/zeros or return aligned results
  const padding = Array(period - 1).fill(0);
  return [...padding, ...emas];
}

// Calculate SMA (Simple Moving Average)
function calculateSMA(prices: number[], period: number): number | undefined {
  if (prices.length < period) return undefined;
  const slice = prices.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

// Calculate RSI (Relative Strength Index)
function calculateRSI(prices: number[], period = 14): number | undefined {
  if (prices.length <= period) return undefined;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let gains = 0;
  let losses = 0;

  // First RSI value
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Main technical indicators entrypoint
export function computeTechnicalIndicators(bars: PriceBar[]): TechnicalIndicators {
  const closePrices = bars.map(b => b.close);
  const latestPrice = closePrices[closePrices.length - 1];

  // 1. Calculate SMA
  const sma20 = calculateSMA(closePrices, 20);
  const sma50 = calculateSMA(closePrices, 50);

  // 2. Calculate RSI
  const rsi = calculateRSI(closePrices, 14);

  // 3. Calculate MACD
  let macdResult;
  if (closePrices.length >= 26 + 9) {
    const ema12 = calculateEMA(closePrices, 12);
    const ema26 = calculateEMA(closePrices, 26);
    
    const macdLine: number[] = [];
    for (let i = 0; i < closePrices.length; i++) {
      macdLine.push(ema12[i] - ema26[i]);
    }
    
    const signalLine = calculateEMA(macdLine.slice(25), 9);
    
    // Align signal line with MACD line
    const alignedSignalLine = [...Array(25).fill(0), ...signalLine];
    
    const latestMacd = macdLine[macdLine.length - 1];
    const latestSignal = alignedSignalLine[alignedSignalLine.length - 1];
    macdResult = {
      macdLine: latestMacd,
      signalLine: latestSignal,
      histogram: latestMacd - latestSignal
    };
  }

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
    signal,
    rsiSignal
  };
}
