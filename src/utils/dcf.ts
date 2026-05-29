/**
 * Saf DCF (İndirgenmiş Nakit Akışı) değerleme matematiği.
 *
 * ALTIN KURAL: Bu modül yalnızca sayı hesaplar; LLM hiçbir rakam üretmez.
 * Çıktı, Derin Rapor endpoint'inde "yer gerçeği" (ground truth) olarak kullanılır.
 *
 * Metodoloji src/skills/dcf/SKILL.md'den TL'ye uyarlanmıştır:
 *  - 5 yıl FCF projeksiyonu (yıllık decay ile)
 *  - Gordon terminal değeri
 *  - Bugünkü değere indirgeme → EV → (−net borç) → ÷ hisse adedi
 *  - 3×3 duyarlılık (sensitivity) tablosu
 *
 * TL yüksek-enflasyon ortamında nakit akışları nominal olduğundan iskonto oranı
 * (varsayılan %30) ve terminal büyüme (varsayılan %10) de nominaldir.
 */

export interface DcfInput {
  /** Güncel hisse fiyatı (TRY). shares = marketCap/currentPrice için zorunlu. */
  currentPrice: number;
  /** Piyasa değeri (TRY). */
  marketCap: number;
  /** Son yıllık serbest nakit akışı (TRY). Pozitifse doğrudan kullanılır. */
  freeCashFlow?: number;
  /** Son yıllık FAVÖK (TRY). FCF yoksa proxy olarak kullanılır. */
  ebitda?: number;
  /** Son yıllık net borç (TRY). Negatif = net nakit. */
  netDebt?: number;
  /** Yıllık büyüme (%, örn. 20 = %20). Scorecard YoY'den. */
  growthYoY?: number;
  /** İskonto oranı (ondalık). Varsayılan 0.30. 0.05–0.60'a clamp edilir. */
  discountRate?: number;
  /** Terminal büyüme (ondalık). Varsayılan 0.10. */
  terminalGrowth?: number;
}

export type DcfConfidence = 'yüksek' | 'orta' | 'düşük';

export interface DcfResult {
  feasible: boolean;
  fairValuePerShare?: number;
  upsidePct?: number;
  confidence: DcfConfidence;
  assumptions: {
    baseFcf?: number;
    fcfSource?: 'reported' | 'ebitda-proxy';
    growthRate?: number;
    discountRate: number;
    terminalGrowth: number;
    shares?: number;
    netDebt?: number;
    projectedFcf?: number[];
    terminalValuePct?: number;
  };
  sensitivity?: { discountRate: number; terminalGrowth: number; fairValue: number }[];
  caveats: string[];
}

// --- Sabitler ---
export const DEFAULT_DISCOUNT_RATE = 0.30;
export const DEFAULT_TERMINAL_GROWTH = 0.10;
const EBITDA_TO_FCF_PROXY = 0.6; // capex + vergi için kaba kesinti
const DECAY = 0.85;              // her yıl büyüme oranı bu kadar azalır
const GROWTH_CAP = 0.25;         // TL nominal — sürdürülebilir üst sınır
const GROWTH_FLOOR = -0.10;
const MIN_SPREAD = 0.05;         // r - tg en az bu kadar olmalı
const PROJECTION_YEARS = 5;
const DR_MIN = 0.05;
const DR_MAX = 0.60;

const STANDARD_CAVEAT =
  'DCF, yüksek enflasyon ortamında varsayımlara aşırı duyarlıdır; yalnızca tek bir değerleme girdisidir, yatırım tavsiyesi değildir.';

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Verilen iskonto oranı ve terminal büyüme için hisse başı adil değer.
 * Saf yardımcı — sensitivity grid de bunu kullanır.
 */
function fairValueFor(
  baseFcf: number,
  growth: number,
  r: number,
  tg: number,
  netDebt: number,
  shares: number,
): { fairValue: number; projectedFcf: number[]; terminalValuePct: number } {
  const projectedFcf: number[] = [];
  let fcf = baseFcf;
  let pvExplicit = 0;
  for (let n = 1; n <= PROJECTION_YEARS; n++) {
    const gn = growth * Math.pow(DECAY, n - 1);
    fcf = fcf * (1 + gn);
    projectedFcf.push(fcf);
    pvExplicit += fcf / Math.pow(1 + r, n);
  }
  const lastFcf = projectedFcf[projectedFcf.length - 1];
  const tv = (lastFcf * (1 + tg)) / (r - tg);
  const pvTv = tv / Math.pow(1 + r, PROJECTION_YEARS);
  const ev = pvExplicit + pvTv;
  const equity = ev - netDebt;
  const fairValue = equity / shares;
  const terminalValuePct = ev > 0 ? pvTv / ev : 1;
  return { fairValue, projectedFcf, terminalValuePct };
}

