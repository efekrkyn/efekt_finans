import { checkEnv } from './env-check.js';

const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';

function getApiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    throw new Error('FMP_API_KEY ortam değişkeni tanımlı değil. Lütfen .env dosyanızı kontrol edin.');
  }
  return key;
}

async function fetchFmp<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const apiKey = getApiKey();
  const url = new URL(`${FMP_BASE_URL}${endpoint}`);
  url.searchParams.append('apikey', apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, String(value));
  }

  const response = await fetch(url.toString(), {
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    let errorMsg = `FMP API hatası: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json() as any;
      if (errorData['Error Message']) errorMsg += ` - ${errorData['Error Message']}`;
    } catch (e) {}
    throw new Error(errorMsg);
  }

  return response.json() as Promise<T>;
}

export const fmpClient = {
  async quote(ticker: string): Promise<any[]> {
    return fetchFmp<any[]>(`/quote/${ticker}`);
  },

  async incomeStatement(ticker: string, limit: number = 4, period: 'quarter' | 'annual' = 'quarter'): Promise<any[]> {
    return fetchFmp<any[]>(`/income-statement/${ticker}`, { limit, period });
  },

  async balanceSheet(ticker: string, limit: number = 4, period: 'quarter' | 'annual' = 'quarter'): Promise<any[]> {
    return fetchFmp<any[]>(`/balance-sheet-statement/${ticker}`, { limit, period });
  },

  async cashFlowStatement(ticker: string, limit: number = 4, period: 'quarter' | 'annual' = 'quarter'): Promise<any[]> {
    return fetchFmp<any[]>(`/cash-flow-statement/${ticker}`, { limit, period });
  },

  async historical(ticker: string, from?: string, to?: string): Promise<{ symbol: string, historical: any[] }> {
    const params: Record<string, string> = {};
    if (from) params.from = from;
    if (to) params.to = to;
    return fetchFmp<{ symbol: string, historical: any[] }>(`/historical-price-full/${ticker}`, params);
  },

  async dividends(ticker: string): Promise<{ symbol: string, historical: any[] }> {
    return fetchFmp<{ symbol: string, historical: any[] }>(`/historical-price-full/stock_dividend/${ticker}`);
  },

  async search(query: string, exchange: string = 'istanbul', limit: number = 10): Promise<any[]> {
    const params: Record<string, string | number> = { query, limit };
    if (exchange) params.exchange = exchange;
    return fetchFmp<any[]>('/search', params);
  }
};
