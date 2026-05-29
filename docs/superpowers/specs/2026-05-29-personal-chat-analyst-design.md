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
  ├─ chatSessions in-memory map ARTIK BY-PASS  (history client'tan gelir)
  ├─ Agent.create({ model, memoryEnabled: false })  (mevcut)
  ├─ Tool registry'ye 5 yeni tool:
  │     • getKapNews(ticker)              [data]
  │     • getWatchlistContext()           [data — body'deki context'i okur]
  │     • openDeepReport(ticker, dr?)     [action]
  │     • openCompare(tickers[])          [action]
  │     • openPortfolioAnalysis()         [action]
  └─ Action tool'lar fetch ETMEZ; SSE 'tool_action' event'i emit eder
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

`finalQuery` formatı:

```
[KİŞİSEL BAĞLAM]
- Şu an açık hisse: TUPRS (veya "yok")
- Watchlist: AKBNK, GARAN, THYAO
- Portföy: AKBNK x 100 (ort 70 TL), THYAO x 50 (ort 250 TL)

[SOHBET GEÇMİŞİ — son N tur]
user: ...
assistant: ...

[ŞU ANKİ SORU]
{query}
```

`chatSessions[sessionId]` map'i artık kullanılmaz; history client'tan gelir. Sınıf ve map ileride silinebilir (bu özelliğin scope'unda değil).

### 5.2 Yeni tool'lar — `src/agent/tools/`

Mevcut registry pattern'ine uyar (her tool ayrı dosya + `tools/index.ts`'de export):

| Tool | Tip | Input | Çıktı |
|---|---|---|---|
| `getKapNews` | data | `{ ticker: string }` | Son 5 başlık metin (mevcut `/api/kap-news` mantığını fonksiyona çıkarır, paylaşır) |
| `getWatchlistContext` | data | none | Çağrıda body'deki `context`'i okur; metin döner ("Watchlist: ...; Portföy: ...") |
| `openDeepReport` | **action** | `{ ticker: string; discountRate?: number }` (ondalık, örn. 0.30) | SSE: `{type:'tool_action', action:'open-tab', tab:'derinrapor', ticker, discountRate}` (ondalık olarak iletilir). Agent'a kısa text: `"AKBNK için Derin Rapor sekmesi açıldı."` |
| `openCompare` | **action** | `{ tickers: string[] }` | SSE: `{type:'tool_action', action:'open-tab', tab:'compare', tickers}`. Agent'a kısa text. |
| `openPortfolioAnalysis` | **action** | none | SSE: `{type:'tool_action', action:'open-tab', tab:'portfolio'}`. Agent'a kısa text. |

Action tool'ların agent'a döndüğü metin **kısa ve neyi yaptığını söyleyen** bir cümledir, böylece agent kullanıcıya doğal devam yazar ("AKBNK için Derin Rapor sekmesini açtım, hesaplama ~30 sn sürüyor.").

### 5.3 SSE event şeması

Mevcut tipler korunur: `thinking | tool_start | done | error`.
**Eklenen:** `tool_action` — frontend bilmediği tipleri yoksaydığı için geri uyumlu.

```ts
type ToolActionEvent = {
  type: 'tool_action';
  action: 'open-tab';
  tab: 'derinrapor' | 'compare' | 'portfolio';
  ticker?: string;
  discountRate?: number;
  tickers?: string[];
};
```

### 5.4 Hata davranışı

- Data tool fetch hatası → tool catch eder, agent'a hata metni döner, agent kullanıcıya açıklar.
- Action tool'da `ticker` yoksa → tool error fırlatır, agent kullanıcıya sorar ("Hangi hisseyi diyorsunuz?").
- Geçersiz ticker → frontend `fetchData` 404 alır, mevcut error banner gösterilir; sekme geçişi yapılır ama içerik hata gösterir.

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

### 6.2 Auto-context POST body

`handleSendAssistant` içinde:

```ts
const context = {
  openTicker: data?.ticker,
  watchlist,
  portfolio: portfolio.map(p => ({ ticker: p.ticker, shares: p.shares, avgPrice: p.avgPrice })),
};
const history = assistantMessages
  .filter(m => m.role !== 'system')
  .slice(-CHAT_MAX_TURNS)
  .map(m => ({ role: m.role, content: m.content }));

const response = await fetch(`${API_BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, history, context, model: aiChatModel }),
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
| Tool unit testleri | `src/agent/tools/*.test.ts` | Her yeni tool için: mock fetch ile data tool; action tool için emit edilen event şemasının doğrulanması. |
| Chat context formatlayıcı | `src/utils/chat-context.test.ts` | Saf fonksiyon: `formatPersonalContext(context)` → metin (snapshot stil değil, içerik kontrolü). |
| Backend chat request kontratı | `src/utils/chat-request.test.ts` veya inline | `parseChatBody` saf fonksiyonu — history validasyonu, default değerler. |
| Frontend integration smoke | manuel | "AKBNK'ın derin raporunu çıkar" → derinrapor sekmesi + AKBNK fetch + Derin Rapor fetch tetiklenir. |

## 9. Out of Scope (bu spec'te yapılmaz)

- Profil distillation ("muhafazakar, banka odaklı" gibi etiketler) — gelecekte ayrı spec.
- Watchlist mutasyonu ("X'i watchlist'ime ekle") — yan etki riski; ayrı spec gerekirse.
- Çoklu cihaz senkron — auth + DB gerekir; ayrı spec.
- `chatSessions` map'inin temizlenmesi (legacy temizliği) — bu spec'in scope'unda değil, by-pass yeterli.
- Sesli giriş / sesli cevap.

## 10. Uygulama Sırası

1. `src/utils/chat-context.ts` — saf `formatPersonalContext` fonksiyonu + test (TDD).
2. `src/agent/tools/` — 5 yeni tool dosyası + testler (TDD; mock fetch).
3. Tool registry'ye entegrasyon + action event'i SSE'ye bağla (server.ts `/api/chat` içinde).
4. `/api/chat` body kontratı genişlet (history + extended context); finalQuery formatını yeniden yaz.
5. Frontend: assistantMessages persistence + DEFAULT_SYSTEM_MSG sabiti.
6. Frontend: POST body'ye history + context ekle.
7. Frontend: SSE reader'a `tool_action` handler.
8. Frontend: "Geçmişi sil" butonu.
9. Doğrulama: `bun test`, `tsc --noEmit`, `vite build`, manuel smoke (3-4 cümle).
10. Commit + push.

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
