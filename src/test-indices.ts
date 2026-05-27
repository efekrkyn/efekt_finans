import YahooFinance from 'yahoo-finance2';

async function main() {
  const tickers = ['XU100.IS', 'XU030.IS', 'TRY=X', 'EURTRY=X'];
  for (const t of tickers) {
    try {
      const q = await YahooFinance.quote(t);
      console.log(`Success ${t}: ${(q as any).regularMarketPrice} (${(q as any).regularMarketChangePercent}%)`);
    } catch (e) {
      console.log(`Failed ${t}:`, (e as Error).message);
    }
  }
}

main();
