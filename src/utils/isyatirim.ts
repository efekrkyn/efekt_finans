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
}

/**
 * İş Yatırım — Hisse fiyat ve piyasa değeri.
 */
export async function fetchIsYatirimQuote(ticker: string): Promise<IsYatirimQuote | null> {
  const sym = ticker.toUpperCase().replace('.IS', '');
  try {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateStr = `${dd}-${mm}-${yyyy}`;
    // 30 gün öncesi
    const past = new Date(today);
    past.setDate(today.getDate() - 30);
    const ddP = String(past.getDate()).padStart(2, '0');
    const mmP = String(past.getMonth() + 1).padStart(2, '0');
    const yyyyP = past.getFullYear();
    const startStr = `${ddP}-${mmP}-${yyyyP}`;

    const url = `https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil?hisse=${sym}&startdate=${startStr}&enddate=${dateStr}`;
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

    return {
      ticker: sym,
      price,
      change,
      marketCap: latest.PD ? Number(latest.PD) : undefined,
      high: latest.HGDG_MAX ? Number(latest.HGDG_MAX) : undefined,
      low: latest.HGDG_MIN ? Number(latest.HGDG_MIN) : undefined,
      volume: latest.HGDG_HACIM ? Number(latest.HGDG_HACIM) : undefined,
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
