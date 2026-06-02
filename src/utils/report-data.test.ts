import { describe, test, expect } from 'bun:test';
import { mapTier, deriveStance, deriveTargetRange } from './report-data';
import type { DcfResult } from './dcf';

describe('mapTier', () => {
  test('fmp → tam', () => {
    expect(mapTier('fmp')).toBe('tam');
  });
  test('mapTier > isyatirim-fallback → kısıtlı', () => {
    expect(mapTier('isyatirim-fallback')).toBe('kısıtlı');
  });

  test('mapTier > borsajs → kısıtlı', () => {
    expect(mapTier('borsajs')).toBe('kısıtlı');
  });

  test('mapTier > undefined → tam (varsayılan)', () => {
    expect(mapTier(undefined)).toBe('tam');
  });
});

describe('deriveStance', () => {
  test('DCF yüksek upside + teknik SAT değil → Pozitif', () => {
    expect(deriveStance({ dcfFeasible: true, upsidePct: 40, signal: 'AL' }).label).toBe('Pozitif');
    expect(deriveStance({ dcfFeasible: true, upsidePct: 40, signal: 'NÖTR' }).label).toBe('Pozitif');
  });
  test('DCF yüksek upside ama teknik SAT → Pozitif olamaz (Nötr)', () => {
    expect(deriveStance({ dcfFeasible: true, upsidePct: 40, signal: 'SAT' }).label).toBe('Negatif');
  });
  test('DCF büyük negatif upside → Negatif', () => {
    expect(deriveStance({ dcfFeasible: true, upsidePct: -40, signal: 'AL' }).label).toBe('Negatif');
  });
  test('DCF küçük upside → Nötr', () => {
    expect(deriveStance({ dcfFeasible: true, upsidePct: 5, signal: 'NÖTR' }).label).toBe('Nötr');
  });
  test('DCF yok → yalnızca teknik sinyale göre', () => {
    expect(deriveStance({ dcfFeasible: false, signal: 'AL' }).label).toBe('Pozitif');
    expect(deriveStance({ dcfFeasible: false, signal: 'SAT' }).label).toBe('Negatif');
    expect(deriveStance({ dcfFeasible: false, signal: 'NÖTR' }).label).toBe('Nötr');
    expect(deriveStance({ dcfFeasible: false }).label).toBe('Nötr');
  });
  test('rationale upside ve sinyali içerir', () => {
    const s = deriveStance({ dcfFeasible: true, upsidePct: 23.4, signal: 'AL' });
    expect(s.rationale).toContain('DCF');
    expect(s.rationale).toContain('AL');
  });
});

function feasibleDcf(sensitivity: { discountRate: number; terminalGrowth: number; fairValue: number }[]): DcfResult {
  return {
    feasible: true,
    fairValuePerShare: 50,
    upsidePct: 10,
    confidence: 'orta',
    assumptions: { discountRate: 0.3, terminalGrowth: 0.1 },
    sensitivity,
    caveats: [],
  };
}

describe('deriveTargetRange', () => {
  test('DCF feasible → sensitivity grid min/max, basis dcf', () => {
    const dcf = feasibleDcf([
      { discountRate: 0.25, terminalGrowth: 0.1, fairValue: 60 },
      { discountRate: 0.30, terminalGrowth: 0.1, fairValue: 50 },
      { discountRate: 0.35, terminalGrowth: 0.1, fairValue: 42 },
    ]);
    const r = deriveTargetRange(dcf, []);
    expect(r).not.toBeNull();
    expect(r!.basis).toBe('dcf');
    expect(r!.low).toBe(42);
    expect(r!.high).toBe(60);
  });

  test('DCF infeasible ama geçmiş fiyat var → 52-hafta bandı, basis teknik', () => {
    const dcf: DcfResult = { feasible: false, confidence: 'düşük', assumptions: { discountRate: 0.3, terminalGrowth: 0.1 }, caveats: [] };
    const hist = Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${i + 1}`, close: 100 + i }));
    const r = deriveTargetRange(dcf, hist);
    expect(r).not.toBeNull();
    expect(r!.basis).toBe('teknik');
    expect(r!.low).toBe(100);
    expect(r!.high).toBe(129);
  });

  test('DCF infeasible ve geçmiş yok → null', () => {
    const dcf: DcfResult = { feasible: false, confidence: 'düşük', assumptions: { discountRate: 0.3, terminalGrowth: 0.1 }, caveats: [] };
    expect(deriveTargetRange(dcf, [])).toBeNull();
    expect(deriveTargetRange(dcf, undefined)).toBeNull();
  });
});
