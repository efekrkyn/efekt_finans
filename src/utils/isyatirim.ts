/**
 * İş Yatırım fallback — Yahoo Finance 429 verdiğinde Türk veri kaynağına düş.
 * Bu endpoint'ler public, rate-limit'siz ve Türk borsasına özel.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface IsYatirimQuote {
  ticker: string;
  price: number;
  marketCap?: number;
  change?: number; // gün içi % değişim
  trailingPE?: number;
  priceToBook?: number;
  companyName?: string;
}

/**
 * İş Yatırım — Hisse temel verileri (fiyat, F/K, PD/DD, piyasa değeri).
 * https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil
 */
export async function fetchIsYatirimQuote(ticker: string): Promise<IsYatirimQuote | null> {
  const sym = ticker.toUpperCase().replace('.IS', '');
  try {
    // Bugünün tarihi
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

    const url = `https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil?hisse=${sym}&startdate=${startStr}&enddate=${dateStr}.json`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`İş Yatırım HTTP ${res.status}`);
    const data: any = await res.json();
    const rows: any[] = data?.value || [];
    if (rows.length === 0) return null;

    const latest = rows[rows.length - 1];
    const price = Number(latest.HGDG_KAPANIS ?? latest.HGDG_FK ?? 0);
    if (!price || isNaN(price)) return null;

    // Önceki güne göre değişim
    let change: number | undefined;
    if (rows.length >= 2) {
      const prev = Number(rows[rows.length - 2].HGDG_KAPANIS ?? 0);
      if (prev > 0) change = ((price - prev) / prev) * 100;
    }

    return {
      ticker: sym,
      price,
      change,
      trailingPE: latest.HGDG_FK ? Number(latest.HGDG_FK) : undefined,
      priceToBook: latest.HGDG_PD_DD ? Number(latest.HGDG_PD_DD) : undefined,
      marketCap: latest.HGDG_PIYASA_DEGERI_TL ? Number(latest.HGDG_PIYASA_DEGERI_TL) : undefined,
      companyName: undefined, // ayrı endpoint ile gelir
    };
  } catch (err) {
    console.error(`[isyatirim] ${sym} fetch hatası:`, (err as Error).message);
    return null;
  }
}

/**
 * Şirket adını çek (cache'lenebilir).
 * https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTanim
 */
export async function fetchIsYatirimCompanyName(ticker: string): Promise<string | null> {
  const sym = ticker.toUpperCase().replace('.IS', '');
  try {
    const url = `https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTanim?hisse=${sym}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.value?.[0]?.SIRKET_UNVAN || null;
  } catch {
    return null;
  }
}
