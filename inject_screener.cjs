const fs = require('fs');
let content = fs.readFileSync('dashboard/src/App.tsx', 'utf-8');

// 1. activeTab tipleri
const oldActiveTabType = "useState<'quarterly'|'annual'|'charts'|'ai'|'compare'|'fund'|'watchlist'|'agenda'|'assistant'|'portfolio'|'kap'>('quarterly');";
const newActiveTabType = "useState<'quarterly'|'annual'|'charts'|'ai'|'compare'|'fund'|'watchlist'|'agenda'|'assistant'|'portfolio'|'kap'|'screener'>('quarterly');";
content = content.replace(oldActiveTabType, newActiveTabType);

// 2. Sidebar Nav Items
const targetAgendaNav = "{ id: 'agenda', label: 'Ajanda', icon: Calendar, active: activeTab === 'agenda' },";
const newScreenerNav = "{ id: 'screener', label: 'Tarayıcı', icon: Search, active: activeTab === 'screener' },\\n            " + targetAgendaNav;
content = content.replace(targetAgendaNav, newScreenerNav);

// onActivate logic in sidebar
const targetAgendaOnAct = "if (item.id === 'agenda') { setActiveTab('agenda'); }";
const newScreenerOnAct = "if (item.id === 'screener') { setData(null); setActiveTab('screener'); }\\n                " + targetAgendaOnAct;
content = content.replace(targetAgendaOnAct, newScreenerOnAct);

// 3. States & runScreener
const targetDividendsState = "  const [dividends, setDividends] = useState<{date:string, amount:number}[]>([]);";
const newScreenerStates = `  const [screenerFilters, setScreenerFilters] = useState({minPE:'', maxPE:'', minPB:'', maxPB:'', minRevGrowth:''});
  const [screenerResults, setScreenerResults] = useState<any[]>([]);
  const [screenerLoading, setScreenerLoading] = useState(false);

  const runScreener = async () => {
    setScreenerLoading(true);
    setScreenerResults([]);
    try {
      const params = new URLSearchParams();
      Object.entries(screenerFilters).forEach(([k,v]) => { if (v) params.set(k, v); });
      const res = await fetch(\`/api/screener?\${params.toString()}\`);
      const json = await res.json();
      setScreenerResults(json.results || []);
    } catch (e) { console.error(e); }
    finally { setScreenerLoading(false); }
  };`;
content = content.replace(targetDividendsState, targetDividendsState + "\\n" + newScreenerStates);

// 4. View UI (after agenda view)
const targetAgendaViewEnd = `                </div>
              </div>
            </div>
          )}

          {activeTab === 'assistant' && (`;

const newScreenerView = `
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
                      style={{width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid var(--glass-border)', backgroundColor:'var(--bg-main)', color:'#fff'}} />
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
                        <th style={{padding:'14px 16px'}}>Sembol</th><th>Şirket</th><th>Fiyat</th><th>F/K</th><th>PD/DD</th><th>FD/FAVÖK</th><th>Satış YoY</th><th>Net Kâr YoY</th>
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

          {activeTab === 'assistant' && (`;

content = content.replace(targetAgendaViewEnd, newScreenerView);

fs.writeFileSync('dashboard/src/App.tsx', content, 'utf-8');
