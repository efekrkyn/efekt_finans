import { readPortfolio, type PortfolioData, type Position } from './store';

const ALPACA_BASE_URL = 'https://paper-api.alpaca.markets/v2';

function getHeaders() {
  const apiKey = process.env.ALPACA_API_KEY;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!apiKey || !secretKey) {
    throw new Error('Alpaca API keys are missing in environment variables.');
  }
  return {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': secretKey,
    'Content-Type': 'application/json'
  };
}

export async function getAlpacaPortfolio(): Promise<PortfolioData> {
  // We ignore Alpaca's balance because Paper Trading forces 100K/200K limits.
  // Instead, we read our strict local JSON balance (e.g. $100).
  const localPortfolio = readPortfolio();
  const balance = localPortfolio.balance;

  // 2. Get Positions
  const posRes = await fetch(`${ALPACA_BASE_URL}/positions`, { headers: getHeaders() });
  if (!posRes.ok) {
    throw new Error(`Failed to fetch Alpaca positions: ${await posRes.text()}`);
  }
  const posData = await posRes.json();

  const positions: Record<string, Position> = {};
  for (const p of posData) {
    positions[p.symbol] = {
      ticker: p.symbol,
      shares: parseFloat(p.qty),
      avgCost: parseFloat(p.avg_entry_price)
    };
  }

  return {
    balance,
    positions,
    history: [] // We don't fetch full history for this simple view
  };
}

export async function submitAlpacaOrder(ticker: string, shares: number, side: 'buy' | 'sell'): Promise<{ success: boolean; message: string; data?: any }> {
  // fractional shares are supported if type='market'
  const payload = {
    symbol: ticker.toUpperCase(),
    qty: shares.toString(),
    side: side,
    type: 'market',
    time_in_force: 'day'
  };

  const res = await fetch(`${ALPACA_BASE_URL}/orders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errorBody = await res.text();
    return { success: false, message: `Alpaca order failed: ${errorBody}` };
  }

  const orderData = await res.json();
  return { 
    success: true, 
    message: `${shares} adet ${ticker} için Alpaca borsasına ${side} emri başarıyla iletildi. Durum: ${orderData.status}`,
    data: orderData
  };
}
