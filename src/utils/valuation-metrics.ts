export interface ValuationMetrics {
  fcfYield?: number;
  netDebtToEbitda?: number;
  ebitdaMargin?: number;
  evToFcf?: number;
  qualityScore: number;
  qualityMax: 5;
  qualityLabel: 'Güçlü' | 'Orta' | 'Zayıf';
  piotroskiScore?: number;
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
  operatingCashFlow?: number;
  totalAssets?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  longTermDebt?: number;
  grossProfit?: number;
  sharesOutstanding?: number;
  prevPeriod?: {
    netIncome?: number;
    totalAssets?: number;
    longTermDebt?: number;
    currentAssets?: number;
    currentLiabilities?: number;
    sharesOutstanding?: number;
    grossProfit?: number;
    totalRevenue?: number;
  };
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

  let piotroskiScore: number | undefined = undefined;

  if (input.prevPeriod && input.totalAssets && input.prevPeriod.totalAssets) {
    let score = 0;
    let missingData = false;

    // 1. Positive Net Income
    if (input.netIncome !== undefined) {
      if (input.netIncome > 0) score++;
    } else missingData = true;

    // 2. Positive Operating Cash Flow
    if (input.operatingCashFlow !== undefined) {
      if (input.operatingCashFlow > 0) score++;
    } else missingData = true;

    // 3. Higher ROA than previous year
    if (input.netIncome !== undefined && input.prevPeriod.netIncome !== undefined && input.totalAssets && input.prevPeriod.totalAssets) {
      const currentRoa = input.netIncome / input.totalAssets;
      const prevRoa = input.prevPeriod.netIncome / input.prevPeriod.totalAssets;
      if (currentRoa > prevRoa) score++;
    } else missingData = true;

    // 4. CFO > Net Income
    if (input.operatingCashFlow !== undefined && input.netIncome !== undefined) {
      if (input.operatingCashFlow > input.netIncome) score++;
    } else missingData = true;

    // 5. Lower Ratio of Long Term Debt to Total Assets
    if (input.longTermDebt !== undefined && input.prevPeriod.longTermDebt !== undefined && input.totalAssets && input.prevPeriod.totalAssets) {
      const currentDebtRatio = input.longTermDebt / input.totalAssets;
      const prevDebtRatio = input.prevPeriod.longTermDebt / input.prevPeriod.totalAssets;
      if (currentDebtRatio < prevDebtRatio) score++;
    } else missingData = true; // if they have 0 debt it's technically fine, but let's be strict

    // 6. Higher Current Ratio
    if (input.currentAssets !== undefined && input.currentLiabilities !== undefined && input.currentLiabilities !== 0 &&
        input.prevPeriod.currentAssets !== undefined && input.prevPeriod.currentLiabilities !== undefined && input.prevPeriod.currentLiabilities !== 0) {
      const currentRatio = input.currentAssets / input.currentLiabilities;
      const prevRatio = input.prevPeriod.currentAssets / input.prevPeriod.currentLiabilities;
      if (currentRatio > prevRatio) score++;
    } else missingData = true;

    // 7. No New Shares (Shares Outstanding <= previous)
    if (input.sharesOutstanding !== undefined && input.prevPeriod.sharesOutstanding !== undefined) {
      if (input.sharesOutstanding <= input.prevPeriod.sharesOutstanding) score++;
    } else missingData = true;

    // 8. Higher Gross Margin
    if (input.grossProfit !== undefined && input.totalRevenue !== undefined && input.totalRevenue !== 0 &&
        input.prevPeriod.grossProfit !== undefined && input.prevPeriod.totalRevenue !== undefined && input.prevPeriod.totalRevenue !== 0) {
      const currentMargin = input.grossProfit / input.totalRevenue;
      const prevMargin = input.prevPeriod.grossProfit / input.prevPeriod.totalRevenue;
      if (currentMargin > prevMargin) score++;
    } else missingData = true;

    // 9. Higher Asset Turnover
    if (input.totalRevenue !== undefined && input.totalAssets !== undefined && input.totalAssets !== 0 &&
        input.prevPeriod.totalRevenue !== undefined && input.prevPeriod.totalAssets !== undefined && input.prevPeriod.totalAssets !== 0) {
      const currentTurnover = input.totalRevenue / input.totalAssets;
      const prevTurnover = input.prevPeriod.totalRevenue / input.prevPeriod.totalAssets;
      if (currentTurnover > prevTurnover) score++;
    } else missingData = true;

    if (!missingData) {
      piotroskiScore = score;
    }
  }

  return {
    fcfYield,
    netDebtToEbitda,
    ebitdaMargin,
    evToFcf,
    qualityScore,
    qualityMax: 5,
    qualityLabel,
    piotroskiScore,
    breakdown,
  };
}
