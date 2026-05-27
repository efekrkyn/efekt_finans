import YahooFinance from 'yahoo-finance2';

async function main() {
  const funds = ['MAC.IS', 'AFT.IS', 'YAS.IS', 'MAC', 'AFT', 'YAS'];
  for (const f of funds) {
    try {
      const q = await YahooFinance.quote(f);
      console.log(`Success for ${f}:`, (q as any).shortName);
    } catch (e) {
      console.log(`Failed for ${f}`);
    }
  }
}

main();
