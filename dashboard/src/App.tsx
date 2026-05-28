import React, { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { 
  Search, ArrowUpRight, Activity, TrendingUp, Download, Briefcase, 
  ChevronRight, BarChart, Bell, BellRing, User, LayoutGrid, Calendar, List, MessageSquare, Menu, Sun, Moon, Monitor, BrainCircuit, Sparkles, Loader2, X } from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart as RechartsBar, Bar, LineChart, Line } from 'recharts';
import { CandlestickChart } from './CandlestickChart';
import { InfoTooltip } from './InfoTooltip';

const API_BASE = window.location.hostname === 'localhost' ? '' : 'https://efekt-finans.onrender.com';

const GLOSSARY = {
  pe: <><strong>F/K (Fiyat / Kazanç):</strong> Şirketin piyasa değerinin yıllık net kâra bölümü.<br/><strong>Formül:</strong> Piyasa Değeri / Net Kâr<br/><strong>Yorum:</strong> Düşük F/K genellikle ucuz, ama sektör bağımlı. BIST için &lt;10 ucuz sayılır.</>,
  pb: <><strong>PD/DD (Piyasa Değeri / Defter Değeri):</strong> Piyasanın şirkete biçtiği değer / Özsermaye.<br/><strong>Formül:</strong> Piyasa Değeri / Özsermaye<br/><strong>Yorum:</strong> &lt;1 değer altında, 1-3 normal, &gt;3 pahalı.</>,
  evEbitda: <><strong>FD/FAVÖK:</strong> Firma Değeri / Faiz, Amortisman, Vergi Öncesi Kâr.<br/><strong>Yorum:</strong> Borçlu şirketleri F/K'dan daha iyi karşılaştırır. &lt;6 cazip.</>,
  ebitda: <><strong>FAVÖK (EBITDA):</strong> Şirketin asıl operasyonundan gelen kâr.<br/><strong>Formül:</strong> Net Kâr + Faiz + Vergi + Amortisman<br/><strong>Yorum:</strong> Şirketler arası operasyonel verimlilik karşılaştırması.</>,
  marketCap: <><strong>Piyasa Değeri:</strong> Şirketin tüm hisselerinin toplam değeri.<br/><strong>Formül:</strong> Hisse Fiyatı × Çıkarılmış Hisse Sayısı</>,
  rsi: <><strong>RSI (Relative Strength Index):</strong> Son 14 günün momentum göstergesi (0-100).<br/><strong>Yorum:</strong> &gt;70 aşırı alım (satış sinyali), &lt;30 aşırı satım (alış sinyali).</>,
  macd: <><strong>MACD:</strong> 12-26 günlük EMA'ların farkı. Trend dönüşü tespiti.<br/><strong>Yorum:</strong> Sinyal çizgisini yukarı keserse alış, aşağı keserse satış.</>,
  sma: <><strong>SMA (Simple Moving Average):</strong> Belirli gün sayısının basit ortalaması.<br/><strong>Yorum:</strong> Fiyat SMA20 üstündeyse kısa vadeli yükseliş trendi.</>,
};

function ClickableCard({ onActivate, ariaLabel, children, ...rest }: any) {
  return (
    <div 
      role="button" 
      tabIndex={0} 
      aria-label={ariaLabel}
      onClick={onActivate}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
      {...rest}
    >
      {children}
    </div>
  );
}

interface PeriodData {
  date: string;
  periodLabel: string;
  totalRevenue?: number;
  grossProfit?: number;
  operatingIncome?: number;
  ebitda?: number;
  netIncome?: number;
  currentAssets?: number;
  nonCurrentAssets?: number;
  totalAssets?: number;
  currentLiabilities?: number;
  nonCurrentLiabilities?: number;
  netDebt?: number;
  stockholdersEquity?: number;
  freeCashFlow?: number;
}

interface Scorecard {
  revenueGrowthQoQ?: number; revenueGrowthYoY?: number;
  ebitdaGrowthQoQ?: number;  ebitdaGrowthYoY?: number;
  netIncomeGrowthQoQ?: number; netIncomeGrowthYoY?: number;
}

interface SearchHit { ticker: string; symbol: string; name: string; exchange?: string; }

interface MarketSummary { 
  xu100?: {price?:number;change?:number}|null; 
  usdtry?: {price?:number;change?:number}|null; 
  eurtry?: {price?:number;change?:number}|null; 
}

interface TechnicalIndicators {
  rsi?: number;
  macd?: { macdLine: number; signalLine: number; histogram: number; };
  sma20?: number;
  sma50?: number;
  signal: 'AL' | 'SAT' | 'NÖTR';
  rsiSignal: 'AŞIRI ALIM' | 'AŞIRI SATIM' | 'NÖTR';
}

interface AnalysisResult {
  ticker: string;
  companyName: string;
  currentPrice: number;
  marketCap: number;
  trailingPE?: number;
  priceToBook?: number;
  evToEbitda?: number;
  currency: string;
  quarterly: PeriodData[];
  annual: PeriodData[];
  scorecard: Scorecard;
  technicalIndicators?: TechnicalIndicators;
}

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

