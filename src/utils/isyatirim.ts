/**
 * İş Yatırım fallback — Yahoo Finance 429 verdiğinde Türk veri kaynağına düş.
 * Bu endpoint public, rate-limit'siz ve Türk borsasına özel.
 *
 * Çalışan endpoint: /HisseTekil (fiyat, hacim, piyasa değeri verir).
 * /SirketTemelturkce ve /HisseTanim auth gerektiriyor (401).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface IsYatirimQuote {
  ticker: string;
  price: number;
  marketCap?: number;
  change?: number; // gün içi % değişim
  high?: number;
  low?: number;
  volume?: number;
  /** Son ~600 günün kapanış serisi (teknik indikatör + chart için) */
  history: { date: string; close: number; high?: number; low?: number }[];
}

function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function parseTrDate(s: string): string {
  // "26-05-2026" → "2026-05-26"
  const [dd, mm, yyyy] = s.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * İş Yatırım — Hisse fiyat + piyasa değeri + ~2 yıllık günlük kapanış.
 */
export async function fetchIsYatirimQuote(ticker: string): Promise<IsYatirimQuote | null> {
  const sym = ticker.toUpperCase().replace('.IS', '');
  try {
    const today = new Date();
    const past = new Date(today);
    past.setFullYear(today.getFullYear() - 2); // 2 yıl geriye

    const url = `https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil?hisse=${sym}&startdate=${ddmmyyyy(past)}&enddate=${ddmmyyyy(today)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`İş Yatırım HTTP ${res.status}`);
    const data: any = await res.json();
    const rows: any[] = data?.value || [];
    if (rows.length === 0) return null;

    const latest = rows[rows.length - 1];
    const price = Number(latest.HGDG_KAPANIS ?? latest.HG_KAPANIS ?? 0);
    if (!price || isNaN(price)) return null;

    // Önceki güne göre değişim
    let change: number | undefined;
    if (rows.length >= 2) {
      const prev = Number(rows[rows.length - 2].HGDG_KAPANIS ?? rows[rows.length - 2].HG_KAPANIS ?? 0);
      if (prev > 0) change = ((price - prev) / prev) * 100;
    }

    const history = rows
      .map((r: any) => {
        const c = Number(r.HGDG_KAPANIS ?? r.HG_KAPANIS ?? NaN);
        const h = Number(r.HGDG_MAX ?? NaN);
        const l = Number(r.HGDG_MIN ?? NaN);
        if (!isFinite(c)) return null;
        const dateStr = typeof r.HGDG_TARIH === 'string' ? parseTrDate(r.HGDG_TARIH) : null;
        if (!dateStr) return null;
        return { date: dateStr, close: c, high: isFinite(h) ? h : undefined, low: isFinite(l) ? l : undefined };
      })
      .filter((x): x is { date: string; close: number; high?: number; low?: number } => x !== null);

    return {
      ticker: sym,
      price,
      change,
      marketCap: latest.PD ? Number(latest.PD) : undefined,
      high: latest.HGDG_MAX ? Number(latest.HGDG_MAX) : undefined,
      low: latest.HGDG_MIN ? Number(latest.HGDG_MIN) : undefined,
      volume: latest.HGDG_HACIM ? Number(latest.HGDG_HACIM) : undefined,
      history,
    };
  } catch (err) {
    console.error(`[isyatirim] ${sym} fetch hatası:`, (err as Error).message);
    return null;
  }
}

/**
 * Şirket adı — public endpoint 401 dönüyor, sembolün kendisini fallback olarak kullan.
 */
export async function fetchIsYatirimCompanyName(ticker: string): Promise<string | null> {
  // Public auth-free endpoint yok; sembolün kendisini döndür.
  return ticker.toUpperCase().replace('.IS', '');
}
