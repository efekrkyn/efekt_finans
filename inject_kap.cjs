const fs = require('fs');
let content = fs.readFileSync('dashboard/src/App.tsx', 'utf-8');

// 1.2: State (yaklaşık satır 91, marketSummary altında)
const stateCode = `  const [kapDisclosures, setKapDisclosures] = useState<{title:string, url:string, snippet:string, publishedDate:string|null}[]>([]);
  const [kapLoading, setKapLoading] = useState(false);`;
content = content.replace("const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);", "const [marketSummary, setMarketSummary] = useState<MarketSummary | null>(null);\\n" + stateCode);

// 1.3: loadStock içi
const loadStockCode = `      setKapDisclosures([]);
      setKapLoading(true);
      fetch(\`/api/kap?ticker=\${encodeURIComponent(ticker)}\`)
        .then(r => r.json())
        .then(j => setKapDisclosures(j.disclosures || []))
        .catch(e => console.error('KAP:', e))
        .finally(() => setKapLoading(false));`;
content = content.replace("setData(json);", "setData(json);\\n" + loadStockCode);

// 1.4: activeTab tipi ve menü arrayleri
const oldActiveTabType = "useState<'quarterly'|'annual'|'charts'|'ai'|'compare'|'fund'|'watchlist'|'agenda'|'assistant'|'portfolio'>('quarterly');";
const newActiveTabType = "useState<'quarterly'|'annual'|'charts'|'ai'|'compare'|'fund'|'watchlist'|'agenda'|'assistant'|'portfolio'|'kap'>('quarterly');";
content = content.replace(oldActiveTabType, newActiveTabType);

const oldTabArray = "{['quarterly', 'annual', 'charts', 'ai', 'compare'].map(tab => (";
const newTabArray = "{['quarterly', 'annual', 'charts', 'ai', 'compare', 'kap'].map(tab => (";
content = content.replace(oldTabArray, newTabArray);

const oldTabLabel = "{tab === 'quarterly' ? 'Çeyreklik' : tab === 'annual' ? 'Yıllık' : tab === 'charts' ? 'Grafikler' : tab === 'ai' ? 'AI Analiz' : 'Karşılaştır'}";
const newTabLabel = "{tab === 'quarterly' ? 'Çeyreklik' : tab === 'annual' ? 'Yıllık' : tab === 'charts' ? 'Grafikler' : tab === 'ai' ? 'AI Analiz' : tab === 'compare' ? 'Karşılaştır' : 'KAP Bildirimleri'}";
content = content.replace(oldTabLabel, newTabLabel);

// 1.5: UI render (activeTab === 'compare' bittikten sonra)
const kapUI = `
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
                          <div style={{fontWeight:700, color:'#fff', marginBottom:8, fontSize:'1.05rem'}}>{d.title}</div>
                          {d.publishedDate && <div style={{fontSize:'0.85rem', color:'var(--accent-primary)', marginBottom:8}}>{new Date(d.publishedDate).toLocaleDateString('tr-TR', {day:'numeric', month:'long', year:'numeric'})}</div>}
                          <div style={{fontSize:'0.95rem', color:'var(--text-muted)', lineHeight:1.6}}>{d.snippet}</div>
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              )}`;

const targetCompareEnd = "              {activeTab === 'charts' && (";
content = content.replace(targetCompareEnd, kapUI + "\\n\\n" + targetCompareEnd);

fs.writeFileSync('dashboard/src/App.tsx', content, 'utf-8');
