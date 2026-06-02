import { Agent } from '../src/agent/agent';
import { InMemoryChatHistory } from '../src/utils/in-memory-chat-history';
import { readPortfolio } from '../src/portfolio/store';
import { getAlpacaPortfolio } from '../src/portfolio/alpaca';

async function runPaperTrader() {
  console.log('🤖 Wall Street Otonom Fon Yöneticisi Uyanıyor...');
  
  // Sadece portföy ve finansal araçlara izin ver
  const allowedTools = [
    'portfolio_get',
    'portfolio_buy',
    'portfolio_sell',
    'get_financials',
    'get_market_data',
    'web_search'
  ];

  const agent = await Agent.create({
    model: 'deepseek-chat', // DeepSeek modeli
    memoryEnabled: false,
    allowedToolNames: allowedTools,
  });

  let portfolio;
  if (process.env.ALPACA_API_KEY) {
    try {
      portfolio = await getAlpacaPortfolio();
    } catch (e: any) {
      console.warn("Alpaca fetch failed, falling back to local JSON:", e.message);
      portfolio = readPortfolio();
    }
  } else {
    portfolio = readPortfolio();
  }
  
  const systemPrompt = `
Sen "Dexter Capital" adında agresif ama rasyonel bir Wall Street fon yöneticisisin.
Amacın sana verilen başlangıç sermayesini Amerikan borsasında (Sadece NASDAQ ve NYSE) kârlı işlemler yaparak artırmak.
DİKKAT: Hesabında $200,000 gibi devasa bir nakit (Buying Power) görünüyor olabilir. ANCAK SENİN KİŞİSEL İŞLEM LİMİTİN SADECE 100 DOLARDIR. Toplamda sadece 100 dolarlık alım yapma hakkın var.
BÜTÇEN ÇOK KISITLI (100$). Bu yüzden hisseleri alırken tam sayı yerine ondalıklı (fractional) küsüratlar kullanmak zorundasın (Örn: 0.15 lot, 0.04 lot). Alım yapmaktan çekinme, mutlaka hisse alımı yap ama 100$ limitini aşma.
Hisseleri rastgele alma. Mutlaka güncel haberleri ve teknik çarpanları (F/K vb.) kontrol et.
Zararda olan ve umut vaat etmeyen pozisyonları kes (stop-loss), kârda olan ve potansiyeli bitmiş pozisyonları sat (take-profit).

ŞU ANKİ GÖREVİN:
1. 'portfolio_get' aracını çağırarak portföyün son durumunu gör.
2. İlgi çekici bulduğun 2-3 teknoloji hissesini (örneğin AAPL, NVDA, TSLA, MSFT) veya kendi seçeceğin hisseleri analiz et.
3. Uygun gördüğün hisseler için 'portfolio_buy' veya 'portfolio_sell' araçlarını kullanarak işlem yap. 
4. İşlemlerini tamamladıktan sonra neyi, neden aldığını/sattığını açıklayan kısa bir rapor yaz.
`;

  const history = new InMemoryChatHistory('deepseek-chat', 10);
  console.log('📈 Piyasalar analiz ediliyor ve portföy kararları alınıyor...\n');

  let finalAnswer = '';
  for await (const event of agent.run(systemPrompt, history)) {
    if (event.type === 'tool_start') {
      console.log(`[TOOL] ${event.tool} çalıştırılıyor... Argümanlar:`, JSON.stringify(event.args));
    } else if (event.type === 'done') {
      finalAnswer = event.answer || '';
    } else if (event.type === 'error') {
      console.error(`[ERROR] ${event.error}`);
    }
  }

  console.log('\n======================================');
  console.log('📝 GÜN SONU FON YÖNETİCİSİ RAPORU:');
  console.log('======================================');
  console.log(finalAnswer);
  
  let finalPortfolio;
  if (process.env.ALPACA_API_KEY) {
    try {
      finalPortfolio = await getAlpacaPortfolio();
    } catch (e) {
      finalPortfolio = readPortfolio();
    }
  } else {
    finalPortfolio = readPortfolio();
  }
  console.log('\n💰 GÜNCEL KASA: $', finalPortfolio.balance.toFixed(2));
}

runPaperTrader().catch(console.error);
