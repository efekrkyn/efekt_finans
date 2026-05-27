import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, Activity, Loader2, Briefcase, TrendingUp,
  ChevronRight, BarChart, Bell, User, LayoutGrid, Calendar, List, MessageSquare
} from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart as RechartsBar, Bar } from 'recharts';

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
}

function getSessionId() {
  let id = localStorage.getItem('dexter-session-id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('dexter-session-id', id); }
  return id;
}
const sessionId = getSessionId();

export default function App() {
  const [activeTab, setActiveTab] = useState<'quarterly'|'annual'|'charts'|'ai'|'compare'|'fund'|'watchlist'|'agenda'|'assistant'>('quarterly');
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
  const [assistantMessages, setAssistantMessages] = useState<{role: 'user'|'assistant'|'system', content: string}[]>([
    { role: 'system', content: 'Merhaba! Ben Dexter AI. BIST hisseleri hakkında analiz, karşılaştırma veya fon oluşturma konularında sana yardımcı olabilirim.' }
  ]);
  const [assistantInput, setAssistantInput] = useState('');
  const [isAssistantTyping, setIsAssistantTyping] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('');

  const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);

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
      const saved = localStorage.getItem('fintables-watchlist');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setWatchlist(parsed.filter(t => typeof t === 'string'));
      }
    } catch (e) {
      console.warn('Watchlist parse failed, resetting:', e);
      localStorage.removeItem('fintables-watchlist');
    }
    
    fetch('/api/market-summary')
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
    localStorage.setItem('fintables-watchlist', JSON.stringify(updated));
  };

  const loadAbortRef = useRef<AbortController | null>(null);
  const loadStock = async (ticker: string) => {
    loadAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadAbortRef.current = ctrl;
    setLoading(true); setError(''); setSearchResults([]); setTickerInput('');
    try {
      const res = await fetch(`/api/analysis?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Veri alınamadı');
      setData(json);
      setAiAnalysis('');
      setAiSentiment(null);
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

  const aiAbortRef = useRef<AbortController | null>(null);
  const fetchAiAnalysis = useCallback(async (ticker: string) => {
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    setAiLoading(true);
    try {
      const res = await fetch(`/api/ai-analysis?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'AI hatası');
      setAiAnalysis(json.analysis);
      setAiSentiment(json.sentiment || null);
    } catch(e: any) { 
      if (e.name !== 'AbortError') {
        console.error(e);
        setError('AI analizi alınamadı');
      }
    } finally { 
      if (aiAbortRef.current === ctrl) setAiLoading(false); 
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'ai' && data && !aiAnalysis && !aiLoading) {
      fetchAiAnalysis(data.ticker);
    }
  }, [activeTab, data, aiAnalysis, aiLoading, fetchAiAnalysis]);

  const fundAbortRef = useRef<AbortController | null>(null);
  const generateAiFund = async () => {
    if (!fundThemeInput.trim()) return;
    fundAbortRef.current?.abort();
    const ctrl = new AbortController();
    fundAbortRef.current = ctrl;
    setFundLoading(true); setFundError(''); setFundRecommendation('');
    try {
      const res = await fetch(`/api/ai-fund?theme=${encodeURIComponent(fundThemeInput)}`, { signal: ctrl.signal });
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
      const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, sessionId })
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
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
      const res = await fetch(`/api/compare?tickers=${all.join(',')}`);
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
        const json = await res.json();
        setSearchResults(Array.isArray(json) ? json : json.results || []);
      } catch(e) { console.error(e); }
    }, 250);
  };

  const formatMoney = (val: any) => {
    if (val == null) return '-';
    const n = Number(val);
    if (!isFinite(n)) return '-';
    if (Math.abs(n) >= 1e9) return (n/1e9).toFixed(2) + ' Mlr ₺';
    if (Math.abs(n) >= 1e6) return (n/1e6).toFixed(2) + ' M ₺';
    return new Intl.NumberFormat('tr-TR').format(n) + ' ₺';
  };

  const parseMarkdown = (text: string) => {
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
    <div id="print-area" className="app-container" style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)', fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
      {/* LEFT SIDEBAR */}
      <aside style={{ width: '260px', backgroundColor: 'var(--bg-card)', borderRight: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px', fontSize: '1.5rem', fontWeight: 900, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity color="var(--accent-primary)" />
          Dexter
        </div>
        
        <div style={{ padding: '0 20px', marginBottom: '24px' }}>
          <button style={{ width: '100%', backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => { setActiveTab('fund'); setData(null); }}>
            <Briefcase size={18} />
            Fon Oluştur
          </button>
        </div>

        <nav style={{ flex: 1, padding: '0 12px' }}>
          {[
            { id: 'dashboard', label: 'Piyasalar', icon: LayoutGrid, active: !data && activeTab !== 'fund' && activeTab !== 'assistant' },
            { id: 'stocks', label: 'Hisseler', icon: BarChart, active: !!data && activeTab !== 'fund' },
            { id: 'watchlist', label: 'İzleme Listesi', icon: List, active: activeTab === 'watchlist' },
            { id: 'agenda', label: 'Ajanda', icon: Calendar, active: activeTab === 'agenda' },
            { id: 'assistant', label: 'AI Asistan', icon: MessageSquare, active: activeTab === 'assistant' }
          ].map(item => (
            <ClickableCard 
              key={item.id}
              onActivate={() => {
                if (item.id === 'dashboard') { setData(null); setActiveTab('quarterly'); }
                if (item.id === 'stocks') { if (!data) loadStock('THYAO'); setActiveTab('quarterly'); }
                if (item.id === 'watchlist') { setActiveTab('watchlist'); }
                if (item.id === 'agenda') { setActiveTab('agenda'); }
                if (item.id === 'assistant') { setData(null); setActiveTab('assistant'); }
              }}
              ariaLabel={item.label}
              style={{ padding: '12px 16px', margin: '4px 0', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', color: item.active ? '#fff' : 'var(--text-muted)', backgroundColor: item.active ? 'rgba(255,255,255,0.05)' : 'transparent', cursor: 'pointer', fontWeight: item.active ? 600 : 400 }}
            >
              <item.icon size={20} color={item.active ? 'var(--accent-primary)' : 'currentColor'} />
              {item.label}
            </ClickableCard>
          ))}
        </nav>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* TOPBAR */}
        {activeTab !== 'assistant' && (
        <header style={{ height: '70px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', padding: '0 24px', backgroundColor: 'var(--bg-card)', gap: '24px' }}>
          <div ref={searchRef} style={{ position: 'relative', width: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              value={tickerInput}
              onChange={handleSearch}
              placeholder="Hisse sembolü veya adıyla ara..." 
              style={{ width: '100%', padding: '10px 12px 10px 40px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: '#fff', fontSize: '0.95rem', outline: 'none' }}
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
                    <strong style={{ color: '#fff' }}>{res.ticker}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{res.name}</span>
                  </ClickableCard>
                ))}
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '32px', marginLeft: 'auto' }}>
            {['xu100', 'usdtry', 'eurtry'].map((key) => {
              const mData = marketSummary?.[key as keyof MarketSummary];
              const price = mData?.price;
              const change = mData?.change;
              if (typeof price !== 'number' || typeof change !== 'number') return null;
              
              const isPos = change > 0;
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '0.75rem', color: '#999', textTransform: 'uppercase', fontWeight: 700 }}>
                    {key === 'xu100' ? 'XU100' : key === 'usdtry' ? 'USDTRY' : 'EURTRY'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem', fontWeight: 700 }}>
                    <span style={{ color: '#fff' }}>{key === 'xu100' ? price.toFixed(2) : price.toFixed(4)}</span>
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
          {!data && !loading && !error && activeTab !== 'fund' && (
            <div className="animated-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '32px' }}>
              
              <div>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '24px' }}>BIST 100 Popüler Hisseler</h2>
                
                {/* 10 Box Stocks */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '32px' }}>
                  {['THYAO', 'TUPRS', 'KCHOL', 'AKBNK', 'ASELS', 'BIMAS', 'EREGL', 'ISCTR', 'SAHOL', 'YKBNK'].map(idx => (
                    <ClickableCard 
                      key={idx} 
                      onActivate={() => loadStock(idx)}
                      ariaLabel={`${idx} hisse detayları`}
                      style={{ backgroundColor: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)', cursor: 'pointer', transition: 'border-color 0.2s', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
                      onMouseEnter={(e: any) => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                      onMouseLeave={(e: any) => e.currentTarget.style.borderColor = 'var(--glass-border)'}
                    >
                      <h3 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '8px', fontWeight: 800 }}>{idx}</h3>
                      <div style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', fontWeight: 600 }}>Analiz <ChevronRight size={14} style={{ verticalAlign: 'middle' }}/></div>
                    </ClickableCard>
                  ))}
                </div>

                {/* 90 List Stocks */}
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '16px', color: 'var(--text-muted)' }}>Diğer Hisseler (Liste Görünümü)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px', backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: '12px', border: '1px solid var(--glass-border)', maxHeight: '400px', overflowY: 'auto' }}>
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
                      style={{ padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600, color: '#fff', backgroundColor: 'rgba(255,255,255,0.02)', textAlign: 'center', transition: 'background-color 0.2s' }}
                      onMouseEnter={(e: any) => { e.currentTarget.style.backgroundColor = 'var(--accent-primary)'; e.currentTarget.style.color = '#000'; }}
                      onMouseLeave={(e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'; e.currentTarget.style.color = '#fff'; }}
                    >
                      {idx}
                    </ClickableCard>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '32px' }}>
                  <div style={{ backgroundColor: 'var(--bg-card)', padding: '24px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Calendar size={18} color="var(--accent-primary)"/> Yaklaşan Ajanda <span style={{fontSize: '0.7rem', backgroundColor: 'var(--accent-negative)', padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto'}}>Demo Veri</span></h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>TUPRS - Bilanço</span><span style={{ fontWeight: 600, color: '#fff' }}>Yarın</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>THYAO - Yatırımcı Sunumu</span><span style={{ fontWeight: 600, color: '#fff' }}>12 Mayıs</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>KCHOL - Temettü (4.5 ₺)</span><span style={{ fontWeight: 600, color: '#fff' }}>15 Mayıs</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}><span style={{ color: 'var(--text-muted)' }}>ASELS - Bilanço</span><span style={{ fontWeight: 600, color: '#fff' }}>20 Mayıs</span></div>
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
                            <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#fff' }}>{ticker}</div>
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
                      <div style={{ color: '#fff' }}>{item.event}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI ASSISTANT VIEW */}
          {activeTab === 'assistant' && (
            <div className="animated-fade-in" style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', maxWidth: '900px', margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <MessageSquare size={24} color="var(--accent-primary)" /> AI Finansal Asistan
                </h2>
                <button 
                  onClick={() => setAssistantMessages([{ role: 'system', content: 'Merhaba! Ben Dexter AI. BIST hisseleri hakkında analiz, karşılaştırma veya fon oluşturma konularında sana yardımcı olabilirim.' }])}
                  style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: '#fff', border: '1px solid var(--glass-border)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}
                >
                  Geçmişi Temizle
                </button>
              </div>
              
              <div ref={scrollRef} style={{ flex: 1, backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '16px' }}>
                {assistantMessages.map((msg, i) => (
                  <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: msg.role === 'user' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.02)', color: msg.role === 'user' ? '#000' : '#fff', padding: '20px', borderRadius: '12px', border: msg.role === 'user' ? 'none' : '1px solid var(--glass-border)' }}>
                    {msg.role !== 'user' && msg.role !== 'system' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', color: 'var(--accent-primary)' }}>
                        <Activity size={16} /> <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>Dexter AI</span>
                      </div>
                    )}
                    <div style={{ lineHeight: '1.6', fontSize: '1.05rem', overflowX: 'auto' }}>
                      {msg.role === 'user' ? msg.content : parseMarkdown(msg.content)}
                    </div>
                  </div>
                ))}
                {isAssistantTyping && assistantStatus && (
                  <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '12px 20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                    <Loader2 className="spinner" size={16} /> {assistantStatus}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '16px' }}>
                <input 
                  type="text" 
                  value={assistantInput}
                  onChange={(e) => setAssistantInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAssistantSend()}
                  placeholder="Hisse analizi iste, piyasa durumu sor, fon oluştur..." 
                  style={{ flex: 1, padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: '#fff', fontSize: '1rem', outline: 'none' }}
                />
                <button 
                  onClick={handleAssistantSend}
                  disabled={isAssistantTyping || !assistantInput.trim()}
                  style={{ backgroundColor: 'var(--accent-primary)', color: '#000', border: 'none', borderRadius: '12px', padding: '0 32px', fontWeight: 800, fontSize: '1.05rem', cursor: isAssistantTyping ? 'not-allowed' : 'pointer', opacity: isAssistantTyping ? 0.7 : 1 }}
                >
                  Gönder
                </button>
              </div>
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
                  style={{ flex: 1, padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: '#fff', fontSize: '1.1rem', outline: 'none' }}
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
          {data && !loading && !error && activeTab !== 'fund' && activeTab !== 'watchlist' && activeTab !== 'agenda' && activeTab !== 'assistant' && (
            <div className="animated-fade-in">
              <section style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '32px', marginBottom: '24px', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '24px', right: '24px', display: 'flex', gap: '8px' }}>
                  <button onClick={() => window.print()} style={{ backgroundColor: 'transparent', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px 16px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    PDF İndir
                  </button>
                  <button onClick={() => toggleWatchlist(data.ticker)} style={{ backgroundColor: 'transparent', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px 16px', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    {watchlist.includes(data.ticker) ? 'İzleme Listesinden Çıkar' : 'İzleme Listesine Ekle'}
                  </button>
                </div>
                <h1 style={{ fontSize: '2rem', fontWeight: 900, marginBottom: '8px' }}>{data.companyName}</h1>
                <div style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginBottom: '24px' }}>{data.ticker} - BIST</div>
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '32px', marginBottom: '24px' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>Fiyat</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{data.currentPrice} {data.currency}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>Piyasa Değeri</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{formatMoney(data.marketCap)}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>F/K</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.trailingPE ? data.trailingPE.toFixed(2) : '-'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>PD/DD</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.priceToBook ? data.priceToBook.toFixed(2) : '-'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>FD/FAVÖK</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{data.evToEbitda ? data.evToEbitda.toFixed(2) : '-'}</div>
                  </div>
                </div>

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

                {/* Teknik Analiz Göstergeleri (Mock) */}
                <div style={{ marginTop: '32px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={20} color="var(--accent-primary)" />
                    Teknik Analiz Göstergeleri <span style={{fontSize: '0.7rem', backgroundColor: 'var(--accent-negative)', padding: '2px 6px', borderRadius: '4px', marginLeft: 'auto'}}>Demo Veri</span>
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>RSI (14) Göstergesi</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>41.7 <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)' }}>(NÖTR)</span></div>
                    </div>
                    <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>Hareketli Ortalamalar</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px' }}>SMA (20): <span style={{ color: '#fff' }}>{(data.currentPrice * 1.02).toFixed(2)} ₺</span></div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>SMA (50): <span style={{ color: '#fff' }}>{(data.currentPrice * 1.05).toFixed(2)} ₺</span></div>
                    </div>
                    <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>MACD Göstergesi (12, 26, 9)</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent-negative)' }}>Hist: -15.398</div>
                    </div>
                    <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '8px' }}>Teknik Sinyal</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>Karar Durumu</div>
                      </div>
                      <div style={{ backgroundColor: 'var(--accent-negative)', color: '#fff', padding: '8px 24px', borderRadius: '24px', fontWeight: 800 }}>SAT</div>
                    </div>
                  </div>
                </div>

              </section>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '16px' }}>
                {(['quarterly', 'annual', 'charts', 'ai', 'compare'] as const).map(tab => (
                  <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)} 
                    style={{ backgroundColor: activeTab === tab ? 'var(--accent-primary)' : 'transparent', color: activeTab === tab ? '#000' : 'var(--text-muted)', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    {tab === 'quarterly' ? 'Çeyreklik' : tab === 'annual' ? 'Yıllık' : tab === 'charts' ? 'Grafikler' : tab === 'ai' ? 'AI Analiz' : 'Karşılaştır'}
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
                        <td style={{ padding: '16px', fontWeight: 600 }}>FAVÖK (EBITDA)</td>
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
                      style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--glass-border)', backgroundColor: 'var(--bg-main)', color: '#fff' }}
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
                </section>
              )}
              
              {activeTab === 'charts' && (
                <section style={{ backgroundColor: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--glass-border)', padding: '32px' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '24px' }}>Gelir Büyümesi (Yıllık)</h3>
                  <div style={{ width: '100%', height: '400px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsBar data={data.annual.slice().reverse()} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis dataKey="periodLabel" stroke="#999" />
                        <YAxis stroke="#999" tickFormatter={(v) => (v / 1e9).toFixed(1) + ' Mlr ₺'} />
                        <Tooltip contentStyle={{ backgroundColor: '#1c1c1c', border: '1px solid #333' }} />
                        <Bar dataKey="totalRevenue" fill="var(--accent-primary)" name="Satış Gelirleri" />
                        <Bar dataKey="netIncome" fill="#3b82f6" name="Net Kar" />
                      </RechartsBar>
                    </ResponsiveContainer>
                  </div>
                </section>
              )}

            </div>
          )}
        </main>
      </div>
    </div>
  );
}