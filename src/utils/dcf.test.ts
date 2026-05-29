import { describe, test, expect } from 'bun:test';
import { computeDcf } from './dcf';

// ---------------------------------------------------------------------------
// Bilinen girdiler → elle hesaplanmış adil değer
//
// currentPrice=100, marketCap=100_000 → shares=1000
// FCF=10_000 (reported, pozitif), netDebt=0, growthYoY=0 (düz), r=0.30, tg=0.10
//
// fcf_n = 10_000 (n=1..5)
// PV(explicit) = 10_000 * Σ 1/1.3^n = 10_000 * 2.43557 = 24_355.7
// TV = 10_000 * 1.10 / (0.30-0.10) = 55_000 ; PV_TV = 55_000/1.3^5 = 14_813.1
// EV = 39_168.8 ; equity = 39_168.8 ; fair/share = 39.17
// ---------------------------------------------------------------------------
describe('computeDcf — temel hesap', () => {
  test('bilinen girdiler beklenen adil değeri üretir (~39.17)', () => {
    const r = computeDcf({
      currentPrice: 100,
      marketCap: 100_000,
      freeCashFlow: 10_000,
      netDebt: 0,
      growthYoY: 0,
      discountRate: 0.30,
      terminalGrowth: 0.10,
    });
    expect(r.feasible).toBe(true);
    expect(r.fairValuePerShare).toBeGreaterThan(38.5);
    expect(r.fairValuePerShare).toBeLessThan(39.8);
    expect(r.assumptions.shares).toBe(1000);
    expect(r.assumptions.fcfSource).toBe('reported');
    expect(r.assumptions.discountRate).toBeCloseTo(0.30, 5);
    // upside = (39.17/100 - 1)*100 ≈ -60.8
    expect(r.upsidePct).toBeLessThan(-50);
    expect(r.upsidePct).toBeGreaterThan(-70);
    // sensitivity 3x3 grid
    expect(r.sensitivity?.length).toBe(9);
  });

  test('net borç adil değeri düşürür', () => {
    const noDebt = computeDcf({ currentPrice: 100, marketCap: 100_000, freeCashFlow: 10_000, netDebt: 0, growthYoY: 0 });
    const withDebt = computeDcf({ currentPrice: 100, marketCap: 100_000, freeCashFlow: 10_000, netDebt: 10_000, growthYoY: 0 });
    expect(withDebt.fairValuePerShare!).toBeLessThan(noDebt.fairValuePerShare!);
    // net borç / shares = 10_000/1000 = 10 TL/hisse fark
    expect(noDebt.fairValuePerShare! - withDebt.fairValuePerShare!).toBeCloseTo(10, 1);
  });
});

describe('computeDcf — EBITDA proxy', () => {
  test('FCF yoksa EBITDA proxy kullanılır, güven en fazla orta', () => {
    const r = computeDcf({
      currentPrice: 100,
      marketCap: 100_000,
      ebitda: 20_000, // proxy: 20_000 * 0.6 = 12_000
      netDebt: 0,
      growthYoY: 0,
    });
    expect(r.feasible).toBe(true);
    expect(r.assumptions.fcfSource).toBe('ebitda-proxy');
    expect(r.assumptions.baseFcf).toBeCloseTo(12_000, 0);
    expect(r.confidence).not.toBe('yüksek');
    expect(r.caveats.some(c => c.toLowerCase().includes('favök') || c.toLowerCase().includes('ebitda'))).toBe(true);
  });

  test('negatif FCF ama pozitif EBITDA → proxy + caveat', () => {
    const r = computeDcf({ currentPrice: 100, marketCap: 100_000, freeCashFlow: -5_000, ebitda: 20_000, growthYoY: 0 });
    expect(r.feasible).toBe(true);
    expect(r.assumptions.fcfSource).toBe('ebitda-proxy');
  });
});

describe('computeDcf — feasible:false durumları', () => {
  test('FCF ve EBITDA yoksa hesap yapılamaz', () => {
    const r = computeDcf({ currentPrice: 100, marketCap: 100_000, growthYoY: 0 });
    expect(r.feasible).toBe(false);
    expect(r.fairValuePerShare).toBeUndefined();
    expect(r.caveats.length).toBeGreaterThan(0);
  });

  test('fiyat 0 ise (shares hesaplanamaz) hesap yapılamaz', () => {
    const r = computeDcf({ currentPrice: 0, marketCap: 100_000, freeCashFlow: 10_000 });
    expect(r.feasible).toBe(false);
  });

  test('FCF ve EBITDA ikisi de ≤0 → hesap yapılamaz', () => {
    const r = computeDcf({ currentPrice: 100, marketCap: 100_000, freeCashFlow: -5_000, ebitda: -2_000 });
    expect(r.feasible).toBe(false);
  });
});

describe('computeDcf — iskonto/terminal guard', () => {
  test('r - tg < 0.05 ise terminal büyüme kısılır', () => {
    const r = computeDcf({
      currentPrice: 100, marketCap: 100_000, freeCashFlow: 10_000, growthYoY: 0,
      discountRate: 0.12, terminalGrowth: 0.10, // spread 0.02 < 0.05
    });
    expect(r.feasible).toBe(true);
    // tg = r - 0.05 = 0.07
    expect(r.assumptions.terminalGrowth).toBeCloseTo(0.07, 5);
    expect(r.caveats.some(c => c.toLowerCase().includes('terminal'))).toBe(true);
  });

  test('iskonto oranı 0.05-0.60 aralığına clamp edilir', () => {
    const tooHigh = computeDcf({ currentPrice: 100, marketCap: 100_000, freeCashFlow: 10_000, growthYoY: 0, discountRate: 0.99 });
    expect(tooHigh.assumptions.discountRate).toBeLessThanOrEqual(0.60);
    const tooLow = computeDcf({ currentPrice: 100, marketCap: 100_000, freeCashFlow: 10_000, growthYoY: 0, discountRate: 0.01 });
    expect(tooLow.assumptions.discountRate).toBeGreaterThanOrEqual(0.05);
  });
});

describe('computeDcf — büyüme sınırlama ve saçma çıktı', () => {
  test('aşırı büyüme %25 ile sınırlanır', () => {
    const r = computeDcf({ currentPrice: 100, marketCap: 100_000, freeCashFlow: 10_000, growthYoY: 999 });
    expect(r.assumptions.growthRate).toBeLessThanOrEqual(0.25);
  });

  test('adil değer güncel fiyatın 20 katından fazlaysa güven düşük', () => {
    const r = computeDcf({ currentPrice: 10, marketCap: 10_000, freeCashFlow: 80_000, growthYoY: 0, discountRate: 0.30, terminalGrowth: 0.10 });
    // shares=1000, base 80_000 → fair/share çok yüksek (>200 = 10*20)
    expect(r.fairValuePerShare!).toBeGreaterThan(200);
    expect(r.confidence).toBe('düşük');
    expect(r.caveats.length).toBeGreaterThan(0);
  });
});
