# Kişisel Sohbet Analisti — Tasarım Dökümanı

**Tarih:** 2026-05-29
**Durum:** Onaylı (kullanıcı brainstorming oturumunda yaklaşım 3 + tüm scope kararlarını onayladı)
**İlişkili özellik:** Derin Rapor (2026-05-29-derin-rapor-design.md) — bu spec o sistemi tüketir.

## 1. Amaç

Mevcut "AI Asistan" (sağ alttaki sohbet baloncuğu) bugün uçucu (server restart'ında uçar) ve kullanıcıyı tanımıyor. Bu özellik AI Asistan'ı **kalıcı**, **kişisel bağlamı otomatik bilen** ve **doğal cümlelerle mevcut zengin ekranları (Derin Rapor, Karşılaştırma, Portföy Analizi) açabilen** bir analiste dönüştürür.

Hedef cümleler:
- "AKBNK'ın derin raporunu çıkar." → Derin Rapor sekmesi otomatik açılır, AKBNK için fetch başlar
- "Portföyümü analiz et." → Portfolio sekmesi açılır, mevcut analiz fetch'i tetiklenir
- "GARAN ile YKBNK'ı kıyasla." → Compare sekmesi açılır, iki hisse eklenir
- "TUPRS'ın son KAP haberleri ne?" → Asistan cevabı direkt chat'te verir

## 2. Onaylanmış Kararlar

| Karar | Seçim | Gerekçe |
|---|---|---|
| Storage | **localStorage** | Auth yok; sessionId zaten localStorage'da; backend stateless kalsın. Watchlist/portfolio zaten böyle saklanıyor. |
| Intent kapsamı | **Derin Rapor + Karşılaştırma + Portföy + KAP** (yalnız okuma) | Mutasyon yok (watchlist düzenleme dışarıda) — LLM yanlış anlarsa state bozulmasın. |
| Auto-context | **Sohbet geçmişi + watchlist/portfolio özeti** | Profil distillation YOK (YAGNI + gizlilik). İleride eklenebilir. |
| Yaklaşım | **Hibrit action tool** | Uzun süren işler (Derin Rapor ~30 sn) mevcut zengin UI'da çalışsın, kısa sorgular chat'te kalsın. |

> **Kod incelemesi sonrası düzeltmeler (2026-05-29):** Plan yazımı öncesi `src/agent/` + `src/tools/registry.ts` incelendi. Üç mimari gerçek bu spec'i revize etti:
> 1. **Tool'lar SSE emit edemez.** LangChain `StructuredToolInterface` döndürdüğü string LLM'e `ToolMessage` olarak gider; frontend'e ulaşmaz. Çözüm: action tool sadece onay metni döner; **server.ts `/api/chat` içinde `tool_start` event'i** (zaten `tool`+`args` taşıyor) yakalanıp `tool_action` SSE event'ine çevrilir.
> 2. **Registry global ve generic** (finance/web/browser/cron tool'ları + tüm agent kullanımları onu paylaşır). Dashboard'a özel "sekme aç" tool'ları global registry'yi kirletmesin → yeni `AgentConfig.extraTools` ile **yalnız `/api/chat` agent'ına** enjekte edilir.
> 3. **Data tool'ları düştü.** `getWatchlistContext` gereksiz (watchlist/portföy zaten finalQuery'ye enjekte ediliyor — mevcut `contextStr` bunu kısmen yapıyor). `getKapNews` gereksiz (mevcut `web_search` tool'u ticker-bazlı haberi inline cevaplar). KAP, `open_kap_news` action tool'una dönüştü (mevcut KAP sekmesini açar). **Net: 4 action tool, 0 data tool.**

## 3. Altın Kural (devam eder)

Derin Rapor'dan miras: **sayısal değerleri LLM uydurmaz**. Asistan action tool'ları çağırınca veri yine `getReportBundle`/`computeDcf`/mevcut endpoint'lerden gelir; asistan sadece "açıyorum / yönlendiriyorum" diyen kısa metinler yazar.

## 4. Mimari & Veri Akışı

```
[Kullanıcı → AI Asistan baloncuğu]
        │
        ▼
[Frontend: App.tsx]
  ├─ assistantMessages         (localStorage 'efekt-chat-history', son 20 tur)
  ├─ watchlist (mevcut)        (localStorage 'efekt-watchlist')
  ├─ portfolio (mevcut)        (localStorage 'efekt-portfolio')
  └─ data.ticker (mevcut)      (şu an açık hisse)
        │
        │ POST /api/chat
        │ body: { query, history: [...], context: { openTicker, watchlist, portfolio }, model }
        ▼
[Backend: /api/chat SSE]
  ├─ chatSessions in-memory map ARTIK BY-PASS  (history client'tan gelir, no-LLM seed)
  ├─ Agent.create({ model, memoryEnabled: false, extraTools: dashboardActionTools })
  ├─ extraTools (yalnız bu agent'a enjekte, 4 action tool):
  │     • open_deep_report(ticker, discountRate?)
  │     • open_compare(tickers[])
  │     • open_portfolio_analysis()
  │     • open_kap_news()
  ├─ Tool func'ları yalnız onay metni döner (LLM'e ToolMessage)
  └─ server.ts loop: event.type==='tool_start' && action-tool adı
        → ek olarak 'tool_action' SSE event'i emit eder (args → tab/ticker/...)
        │
        │ SSE events: thinking | tool_start | tool_action | done | error
        ▼
[Frontend SSE reader]
  ├─ type:'tool_action' → setActiveTab + parametre uygula → mevcut useEffect mevcut fetch'i tetikler
  ├─ type:'done' → asistan cevabı baloncuğa eklenir
  └─ assistantMessages → localStorage'a yazılır
```

## 5. Backend Değişiklikleri

### 5.1 `/api/chat` body kontratı (genişler)

```ts
type ChatRequest = {
  query: string;
  history?: { role: 'user' | 'assistant'; content: string }[];   // YENİ — client'tan
  context?: {                                                     // genişledi
    openTicker?: string;
    watchlist?: string[];
    portfolio?: { ticker: string; shares: number; avgPrice?: number }[];
  };
  model?: string;
  sessionId?: string;   // geri uyumluluk için kalır, kullanılmaz
};
```

**Kişisel bağlam (zaten KISMEN var):** Mevcut `/api/chat` frontend'i `context` adında bir string yolluyor (açık hisse + watchlist tickerları + portföy tickerları) ve backend bunu `[EK BİLGİ ...]` olarak finalQuery'ye gömüyor. Bu özellik bunu **zenginleştirir** (portföye `shares`/`avgPrice` ekler) ama mekanizma yeni değil. `context` string olarak kalır (geri uyumlu).

**Sohbet geçmişi (yeni — kalıcılık):** Client `history: {role, content}[]` yollar. Backend bunu **LLM özeti üretmeden** bir `InMemoryChatHistory`'ye seed eder (aşağıda `seedCompletedTurns`), `agent.run(finalQuery, history)`'e geçirir. `chatSessions[sessionId]` map'i artık kullanılmaz; server restart'ta kayıp olmaz çünkü kaynak client'tır. Backend artık `saveUserQuery`/`saveAnswer` ÇAĞIRMAZ (özet LLM çağrılarından kaçınılır; kalıcılık client'ta).

### 5.2 Yeni action tool'ları — `src/tools/dashboard/`

Mevcut tool pattern'ine uyar: `new DynamicStructuredTool({ name, description, schema: z.object({...}), func })` (bkz. `src/tools/skill.ts`). Her tool **fetch ETMEZ**; yalnız LLM'e dönecek kısa onay metni döner. Frontend'e ulaşma işi server.ts'nin `tool_start` yakalamasıyla olur (§5.3).

| Tool | Input (zod) | func dönüşü (LLM'e) |
|---|---|---|
| `open_deep_report` | `{ ticker: string; discountRate?: number }` (ondalık, örn. 0.30) | `"AKBNK için Derin Rapor sekmesi açılıyor (~30 sn)."` |
| `open_compare` | `{ tickers: string[] }` (en az 2) | `"GARAN, YKBNK karşılaştırması açılıyor."` |
| `open_portfolio_analysis` | `{}` (parametresiz) | `"Portföy analizi açılıyor."` |
| `open_kap_news` | `{}` (parametresiz) | `"Günün KAP bildirimleri açılıyor."` |

Bu 4 tool `src/tools/dashboard/index.ts`'te `DASHBOARD_ACTION_TOOLS: StructuredToolInterface[]` ve `DASHBOARD_ACTION_TOOL_NAMES: Set<string>` olarak export edilir. `AgentConfig.extraTools` ile yalnız `/api/chat` agent'ına enjekte edilir; global registry değişmez.

**Ticker-bazlı haber** ("TUPRS'ın son haberleri") yeni tool gerektirmez — mevcut `web_search` tool'u inline cevaplar. `open_kap_news` yalnız genel KAP sekmesini açar.

### 5.3 SSE event şeması

Mevcut tipler korunur: `thinking | tool_start | done | error`.
**Eklenen:** `tool_action` — frontend bilmediği tipleri yoksaydığı için geri uyumlu.

server.ts `/api/chat` döngüsünde, mevcut `tool_start` handler'ın hemen ardına: tool adı bir action-tool ise (`DASHBOARD_ACTION_TOOL_NAMES.has(event.tool)`) saf bir `mapActionEvent(tool, args)` fonksiyonuyla `tool_action` event'i üretip enqueue edilir. Bu eşleme saf + test edilebilir:

```ts
// src/utils/dashboard-action-event.ts (saf, test edilir)
export type ToolActionEvent = {
  type: 'tool_action';
  action: 'open-tab';
  tab: 'derinrapor' | 'compare' | 'portfolio' | 'kap';
  ticker?: string;
  discountRate?: number;
  tickers?: string[];
};
export function mapActionEvent(tool: string, args: Record<string, unknown>): ToolActionEvent | null {
  switch (tool) {
    case 'open_deep_report':
      return { type: 'tool_action', action: 'open-tab', tab: 'derinrapor',
        ticker: String(args.ticker ?? '').toUpperCase(),
        ...(typeof args.discountRate === 'number' ? { discountRate: args.discountRate } : {}) };
    case 'open_compare':
      return { type: 'tool_action', action: 'open-tab', tab: 'compare',
        tickers: Array.isArray(args.tickers) ? args.tickers.map(t => String(t).toUpperCase()) : [] };
    case 'open_portfolio_analysis':
      return { type: 'tool_action', action: 'open-tab', tab: 'portfolio' };
    case 'open_kap_news':
      return { type: 'tool_action', action: 'open-tab', tab: 'kap' };
    default:
      return null;
  }
}
```

### 5.4 Hata davranışı

- Action tool'da zorunlu alan yoksa → zod şeması doğrulamada hata verir, agent ToolMessage'da hatayı görür, kullanıcıya sorar ("Hangi hisseyi diyorsunuz?").
- Geçersiz ticker → frontend `fetchData` 404 alır, mevcut error banner gösterilir; sekme geçişi yapılır ama içerik hata gösterir.

### 5.5 Agent enjeksiyonu + history seeding (backend)

**`AgentConfig.extraTools` (yeni alan):** `src/agent/types.ts`'e `extraTools?: StructuredToolInterface[]` ve `extraToolsConcurrency?: Map<string, boolean>` eklenir. `Agent.create` (agent.ts:72-99) içinde:
```ts
const baseTools = getTools(model);
const tools = [...baseTools, ...(config.extraTools ?? [])];
const concurrencyMap = getToolConcurrencyMap(model);
for (const t of config.extraTools ?? []) {
  concurrencyMap.set(t.name, config.extraToolsConcurrency?.get(t.name) ?? false);
}
```
Action tool'lar `concurrencySafe: false` (yan etki yok ama tekil tetiklensin, sıralama önemli).

`/api/chat`, agent'a action tool'ların adlarını ve ne yaptıklarını kısa bir cümleyle `finalQuery` preamble'ına ekler (system prompt'a girmedikleri için): `"[DASHBOARD AKSİYONLARI] Kullanıcı NET olarak isterse şu tool'ları çağır: open_deep_report (derin DCF raporu), open_compare (2+ hisse kıyas), open_portfolio_analysis (portföy), open_kap_news (günün KAP). Belirsizse çağırma, sor."`

**`InMemoryChatHistory.seedCompletedTurns` (yeni metot):** LLM özeti üretmeden geçmiş turları doldurur:
```ts
seedCompletedTurns(turns: { query: string; answer: string }[]): void {
  for (const t of turns) {
    this.messages.push({ id: this.messages.length, query: t.query, answer: t.answer, summary: t.answer });
  }
}
```

**`pairChatMessages` (yeni saf yardımcı, `src/utils/chat-history-seed.ts`):** Client'ın `{role, content}[]` düz dizisini `{query, answer}[]` turlarına eşler (user→assistant). Eşsiz/askıda user varsa answer `''` olur.

## 6. Frontend Değişiklikleri (`dashboard/src/App.tsx`)

### 6.1 Persistence

```ts
const CHAT_KEY = 'efekt-chat-history';
const CHAT_MAX_TURNS = 20;
const DEFAULT_SYSTEM_MSG = { role: 'system', content: 'Merhaba! Ben Efekt AI. ...' };

const [assistantMessages, setAssistantMessages] = useState(() => {
  const saved = safeLocalStorage.getItem(CHAT_KEY);
  if (!saved) return [DEFAULT_SYSTEM_MSG];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_SYSTEM_MSG];
  } catch {
    return [DEFAULT_SYSTEM_MSG];
  }
});

useEffect(() => {
  // System message korunur; user/assistant son N tur tutulur
  const system = assistantMessages.find(m => m.role === 'system') ?? DEFAULT_SYSTEM_MSG;
  const turns = assistantMessages.filter(m => m.role !== 'system').slice(-CHAT_MAX_TURNS);
  safeLocalStorage.setItem(CHAT_KEY, JSON.stringify([system, ...turns]));
}, [assistantMessages]);
```

### 6.2 POST body — history ekle, context'i zenginleştir

Mevcut `handleAssistantSend` (App.tsx:938) zaten `context` string'i + `sessionId` + `model` yolluyor. **Değişiklik:** (a) `history` ekle, (b) `context` string'ine portföy `shares`/`avgPrice` ekle. `context` string olarak KALIR (backend geri uyumlu).

```ts
// context string'i zenginleştir (mevcut contextStr'e ek):
const portfolioDetail = portfolio.length
  ? portfolio.map(p => `${p.ticker} x${p.shares}${p.avgPrice ? ` (ort ${p.avgPrice} TL)` : ''}`).join(', ')
  : 'boş';
// ...mevcut contextStr içinde `Portföy: ${portfolio.map(p => p.ticker)...}` satırını
//    `Portföy: ${portfolioDetail}` ile değiştir.

// history: system hariç, son N tur, son (boş) assistant placeholder hariç:
const history = assistantMessages
  .filter(m => m.role !== 'system' && m.content.trim() !== '')
  .slice(-CHAT_MAX_TURNS)
  .map(m => ({ role: m.role, content: m.content }));

const response = await fetch(`${API_BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, history, context: contextStr, sessionId, model: aiChatModel }),
});
```

### 6.3 Action handler (SSE reader)

```ts
if (parsed.type === 'tool_action' && parsed.action === 'open-tab') {
  const { tab, ticker, discountRate, tickers } = parsed;

  if (ticker && ticker !== data?.ticker) {
    await fetchData(ticker);  // mevcut fonksiyon, await edilir ki tab açıldığında veri hazır olsun
  }
  if (typeof discountRate === 'number') {
    setDiscountRate(Math.round(discountRate * 100));
  }
  if (Array.isArray(tickers)) {
    for (const t of tickers) await addCompareStock(t);  // mevcut fonksiyon
  }

  setActiveTab(tab);
  setIsAssistantOpen(false);  // asistanı kapat — kullanıcı asıl ekranı görsün
}
```

Mevcut useEffect'ler (Derin Rapor, AI Analiz, Portföy analizi) bu sekme/state değişikliklerinden sonra otomatik fetch'i tetikler — yeni bir entegrasyon noktası gerekmez.

### 6.4 UI küçük dokunuş — "Geçmişi sil"

Asistan başlığına küçük bir buton: `setAssistantMessages([DEFAULT_SYSTEM_MSG])` + localStorage temizler. Gizlilik için zorunlu.

## 7. Hata Yönetimi & Edge Cases

- **localStorage dolu/yazılamıyor** → mevcut `safeLocalStorage` swallow eder; persistence kaybolur ama chat çalışır.
- **SSE bağlantısı kopar** → mevcut AbortController + finally pattern korunur; `isAssistantTyping = false`.
- **Geçmiş çok büyürse** → `slice(-20)` cap.
- **Action tool'da yanlış ticker formatı** → backend `fetchData` 404 verir, mevcut error banner gösterilir; sekme açık kalır.
- **Eski tarayıcı (localStorage yok)** → assistantMessages session-scope'a düşer (mevcut davranış).
- **Birden çok action emit** → frontend sırayla işler (await kullanır).

## 8. Test Stratejisi

| Test | Konum | Kapsam |
|---|---|---|
| `mapActionEvent` | `src/utils/dashboard-action-event.test.ts` | 4 tool adı → doğru `ToolActionEvent` (tab, ticker upper-case, discountRate opsiyonel, tickers upper-case); bilinmeyen ad → null. |
| `pairChatMessages` | `src/utils/chat-history-seed.test.ts` | `{role,content}[]` → `{query,answer}[]`; askıda user → answer ''; boş dizi → []. |
| `seedCompletedTurns` | `src/utils/in-memory-chat-history.test.ts` (varsa ekle) | Seed sonrası `getRecentTurnsAsMessages` doğru sayıda Human/AI mesajı döner; **LLM çağrısı yapılmaz** (summary=answer). |
| Action tool şeması | `src/tools/dashboard/dashboard-tools.test.ts` | Her tool: doğru `name`, zod şeması (open_deep_report ticker zorunlu; open_compare tickers≥2), `func` çağrısı string döner. |
| Frontend integration smoke | manuel | "AKBNK'ın derin raporunu çıkar" → derinrapor sekmesi + AKBNK fetch + Derin Rapor fetch tetiklenir. |

## 9. Out of Scope (bu spec'te yapılmaz)

- Profil distillation ("muhafazakar, banka odaklı" gibi etiketler) — gelecekte ayrı spec.
- Watchlist mutasyonu ("X'i watchlist'ime ekle") — yan etki riski; ayrı spec gerekirse.
- Çoklu cihaz senkron — auth + DB gerekir; ayrı spec.
- `chatSessions` map'inin temizlenmesi (legacy temizliği) — bu spec'in scope'unda değil, by-pass yeterli.
- Sesli giriş / sesli cevap.

## 10. Uygulama Sırası

1. `src/utils/dashboard-action-event.ts` — saf `mapActionEvent` + test (TDD).
2. `src/utils/chat-history-seed.ts` — saf `pairChatMessages` + test (TDD).
3. `InMemoryChatHistory.seedCompletedTurns` metodu + test (no-LLM doğrulaması).
4. `src/tools/dashboard/` — 4 action tool + `index.ts` (export `DASHBOARD_ACTION_TOOLS`, `DASHBOARD_ACTION_TOOL_NAMES`) + test (TDD).
5. `AgentConfig.extraTools`/`extraToolsConcurrency` + `Agent.create` merge (agent.ts).
6. server.ts `/api/chat`: body'ye `history` ekle, seed et, `extraTools` geçir, `tool_start` sonrası `mapActionEvent` ile `tool_action` emit; `saveUserQuery`/`saveAnswer` kaldır.
7. Frontend: `assistantMessages` localStorage persistence + `DEFAULT_SYSTEM_MSG` + `CHAT_KEY`/`CHAT_MAX_TURNS` sabitleri.
8. Frontend: `handleAssistantSend` — `history` ekle, `context` string'ine portföy detayı ekle.
9. Frontend: SSE reader'a `tool_action` handler (tab geç + ticker yükle + tetikle).
10. Frontend: "Geçmişi sil" butonu (asistan başlığı).
11. Doğrulama: `bun test ./src/`, `tsc --noEmit`, `cd dashboard && npm run build`, manuel smoke (4 cümle).
12. Commit + push.

## 11. Riskler

- **Tool yanlış tetiklenir** ("AKBNK ne durumda?" → openDeepReport çağırması). Mitigasyon: tool description'larda "kullanıcı NET olarak rapor/karşılaştırma/analiz istediğinde çağır" notu; düşük güven varsa sorgular.
- **30 sn'lik Derin Rapor sırasında kullanıcı sohbete döner** → sorun değil; rapor arka planda devam eder, kullanıcı istediğinde sekmeye döner.
- **Çok büyük portföy/watchlist** → contextstring şişer. Mitigasyon: portföyü en fazla 20 pozisyona kıs (özet metinde).
- **localStorage 5MB sınırı** → 20 turluk geçmiş + portfolio + watchlist çok altında kalır.

## 12. Başarı Kriterleri

- Kullanıcı "X'in derin raporunu çıkar" yazdığında derinrapor sekmesi açılır ve fetch tetiklenir.
- Tarayıcı kapatılıp açıldıktan sonra önceki sohbet geçmişi görünür.
- "Portföyümü analiz et" yazdığında ticker söylemeye gerek kalmadan portföy sekmesinde analiz tetiklenir.
- Tüm yeni tool'lar için unit testler yeşil; `tsc --noEmit` temiz; vite build başarılı.
