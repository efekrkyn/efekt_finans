export interface ValuationMetrics {
  fcfYield?: number;
  netDebtToEbitda?: number;
  ebitdaMargin?: number;
  evToFcf?: number;
  qualityScore: number;
  qualityMax: 5;
  qualityLabel: 'Güçlü' | 'Orta' | 'Zayıf';
  breakdown: { name: string; passed: boolean }[];
}

export function computeValuationMetrics(input: {
  marketCap?: number;
  freeCashFlow?: number;
  ebitda?: number;
  netDebt?: number;
  netIncome?: number;
  totalRevenue?: number;
  revenueGrowthYoY?: number;
}): ValuationMetrics {
  let fcfYield: number | undefined;
  if (input.freeCashFlow !== undefined && input.marketCap !== undefined && input.marketCap !== 0) {
    fcfYield = input.freeCashFlow / input.marketCap;
  }

  let netDebtToEbitda: number | undefined;
  if (input.netDebt !== undefined && input.ebitda !== undefined && input.ebitda !== 0) {
    netDebtToEbitda = input.netDebt / input.ebitda;
  }

  let ebitdaMargin: number | undefined;
  if (input.ebitda !== undefined && input.totalRevenue !== undefined && input.totalRevenue !== 0) {
    ebitdaMargin = input.ebitda / input.totalRevenue;
  }

  let evToFcf: number | undefined;
  if (input.marketCap !== undefined && input.netDebt !== undefined && input.freeCashFlow !== undefined && input.freeCashFlow !== 0) {
    evToFcf = (input.marketCap + input.netDebt) / input.freeCashFlow;
  }

  const breakdown: { name: string; passed: boolean }[] = [];

  const passedFcf = input.freeCashFlow !== undefined && input.freeCashFlow > 0;
  breakdown.push({ name: 'Pozitif Serbest Nakit Akışı (FCF)', passed: passedFcf });

  const passedNetIncome = input.netIncome !== undefined && input.netIncome > 0;
  breakdown.push({ name: 'Pozitif Net Kar', passed: passedNetIncome });

  const passedDebt = netDebtToEbitda !== undefined && netDebtToEbitda < 3;
  breakdown.push({ name: 'Net Borç / FAVÖK < 3', passed: passedDebt });

  const passedMargin = ebitdaMargin !== undefined && ebitdaMargin > 0.15;
  breakdown.push({ name: 'FAVÖK Marjı > %15', passed: passedMargin });

  const passedGrowth = input.revenueGrowthYoY !== undefined && input.revenueGrowthYoY > 0;
  breakdown.push({ name: 'Pozitif Gelir Büyümesi', passed: passedGrowth });

  const qualityScore = breakdown.filter(b => b.passed).length;
  let qualityLabel: 'Güçlü' | 'Orta' | 'Zayıf';
  if (qualityScore >= 4) {
    qualityLabel = 'Güçlü';
  } else if (qualityScore >= 2) {
    qualityLabel = 'Orta';
  } else {
    qualityLabel = 'Zayıf';
  }

  return {
    fcfYield,
    netDebtToEbitda,
    ebitdaMargin,
    evToFcf,
    qualityScore,
    qualityMax: 5,
    qualityLabel,
    breakdown,
  };
}