export function computeDcf(input: DcfInput): DcfResult {
  const caveats: string[] = [];
  const r = clamp(input.discountRate ?? DEFAULT_DISCOUNT_RATE, DR_MIN, DR_MAX);

  // 1. Hisse adedi
  if (!input.currentPrice || input.currentPrice <= 0 || !input.marketCap || input.marketCap <= 0) {
    return {
      feasible: false,
      confidence: 'düşük',
      assumptions: { discountRate: r, terminalGrowth: input.terminalGrowth ?? DEFAULT_TERMINAL_GROWTH },
      caveats: ['Güncel fiyat veya piyasa değeri verisi yok; hisse adedi hesaplanamadı.', STANDARD_CAVEAT],
    };
  }
  const shares = input.marketCap / input.currentPrice;

  // 2. Baz FCF belirle
  let baseFcf: number | undefined;
  let fcfSource: 'reported' | 'ebitda-proxy' | undefined;
  if (typeof input.freeCashFlow === 'number' && input.freeCashFlow > 0) {
    baseFcf = input.freeCashFlow;
    fcfSource = 'reported';
  } else if (typeof input.ebitda === 'number' && input.ebitda > 0) {
    baseFcf = input.ebitda * EBITDA_TO_FCF_PROXY;
    fcfSource = 'ebitda-proxy';
    caveats.push(
      `Raporlanmış serbest nakit akışı yok; FAVÖK'ün %${Math.round(EBITDA_TO_FCF_PROXY * 100)}'i proxy olarak kullanıldı (capex/vergi için kaba kesinti).`,
    );
    if (typeof input.freeCashFlow === 'number' && input.freeCashFlow <= 0) {
      caveats.push('Raporlanmış FCF negatif olduğundan FAVÖK proxy tercih edildi.');
    }
  } else {
    return {
      feasible: false,
      confidence: 'düşük',
      assumptions: { discountRate: r, terminalGrowth: input.terminalGrowth ?? DEFAULT_TERMINAL_GROWTH, shares },
      caveats: ['Pozitif serbest nakit akışı veya FAVÖK verisi yok; DCF hesaplanamadı (büyük olasılıkla yedek veri kaynağı kullanıldı).', STANDARD_CAVEAT],
    };
  }

  // 3. Büyüme
  let growth: number;
  if (typeof input.growthYoY === 'number' && isFinite(input.growthYoY)) {
    growth = clamp(input.growthYoY / 100, GROWTH_FLOOR, GROWTH_CAP);
  } else {
    growth = DEFAULT_TERMINAL_GROWTH;
    caveats.push('Büyüme verisi yok; %10 nominal büyüme varsayıldı.');
  }

  // 4. Terminal büyüme + spread guard
  let tg = input.terminalGrowth ?? DEFAULT_TERMINAL_GROWTH;
  if (r - tg < MIN_SPREAD) {
    tg = Math.max(0, r - MIN_SPREAD);
    caveats.push(`İskonto oranı terminal büyümeye çok yakın; terminal büyüme %${(tg * 100).toFixed(1)}'e kısıldı (r−g ≥ %5 kuralı).`);
  }

  // 5. Ana hesap
  const main = fairValueFor(baseFcf, growth, r, tg, input.netDebt ?? 0, shares);
  const fairValuePerShare = main.fairValue;
  const upsidePct = (fairValuePerShare / input.currentPrice - 1) * 100;

  // 6. Duyarlılık (3×3)
  const sensitivity: { discountRate: number; terminalGrowth: number; fairValue: number }[] = [];
  for (const rr of [clamp(r - 0.05, DR_MIN, DR_MAX), r, clamp(r + 0.05, DR_MIN, DR_MAX)]) {
    for (const tgg of [Math.max(0, tg - 0.02), tg, tg + 0.02]) {
      const safeTg = rr - tgg < MIN_SPREAD ? Math.max(0, rr - MIN_SPREAD) : tgg;
      const { fairValue } = fairValueFor(baseFcf, growth, rr, safeTg, input.netDebt ?? 0, shares);
      sensitivity.push({ discountRate: rr, terminalGrowth: safeTg, fairValue });
    }
  }

  // 7. Güven + doğrulama
  let confidence: DcfConfidence = 'yüksek';
  if (fcfSource === 'ebitda-proxy') confidence = 'orta';
  if (typeof input.growthYoY !== 'number') confidence = confidence === 'yüksek' ? 'orta' : confidence;
  if (main.terminalValuePct > 0.9) {
    confidence = 'düşük';
    caveats.push(`Değerin %${(main.terminalValuePct * 100).toFixed(0)}'ı terminal değerden geliyor; sonuç terminal varsayımlara aşırı bağımlı.`);
  }
  if (fairValuePerShare <= 0) {
    confidence = 'düşük';
    caveats.push('Hesaplanan özsermaye değeri negatif (net borç firma değerini aşıyor).');
  }
  if (fairValuePerShare > input.currentPrice * 20) {
    confidence = 'düşük';
    caveats.push('Adil değer güncel fiyatın 20 katından fazla; girdiler gerçekçi olmayabilir, sonuç güvenilmez.');
  }
  caveats.push(STANDARD_CAVEAT);

  return {
    feasible: true,
    fairValuePerShare,
    upsidePct,
    confidence,
    assumptions: {
      baseFcf,
      fcfSource,
      growthRate: growth,
      discountRate: r,
      terminalGrowth: tg,
      shares,
      netDebt: input.netDebt ?? 0,
      projectedFcf: main.projectedFcf,
      terminalValuePct: main.terminalValuePct,
    },
    sensitivity,
    caveats,
  };
}
