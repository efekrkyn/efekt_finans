# Derin Rapor — AI Derin Yatırım Raporu (Tasarım)

**Tarih:** 2026-05-29
**Durum:** Onaylandı (brainstorming tamamlandı, kararlar kilitli)
**Hedef:** Efekt BIST dashboard'una tek tıkla, deterministik, kaynak-dayanaklı bir derin yatırım raporu eklemek.

## Altın Kural

**Sayılar TypeScript'te hesaplanır; LLM ASLA sayı üretmez — yalnızca düzyazı yazar.**
DCF adil değer, hedef aralık, upside %, çarpanlar, teknik göstergeler — hepsi kodda hesaplanıp prompt'a "yer gerçeği" (ground truth) olarak gömülür. Bu, halüsinasyon rakamlarını engeller.

## Kapsam Dışı (YAGNI)

- İndirilebilir HTML/PDF rapor (sadece in-app streamed markdown).
- Çok-hisseli toplu rapor.
- Yapılandırılmış emsal veritabanı (peer multiples DB). Emsal karşılaştırma Tavily bağlamı + öznenin kendi çarpanlarıyla niteliksel yapılır.
- Terminal büyüme oranı kullanıcı kontrolü (yalnızca iskonto oranı ayarlanabilir; terminal büyüme makul TL varsayılanı + sensitivity grid'de gösterilir).

## Kilitli Kararlar

1. **Ayrı sekme:** Mevcut "AI Analiz" sekmesi KALIR. Yeni, bağımsız "Derin Rapor" sekmesi eklenir.
2. **Tahmini süre etiketi:** Sekme/buton yanında tahmini süre gösterir — `Derin Rapor (~30 sn)`.
3. **Ayarlanabilir iskonto oranı:** UI'da bir kontrol (number input/slider), varsayılan %30 (TL nominal). `discountRate` query param olarak endpoint'e geçer, raporda şeffafça gösterilir.
4. **Nicel çıktı:** DCF adil değer + 12 aylık hedef fiyat aralığı + duruş (Pozitif/Nötr/Negatif).
5. **Veri katmanına göre zarif düşüş (graceful degradation).**

## Mimari — Mevcut Altyapıyla Hizalama

Keşif sırasında bulundu — tekrar yazmaya gerek yok:

- **`fetchBISTData(ticker)` zaten şunları döndürüyor:**
  - `historicalPrices` + `technicalIndicators` (RSI/MACD/SMA20/SMA50 + AL/SAT/NÖTR sinyali) — `computeTechnicalIndicators` ile hesaplanmış.
  - `dataSource: 'yahoo' | 'isyatirim-fallback'` → **bu bizim veri katmanı bayrağımız.**
  - `quarterly`/`annual` dizileri: `ebitda`, `netDebt`, `freeCashFlow`, `stockholdersEquity` vb. (yalnızca Yahoo'da dolu).
  - Yahoo→İş Yatırım fallback'i içeride otomatik.
- **Veri katmanları:**
  - **Tier 1** (`dataSource === 'yahoo'`): tam finansallar → DCF + çarpan analizi mümkün.
  - **Tier 2** (`dataSource === 'isyatirim-fallback'`): yalnızca fiyat + 2 yıllık geçmiş + teknikler. Finansal periyot yok → DCF otomatik atlanır (`feasible:false`).
- **LLM:** `streamLlmWithMessages([SystemMessage, HumanMessage], { model: 'deepseek-chat' })`. Chunk içeriği `typeof content === 'string'` ile filtrelenir (ai-analysis pattern'i).

## Bileşenler

### 1. `src/utils/dcf.ts` (YENİ) — saf DCF matematiği

`src/skills/dcf/SKILL.md` metodolojisini TL'ye uyarlayarak port et. **Yan etkisiz, tam test edilebilir.**

**Girdi** (`BISTAnalysisResult`'tan türetilir):
- `shares = marketCap / currentPrice` (currentPrice > 0 guard).
- Baz FCF: son yıllık `freeCashFlow`. Yoksa son yıllık `ebitda × EBITDA_TO_FCF_PROXY` (0.6, capex/vergi kabaca düşülmüş — `fcfSource:'ebitda-proxy'` + caveat + güven düşür). İkisi de yoksa → `feasible:false`.
- Büyüme `g`: `scorecard.ebitdaGrowthYoY` (yoksa `revenueGrowthYoY`), `clamp(g, -0.10, 0.25)` (TL nominal yüksek olabilir).
- İskonto oranı `r`: parametre, varsayılan 0.30.
- Terminal büyüme `tg`: `DEFAULT_TERMINAL_GROWTH = 0.10` (TL nominal). Guard: `r - tg ≥ 0.05` (değilse tg'yi kıs + caveat).

**Yöntem:**
1. 5 yıl projeksiyon: `g_n = g × DECAY^(n-1)`, `DECAY = 0.85`; `FCF_n = FCF_{n-1} × (1+g_n)`.
2. PV(FCF) = `Σ FCF_n / (1+r)^n`, n=1..5.
3. Terminal: `TV = FCF_5 × (1+tg) / (r-tg)`; `PV_TV = TV / (1+r)^5`.
4. `EV = PV(FCF) + PV_TV`; `Equity = EV − (netDebt ?? 0)`; `fairValuePerShare = Equity / shares`.
5. `upsidePct = (fairValuePerShare/currentPrice − 1) × 100`.
6. Sensitivity 3×3: `r ∈ {r−.05, r, r+.05}` × `tg ∈ {tg−.02, tg, tg+.02}`.

**Doğrulama/clamp & güven:**
- `fairValuePerShare ≤ 0` veya `> currentPrice×20` → düşük güven + clamp/flag.
- `terminalValuePct > 0.9` → "terminal değere aşırı bağımlı" caveat.
- `fcfSource === 'ebitda-proxy'` → güven en fazla "orta".
- Tüm DCF'lere standart caveat: yüksek enflasyon ortamında TL DCF hassastır; yatırım tavsiyesi değildir.

**Dönüş tipi:**
```ts
interface DcfResult {
  feasible: boolean;
  fairValuePerShare?: number;
  upsidePct?: number;
  confidence: 'yüksek' | 'orta' | 'düşük';
  assumptions: {
    baseFcf?: number; fcfSource?: 'reported' | 'ebitda-proxy';
    growthRate?: number; discountRate: number; terminalGrowth: number;
    shares?: number; netDebt?: number; projectedFcf?: number[]; terminalValuePct?: number;
  };
  sensitivity?: { discountRate: number; terminalGrowth: number; fairValue: number }[];
  caveats: string[];
}
export function computeDcf(input: DcfInput): DcfResult
```

### 2. `src/utils/report-data.ts` (YENİ) — sentez çekirdeği

`getReportBundle(ticker, { discountRate })`:
1. `fetchBISTData(ticker)` (teknikler + tier + finansallar bir arada).
2. `computeDcf(...)` — son yıllık periyottan girdiler.
3. `searchTavily("${companyName} (${ticker}) hisse son haberler", { topic:'news', days:7 })`.
4. Emsal bağlamı: `searchTavily("BIST ${ticker} sektörü rakipleri kıyaslama", { topic:'general' })` (niteliksel; öznenin F/K, PD/DD, FD/FAVÖK çarpanları yer gerçeği olarak ayrı geçer).
5. **12 aylık hedef fiyat aralığı** (kodda, deterministik): DCF feasible ise sensitivity grid'in min/max fairValue'su; değilse teknik bantlardan (örn. son fiyat ± 1σ veya SMA50/SMA200 bandı) türet ve "değerleme-temelli değil" diye işaretle.
6. **Duruş** (kodda): upside% + teknik sinyal birleşimi → Pozitif (upside>+15% & sinyal≠SAT) / Negatif (upside<−15% veya sinyal=SAT) / Nötr.

`ReportBundle` tipi: `{ ticker, companyName, currentPrice, marketCap, multiples{trailingPE,priceToBook,evToEbitda}, scorecard, technicals, dcf, news, peerContext, targetRange{low,high,basis}, stance, tier }`. Eksik her alan açık `null`/işaretle gelir → LLM uydurmaz. Çekirdek gelecekteki özellikler (A/C) için yeniden kullanılabilir.

### 3. `/api/deep-report` (server.ts, YENİ SSE endpoint)

ai-analysis pattern'i (satır 312-409) aynalanır.
- Params: `ticker` (zorunlu), `discountRate` (opsiyonel, parse → 0.05–0.60 aralığına clamp, varsayılan 0.30).
- `requireApiKey()` + `rateLimit(req, 10, 60000)`.
- `cacheGet`/`cacheSet` anahtar: `deep-report:${ticker}:${tier}:${discountRate}`, TTL ~30 dk. Cache hit → metni chunk'lara bölüp replay.
- `getReportBundle` çağrılır; tüm sayılar prompt'a ground truth gömülür.
- İlk SSE event: hesaplanmış özet (`summary` objesi: stance, fairValue, targetRange, currentPrice, upsidePct, confidence, tier) → UI özet kartını anında çizer.
- Sonra tek `streamLlmWithMessages(..., {model:'deepseek-chat'})` geçişi, markdown bölümler:
  1. Özet / TL;DR + gerekçe
  2. Finansal Sağlık
  3. Değerleme (DCF varsayımları tablosu + çarpan çapraz kontrolü). Tier 2 ise "tam finansal veri yok, DCF atlandı" notu.
  4. Teknik Görünüm (RSI/MACD/SMA + sinyal)
  5. Emsal Karşılaştırma (niteliksel, Tavily bağlamı)
  6. Haber & Katalizör
  7. Boğa / Ayı senaryosu (steelman + "şu olursa tez yanlış"; write-memo tonu — yasaklı kelimelerden kaçın: delve/leverage/robust/comprehensive/seamless/moreover; tricolon yok; paragraf başına en fazla bir em-dash)
  8. Sonuç & Riskler + disclaimer: **"Bu rapor yatırım danışmanlığı kapsamında değildir."**
  9. Sonda: `[SENTIMENT]: positive: X, neutral: Y, negative: Z` (toplam 100).

### 4. `dashboard/src/App.tsx` (DÜZENLE)

- `activeTab` union'a `'derinrapor'` ekle (mevcut `'ai'` KALIR).
- Hisse-detay sekme barına "Derin Rapor (~30 sn)" girişi (tahmini süre etiketli).
- İskonto oranı kontrolü: number input/slider, %5–%60, varsayılan %30. Değer `discountRate` query param (ondalık: 0.30) olarak gönderilir.
- Render:
  - Hesaplanmış **özet kartı**: renkli duruş rozeti (yeşil/gri/kırmızı), Adil Değer, 12-ay Hedef aralığı, Güncel fiyat, Yükseliş %, Güven, Veri katmanı rozeti.
  - Streamed markdown → mevcut `parseMarkdown()`.
  - Sentiment bar → mevcut `[SENTIMENT]` parse mantığı.
- Akış: `${API_BASE}/api/deep-report?ticker=...&discountRate=...` (EventSource/fetch-stream, ai tab pattern'i).

### 5. Testler

- `src/utils/dcf.test.ts` (Bun test):
  - Bilinen girdiler → elle hesaplanmış fair value (tolerans ±%1).
  - `freeCashFlow` yok + `ebitda` var → `fcfSource:'ebitda-proxy'`, güven ≤ orta.
  - FCF ve EBITDA yok → `feasible:false`.
  - `shares ≤ 0` (currentPrice 0) → `feasible:false`.
  - `r - tg < 0.05` → tg kısılır, caveat eklenir.
  - Saçma çıktı (fair > price×20) → düşük güven flag.
- Çalıştır: `bun test ./src/` ve `npx tsc --noEmit` → exit 0.

## Uygulama Sırası (plan)

1. TDD: `dcf.test.ts` yaz → `dcf.ts` yaz → yeşil.
2. `report-data.ts` yaz (dcf + fetchBISTData + Tavily + stance/targetRange).
3. `/api/deep-report` endpoint'i ekle (server.ts), cache + SSE.
4. `App.tsx` Derin Rapor sekmesi + iskonto kontrolü + özet kartı + stream + sentiment.
5. `bun test ./src/` + `npx tsc --noEmit` + `cd dashboard && npm run build` → hepsi yeşil.
6. Commit + push `main` (Render + Vercel auto-deploy). `.env`/secret ASLA commit edilmez.

## Riskler

- TL yüksek-enflasyon DCF'i kırılgan → ağır caveat + ayarlanabilir iskonto + sensitivity grid ile şeffaflaştırıldı; rapor DCF'i tek doğru değil, bir girdi olarak sunar.
- EBITDA→FCF proxy aggressive → açıkça işaretli + güven düşürülür.
- Tavily/LLM gecikmesi → ~30 sn etiketi beklenti yönetir; cache tekrar isteklerde hızlandırır.