const safeLocalStorage = {
  getItem(key: string): string | null {
    if (!isBrowser) return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (!isBrowser) return;
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  removeItem(key: string): void {
    if (!isBrowser) return;
    try {
      localStorage.removeItem(key);
    } catch {}
  }
};

function getSessionId() {
  let id = safeLocalStorage.getItem('dexter-session-id');
  if (!id) { id = crypto.randomUUID(); safeLocalStorage.setItem('dexter-session-id', id); }
  return id;
}
const sessionId = getSessionId();

export default function App() {
  const [theme, setTheme] = useState<'dark'|'light'|'system'>(() => {
    return (safeLocalStorage.getItem('dexter-theme') as any) || 'dark';
  });

  useEffect(() => {
    const apply = () => {
      let effective: 'dark'|'light' = 'dark';
      if (theme === 'system') {
        effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } else {
        effective = theme;
      }
      document.documentElement.setAttribute('data-theme', effective);
    };
    apply();
    safeLocalStorage.setItem('dexter-theme', theme);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  const [activeTab, setActiveTab] = useState<'quarterly'|'annual'|'charts'|'ai'|'compare'|'fund'|'watchlist'|'agenda'|'assistant'|'portfolio'|'kap'|'screener'|'global'|'heatmap'|'backtest'|'alerts'|'macro'>('quarterly');
  const [tickerInput, setTickerInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<AnalysisResult | null>(null);

  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  
  const [fundThemeInput, setFundThemeInput] = useState('');
  const [fundRecommendation, setFundRecommendation] = useState('');
  const [fundLoading, setFundLoading] = useState(false);
  const [fundError, setFundError] = useState('');
  
  const [aiSentiment, setAiSentiment] = useState<{positive:number, neutral:number, negative:number} | null>(null);

  const [compareInput, setCompareInput] = useState('');
  const [compareSuggestions, setCompareSuggestions] = useState<SearchHit[]>([]);
  const [compareStocks, setCompareStocks] = useState<AnalysisResult[]>([]);

  // AI Assistant State
  const [aiChatModel, setAiChatModel] = useState('deepseek-v4-pro');
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<{role: 'user'|'assistant'|'system', content: string}[]>([
    { role: 'system', content: 'Merhaba! Ben Efekt AI. BIST hisseleri hakkında analiz, karşılaştırma veya fon oluşturma konularında sana yardımcı olabilirim.' }
  ]);
  const [assistantInput, setAssistantInput] = useState('');
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('');

  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const [kapDisclosures, setKapDisclosures] = useState<{title:string, url:string, snippet:string, publishedDate:string|null}[]>([]);
  const [kapLoading, setKapLoading] = useState(false);
  const [dividends, setDividends] = useState<{date:string, amount:number}[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);

  const [priceHistory, setPriceHistory] = useState<{points: {date: string, close: number, volume: number}[]} | null>(null);
  const [priceRange, setPriceRange] = useState<'1m'|'3m'|'6m'|'1y'|'5y'>('1y');
  const [chartType, setChartType] = useState<'line'|'candle'>('candle');

  const [screenerFilters, setScreenerFilters] = useState({minPE:'', maxPE:'', minPB:'', maxPB:'', minRevGrowth:''});
  const [screenerResults, setScreenerResults] = useState<any[]>([]);
  const [screenerLoading, setScreenerLoading] = useState(false);

  type GlobalAsset = { ticker:string, companyName:string, currentPrice:number, change:number, currency:string, assetType:string };
  const [globalAssets, setGlobalAssets] = useState<GlobalAsset[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);

  const [heatmapData, setHeatmapData] = useState<any[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'heatmap' && heatmapData.length === 0) {
      setHeatmapLoading(true);
      fetch(`${API_BASE}/api/heatmap`)
        .then(r => r.json())
        .then(d => { setHeatmapData(Array.isArray(d) ? d : []); setHeatmapLoading(false); })
        .catch(() => setHeatmapLoading(false));
    }
  }, [activeTab, heatmapData.length]);

  useEffect(() => {
    if (activeTab === 'kap' && !globalKapNews && !globalKapLoading) {
      const fetchKap = async () => {
        setGlobalKapLoading(true);
        setGlobalKapNews('');
        try {
          const res = await fetch(`${API_BASE}/api/kap-news`, {
            headers: { 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` }
          });
          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          if (reader) {
            let chunk = await reader.read();
            while (!chunk.done) {
              const lines = decoder.decode(chunk.value).split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') break;
                  try {
                    const parsed = JSON.parse(data);
                    if (parsed.chunk) setGlobalKapNews(prev => prev + parsed.chunk);
                  } catch (e) {}
                }
              }
              chunk = await reader.read();
            }
          }
        } catch (e) {
          setGlobalKapNews('Hata oluştu.');
        } finally {
          setGlobalKapLoading(false);
        }
      };
      fetchKap();
    }
  }, [activeTab]);

  const GLOBAL_SYMBOLS = {
    'ABD Hisseleri': ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA'],
    'Döviz': ['TRY=X','EURTRY=X','GBPTRY=X','EURUSD=X'],
    'Emtia': ['GC=F','SI=F','CL=F'],
    'Kripto': ['BTC-USD','ETH-USD','SOL-USD']
  };

  useEffect(() => {
    if (activeTab !== 'global') return;
    setGlobalLoading(true);
    const allSymbols = Object.values(GLOBAL_SYMBOLS).flat();
    Promise.all(allSymbols.map(s =>
      fetch(`${API_BASE}/api/asset?symbol=${encodeURIComponent(s)}`).then(r => r.json()).catch(() => null)
    )).then(results => {
      setGlobalAssets(results.filter(r => r && !r.error));
      setGlobalLoading(false);
    });
  }, [activeTab]);

  const runScreener = async () => {
    setScreenerLoading(true);
    setScreenerResults([]);
    try {
      const params = new URLSearchParams();
      Object.entries(screenerFilters).forEach(([k,v]) => { if (v) params.set(k, v); });
      const res = await fetch(`${API_BASE}/api/screener?${params.toString()}`);
      const json = await res.json();
      setScreenerResults(json.results || []);
    } catch (e) { console.error(e); }
    finally { setScreenerLoading(false); }
  };

  useEffect(() => {
    if (data) {
      setSentimentLoading(true);
      setSentimentData(null);
      fetch(`${API_BASE}/api/sentiment?ticker=${data.ticker}`, { headers: { 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` } })
        .then(r => r.json())
        .then(d => { setSentimentData(d); setSentimentLoading(false); })
        .catch(() => setSentimentLoading(false));
    }
  }, [data]);

  useEffect(() => {
    if (activeTab === 'charts' && data) {
      fetch(`${API_BASE}/api/price-history?ticker=${data.ticker}&range=${priceRange}`)
        .then(r => r.json())
        .then(setPriceHistory)
        .catch(e => console.error(e));
    }
  }, [activeTab, data, priceRange]);


  type Position = { ticker: string; lots: number; entryPrice: number; entryDate: string };
  const [portfolio, setPortfolio] = useState<Position[]>(() => {
    try {
      const saved = safeLocalStorage.getItem('dexter-portfolio');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [portfolioPrices, setPortfolioPrices] = useState<Record<string, number>>({});
  
  const [portfolioAnalysis, setPortfolioAnalysis] = useState('');
  const [portfolioAiLoading, setPortfolioAiLoading] = useState(false);
  const [portfolioAiError, setPortfolioAiError] = useState<string | null>(null);

  const [globalKapNews, setGlobalKapNews] = useState('');
  const [globalKapLoading, setGlobalKapLoading] = useState(false);
  
  const [sentimentData, setSentimentData] = useState<{score: number, summary: string} | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);

  const [peerCompareData, setPeerCompareData] = useState('');
  const [peerCompareLoading, setPeerCompareLoading] = useState(false);

  const runPeerCompare = async () => {
    if (!data) return;
    setPeerCompareLoading(true);
    setPeerCompareData('');
    try {
      const res = await fetch(`${API_BASE}/api/peer-compare?ticker=${data.ticker}`, {
        headers: { 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` }
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let chunk = await reader.read();
        while (!chunk.done) {
          const lines = decoder.decode(chunk.value).split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const str = line.slice(6);
              if (str === '[DONE]') break;
              try {
                const parsed = JSON.parse(str);
                if (parsed.chunk) setPeerCompareData(prev => prev + parsed.chunk);
              } catch (e) {}
            }
          }
          chunk = await reader.read();
        }
      }
    } catch (e) {} finally {
      setPeerCompareLoading(false);
    }
  };

  const [backtestTicker, setBacktestTicker] = useState('THYAO');
  const [backtestYears, setBacktestYears] = useState(3);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  const runBacktest = async () => {
    setBacktestLoading(true);
    setBacktestError(null);
    try {
      const res = await fetch(`${API_BASE}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: backtestTicker.toUpperCase(), strategy: 'sma', years: backtestYears })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');
      setBacktestResult(data);
    } catch (e: any) {
      setBacktestError(e.message);
    } finally {
      setBacktestLoading(false);
    }
  };
  
  const optimizePortfolio = async () => {
    if (portfolio.length === 0) return;
    setPortfolioAiLoading(true);
    setPortfolioAnalysis('');
    setPortfolioAiError(null);
    try {
      const res = await fetch(`${API_BASE}/api/portfolio-optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` },
        body: JSON.stringify({ portfolio })
      });
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let chunk = await reader.read();
        while (!chunk.done) {
          const lines = decoder.decode(chunk.value).split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.error) { setPortfolioAiError(parsed.error); break; }
                if (parsed.chunk) setPortfolioAnalysis(prev => prev + parsed.chunk);
              } catch (e) {}
            }
          }
          chunk = await reader.read();
        }
      }
    } catch (e: any) {
      setPortfolioAiError(e.message);
    } finally {
      setPortfolioAiLoading(false);
    }
  };

  const [dividendData, setDividendData] = useState('');
  const [dividendLoading, setDividendLoading] = useState(false);
  const [monthlyAddition, setMonthlyAddition] = useState(5000);

  const runDividendPlanner = async () => {
    if (portfolio.length === 0) return;
    setDividendLoading(true);
    setDividendData('');
    try {
      const res = await fetch(`${API_BASE}/api/dividend-planner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` },
        body: JSON.stringify({ portfolio, monthlyAddition })
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let chunk = await reader.read();
        while (!chunk.done) {
          const lines = decoder.decode(chunk.value).split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const str = line.slice(6);
              if (str === '[DONE]') break;
              try {
                const parsed = JSON.parse(str);
                if (parsed.chunk) setDividendData(prev => prev + parsed.chunk);
              } catch (e) {}
            }
          }
          chunk = await reader.read();
        }
      }
    } catch (e) {} finally {
      setDividendLoading(false);
    }
  };

  useEffect(() => {
    safeLocalStorage.setItem('dexter-portfolio', JSON.stringify(portfolio));
  }, [portfolio]);

  useEffect(() => {
    if (activeTab !== 'portfolio' || portfolio.length === 0) return;
    Promise.all(portfolio.map(p =>
      fetch(`${API_BASE}/api/analysis?ticker=${p.ticker}`).then(r => r.json()).catch(() => null)
    )).then(results => {
      const prices: Record<string, number> = {};
      results.forEach((r: any, i) => { if (r?.currentPrice) prices[portfolio[i].ticker] = r.currentPrice; });
      setPortfolioPrices(prices);
    });
  }, [activeTab, portfolio]);


  type Alert = { id: string; ticker: string; condition: 'above'|'below'; price: number; createdAt: string };
  const [alerts, setAlerts] = useState<Alert[]>(() => {
    try { return JSON.parse(safeLocalStorage.getItem('dexter-alerts') || '[]'); } catch { return []; }
  });
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [triggeredAlerts, setTriggeredAlerts] = useState<Alert[]>([]);
  
  const [macroData, setMacroData] = useState('');
  const [macroLoading, setMacroLoading] = useState(false);
  const runMacroAnalysis = async () => {
    setMacroLoading(true);
    setMacroData('');
    try {
      const res = await fetch(`${API_BASE}/api/macro-analysis`, {
        headers: { 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` }
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let chunk = await reader.read();
        while (!chunk.done) {
          const lines = decoder.decode(chunk.value).split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const str = line.slice(6);
              if (str === '[DONE]') break;
              try {
                const parsed = JSON.parse(str);
                if (parsed.chunk) setMacroData(prev => prev + parsed.chunk);
              } catch (e) {}
            }
          }
          chunk = await reader.read();
        }
      }
    } catch (e) {} finally {
      setMacroLoading(false);
    }
  };

  const [smartAlertInput, setSmartAlertInput] = useState('');
  const [smartAlertLoading, setSmartAlertLoading] = useState(false);

  const createSmartAlert = async () => {
    if (!smartAlertInput.trim()) return;
    setSmartAlertLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/alerts/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` },
        body: JSON.stringify({ query: smartAlertInput })
      });
      const data = await res.json();
      if (data && data.ticker && data.price && data.condition) {
        setAlerts(p => [...p, { id: crypto.randomUUID(), ticker: data.ticker, condition: data.condition, price: Number(data.price), createdAt: new Date().toISOString() }]);
        setSmartAlertInput('');
        alert(`Akıllı Alarm Başarıyla Kuruldu: ${data.ticker} ${data.condition === 'above' ? '≥' : '≤'} ${data.price} ₺`);
      } else {
        alert('Alarm algılanamadı, lütfen daha net yazın (Örn: THYAO 300 üzerine çıkarsa uyar)');
      }
    } catch (e) {
      alert('Yapay zeka alarmı parse edemedi.');
    } finally {
      setSmartAlertLoading(false);
    }
  };

  useEffect(() => { safeLocalStorage.setItem('dexter-alerts', JSON.stringify(alerts)); }, [alerts]);

  useEffect(() => {
    if (alerts.length === 0) return;
    const check = async () => {
      const uniqueTickers = [...new Set(alerts.map(a => a.ticker))];
      const prices: Record<string, number> = {};
      await Promise.all(uniqueTickers.map(async t => {
        try {
          const r = await fetch(`${API_BASE}/api/analysis?ticker=${t}`);
          const j = await r.json();
          if (j.currentPrice) prices[t] = j.currentPrice;
        } catch {}
      }));
      const newTriggers: Alert[] = [];
      alerts.forEach(a => {
        const p = prices[a.ticker];
        if (!p) return;
        if (a.condition === 'above' && p >= a.price) newTriggers.push(a);
        if (a.condition === 'below' && p <= a.price) newTriggers.push(a);
      });
      if (newTriggers.length) {
        setTriggeredAlerts(prev => [...prev, ...newTriggers]);
        if ('serviceWorker' in navigator && Notification.permission === 'granted') {
          navigator.serviceWorker.ready.then(reg => {
            newTriggers.forEach(a => reg.showNotification(`${a.ticker} hedefe ulaştı`, {
              body: `${a.condition === 'above' ? '≥' : '≤'} ${a.price} ₺ (güncel: ${prices[a.ticker].toFixed(2)} ₺)`,
              icon: '/icon.svg',
              badge: '/icon.svg',
              tag: a.id
            }));
          });
        }
        setAlerts(prev => prev.filter(a => !newTriggers.find(t => t.id === a.id)));
      }
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, [alerts]);


  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);


  const searchRef = useRef<HTMLDivElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [assistantMessages, assistantStatus]);

  const didMountRef = useRef(false);

  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;

    try {
      const saved = safeLocalStorage.getItem('fintables-watchlist');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setWatchlist(parsed.filter(t => typeof t === 'string'));
      }
    } catch (e) {
      console.warn('Watchlist parse failed, resetting:', e);
      safeLocalStorage.removeItem('fintables-watchlist');
    }
    
    fetch(`${API_BASE}/api/market-summary`)
      .then(r => r.json())
      .then(d => setMarketSummary(d))
      .catch(e => console.error(e));

    loadStock('THYAO');
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchResults([]);
      if (compareRef.current && !compareRef.current.contains(e.target as Node)) setCompareSuggestions([]);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleWatchlist = (ticker: string) => {
    const updated = watchlist.includes(ticker) ? watchlist.filter(t => t !== ticker) : [...watchlist, ticker];
    setWatchlist(updated);
    safeLocalStorage.setItem('fintables-watchlist', JSON.stringify(updated));
  };

  const loadAbortRef = useRef<AbortController | null>(null);
  const loadStock = async (ticker: string) => {
    loadAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    setLoading(true); setError(''); setSearchResults([]); setTickerInput('');
    try {
      const res = await fetch(`${API_BASE}/api/analysis?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Veri alınamadı');
      setData(json);
      setKapDisclosures([]);
      setKapLoading(true);
      fetch(`${API_BASE}/api/kap?ticker=${encodeURIComponent(ticker)}`)
        .then(r => r.json())
        .then(j => setKapDisclosures(j.disclosures || []))
        .catch(e => console.error('KAP:', e))
        .finally(() => setKapLoading(false));
      fetch(`${API_BASE}/api/dividends?ticker=${encodeURIComponent(ticker)}`)
        .then(r => r.json())
        .then(j => setDividends(j.dividends || []))
        .catch(e => console.error('Dividends:', e));
      setAiAnalysis('');
      setAiSentiment(null);
      setAiError(null);
      setActiveTab('quarterly');
    } catch(e: any) { 
      if (e.name !== 'AbortError') {
        setError(e.message);
        console.error(e);
      }
    } finally { 
      if (loadAbortRef.current === ctrl) setLoading(false); 
    }
  };

  const [aiError, setAiError] = useState<string | null>(null);

  const aiAbortRef = useRef<AbortController | null>(null);
  const fetchAiAnalysis = useCallback(async (ticker: string) => {
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    setAiLoading(true);
    setAiAnalysis('');
    setAiSentiment(null);
    setAiError(null);
    
    try {
      const res = await fetch(`${API_BASE}/api/ai-analysis?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error('AI hatası');
      if (!res.body) throw new Error('Response body yok');
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') break;
            if (!dataStr) continue;
            
            let parsed;
            try {
              parsed = JSON.parse(dataStr);
            } catch (err) {
              continue;
            }
            if (parsed.error) {
               if (parsed.error.includes('Too Many Requests') || parsed.error.includes('Quota')) {
                 throw new Error('Google Gemini API kotanız dolmuş. Lütfen 1 dakika bekleyip tekrar deneyin.');
               }
               throw new Error(parsed.error);
            }
            if (parsed.analysisChunk) {
              fullText += parsed.analysisChunk;
              setAiAnalysis(fullText);
            }
          }
        }
      }
      
      // Sentiment ayıklama
      const sentimentMatch = fullText.match(/\[SENTIMENT\]:\s*positive:\s*(\d+),\s*neutral:\s*(\d+),\s*negative:\s*(\d+)/i);
      if (sentimentMatch) {
        setAiSentiment({
          positive: parseInt(sentimentMatch[1], 10),
          neutral: parseInt(sentimentMatch[2], 10),
          negative: parseInt(sentimentMatch[3], 10)
        });
      }
    } catch(e: any) { 
      if (e.name !== 'AbortError') {
        console.error(e);
        setAiError(e.message || 'AI analizi alınamadı');
      }
    } finally { 
      if (aiAbortRef.current === ctrl) setAiLoading(false); 
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'ai' && data && !aiAnalysis && !aiLoading && !error && !aiError) {
      fetchAiAnalysis(data.ticker);
    }
  }, [activeTab, data, aiAnalysis, aiLoading, error, aiError, fetchAiAnalysis]);

  const fundAbortRef = useRef<AbortController | null>(null);
  const generateAiFund = async () => {
    if (!fundThemeInput.trim()) return;
    fundAbortRef.current?.abort();
    const ctrl = new AbortController();
    fundAbortRef.current = ctrl;
    setFundLoading(true); setFundError(''); setFundRecommendation('');
    try {
      const res = await fetch(`${API_BASE}/api/ai-fund?theme=${encodeURIComponent(fundThemeInput)}`, { signal: ctrl.signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fon önerisi alınamadı.');
      setFundRecommendation(json.recommendation);
    } catch (e: any) { 
      if (e.name !== 'AbortError') {
        console.error(e);
        setFundError(e.message); 
      }
    } finally { 
      if (fundAbortRef.current === ctrl) setFundLoading(false); 
    }
  };

  const handleAssistantSend = async () => {
    if (!assistantInput.trim()) return;
    const query = assistantInput;
    setAssistantInput('');
    setAssistantMessages(prev => [...prev, { role: 'user', content: query }]);
    setIsAssistantTyping(true);
    setAssistantStatus('Düşünüyor...');

    setAssistantMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const contextStr = `Mevcut Ekran: ${activeTab === 'quarterly' ? data?.ticker + ' Hisse Detayı' : activeTab}\n` + 
                         (data ? `Açık Hisse Verisi: ${JSON.stringify({
                            ticker: data.ticker, 
                            fiyat: data.currentPrice,
                            piyasaDegeri: data.marketCap,
                            bilancoPuanlari: data.scorecard
                         })}\n` : '') +
                         `İzleme Listesi: ${watchlist.join(', ')}\n` +
                         `Portföy: ${portfolio.map(p => p.ticker).join(', ')}`;

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${safeLocalStorage.getItem('dexter-api-key') || ''}` },
        body: JSON.stringify({ query, sessionId, model: aiChatModel, context: contextStr })
      });

      if (!response.body) throw new Error('No body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (!value) continue;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          
          try {
            const data = JSON.parse(payload);
            if (data.type === 'thinking') {
              setAssistantStatus(`Düşünüyor: ${data.message}`);
            } else if (data.type === 'tool_start') {
              setAssistantStatus(`Araç kullanılıyor: ${data.tool}`);
            } else if (data.type === 'done') {
              setAssistantMessages(prev => {
                const newMsgs = [...prev];
                newMsgs[newMsgs.length - 1] = { ...newMsgs[newMsgs.length - 1], content: data.answer || '' };
                return newMsgs;
              });
              setAssistantStatus('');
            } else if (data.type === 'error') {
              setAssistantMessages(prev => {
                const newMsgs = [...prev];
                newMsgs[newMsgs.length - 1] = { ...newMsgs[newMsgs.length - 1], content: `Hata: ${data.error}` };
                return newMsgs;
              });
              setAssistantStatus('');
            }
          } catch (e) {
            console.error('SSE parse:', e, payload);
          }
        }
      }
    } catch (err: any) {
      setAssistantMessages(prev => {
        const newMsgs = [...prev];
        if (!newMsgs[newMsgs.length - 1].content) {
          newMsgs[newMsgs.length - 1].content = `Bir bağlantı hatası oluştu veya istek zaman aşımına uğradı. Detay: ${err.message}`;
        }
        return newMsgs;
      });
      setAssistantStatus('');
    } finally {
      setIsAssistantTyping(false);
    }
  };

  const compareDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCompareSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; setCompareInput(val);
    if (compareDebounceRef.current) clearTimeout(compareDebounceRef.current);
    if (val.length < 2) { setCompareSuggestions([]); return; }
    
    compareDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(val)}`);
        const json = await res.json();
        setCompareSuggestions(Array.isArray(json) ? json : json.results || []);
      } catch(e) { console.error(e); }
    }, 250);
  };

  const addCompareStock = async (ticker: string) => {
    setCompareInput(''); setCompareSuggestions([]);
    if (compareStocks.find(s => s.ticker === ticker)) return;
    if (!data) return;
    try {
      const all = [data.ticker, ...compareStocks.map(s => s.ticker), ticker];
      const res = await fetch(`${API_BASE}/api/compare?tickers=${all.join(',')}`);
      if (!res.ok) return;
      const json = await res.json();
      setCompareStocks(json.filter((s: any) => s.ticker !== data.ticker));
    } catch(e) { console.error(e); }
  };

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; setTickerInput(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (val.length < 2) { setSearchResults([]); return; }
    
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(val)}`);
        const json = await res.json();
        setSearchResults(Array.isArray(json) ? json : json.results || []);
      } catch(e) { console.error(e); }
    }, 250);
  };

  
  const downloadCsv = (filename: string, headers: string[], rows: (string|number)[][]) => {
    const escape = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };


  const calculateBalanceScore = (d: any): {score:number, breakdown:{label:string, points:number, max:number, note:string}[]} | null => {
    if (!d) return null;
    const sc = d.scorecard;
    const breakdown: {label:string, points:number, max:number, note:string}[] = [];

    const revG = sc?.revenueGrowthYoY ?? 0;
    const revPts = revG >= 50 ? 2 : revG >= 20 ? 1.5 : revG >= 0 ? 1 : revG >= -10 ? 0.5 : 0;
    breakdown.push({label:'Satış Büyümesi YoY', points:revPts, max:2, note:`%${revG.toFixed(1)}`});

    const netG = sc?.netIncomeGrowthYoY ?? 0;
    const netPts = netG >= 50 ? 2 : netG >= 20 ? 1.5 : netG >= 0 ? 1 : netG >= -20 ? 0.5 : 0;
    breakdown.push({label:'Net Kâr Büyümesi YoY', points:netPts, max:2, note:`%${netG.toFixed(1)}`});

    const ebitdaG = sc?.ebitdaGrowthYoY ?? 0;
    const ebitdaPts = ebitdaG >= 30 ? 2 : ebitdaG >= 10 ? 1.5 : ebitdaG >= 0 ? 1 : ebitdaG >= -10 ? 0.5 : 0;
    breakdown.push({label:'FAVÖK Büyümesi YoY', points:ebitdaPts, max:2, note:`%${ebitdaG.toFixed(1)}`});

    const pe = d.trailingPE;
    const pePts = pe == null ? 0.5 : pe > 0 && pe < 5 ? 2 : pe < 10 ? 1.5 : pe < 20 ? 1 : pe < 30 ? 0.5 : 0;
    breakdown.push({label:'F/K Çarpanı', points:pePts, max:2, note: pe ? pe.toFixed(2) : 'Veri yok'});

    const pb = d.priceToBook;
    const pbPts = pb == null ? 0.5 : pb > 0 && pb < 1 ? 2 : pb < 2 ? 1.5 : pb < 3 ? 1 : pb < 5 ? 0.5 : 0;
    breakdown.push({label:'PD/DD Çarpanı', points:pbPts, max:2, note: pb ? pb.toFixed(2) : 'Veri yok'});

    const score = breakdown.reduce((s,b) => s + b.points, 0);
    return { score, breakdown };
  };

  const formatMoney = (val: any) => {
    if (val == null) return '-';
    const n = Number(val);
    if (!isFinite(n)) return '-';
    if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(2) + ' Mlr ₺';
    if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2) + ' M ₺';
    return new Intl.NumberFormat('tr-TR').format(n) + ' ₺';
  };

  const parseMarkdown = (text: string | null) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
      if (line.startsWith('# ')) return <h1 key={i} style={{fontSize:'1.5rem', fontWeight:800, margin:'1rem 0'}}>{parseInlineMarkdown(line.slice(2))}</h1>;
      if (line.startsWith('## ')) return <h2 key={i} style={{fontSize:'1.3rem', fontWeight:700, margin:'1rem 0'}}>{parseInlineMarkdown(line.slice(3))}</h2>;
      if (line.startsWith('### ')) return <h3 key={i} style={{fontSize:'1.1rem', fontWeight:700, margin:'0.5rem 0'}}>{parseInlineMarkdown(line.slice(4))}</h3>;
      if (line.startsWith('- ')) return <li key={i} style={{marginLeft:'1.5rem', marginBottom:'0.5rem'}}>{parseInlineMarkdown(line.slice(2))}</li>;
      return <p key={i} style={{marginBottom:'0.5rem'}}>{parseInlineMarkdown(line)}</p>;
    });
  };

  const parseInlineMarkdown = (text: string) => {
    let result: React.ReactNode[] = [];
    let current = text;
    let key = 0;
    while (current) {
      const boldMatch = current.match(/\*\*([\s\S]*?)\*\*/);
      const codeMatch = current.match(/`([^`]+)`/);
      const linkMatch = current.match(/\[([^\]]+)\]\(([^)]+)\)/);
      
      const matches = [
        { type: 'bold', match: boldMatch },
        { type: 'code', match: codeMatch },
        { type: 'link', match: linkMatch }
      ].filter(m => m.match).sort((a, b) => a.match!.index! - b.match!.index!);

      if (matches.length === 0) {
        result.push(<React.Fragment key={key++}>{current}</React.Fragment>);
        break;
      }

      const first = matches[0];
      const match = first.match!;
      const index = match.index!;
      
      if (index > 0) {
        result.push(<React.Fragment key={key++}>{current.substring(0, index)}</React.Fragment>);
      }

      if (first.type === 'bold') {
        result.push(<strong key={key++} style={{ color: 'var(--accent-primary)' }}>{match[1]}</strong>);
      } else if (first.type === 'code') {
        result.push(<code key={key++} style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }}>{match[1]}</code>);
      } else if (first.type === 'link') {
        result.push(<a key={key++} href={match[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>{match[1]}</a>);
      }

      current = current.substring(index + match[0].length);
    }
    return result;
  };

  return (
    <div id="print-area" className="app-container" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontFamily: '"Plus Jakarta Sans", sans-serif', position: 'relative' }}>
      
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{position:'fixed', inset:0, backgroundColor:'rgba(0,0,0,0.6)', zIndex:150}} />
      )}
      
      {/* LEFT SIDEBAR */}
      <aside style={{ width: '260px', backgroundColor: 'var(--bg-card)', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', position: isMobile ? 'fixed' : 'static', top: 0, left: 0, height: '100vh', zIndex: 200, transform: isMobile && !sidebarOpen ? 'translateX(-100%)' : 'translateX(0)', transition: 'transform 0.3s ease' }}>
        <div style={{ padding: '24px', fontSize: '1.5rem', fontWeight: 900, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity color="var(--accent-primary)" />
          Efekt
        </div>
        
        <div style={{ padding: '0 20px', marginBottom: '24px' }}>
          <button style={{ width: '100%', backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => { setActiveTab('fund'); setData(null); }}>
            <Briefcase size={18} />
            Fon Oluştur
          </button>
        </div>

        <nav style={{ flex: 1, padding: '0 12px', overflowY: 'auto' }}>
          {[
            { id: 'dashboard', label: 'Piyasalar', icon: LayoutGrid, active: !data && activeTab !== 'fund' && activeTab !== 'portfolio' && activeTab !== 'backtest' && activeTab !== 'kap' && activeTab !== 'alerts' && activeTab !== 'macro' },
            { id: 'stocks', label: 'Hisseler', icon: BarChart, active: !!data && activeTab !== 'fund' && activeTab !== 'backtest' && activeTab !== 'kap' && activeTab !== 'alerts' && activeTab !== 'macro' },
            { id: 'watchlist', label: 'İzleme Listesi', icon: List, active: activeTab === 'watchlist' },
            { id: 'portfolio', label: 'Portföyüm', icon: Briefcase, active: activeTab === 'portfolio' },
            { id: 'backtest', label: 'Backtest', icon: Activity, active: activeTab === 'backtest' },
            { id: 'alerts', label: 'Akıllı Alarmlar', icon: BellRing, active: activeTab === 'alerts' },
            { id: 'kap', label: 'KAP Canlı', icon: Bell, active: activeTab === 'kap' },
            { id: 'agenda', label: 'Ajanda', icon: Calendar, active: activeTab === 'agenda' },
            { id: 'screener', label: 'Tarayıcı', icon: Search, active: activeTab === 'screener' },
            { id: 'global', label: 'Global', icon: TrendingUp, active: activeTab === 'global' },
            { id: 'macro', label: 'Makro Analiz', icon: BrainCircuit, active: activeTab === 'macro' },
            { id: 'heatmap', label: 'Heatmap', icon: LayoutGrid, active: activeTab === 'heatmap' }
          ].map(item => (
            <ClickableCard 
              key={item.id}
              onActivate={() => {
                if (item.id === 'dashboard') { setData(null); setActiveTab('quarterly'); }
                if (item.id === 'stocks') { if (!data) loadStock('THYAO'); setActiveTab('quarterly'); }
                if (item.id === 'watchlist') { setActiveTab('watchlist'); }
                if (item.id === 'portfolio') { setActiveTab('portfolio'); }
                if (item.id === 'backtest') { setData(null); setActiveTab('backtest'); }
                if (item.id === 'alerts') { setData(null); setActiveTab('alerts'); }
                if (item.id === 'kap') { setData(null); setActiveTab('kap'); }
                if (item.id === 'agenda') { setActiveTab('agenda'); }
                if (item.id === 'screener') { setData(null); setActiveTab('screener'); }
                if (item.id === 'global') { setData(null); setActiveTab('global'); }
                if (item.id === 'macro') { setData(null); setActiveTab('macro'); }
                if (item.id === 'heatmap') { setData(null); setActiveTab('heatmap'); }
                if (isMobile) setSidebarOpen(false);
              }}
              ariaLabel={item.label}
              style={{ padding: '12px 16px', margin: '4px 0', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', color: item.active ? 'var(--text-main)' : 'var(--text-muted)', backgroundColor: item.active ? 'rgba(255,255,255,0.05)' : 'transparent', cursor: 'pointer', fontWeight: item.active ? 600 : 400 }}
            >
              <item.icon size={20} color={item.active ? 'var(--accent-primary)' : 'currentColor'} />
              {item.label}
            </ClickableCard>
          ))}
        </nav>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div id="app-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* TOPBAR */}
        {activeTab !== 'assistant' && (
        <header style={{ height: '70px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', padding: '0 24px', backgroundColor: 'var(--bg-card)', gap: '24px' }}>
          {isMobile && (
            <button onClick={() => setSidebarOpen(true)} aria-label="Menüyü aç" style={{background:'none', border:'none', color:'var(--text-main)', cursor:'pointer', padding:8, marginRight:16}}>
              <Menu size={24} />
            </button>
          )}
          <div ref={searchRef} style={{ position: 'relative', width: isMobile ? '100%' : '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              value={tickerInput}
              onChange={handleSearch}
              placeholder="Hisse sembolü veya adıyla ara..." 
              style={{ width: '100%', padding: '10px 12px 10px 40px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontSize: '0.95rem', outline: 'none' }}
            />
            {searchResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '8px', marginTop: '8px', zIndex: 50, maxHeight: '300px', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
                {searchResults.map(res => (
                  <ClickableCard 
                    key={res.ticker} 
                    onActivate={() => loadStock(res.ticker)}
                    ariaLabel={`${res.ticker} hissesine git`}
                    style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                  >
                    <strong style={{ color: 'var(--text-main)' }}>{res.ticker}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{res.name}</span>
                  </ClickableCard>
                ))}
              </div>
            )}
          </div>
          
          <div style={{ display: isMobile ? 'none' : 'flex', gap: '32px', marginLeft: 'auto', alignItems: 'center' }}>
            {installPrompt && (
              <button onClick={async () => {
                await installPrompt.prompt();
                setInstallPrompt(null);
              }}
                style={{padding:'8px 16px', borderRadius:8, border:'1px solid var(--accent-primary)', backgroundColor:'transparent', color:'var(--accent-primary)', fontWeight:700, cursor:'pointer', fontSize:'0.85rem'}}>
                📲 Yükle
              </button>
            )}
            <div style={{ position: 'relative' }}>
              <button aria-label={`Bildirimler (${alerts.length} aktif, ${triggeredAlerts.length} tetiklendi)`}
                onClick={async () => {
                  if ('Notification' in window && Notification.permission === 'default') {
                    await Notification.requestPermission();
                  }
                  setShowAlertsPanel(s => !s);
                }}
                style={{position:'relative', background:'none', border:'none', color:'inherit', cursor:'pointer', padding:0}}>
                <Bell size={20} />
                {(alerts.length + triggeredAlerts.length) > 0 && (
                  <span style={{position:'absolute', top:-4, right:-4, backgroundColor:'var(--accent-negative)', color:'var(--text-main)', fontSize:10, fontWeight:700, borderRadius:'50%', width:16, height:16, display:'flex', alignItems:'center', justifyContent:'center'}}>
                    {alerts.length + triggeredAlerts.length}
                  </span>
                )}
              </button>
              {showAlertsPanel && (
                <div style={{position:'absolute', top:30, right:0, width:320, backgroundColor:'var(--bg-card)', border:'1px solid var(--glass-border)', borderRadius:12, padding:20, zIndex:100, boxShadow:'0 10px 40px rgba(0,0,0,0.5)'}}>
                  <h3 style={{fontSize:'1.1rem', fontWeight:700, marginBottom:16}}>Uyarılar</h3>
                  {triggeredAlerts.length > 0 && (
                    <div style={{marginBottom:16}}>
                      <div style={{color:'var(--accent-primary)', fontSize:'0.85rem', fontWeight:700, marginBottom:8}}>TETİKLENEN</div>
                      {triggeredAlerts.map(a => (
                        <div key={a.id} style={{padding:10, backgroundColor:'rgba(16,185,129,0.1)', borderRadius:6, marginBottom:6, fontSize:'0.9rem'}}>
                          <strong>{a.ticker}</strong> {a.condition === 'above' ? '≥' : '≤'} {a.price} ₺
                        </div>
                      ))}
                      <button onClick={() => setTriggeredAlerts([])} style={{fontSize:'0.8rem', color:'var(--text-muted)', background:'none', border:'none', cursor:'pointer'}}>Hepsini temizle</button>
                    </div>
                  )}
                  {alerts.length === 0 && triggeredAlerts.length === 0 ? (
                    <div style={{color:'var(--text-muted)', fontSize:'0.9rem'}}>Henüz uyarı yok. Bir hisse açıp "Uyarı Kur" ile başla.</div>
                  ) : (
                    <>
                      <div style={{color:'var(--text-muted)', fontSize:'0.85rem', fontWeight:700, marginBottom:8}}>AKTİF</div>
                      {alerts.map(a => (
                        <div key={a.id} style={{display:'flex', justifyContent:'space-between', padding:10, backgroundColor:'rgba(255,255,255,0.02)', borderRadius:6, marginBottom:6, fontSize:'0.9rem'}}>
                          <span><strong>{a.ticker}</strong> {a.condition === 'above' ? '≥' : '≤'} {a.price} ₺</span>
                          <button onClick={() => setAlerts(p => p.filter(x => x.id !== a.id))} style={{background:'none', border:'none', color:'var(--accent-negative)', cursor:'pointer'}}>×</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            {['xu100', 'usdtry', 'eurtry'].map((key) => {
              const mData = marketSummary?.[key as keyof MarketSummary];
              const price = mData?.price;
              const change = mData?.change;
              if (typeof price !== 'number' || typeof change !== 'number') return null;
              
              const isPos = change > 0;
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                    {key === 'xu100' ? 'XU100' : key === 'usdtry' ? 'USDTRY' : 'EURTRY'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem', fontWeight: 700 }}>
                    <span style={{ color: 'var(--text-main)' }}>{key === 'xu100' ? price.toFixed(2) : price.toFixed(4)}</span>
                    <span style={{ color: isPos ? 'var(--accent-primary)' : 'var(--accent-negative)', fontSize: '0.85rem' }}>
                      {isPos ? '+' : ''}{change.toFixed(2)}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <div style={{ width: '1px', height: '32px', backgroundColor: 'var(--glass-border)' }}></div>
          
          <div style={{ display: 'flex', gap: '16px', color: 'var(--text-muted)' }}>
            <button aria-label="Bildirimler" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}><Bell size={20} /></button>
            <div style={{display:'flex', backgroundColor:'rgba(255,255,255,0.05)', borderRadius:8, padding:2}}>
              {([
                {val:'light', icon:Sun, label:'Açık'},
                {val:'dark', icon:Moon, label:'Koyu'},
                {val:'system', icon:Monitor, label:'Sistem'}
              ] as const).map(opt => (
                <button key={opt.val} onClick={() => setTheme(opt.val)} aria-label={opt.label}
                  title={opt.label}
                  style={{padding:6, borderRadius:6, border:'none',
                    backgroundColor: theme === opt.val ? 'var(--accent-primary)' : 'transparent',
                    color: theme === opt.val ? '#000' : 'var(--text-muted)',
                    cursor:'pointer', display:'flex', alignItems:'center'}}>
                  <opt.icon size={14} />
                </button>
              ))}
            </div>
            <button aria-label="Kullanıcı Profili" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}><User size={20} /></button>
          </div>
        </header>
        )}

        {/* SCROLLABLE MAIN */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
          
          {loading && !data && (
            <div className="animated-fade-in" style={{display:'flex', flexDirection:'column', gap:'24px'}}>
              <div style={{backgroundColor:'var(--bg-card)', borderRadius:'12px', padding:'32px', border:'1px solid var(--glass-border)'}}>
                <div className="skeleton" style={{height:32, width:'40%', marginBottom:16}}/>
                <div className="skeleton" style={{height:16, width:'25%', marginBottom:32}}/>
                <div style={{display:'flex', gap:32}}>
                  {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{height:64, flex:1}}/>)}
                </div>
              </div>
              <div className="skeleton" style={{height:400, borderRadius:12}}/>
            </div>
          )}
          {loading && data && <div style={{display:'flex', justifyContent:'center', padding:60}}><Loader2 className="spinner" size={32} color="var(--accent-primary)"/></div>}

          {error && (
            <div style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)', border: '1px solid var(--accent-negative)', padding: '1rem', borderRadius: '8px', color: 'var(--accent-negative)', marginBottom: '1.5rem' }}>
              {error}
            </div>
          )}

          {/* DEFAULT HOME VIEW ("Piyasalar") */}
          {!data && !loading && !error && activeTab === 'quarterly' && (
            <div className="animated-fade-in" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: '32px' }}>
              
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
                  <div style={{ backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Calendar size={18} color="var(--accent-primary)"/> Yaklaşan Ajanda <span style={{fontSize: '0.7rem', backgroundColor: 'var(--accent-negative)', padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto'}}>Demo Veri</span></h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>TUPRS - Bilanço</span><span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Yarın</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>THYAO - Yatırımcı Sunumu</span><span style={{ fontWeight: 600, color: 'var(--text-main)' }}>12 Mayıs</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>KCHOL - Temettü (4.5 ₺)</span><span style={{ fontWeight: 600, color: 'var(--text-main)' }}>15 Mayıs</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>ASELS - Bilanço</span><span style={{ fontWeight: 600, color: 'var(--text-main)' }}>20 Mayıs</span></div>
                    </div>
                  </div>
                  <div style={{ backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><TrendingUp size={18} color="var(--accent-primary)"/> Sektör Performansları <span style={{fontSize: '0.7rem', backgroundColor: 'var(--accent-negative)', padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto'}}>Demo Veri</span></h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>XBANK (Bankacılık)</span><span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>+2.45%</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>XULAS (Ulaştırma)</span><span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>+1.12%</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>XBLSM (Bilişim)</span><span style={{ fontWeight: 700, color: 'var(--accent-negative)' }}>-0.85%</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>XGIDA (Gıda İçecek)</span><span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>+0.34%</span></div>
                    </div>
                  </div>
                </div>

                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>BIST 100 Popüler Hisseler</h2>
                
                {/* 10 Box Stocks */}
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: '16px', marginBottom: '32px' }}>
                  {['THYAO', 'TUPRS', 'KCHOL', 'AKBNK', 'ASELS', 'BIMAS', 'EREGL', 'ISCTR', 'SAHOL', 'YKBNK'].map(idx => (
                    <ClickableCard 
                      key={idx} 
                      onActivate={() => loadStock(idx)}
                      ariaLabel={`${idx} hisse detayları`}
                      style={{ backgroundColor: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)', cursor: 'pointer', transition: 'border-color 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
                      onMouseEnter={(e: any) => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                      onMouseLeave={(e: any) => e.currentTarget.style.borderColor = 'var(--glass-border)'}
                    >
                      <h3 style={{ fontSize: '1.2rem', color: 'var(--text-main)', marginBottom: '8px', fontWeight: 800 }}>{idx}</h3>
                      <div style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 600 }}>Analiz <ChevronRight size={14} style={{ verticalAlign: 'middle' }}/></div>
                    </ClickableCard>
                  ))}
                </div>

                {/* 90 List Stocks */}
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '16px', color: 'var(--text-muted)' }}>Diğer Hisseler (Liste Görünümü)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)', gap: '8px', backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: '12px', border: '1px solid var(--glass-border)', maxHeight: '400px', overflowY: 'auto' }}>
                  {[
                    'ENKAI', 'GARAN', 'SISE', 'FROTO', 'PGSUS', 'TOASO', 'TCELL', 'SASA', 'HEKTS', 'TTKOM', 'ALARK', 'MGROS', 'DOAS', 'KRDMD', 'KOZAL', 
                    'PETKM', 'ENJSA', 'ASTOR', 'EKGYO', 'TTRAK', 'VAKBN', 'GUBRF', 'OYAKC', 'KORDS', 'SOKM', 'VESBE', 'ARCLK', 'ODAS', 'KMPUR', 'HALKB', 
                    'ISGYO', 'GWIND', 'ALFAS', 'CANTE', 'EUPWR', 'KONTR', 'MIATK', 'REEDR', 'YYLGD', 'ZOREN', 'ALBRK', 'CCOLA', 'AEFES', 'TSKB', 'MAVI', 
                    'BRISA', 'AKSA', 'TKFEN', 'SELEC', 'LOGO', 'IPEKE', 'KOZAA', 'SMRTG', 'GESAN', 'AHGAZ', 'TUKAS', 'KCAER', 'BRSAN', 'AYDEM', 'QUAGR', 
                    'KLSER', 'ULKER', 'BIOEN', 'ISMEN', 'AKCNS', 'YATAS', 'SNGYO', 'ZRGYO', 'TAVHL', 'OTKAR', 'EGEEN', 'JANTS', 'BRYAT', 'BIZIM', 'ALGYO', 
                    'KARTN', 'NTHOL', 'GSDHO', 'HLGYO', 'TRGYO', 'PSGYO', 'TSGYO', 'IZFAS', 'ENSRV', 'ANELE', 'DOHOL', 'ECILC', 'SKBNK', 'CIMSA', 'KONYA'
                  ].map(idx => (
                    <ClickableCard 
                      key={idx} 
                      onActivate={() => loadStock(idx)}
                      ariaLabel={`${idx} hisse detayları`}
                      style={{ padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', backgroundColor: 'rgba(255,255,255,0.02)', textAlign: 'center', transition: 'background-color 0.2s' }}
                      onMouseEnter={(e: any) => { e.currentTarget.style.backgroundColor = 'var(--accent-primary)'; e.currentTarget.style.color = '#000'; }}
                      onMouseLeave={(e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'; e.currentTarget.style.color = 'var(--text-main)'; }}
                    >
                      {idx}
                    </ClickableCard>
                  ))}
                </div>
              </div>

              {/* RIGHT SIDEBAR (Watchlist) */}
              <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '20px' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
                  İzleme Listesi
                </h3>
                {watchlist.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>İzleme listende hisse yok.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {watchlist.map(t => (
                      <ClickableCard key={t} onActivate={() => loadStock(t)} ariaLabel={`${t} hissesi`} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '8px', cursor: 'pointer', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{t}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <ChevronRight size={16} color="var(--text-muted)" />
                          <button onClick={(e) => { e.stopPropagation(); toggleWatchlist(t); }} aria-label={`${t} sembolünü izleme listesinden çıkar`} style={{ background: 'none', border: 'none', color: 'var(--accent-negative)', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px', lineHeight: 1 }}>×</button>
                        </div>
                      </ClickableCard>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* WATCHLIST VIEW */}
          
          {activeTab === 'portfolio' && (
            <div className="animated-fade-in" style={{padding: isMobile ? 16 : 32, maxWidth:1100, margin:'0 auto'}}>
              <h2 style={{fontSize:'2rem', fontWeight:800, marginBottom:8}}>Kağıt Portföyüm</h2>
              <p style={{color:'var(--text-muted)', marginBottom:24}}>Gerçek para riski olmadan strateji dene. Tüm veriler tarayıcında saklanır.</p>

              <AddPositionForm onAdd={(pos) => setPortfolio(p => [...p, pos])} />

              {portfolio.length === 0 ? (
                <div style={{textAlign:'center', padding:60, color:'var(--text-muted)'}}>Henüz pozisyon yok. Yukarıdan ekle.</div>
              ) : (
                <PortfolioTable portfolio={portfolio} prices={portfolioPrices} onRemove={(i) => setPortfolio(p => p.filter((_,idx) => idx !== i))} onDownload={() => {
                  const headers = ['Sembol','Lot','Giriş Fiyatı','Giriş Tarihi','Güncel Fiyat','K/Z (₺)','K/Z (%)'];
                  const rows = portfolio.map(p => {
                    const cur = portfolioPrices[p.ticker] || p.entryPrice;
                    const pl = (cur - p.entryPrice) * p.lots;
                    const plPct = ((cur - p.entryPrice) / p.entryPrice) * 100;
                    return [p.ticker, p.lots, p.entryPrice, p.entryDate, cur.toFixed(2), pl.toFixed(2), plPct.toFixed(2)];
                  });
                  downloadCsv(`portfoy_${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
                }} />
              )}
              
              {portfolio.length > 0 && (
                <div style={{ marginTop: '32px' }}>
                  <button 
                    onClick={optimizePortfolio}
                    disabled={portfolioAiLoading}
                    style={{
                      width: '100%',
                      padding: '16px',
                      backgroundColor: 'var(--accent-primary)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '1.2rem',
                      fontWeight: 800,
                      cursor: portfolioAiLoading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: '12px',
                      transition: 'all 0.2s',
                      opacity: portfolioAiLoading ? 0.7 : 1
                    }}
                  >
                    {portfolioAiLoading ? <Loader2 className="spinner" size={24} /> : <Sparkles size={24} />}
                    {portfolioAiLoading ? 'Yapay Zeka Portföyü Analiz Ediyor...' : 'Portföyü Yapay Zeka ile Optimize Et'}
                  </button>
                  
                  {portfolioAiError && (
                    <div style={{ padding: '16px', backgroundColor: 'var(--accent-negative-rgb)', border: '1px solid var(--accent-negative)', color: '#fff', borderRadius: '8px', marginTop: '16px' }}>
                      {portfolioAiError}
                    </div>
                  )}
                  
                  {portfolioAnalysis && (
                    <div className="animated-fade-in" style={{ marginTop: '24px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '32px', lineHeight: '1.6' }}>
                      <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-primary)', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <BrainCircuit size={24} /> Portföy Optimizasyon Raporu (DeepSeek V4 Pro)
                      </h3>
                      <div>{parseMarkdown(portfolioAnalysis)}</div>
                    </div>
                  )}

                  <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--glass-border)' }}>
                    <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Briefcase size={24} color="var(--accent-primary)" /> AI Temettü Emeklilik Planlayıcısı
                    </h3>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Portföyünüzdeki hisseleri ve geçmiş temettü verimlerini baz alarak yapay zeka sizin için 5, 10 ve 20 yıllık bir emeklilik ve pasif gelir simülasyonu oluştursun.</p>
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Aylık Düzenli Eklenecek Tutar (TL)</label>
                        <input type="number" value={monthlyAddition} onChange={(e) => setMonthlyAddition(Number(e.target.value))} style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '1.1rem', width: '200px' }} />
                      </div>
                      <button 
                        onClick={runDividendPlanner}
                        disabled={dividendLoading}
                        style={{ padding: '12px 24px', backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: 800, cursor: dividendLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        {dividendLoading ? <Loader2 className="spinner" size={20} /> : <Sparkles size={20} />}
                        {dividendLoading ? 'Plan Hesaplanıyor...' : 'Emeklilik Projeksiyonu Çıkar'}
                      </button>
                    </div>

                    {dividendData && (
                      <div className="animated-fade-in" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '32px', lineHeight: '1.6' }}>
                        {parseMarkdown(dividendData)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'alerts' && (
            <div className="animated-fade-in" style={{ padding: '32px', maxWidth: 1000, margin: '0 auto' }}>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '24px', display:'flex', alignItems:'center', gap:12 }}>
                <BellRing size={32} color="var(--accent-primary)" /> Akıllı Alarmlar
              </h2>
              
              <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '24px', marginBottom: '32px' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '16px' }}>Doğal Dille Alarm Kur</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.95rem' }}>
                  Yapay zeka asistanınıza ne istediğinizi yazın, o sizin için alarmı kursun. Örnek: <br/>
                  <span style={{ fontStyle: 'italic', color: 'var(--accent-primary)' }}>"Türk Hava Yolları 350'yi geçerse bana haber ver"</span> veya <br/>
                  <span style={{ fontStyle: 'italic', color: 'var(--accent-primary)' }}>"SAHOL 95 liranın altına düşerse uyar"</span>
                </p>
                
                <div style={{ display: 'flex', gap: '16px' }}>
                  <input 
                    value={smartAlertInput} 
                    onChange={(e) => setSmartAlertInput(e.target.value)} 
                    placeholder="Alarm koşulunuzu yazın..." 
                    style={{ flex: 1, padding: '16px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '1rem' }} 
                    onKeyDown={(e) => e.key === 'Enter' && createSmartAlert()}
                  />
                  <button 
                    onClick={createSmartAlert} 
                    disabled={smartAlertLoading}
                    style={{ padding: '0 32px', backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: 800, cursor: smartAlertLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                  >
                    {smartAlertLoading ? <Loader2 className="spinner" size={20} /> : <Sparkles size={20} />}
                    {smartAlertLoading ? 'Kuruluyor...' : 'Alarm Kur'}
                  </button>
                </div>
              </div>

              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '16px' }}>Aktif Alarmlarınız ({alerts.length})</h3>
              {alerts.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px dashed var(--glass-border)', color: 'var(--text-muted)' }}>
                  Henüz bir alarm kurmadınız.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                  {alerts.map(a => (
                    <div key={a.id} style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', padding: '20px', borderRadius: '12px', position: 'relative' }}>
                      <button onClick={() => setAlerts(p => p.filter(x => x.id !== a.id))} style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                      <h4 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-primary)', marginBottom: '8px' }}>{a.ticker}</h4>
                      <div style={{ fontSize: '1.1rem' }}>
                        {a.condition === 'above' ? '≥' : '≤'} <strong>{a.price} ₺</strong> olduğunda bildir
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '12px' }}>
                        {new Date(a.createdAt).toLocaleString('tr-TR')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'backtest' && (
            <div className="animated-fade-in" style={{ padding: '32px', maxWidth: 1000, margin: '0 auto' }}>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '24px', display:'flex', alignItems:'center', gap:12 }}>
                <Activity size={32} color="var(--accent-primary)" /> Backtest Simülatörü
              </h2>
              
              <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '24px', marginBottom: '32px', display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Hisse Simgesi</label>
                  <input value={backtestTicker} onChange={(e) => setBacktestTicker(e.target.value.toUpperCase())} placeholder="Örn: THYAO" style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: '1rem' }} />
                </div>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Süre</label>
                  <select value={backtestYears} onChange={(e) => setBacktestYears(Number(e.target.value))} style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-card)', color: '#fff', fontSize: '1rem' }}>
                    <option value={1}>Son 1 Yıl</option>
                    <option value={3}>Son 3 Yıl</option>
                    <option value={5}>Son 5 Yıl</option>
                  </select>
                </div>
                <button onClick={runBacktest} disabled={backtestLoading} style={{ padding: '12px 32px', backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '8px', fontWeight: 800, fontSize: '1rem', cursor: backtestLoading ? 'not-allowed' : 'pointer' }}>
                  {backtestLoading ? 'Hesaplanıyor...' : 'Testi Başlat'}
                </button>
              </div>

              {backtestError && (
                <div style={{ padding: '16px', backgroundColor: 'var(--accent-negative-rgb)', border: '1px solid var(--accent-negative)', color: '#fff', borderRadius: '8px', marginBottom: '24px' }}>
                  {backtestError}
                </div>
              )}

              {backtestResult && (
                <div className="animated-fade-in" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '32px' }}>
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '24px' }}>SMA (20-50) Kesişim Stratejisi Sonuçları</h3>
                  
                  <div style={{ display: 'flex', gap: '24px', marginBottom: '32px', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 250px', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Algoritma Getirisi</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: Number(backtestResult.metrics.strategyReturn) >= 0 ? 'var(--accent-primary)' : 'var(--accent-negative)' }}>
                        %{backtestResult.metrics.strategyReturn}
                      </div>
                    </div>
                    <div style={{ flex: '1 1 250px', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Sadece Al & Tut Yapsaydın</div>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: Number(backtestResult.metrics.baselineReturn) >= 0 ? 'var(--text-main)' : 'var(--accent-negative)' }}>
                        %{backtestResult.metrics.baselineReturn}
                      </div>
                    </div>
                  </div>

                  <div style={{ height: '400px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={backtestResult.data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="date" stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)' }} />
                        <YAxis stroke="var(--text-muted)" tick={{ fill: 'var(--text-muted)' }} domain={['auto', 'auto']} tickFormatter={(v: any) => (v/1000).toFixed(0)+'k'} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-main)', border: '1px solid var(--glass-border)', borderRadius: '8px' }} />
                        <Line type="monotone" dataKey="Strateji" stroke="var(--accent-primary)" strokeWidth={3} dot={false} />
                        <Line type="monotone" dataKey="AlTut" stroke="var(--text-muted)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
          {activeTab === 'kap' && (
            <div className="animated-fade-in" style={{ padding: '32px', maxWidth: 1000, margin: '0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                <Bell size={32} color="var(--accent-primary)" />
                <h2 style={{ fontSize: '2rem', fontWeight: 800 }}>Canlı KAP Bildirimleri</h2>
              </div>
              
              <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '32px', lineHeight: '1.6' }}>
                {globalKapLoading && !globalKapNews ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '60px', color: 'var(--accent-primary)' }}>
                    <Loader2 className="spinner" size={32} />
                    <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>Yapay Zeka Tüm KAP Bildirimlerini Okuyup Özetliyor...</span>
                  </div>
                ) : (
                  <div>{parseMarkdown(globalKapNews)}</div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'watchlist' && (
            <div className="animated-fade-in" style={{ padding: '32px' }}>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '24px' }}>İzleme Listesi</h2>
              {watchlist.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>İzleme listenizde henüz hisse bulunmuyor. Hisseleri arayarak listeye ekleyebilirsiniz.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                  {watchlist.map(ticker => (
                    <ClickableCard 
                      key={ticker} 
                      onActivate={() => loadStock(ticker)}
                      ariaLabel={`${ticker} hissesi`}
                      style={{ backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: '12px', border: '1px solid var(--glass-border)', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column' }}
                      onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                      onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.transform = 'none'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'var(--accent-primary)' }}>
                            {ticker.substring(0,2)}
                          </div>
                          <div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-main)' }}>{ticker}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>BIST Yıldız</div>
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); toggleWatchlist(ticker); }} aria-label={`${ticker} sembolünü izleme listesinden çıkar`} style={{ background: 'none', border: 'none', color: 'var(--accent-negative)', cursor: 'pointer', fontSize: '1.5rem', padding: '0 4px', lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ fontSize: '1rem', color: 'var(--accent-primary)', fontWeight: 600 }}>Analizi Gör <ChevronRight size={16} style={{ verticalAlign: 'middle' }}/></div>
                    </ClickableCard>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AGENDA VIEW */}
          {activeTab === 'agenda' && (
            <div className="animated-fade-in" style={{ padding: '32px' }}>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '24px' }}>Bilanço Ajandası</h2>
              <div style={{ backgroundColor: 'var(--bg-card)', padding: '32px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {[
                    { date: 'Yarın, 18:00', event: 'TUPRS - 2026/03 Çeyreklik Bilanço Açıklaması' },
                    { date: '12 Mayıs 2026', event: 'THYAO - Yatırımcı Sunumu' },
                    { date: '15 Mayıs 2026', event: 'KCHOL - Temettü Dağıtımı (Hisse Başına 4.5 ₺)' },
                    { date: '20 Mayıs 2026', event: 'ASELS - 2026/03 Çeyreklik Bilanço Açıklaması' }
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: '24px', paddingBottom: '16px', borderBottom: i === 3 ? 'none' : '1px solid var(--glass-border)' }}>
                      <div style={{ fontWeight: 700, color: 'var(--accent-primary)', width: '150px' }}>{item.date}</div>
                      <div style={{ color: 'var(--text-main)' }}>{item.event}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI ASSISTANT VIEW */}
          {activeTab === 'macro' && (
            <div className="animated-fade-in" style={{ padding: '32px', maxWidth: 1000, margin: '0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
                <h2 style={{ fontSize: '2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <BrainCircuit size={32} color="var(--accent-primary)" /> Makroekonomi & Merkez Bankası (AI Analizi)
                </h2>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {macroData && (
                    <button 
                      onClick={() => window.print()}
                      style={{ padding: '12px 24px', backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', borderRadius: '8px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                      <Download size={20} />
                      PDF İndir
                    </button>
                  )}
                  <button 
                    onClick={runMacroAnalysis}
                    disabled={macroLoading}
                    style={{ padding: '12px 24px', backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '8px', fontSize: '1rem', fontWeight: 800, cursor: macroLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'opacity 0.2s' }}
                  >
                    {macroLoading ? <Loader2 className="spinner" size={20} /> : <Sparkles size={20} />}
                    {macroLoading ? 'Rapor Hazırlanıyor...' : 'Güncel Rapor Üret'}
                  </button>
                </div>
              </div>

              {!macroData && !macroLoading && (
                <div style={{ textAlign: 'center', padding: '64px', backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px dashed var(--glass-border)' }}>
                  <TrendingUp size={48} color="var(--text-muted)" style={{ marginBottom: '16px', opacity: 0.5 }} />
                  <h3 style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>Derinlemesine Makroekonomik Analiz</h3>
                  <p style={{ color: 'var(--text-muted)', marginTop: '8px', maxWidth: 600, margin: '8px auto 0' }}>
                    Yapay Zeka (DeepSeek V4 Pro) internetteki son dakika verilerini (Enflasyon, TCMB faiz kararları, dolar beklentileri) tarayarak Borsa İstanbul'a olası etkilerini sizin için saniyeler içinde analiz eder.
                  </p>
                </div>
              )}

              {macroData && (
                <div className="animated-fade-in" style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '40px', borderRadius: '16px', border: '1px solid var(--glass-border)', lineHeight: '1.7', fontSize: '1.05rem', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
                  {parseMarkdown(macroData)}
                </div>
              )}
            </div>
          )}

          {activeTab === 'global' && (
            <div className="animated-fade-in" style={{padding:32, maxWidth:1200, margin:'0 auto'}}>
              <h2 style={{fontSize:'2rem', fontWeight:800, marginBottom:24}}>Global Varlıklar</h2>
              {globalLoading && <div style={{color:'var(--text-muted)', textAlign:'center', padding:40}}><Loader2 className="spinner" size={32} /></div>}
              {!globalLoading && Object.entries(GLOBAL_SYMBOLS).map(([category, symbols]) => {
                const categoryAssets = globalAssets.filter(a => symbols.includes(a.ticker));
                if (categoryAssets.length === 0) return null;
                const emojis: Record<string,string> = {'ABD Hisseleri':'🇺🇸', 'Döviz':'💱', 'Emtia':'🥇', 'Kripto':'₿'};
                return (
                  <div key={category} style={{marginBottom:32}}>
                    <h3 style={{fontSize:'1.2rem', fontWeight:700, marginBottom:16}}>{emojis[category]} {category}</h3>
                    <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:16}}>
                      {categoryAssets.map(a => {
                        const isPos = a.change > 0;
                        return (
                          <div key={a.ticker} style={{padding:20, backgroundColor:'var(--bg-card)', borderRadius:12, border:'1px solid var(--glass-border)'}}>
                            <div style={{fontWeight:800, fontSize:'1.1rem', color:'var(--text-main)', marginBottom:4}}>{a.ticker}</div>
                            <div style={{fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:12, height:'2.2em', overflow:'hidden'}}>{a.companyName}</div>
                            <div style={{fontSize:'1.4rem', fontWeight:700, marginBottom:4}}>{a.currentPrice?.toFixed(a.assetType === 'FX' ? 4 : 2)} {a.currency}</div>
                            <div style={{fontSize:'0.95rem', fontWeight:600, color: isPos ? 'var(--accent-primary)' : 'var(--accent-negative)'}}>
                              {isPos ? '▲' : '▼'} {Math.abs(a.change).toFixed(2)}%
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'heatmap' && (
            <div className="animated-fade-in" style={{padding:32, maxWidth:1200, margin:'0 auto'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24}}>
                <h2 style={{fontSize:'2rem', fontWeight:800}}>BIST 30 Heatmap</h2>
                <button onClick={() => { setHeatmapData([]); setHeatmapLoading(true); fetch(`${API_BASE}/api/heatmap`).then(r=>r.json()).then(d=>{setHeatmapData(Array.isArray(d)?d:[]); setHeatmapLoading(false);}).catch(()=>setHeatmapLoading(false)); }}
                  style={{padding:'8px 16px', borderRadius:8, border:'1px solid var(--glass-border)', backgroundColor:'transparent', color:'var(--text-main)', cursor:'pointer'}}>
                  Yenile
                </button>
              </div>
              {heatmapLoading ? (
                <div style={{color:'var(--text-muted)', textAlign:'center', padding:40}}><Loader2 className="spinner" size={32} /> Yükleniyor...</div>
              ) : heatmapData.length === 0 ? (
                <div style={{color:'var(--text-muted)', textAlign:'center', padding:60}}>Veri alınamadı.</div>
              ) : (
                <>
                  <div style={{display:'flex', flexWrap:'wrap', gap:4, alignContent:'flex-start'}}>
                    {[...heatmapData].sort((a,b) => (b.marketCap || 0) - (a.marketCap || 0)).map(d => {
                      const absChange = Math.abs(d.change);
                      const intensity = Math.min(absChange / 5, 1);
                      const baseColor = d.change >= 0 ? 'var(--accent-primary-rgb)' : 'var(--accent-negative-rgb)';
                      const bg = `rgba(${baseColor}, ${0.2 + intensity * 0.8})`;
                      const widthClass = d.marketCap > 100000000000 ? '24%' : d.marketCap > 50000000000 ? '16%' : '12%';
                      return (
                        <div key={d.ticker} 
                          title={`${d.companyName} — tıkla detay aç`}
                          onClick={() => loadStock(d.ticker)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadStock(d.ticker); } }}
                          style={{
                            flex: `1 1 ${widthClass}`,
                            minWidth: 80,
                            height: 80,
                            backgroundColor: bg,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--glass-border)',
                            transition: 'transform 0.15s, box-shadow 0.15s',
                            textShadow: '0 1px 3px rgba(0,0,0,0.5)'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)'; e.currentTarget.style.zIndex = '10'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.zIndex = '1'; }}>
                          <div style={{fontWeight:800, fontSize:'1rem'}}>{d.ticker}</div>
                          <div style={{fontSize:'0.8rem', fontWeight:600}}>{d.change > 0 ? '+' : ''}{d.change.toFixed(2)}%</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{marginTop:24, padding:16, backgroundColor:'var(--bg-card)', borderRadius:8, fontSize:'0.85rem', color:'var(--text-muted)'}}>
                    💡 Kutu boyutu piyasa değerini, renk yoğunluğu günlük değişim büyüklüğünü temsil eder. Bir kutuya tıklayınca o hissenin analizi açılır.
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'screener' && (
            <div className="animated-fade-in" style={{padding:32, maxWidth:1200, margin:'0 auto'}}>
              <h2 style={{fontSize:'2rem', fontWeight:800, marginBottom:8}}>Hisse Tarayıcı</h2>
              <p style={{color:'var(--text-muted)', marginBottom:24}}>Kriterlere göre BIST hisselerini filtrele.</p>
              
              <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr) auto', gap:12, marginBottom:24, padding:20, backgroundColor:'var(--bg-card)', borderRadius:12, border:'1px solid var(--glass-border)'}}>
                {([
                  {key:'minPE', label:'F/K min', placeholder:'örn: 0'},
                  {key:'maxPE', label:'F/K max', placeholder:'örn: 10'},
                  {key:'minPB', label:'PD/DD min', placeholder:'örn: 0'},
                  {key:'maxPB', label:'PD/DD max', placeholder:'örn: 2'},
                  {key:'minRevGrowth', label:'Satış Büyümesi min %', placeholder:'örn: 20'},
                ] as const).map(f => (
                  <div key={f.key}>
                    <label style={{display:'block', fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:6}}>{f.label}</label>
                    <input type="number"
                      value={screenerFilters[f.key as keyof typeof screenerFilters]}
                      onChange={e => setScreenerFilters(p => ({...p, [f.key]: e.target.value}))}
                      placeholder={f.placeholder}
                      style={{width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid var(--glass-border)', backgroundColor:'var(--bg-main)', color:'var(--text-main)'}} />
                  </div>
                ))}
                <div style={{display:'flex', alignItems:'flex-end'}}>
                  <button onClick={runScreener} disabled={screenerLoading}
                    style={{padding:'10px 24px', borderRadius:8, border:'none', backgroundColor:'var(--accent-primary)', color:'#000', fontWeight:700, cursor:'pointer', height:42, display:'flex', alignItems:'center', gap:8}}>
                    {screenerLoading && <Loader2 className="spinner" size={16} />}
                    Tara
                  </button>
                </div>
              </div>
              
              {screenerLoading && (
                <div style={{color:'var(--text-muted)', padding:60, textAlign:'center'}}>
                  BIST 40 hisse taranıyor, ~30 saniye sürebilir...
                </div>
              )}
              
              {!screenerLoading && screenerResults.length > 0 && (
                <div style={{backgroundColor:'var(--bg-card)', borderRadius:12, border:'1px solid var(--glass-border)', overflowX:'auto'}}>
                  <table style={{width:'100%', borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{color:'var(--text-muted)', fontSize:'0.85rem', textAlign:'left', borderBottom:'1px solid var(--glass-border)'}}>
                        <th style={{padding:'14px 16px'}}>Sembol</th><th>Şirket</th><th>Puan</th><th>Fiyat</th><th>F/K</th><th>PD/DD</th><th>FD/FAVÖK</th><th>Satış YoY</th><th>Net Kâr YoY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {screenerResults.map(r => (
                        <tr key={r.ticker} onClick={() => loadStock(r.ticker)}
                          style={{borderBottom:'1px solid var(--glass-border)', cursor:'pointer'}}
                          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'}
                          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                          <td style={{padding:'14px 16px', fontWeight:700, color:'var(--accent-primary)'}}>{r.ticker}</td>
                          <td style={{color:'var(--text-muted)', fontSize:'0.9rem'}}>{r.companyName}</td>
                          <td>
                            {(() => {
                              const sc = calculateBalanceScore({
                                trailingPE: r.trailingPE, priceToBook: r.priceToBook,
                                scorecard: { revenueGrowthYoY: r.revenueGrowthYoY, netIncomeGrowthYoY: r.netIncomeGrowthYoY, ebitdaGrowthYoY: r.ebitdaGrowthYoY }
                              });
                              if (!sc) return '-';
                              const c = sc.score >= 7 ? 'var(--accent-primary)' : sc.score >= 4 ? '#f59e0b' : 'var(--accent-negative)';
                              return <span style={{backgroundColor: c, color: '#000', padding: '2px 8px', borderRadius: '12px', fontWeight: 700, fontSize: '0.85rem'}}>{sc.score.toFixed(1)}</span>;
                            })()}
                          </td>
                          <td>{r.currentPrice?.toFixed(2)} ₺</td>
                          <td>{r.trailingPE?.toFixed(2) ?? '-'}</td>
                          <td>{r.priceToBook?.toFixed(2) ?? '-'}</td>
                          <td>{r.evToEbitda?.toFixed(2) ?? '-'}</td>
                          <td style={{color: (r.revenueGrowthYoY ?? 0) > 0 ? 'var(--accent-primary)' : 'var(--accent-negative)'}}>{r.revenueGrowthYoY?.toFixed(1) ?? '-'}%</td>
                          <td style={{color: (r.netIncomeGrowthYoY ?? 0) > 0 ? 'var(--accent-primary)' : 'var(--accent-negative)'}}>{r.netIncomeGrowthYoY?.toFixed(1) ?? '-'}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}



          {/* FUND CREATOR VIEW */}
          {activeTab === 'fund' && (
            <section className="animated-fade-in" style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '32px', maxWidth: '800px', margin: '0 auto' }}>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Briefcase size={28} color="var(--accent-primary)" /> 
                AI ile Yatırım Fonu Oluştur
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '24px', lineHeight: '1.6', fontSize: '1.05rem' }}>
                Yatırım hedefini veya ilgilendiğin temayı belirt (örn: "Temettü emekliliği", "Teknoloji odaklı büyüme"). Yapay zeka sana özel BIST hisselerinden oluşan bir sepet çıkarsın.
              </p>
              
              <div style={{ display: 'flex', gap: '16px', marginBottom: '32px' }}>
                <input 
                  type="text" 
                  placeholder="Fon hedefini yaz..." 
                  value={fundThemeInput}
                  onChange={(e) => setFundThemeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && generateAiFund()}
                  style={{ flex: 1, padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontSize: '1.1rem', outline: 'none' }}
                />
                <button 
                  onClick={generateAiFund}
                  disabled={fundLoading || !fundThemeInput.trim()}
                  style={{ backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '12px', padding: '0 32px', fontWeight: 700, fontSize: '1.05rem', cursor: fundLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: fundLoading ? 0.7 : 1 }}
                >
                  {fundLoading && <Loader2 className="spinner" size={20} />} 
                  Oluştur
                </button>
              </div>

              {fundError && <div style={{ color: 'var(--accent-negative)', marginBottom: '16px' }}>{fundError}</div>}

              {fundRecommendation && (
                <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '24px', lineHeight: '1.6' }}>
                  {parseMarkdown(fundRecommendation)}
                </div>
              )}
            </section>
          )}

          {/* STOCK ANALYSIS VIEW */}
          {data && !loading && !error && activeTab !== 'fund' && activeTab !== 'watchlist' && activeTab !== 'agenda' && activeTab !== 'assistant' && activeTab !== 'portfolio' && activeTab !== 'backtest' && activeTab !== 'heatmap' && activeTab !== 'global' && activeTab !== 'screener' && activeTab !== 'alerts' && activeTab !== 'macro' && (
            <div className="animated-fade-in">
              <section style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '32px', marginBottom: '24px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '24px', right: '24px', display: 'flex', gap: '8px' }}>
                  <button onClick={() => window.print()} style={{ backgroundColor: 'transparent', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px 16px', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    PDF İndir
                  </button>
                  <button onClick={() => {
                        const periods = activeTab === 'annual' ? data.annual : data.quarterly;
                        const headers = ['Kalem', ...periods.slice().reverse().map(p => p.periodLabel)];
                        const rows = [
                          ['Satış Gelirleri',  ...periods.slice().reverse().map(p => p.totalRevenue ?? '')],
                          ['Brüt Kâr',         ...periods.slice().reverse().map(p => p.grossProfit ?? '')],
                          ['FAVÖK',            ...periods.slice().reverse().map(p => p.ebitda ?? '')],
                          ['Net Kâr',          ...periods.slice().reverse().map(p => p.netIncome ?? '')],
                          ['Toplam Varlıklar', ...periods.slice().reverse().map(p => p.totalAssets ?? '')],
                          ['Özsermaye',        ...periods.slice().reverse().map(p => p.stockholdersEquity ?? '')],
                          ['Net Borç',         ...periods.slice().reverse().map(p => p.netDebt ?? '')],
                          ['Serbest Nakit Akışı', ...periods.slice().reverse().map(p => p.freeCashFlow ?? '')],
                        ];
                        downloadCsv(`${data.ticker}_${activeTab === 'annual' ? 'yillik' : 'ceyreklik'}_${new Date().toISOString().slice(0,10)}.csv`, headers, rows);
                      }}
                      style={{backgroundColor:'transparent', border:'1px solid var(--glass-border)', borderRadius:8, padding:'8px 16px', color:'var(--text-main)', cursor:'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 0.2s'}} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    CSV İndir
                  </button>
                  <button onClick={() => {
                        const above = prompt(`${data.ticker} için hedef fiyat (üstüne çıkarsa uyar):`, String((data.currentPrice * 1.05).toFixed(2)));
                        if (!above) return;
                        const v = parseFloat(above);
                        if (isNaN(v)) return;
                        setAlerts(p => [...p, { id: crypto.randomUUID(), ticker: data.ticker, condition: 'above', price: v, createdAt: new Date().toISOString() }]);
                        alert(`Uyarı kuruldu: ${data.ticker} ≥ ${v} ₺`);
                      }} style={{backgroundColor:'transparent', border:'1px solid var(--glass-border)', borderRadius:8, padding:'8px 16px', color:'var(--text-main)', cursor:'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 0.2s'}} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    Uyarı Kur
                  </button>
                  <button onClick={() => toggleWatchlist(data.ticker)} style={{ backgroundColor: 'transparent', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px 16px', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    {watchlist.includes(data.ticker) ? 'İzleme Listesinden Çıkar' : 'İzleme Listesine Ekle'}
                  </button>
                </div>
                <h1 style={{ fontSize: '2rem', fontWeight: 900, marginBottom: '8px' }}>{data.companyName}</h1>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>{data.ticker} - BIST</div>
                  {sentimentLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 12px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '20px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <Loader2 className="spinner" size={14} /> Duyarlılık Analizi Yapılıyor...
                    </div>
                  ) : sentimentData ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 16px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '24px', border: '1px solid var(--glass-border)' }} title={sentimentData.summary}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>SOSYAL DUYARLILIK:</div>
                      <div style={{ width: '100px', height: '8px', backgroundColor: 'var(--bg-main)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${sentimentData.score}%`, backgroundColor: sentimentData.score > 60 ? 'var(--accent-primary)' : sentimentData.score < 40 ? 'var(--accent-negative)' : 'var(--text-muted)', transition: 'width 1s ease-in-out' }} />
                      </div>
                      <div style={{ fontWeight: 800, color: sentimentData.score > 60 ? 'var(--accent-primary)' : sentimentData.score < 40 ? 'var(--accent-negative)' : 'var(--text-muted)' }}>
                        {sentimentData.score}/100
                      </div>
                    </div>
                  ) : null}
                </div>
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', marginBottom: '24px' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>Fiyat</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{data.currentPrice} {data.currency}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px', display:'flex', alignItems:'center' }}>Piyasa Değeri <InfoTooltip content={GLOSSARY.marketCap} /></div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{formatMoney(data.marketCap)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px', display:'flex', alignItems:'center' }}>F/K <InfoTooltip content={GLOSSARY.pe} /></div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.trailingPE ? data.trailingPE.toFixed(2) : '-'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px', display:'flex', alignItems:'center' }}>PD/DD <InfoTooltip content={GLOSSARY.pb} /></div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.priceToBook ? data.priceToBook.toFixed(2) : '-'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px', display:'flex', alignItems:'center' }}>FD/FAVÖK <InfoTooltip content={GLOSSARY.evEbitda} /></div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.evToEbitda ? data.evToEbitda.toFixed(2) : '-'}</div>
                  </div>
                </div>
                {/* Bilanço Puanı */}
                {(() => {
                  const sc = calculateBalanceScore(data);
                  if (!sc) return null;
                  const color = sc.score >= 7 ? 'var(--accent-primary)' : sc.score >= 4 ? '#f59e0b' : 'var(--accent-negative)';
                  return (
                    <div style={{marginTop:24, marginBottom:24, padding:20, backgroundColor:'rgba(255,255,255,0.02)', borderRadius:12, border:`1px solid ${color}`}}>
                      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16}}>
                        <h4 style={{fontSize:'1.05rem', fontWeight:800, color:'var(--text-muted)', margin:0}}>Bilanço Puanı</h4>
                        <div style={{display:'flex', alignItems:'baseline', gap:4}}>
                          <span style={{fontSize:'2.5rem', fontWeight:900, color}}>{sc.score.toFixed(1)}</span>
                          <span style={{fontSize:'1.2rem', color:'var(--text-muted)'}}>/ 10</span>
                        </div>
                      </div>
                      <div style={{display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:8}}>
                        {sc.breakdown.map((b,i) => {
                          const pct = (b.points / b.max) * 100;
                          const segColor = pct >= 75 ? 'var(--accent-primary)' : pct >= 50 ? '#f59e0b' : 'var(--accent-negative)';
                          return (
                            <div key={i} title={`${b.label}: ${b.note}`}>
                              <div style={{fontSize:'0.7rem', color:'var(--text-muted)', marginBottom:4, textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{b.label}</div>
                              <div style={{height:6, backgroundColor:'rgba(255,255,255,0.05)', borderRadius:3, overflow:'hidden'}}>
                                <div style={{width:`${pct}%`, height:'100%', backgroundColor:segColor}} />
                              </div>
                              <div style={{fontSize:'0.75rem', textAlign:'center', marginTop:4, fontWeight:600, color:segColor}}>{b.points}/{b.max}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', gap: '16px', borderTop: '1px solid var(--glass-border)', paddingTop: '24px' }}>
                  <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '8px', flex: 1 }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Satış Büyümesi (Yıllık)</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: data.scorecard?.revenueGrowthYoY && data.scorecard.revenueGrowthYoY > 0 ? 'var(--accent-primary)' : 'var(--accent-negative)' }}>
                      {data.scorecard?.revenueGrowthYoY ? `%${data.scorecard.revenueGrowthYoY.toFixed(1)}` : '-'}
                    </div>
                  </div>
                  <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '8px', flex: 1 }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>FAVÖK Büyümesi (Yıllık)</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: data.scorecard?.ebitdaGrowthYoY && data.scorecard.ebitdaGrowthYoY > 0 ? 'var(--accent-primary)' : 'var(--accent-negative)' }}>
                      {data.scorecard?.ebitdaGrowthYoY ? `%${data.scorecard.ebitdaGrowthYoY.toFixed(1)}` : '-'}
                    </div>
                  </div>
                  <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '8px', flex: 1 }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Net Kâr Büyümesi (Yıllık)</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: data.scorecard?.netIncomeGrowthYoY && data.scorecard.netIncomeGrowthYoY > 0 ? 'var(--accent-primary)' : 'var(--accent-negative)' }}>
                      {data.scorecard?.netIncomeGrowthYoY ? `%${data.scorecard.netIncomeGrowthYoY.toFixed(1)}` : '-'}
                    </div>
                  </div>
                </div>

                {/* Temettü Tarihçesi */}
                {dividends.length > 0 && (
                  <div style={{marginTop:32}}>
                    <h3 style={{fontSize:'1.2rem', fontWeight:800, marginBottom:16, display:'flex', alignItems:'center', gap:8}}>
                      <Briefcase size={20} color="var(--accent-primary)" />
                      Temettü Geçmişi (Son 5 Yıl)
                    </h3>
                    <div style={{display:'grid', gridTemplateColumns:'2fr 1fr', gap:24}}>
                      <div style={{backgroundColor:'rgba(255,255,255,0.02)', padding:20, borderRadius:12, border:'1px solid var(--glass-border)'}}>
                        <div style={{maxHeight:240, overflowY:'auto'}}>
                          {dividends.map((d, i) => (
                            <div key={i} style={{display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom: i === dividends.length-1 ? 'none' : '1px solid var(--glass-border)'}}>
                              <span style={{color:'var(--text-muted)'}}>{new Date(d.date).toLocaleDateString('tr-TR', {day:'numeric', month:'long', year:'numeric'})}</span>
                              <span style={{fontWeight:700, color:'var(--accent-primary)'}}>{d.amount.toFixed(4)} ₺</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{backgroundColor:'rgba(255,255,255,0.02)', padding:20, borderRadius:12, border:'1px solid var(--glass-border)'}}>
                        <div style={{color:'var(--text-muted)', fontSize:'0.85rem', marginBottom:8}}>Son 12 Ay Toplam</div>
                        <div style={{fontSize:'1.6rem', fontWeight:800, color:'var(--accent-primary)', marginBottom:16}}>
                          {dividends.filter(d => Date.now() - new Date(d.date).getTime() < 365*24*60*60*1000).reduce((s,d)=>s+d.amount, 0).toFixed(2)} ₺
                        </div>
                        <div style={{color:'var(--text-muted)', fontSize:'0.85rem', marginBottom:8}}>Temettü Verimi (12A)</div>
                        <div style={{fontSize:'1.4rem', fontWeight:700}}>
                          {(() => {
                            const yr = dividends.filter(d => Date.now() - new Date(d.date).getTime() < 365*24*60*60*1000).reduce((s,d)=>s+d.amount, 0);
                            return data.currentPrice > 0 ? `%${(yr/data.currentPrice*100).toFixed(2)}` : '-';
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Teknik Analiz Göstergeleri (Mock) */}
                {data.technicalIndicators && (
                  <div style={{ marginTop: '32px' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Activity size={20} color="var(--accent-primary)" />
                      Teknik Analiz Göstergeleri
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px', display:'flex', alignItems:'center' }}>RSI (14) Göstergesi <InfoTooltip content={GLOSSARY.rsi} /></div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                          {data.technicalIndicators.rsi ? data.technicalIndicators.rsi.toFixed(1) : '-'} <span style={{ fontSize: '1rem', fontWeight: 500, color: data.technicalIndicators.rsiSignal === 'AŞIRI ALIM' ? 'var(--accent-negative)' : data.technicalIndicators.rsiSignal === 'AŞIRI SATIM' ? 'var(--accent-primary)' : 'var(--text-muted)' }}>({data.technicalIndicators.rsiSignal})</span>
                        </div>
                      </div>
                      <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>Hareketli Ortalamalar</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px', display:'flex', alignItems:'center' }}>SMA (20) <InfoTooltip content={GLOSSARY.sma} />: <span style={{ color: 'var(--text-main)', marginLeft:4 }}>{data.technicalIndicators.sma20 ? data.technicalIndicators.sma20.toFixed(2) : '-'} ₺</span></div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>SMA (50): <span style={{ color: 'var(--text-main)' }}>{data.technicalIndicators.sma50 ? data.technicalIndicators.sma50.toFixed(2) : '-'} ₺</span></div>
                      </div>
                      <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px', display:'flex', alignItems:'center' }}>MACD Göstergesi (12, 26, 9) <InfoTooltip content={GLOSSARY.macd} /></div>
                        <div style={{ fontSize: '1.3rem', fontWeight: 700, color: data.technicalIndicators.macd && data.technicalIndicators.macd.histogram > 0 ? 'var(--accent-primary)' : 'var(--accent-negative)' }}>Hist: {data.technicalIndicators.macd ? data.technicalIndicators.macd.histogram.toFixed(3) : '-'}</div>
                      </div>
                      <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>Teknik Sinyal</div>
                          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>Karar Durumu</div>
                        </div>
                        <div style={{ backgroundColor: data.technicalIndicators.signal === 'AL' ? 'var(--accent-primary)' : data.technicalIndicators.signal === 'SAT' ? 'var(--accent-negative)' : 'var(--glass-border)', color: 'var(--text-main)', padding: '8px 24px', borderRadius: '24px', fontWeight: 800 }}>{data.technicalIndicators.signal}</div>
                      </div>
                    </div>
                  </div>
                )}

              </section>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '16px' }}>
                {(['quarterly', 'annual', 'charts', 'ai', 'compare'] as const).map(tab => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)} 
                    style={{ backgroundColor: activeTab === tab ? 'var(--accent-primary)' : 'transparent', color: activeTab === tab ? '#000' : 'var(--text-muted)', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    {tab === 'quarterly' ? 'Çeyreklik' : tab === 'annual' ? 'Yıllık' : tab === 'charts' ? 'Grafikler' : tab === 'ai' ? 'AI Analiz' : tab === 'compare' ? 'Karşılaştır' : 'KAP Bildirimleri'}
                  </button>
                ))}
              </div>

              {(activeTab === 'quarterly' || activeTab === 'annual') && (
                <section style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '24px', overflowX: 'auto' }}>
                  <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '16px', color: 'var(--text-muted)', borderBottom: '1px solid var(--glass-border)' }}>Kalem</th>
                        {(activeTab === 'quarterly' ? data.quarterly : data.annual).slice().reverse().map(p => (
                          <th key={p.date} style={{ padding: '16px', textAlign: 'right', color: 'var(--text-muted)', borderBottom: '1px solid var(--glass-border)' }}>{p.periodLabel}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: '16px', fontWeight: 600 }}>Satış Gelirleri</td>
                        {(activeTab === 'quarterly' ? data.quarterly : data.annual).slice().reverse().map(p => (
                          <td key={p.date} style={{ padding: '16px', textAlign: 'right' }}>{formatMoney(p.totalRevenue)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td style={{ padding: '16px', fontWeight: 600 }}>Brüt Kar</td>
                        {(activeTab === 'quarterly' ? data.quarterly : data.annual).slice().reverse().map(p => (
                          <td key={p.date} style={{ padding: '16px', textAlign: 'right' }}>{formatMoney(p.grossProfit)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td style={{ padding: '16px', fontWeight: 600, display:'flex', alignItems:'center' }}>FAVÖK (EBITDA) <InfoTooltip content={GLOSSARY.ebitda} /></td>
                        {(activeTab === 'quarterly' ? data.quarterly : data.annual).slice().reverse().map(p => (
                          <td key={p.date} style={{ padding: '16px', textAlign: 'right' }}>{formatMoney(p.ebitda)}</td>
                        ))}
                      </tr>
                      <tr>
                        <td style={{ padding: '16px', fontWeight: 600 }}>Net Kar</td>
                        {(activeTab === 'quarterly' ? data.quarterly : data.annual).slice().reverse().map(p => (
                          <td key={p.date} style={{ padding: '16px', textAlign: 'right' }}>{formatMoney(p.netIncome)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </section>
              )}

              {activeTab === 'ai' && (
                <section style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '32px', lineHeight: '1.6' }}>
                  {aiLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent-primary)' }}>
                      <Loader2 className="spinner" size={24} /> Yapay Zeka analiz ediyor...
                    </div>
                  ) : aiError ? (
                    <div style={{ color: 'var(--accent-negative)', padding: '16px', borderRadius: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--accent-negative)' }}>
                      <strong>AI Analiz Hatası:</strong> {aiError}
                    </div>
                  ) : (
                    <div>
                      {aiSentiment && (
                        <div style={{ marginBottom: '32px', paddingBottom: '32px', borderBottom: '1px solid var(--glass-border)' }}>
                          <h4 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '16px', color: 'var(--text-muted)' }}>Haber ve Veri Duyarlılığı (AI Sentiment)</h4>
                          <div style={{ display: 'flex', height: '16px', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
                            <div style={{ width: `${aiSentiment.positive}%`, backgroundColor: '#10b981', transition: 'width 1s ease-in-out' }}></div>
                            <div style={{ width: `${aiSentiment.neutral}%`, backgroundColor: '#6b7280', transition: 'width 1s ease-in-out' }}></div>
                            <div style={{ width: `${aiSentiment.negative}%`, backgroundColor: '#ef4444', transition: 'width 1s ease-in-out' }}></div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700 }}>
                            <span style={{ color: '#10b981' }}>● Olumlu (%{aiSentiment.positive})</span>
                            <span style={{ color: '#6b7280' }}>● Nötr (%{aiSentiment.neutral})</span>
                            <span style={{ color: '#ef4444' }}>● Olumsuz (%{aiSentiment.negative})</span>
                          </div>
                        </div>
                      )}
                      <div>{parseMarkdown(aiAnalysis)}</div>
                    </div>
                  )}
                </section>
              )}

              {activeTab === 'compare' && (
                <section style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '32px' }}>
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', position: 'relative' }} ref={compareRef}>
                    <input 
                      value={compareInput}
                      onChange={handleCompareSearch}
                      placeholder="Karşılaştırmak için hisse ekle..."
                      style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)' }}
                    />
                    {compareSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: '100px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '8px', marginTop: '8px', zIndex: 50 }}>
                        {compareSuggestions.map(res => (
                          <ClickableCard key={res.ticker} onActivate={() => addCompareStock(res.ticker)} ariaLabel={`${res.ticker} ekle`} style={{ padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--glass-border)' }}>
                            <strong>{res.ticker}</strong> - {res.name}
                          </ClickableCard>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    {[data, ...compareStocks].map(stock => (
                      <div key={stock.ticker} style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '12px' }}>{stock.ticker}</h3>
                        <div style={{ marginBottom: '8px' }}><span style={{ color: 'var(--text-muted)' }}>Fiyat:</span> {stock.currentPrice}</div>
                        <div style={{ marginBottom: '8px' }}><span style={{ color: 'var(--text-muted)' }}>Piyasa Değeri:</span> {formatMoney(stock.marketCap)}</div>
                        <div style={{ marginBottom: '8px' }}><span style={{ color: 'var(--text-muted)' }}>F/K:</span> {stock.trailingPE?.toFixed(2) || '-'}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                      <BrainCircuit size={28} color="var(--accent-primary)" />
                      <h3 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Akıllı Sektör & Rakip Kıyaslaması</h3>
                    </div>
                    
                    {!peerCompareData && !peerCompareLoading ? (
                       <button onClick={runPeerCompare} style={{ padding: '16px 32px', backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '8px', fontSize: '1.1rem', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'opacity 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'} onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}>
                         <Sparkles size={20} /> Yapay Zeka Kıyaslama Raporu Oluştur (DeepSeek V4 Pro)
                       </button>
                    ) : (
                       <div className="animated-fade-in" style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '32px', borderRadius: '12px', border: '1px solid var(--glass-border)', lineHeight: '1.6' }}>
                          {peerCompareLoading && !peerCompareData ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--accent-primary)' }}>
                              <Loader2 className="spinner" size={24} /> <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>Yapay Zeka Sektörel Verileri Analiz Ediyor...</span>
                            </div>
                          ) : (
                            <div>{parseMarkdown(peerCompareData)}</div>
                          )}
                       </div>
                    )}
                  </div>
                </section>
              )}
              

              {activeTab === 'kap' && (
                <section style={{backgroundColor:'var(--bg-card)', borderRadius:12, border:'1px solid var(--glass-border)', padding:32}}>
                  <h3 style={{fontSize:'1.3rem', fontWeight:800, marginBottom:24, display:'flex', alignItems:'center', gap:12}}>
                    <Activity size={20} color="var(--accent-primary)" />
                    {data.ticker} — KAP Bildirimleri
                  </h3>
                  {kapLoading ? (
                    <div style={{display:'flex', alignItems:'center', gap:12, color:'var(--accent-primary)'}}>
                      <Loader2 className="spinner" size={20} /> KAP verisi alınıyor...
                    </div>
                  ) : kapDisclosures.length === 0 ? (
                    <div style={{color:'var(--text-muted)', padding:40, textAlign:'center'}}>
                      Bu hisse için KAP bildirimi bulunamadı.
                    </div>
                  ) : (
                    <div style={{display:'flex', flexDirection:'column', gap:16}}>
                      {kapDisclosures.map((d, i) => (
                        <a key={i} href={d.url} target="_blank" rel="noreferrer"
                          style={{display:'block', padding:20, backgroundColor:'rgba(255,255,255,0.02)', borderRadius:10, border:'1px solid var(--glass-border)', textDecoration:'none', color:'inherit', transition:'border-color 0.2s'}}
                          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--glass-border)'}>
                          <div style={{fontWeight:700, color:'var(--text-main)', marginBottom:8, fontSize:'1.05rem'}}>{d.title}</div>
                          {d.publishedDate && <div style={{fontSize:'0.85rem', color:'var(--accent-primary)', marginBottom:8}}>{new Date(d.publishedDate).toLocaleDateString('tr-TR', {day:'numeric', month:'long', year:'numeric'})}</div>}
                          <div style={{fontSize:'0.95rem', color:'var(--text-muted)', lineHeight:1.6}}>{d.snippet}</div>
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {activeTab === 'charts' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <section style={{backgroundColor:'var(--bg-card)', borderRadius:12, border:'1px solid var(--glass-border)', padding:32}}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24}}>
                      <h3 style={{fontSize:'1.2rem', fontWeight:700}}>{data.ticker} Fiyat Geçmişi</h3>
                      <div style={{display:'flex', gap:8, marginRight:16}}>
                        <button onClick={() => setChartType('candle')}
                          style={{padding:'6px 14px', borderRadius:6, border:'none',
                            backgroundColor: chartType === 'candle' ? 'var(--accent-primary)' : 'transparent',
                            color: chartType === 'candle' ? '#000' : 'var(--text-muted)',
                            cursor:'pointer', fontWeight:600}}>
                          Mum
                        </button>
                        <button onClick={() => setChartType('line')}
                          style={{padding:'6px 14px', borderRadius:6, border:'none',
                            backgroundColor: chartType === 'line' ? 'var(--accent-primary)' : 'transparent',
                            color: chartType === 'line' ? '#000' : 'var(--text-muted)',
                            cursor:'pointer', fontWeight:600}}>
                          Çizgi
                        </button>
                      </div>
                      <div style={{display:'flex', gap:8}}>
                        {(['1m','3m','6m','1y','5y'] as const).map(r => (
                          <button key={r} onClick={() => setPriceRange(r)}
                            style={{padding:'6px 14px', borderRadius:6, border:'none',
                              backgroundColor: priceRange===r ? 'var(--accent-primary)' : 'transparent',
                              color: priceRange===r ? '#000' : 'var(--text-muted)',
                              cursor:'pointer', fontWeight:600}}>
                            {r === '1m' ? '1A' : r === '3m' ? '3A' : r === '6m' ? '6A' : r === '1y' ? '1Y' : '5Y'}
                          </button>
                        ))}
                      </div>
                    </div>
                    {priceHistory && priceHistory.points.length > 0 ? (
                      chartType === 'candle' ? (
                        <CandlestickChart data={priceHistory.points as any} />
                      ) : (
                        <div style={{width:'100%', height:400}}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={priceHistory.points} margin={{top:20, right:30, left:20, bottom:5}}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                              <XAxis dataKey="date" stroke="var(--text-muted)" tickFormatter={(d) => new Date(d).toLocaleDateString('tr-TR', {month:'short', year:'2-digit'})} />
                              <YAxis stroke="var(--text-muted)" domain={['auto','auto']} tickFormatter={(v) => (v as number).toFixed(0)} />
                              <Tooltip contentStyle={{backgroundColor:'var(--bg-card)', border:'1px solid #333'}}
                                labelFormatter={(d) => new Date(d).toLocaleDateString('tr-TR')}
                                formatter={(v: any) => [Number(v).toFixed(2) + ' ₺', 'Kapanış']} />
                              <Line type="monotone" dataKey="close" stroke="var(--accent-primary)" strokeWidth={2} dot={false} name="Kapanış" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )
                    ) : (
                      <div style={{color:'var(--text-muted)', padding:60, textAlign:'center'}}>Fiyat verisi yükleniyor...</div>
                    )}
                  </section>
                <section style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '32px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '24px' }}>Gelir Büyümesi (Yıllık)</h3>
                  <div style={{ width: '100%', height: '400px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsBar data={data.annual.slice().reverse()} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="periodLabel" stroke="var(--text-muted)" />
                        <YAxis stroke="var(--text-muted)" tickFormatter={(v) => (v / 1e9).toFixed(1) + ' Mlr ₺'} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid #333' }} />
                        <Bar dataKey="totalRevenue" fill="var(--accent-primary)" name="Satış Gelirleri" />
                        <Bar dataKey="netIncome" fill="#3b82f6" name="Net Kar" />
                      </RechartsBar>
                    </ResponsiveContainer>
                  </div>
                </section>
                  </div>
                )}

            </div>
          )}
        </main>
      </div>

      {/* FLOATING AI ASSISTANT WIDGET */}
      <Draggable bounds="body" handle=".drag-handle">
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '16px'
        }}>
          {isAssistantOpen && (
            <div className="animated-fade-in" style={{
              width: isMobile ? 'calc(100vw - 48px)' : '400px',
              height: isMobile ? 'calc(100vh - 120px)' : '600px',
              backgroundColor: 'var(--bg-secondary)', // Solid dark background to prevent text overlapping
              border: '1px solid var(--glass-border)',
              borderRadius: '16px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              {/* Header (Draggable) */}
              <div className="drag-handle" style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', cursor: 'grab' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MessageSquare size={20} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 800 }}>Efekt AI</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <select
                    value={aiChatModel}
                    onChange={(e) => setAiChatModel(e.target.value)}
                    style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', padding: '4px 8px', borderRadius: '6px', outline: 'none', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    <option value="deepseek-v4-pro">Pro</option>
                    <option value="deepseek-v4-flash">Fast</option>
                  </select>
                  <button onClick={() => setAssistantMessages([{ role: 'system', content: 'Merhaba! Ben Efekt AI. Şu an bulunduğun sayfadaki hisseleri ve verileri görüyorum. Nasıl yardımcı olabilirim?' }])} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }} title="Sohbeti Temizle">
                    <Loader2 size={16} />
                  </button>
                  <button onClick={() => setIsAssistantOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Chat Area */}
              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {assistantMessages.map((msg, i) => (
                  <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: msg.role === 'user' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)', color: msg.role === 'user' ? '#000' : 'var(--text-main)', padding: '12px 16px', borderRadius: '12px', border: msg.role === 'user' ? 'none' : '1px solid var(--glass-border)', fontSize: '0.95rem' }}>
                    {msg.role !== 'user' && msg.role !== 'system' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--accent-primary)', fontSize: '0.8rem', fontWeight: 800 }}>
                        <Activity size={12} /> Efekt AI
                      </div>
                    )}
                    <div style={{ lineHeight: '1.5', overflowX: 'auto' }}>
                      {msg.role === 'user' ? msg.content : parseMarkdown(msg.content)}
                    </div>
                  </div>
                ))}
                {isAssistantTyping && assistantStatus && (
                  <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                    <Loader2 className="spinner" size={14} /> {assistantStatus}
                  </div>
                )}
              </div>

              {/* Input Area */}
              <div style={{ padding: '16px', borderTop: '1px solid var(--glass-border)', display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  value={assistantInput}
                  onChange={(e) => setAssistantInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAssistantSend()}
                  placeholder="Bana bir şey sor..." 
                  style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontSize: '0.95rem', outline: 'none' }}
                />
                <button 
                  onClick={handleAssistantSend}
                  disabled={isAssistantTyping || !assistantInput.trim()}
                  style={{ backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '8px', padding: '0 16px', fontWeight: 800, cursor: isAssistantTyping ? 'not-allowed' : 'pointer', opacity: isAssistantTyping ? 0.7 : 1 }}
                >
                  <ArrowUpRight size={20} />
                </button>
              </div>
            </div>
          )}
          
          <button
            onClick={() => setIsAssistantOpen(prev => !prev)}
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'var(--accent-primary)',
              color: '#000',
              border: 'none',
              boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'transform 0.2s',
              transform: isAssistantOpen ? 'scale(0.9)' : 'scale(1)'
            }}
          >
            {isAssistantOpen ? <X size={32} /> : <Sparkles size={32} />}
          </button>
        </div>
      </Draggable>
    </div>
  );
}

function AddPositionForm({onAdd}: {onAdd: (p: any) => void}) {
  const [ticker, setTicker] = useState('');
  const [lots, setLots] = useState('');
  const [price, setPrice] = useState('');
  const submit = () => {
    if (!ticker || !lots || !price) return;
    onAdd({
      ticker: ticker.toUpperCase(),
      lots: parseFloat(lots),
      entryPrice: parseFloat(price),
      entryDate: new Date().toISOString().slice(0,10)
    });
    setTicker(''); setLots(''); setPrice('');
  };
  return (
    <div style={{display:'flex', gap:12, marginBottom:24, padding:20, backgroundColor:'var(--bg-card)', borderRadius:12, border:'1px solid var(--glass-border)'}}>
      <input value={ticker} onChange={e => setTicker(e.target.value)} placeholder="Sembol (THYAO)"
        style={{flex:1, padding:'10px 14px', borderRadius:8, border:'1px solid var(--glass-border)', backgroundColor:'var(--bg-main)', color:'var(--text-main)'}} />
      <input value={lots} onChange={e => setLots(e.target.value)} placeholder="Lot adedi" type="number"
        style={{width:120, padding:'10px 14px', borderRadius:8, border:'1px solid var(--glass-border)', backgroundColor:'var(--bg-main)', color:'var(--text-main)'}} />
      <input value={price} onChange={e => setPrice(e.target.value)} placeholder="Alış fiyatı ₺" type="number"
        style={{width:140, padding:'10px 14px', borderRadius:8, border:'1px solid var(--glass-border)', backgroundColor:'var(--bg-main)', color:'var(--text-main)'}} />
      <button onClick={submit} disabled={!ticker || !lots || !price}
        style={{padding:'10px 24px', borderRadius:8, border:'none', backgroundColor:'var(--accent-primary)', color:'#000', fontWeight:700, cursor:'pointer'}}>
        Pozisyon Ekle
      </button>
    </div>
  );
}

function PortfolioTable({portfolio, prices, onRemove, onDownload}: {portfolio: any[]; prices: Record<string, number>; onRemove: (i: number) => void; onDownload: () => void}) {
  const totalCost = portfolio.reduce((s, p) => s + p.lots * p.entryPrice, 0);
  const totalValue = portfolio.reduce((s, p) => s + p.lots * (prices[p.ticker] || p.entryPrice), 0);
  const totalPL = totalValue - totalCost;
  const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  return (
    <div style={{backgroundColor:'var(--bg-card)', borderRadius:12, border:'1px solid var(--glass-border)', padding:24}}>
      <div style={{display:'flex', justifyContent:'space-between', marginBottom:20, paddingBottom:20, borderBottom:'1px solid var(--glass-border)'}}>
        <div style={{display:'flex', gap:32}}>
          <div><div style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>Toplam Maliyet</div><div style={{fontSize:'1.4rem', fontWeight:700}}>{totalCost.toFixed(2)} ₺</div></div>
          <div><div style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>Güncel Değer</div><div style={{fontSize:'1.4rem', fontWeight:700}}>{totalValue.toFixed(2)} ₺</div></div>
          <div><div style={{color:'var(--text-muted)', fontSize:'0.85rem'}}>Kâr/Zarar</div>
            <div style={{fontSize:'1.4rem', fontWeight:800, color: totalPL >= 0 ? 'var(--accent-primary)' : 'var(--accent-negative)'}}>
              {totalPL >= 0 ? '+' : ''}{totalPL.toFixed(2)} ₺ ({totalPL >= 0 ? '+' : ''}{totalPLPct.toFixed(2)}%)
            </div>
          </div>
        </div>
        <button onClick={onDownload} style={{backgroundColor:'transparent', border:'1px solid var(--glass-border)', borderRadius:8, padding:'8px 16px', color:'var(--text-main)', cursor:'pointer'}}>Portföyü CSV İndir</button>
      </div>
      <table style={{width:'100%'}}>
        <thead><tr style={{color:'var(--text-muted)', fontSize:'0.85rem', textAlign:'left'}}>
          <th style={{padding:'12px 8px'}}>Sembol</th><th>Lot</th><th>Giriş</th><th>Güncel</th><th>K/Z</th><th></th>
        </tr></thead>
        <tbody>
          {portfolio.map((p, i) => {
            const cur = prices[p.ticker] || p.entryPrice;
            const pl = (cur - p.entryPrice) * p.lots;
            const plPct = ((cur - p.entryPrice) / p.entryPrice) * 100;
            return (
              <tr key={i} style={{borderTop:'1px solid var(--glass-border)'}}>
                <td style={{padding:'14px 8px', fontWeight:700}}>{p.ticker}</td>
                <td>{p.lots}</td>
                <td>{p.entryPrice.toFixed(2)} ₺</td>
                <td>{cur.toFixed(2)} ₺</td>
                <td style={{color: pl >= 0 ? 'var(--accent-primary)' : 'var(--accent-negative)', fontWeight:700}}>
                  {pl >= 0 ? '+' : ''}{pl.toFixed(2)} ₺ ({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)
                </td>
                <td><button onClick={() => onRemove(i)} aria-label="Pozisyonu sil" style={{background:'none', border:'none', color:'var(--accent-negative)', cursor:'pointer', fontSize:18}}>×</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
