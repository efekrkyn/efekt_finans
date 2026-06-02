import fs from 'fs';
import path from 'path';

export interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
}

export interface Transaction {
  date: string;
  type: 'BUY' | 'SELL';
  ticker: string;
  shares: number;
  price: number;
  total: number;
}

export interface PortfolioData {
  balance: number;
  positions: Record<string, Position>;
  history: Transaction[];
}

const PORTFOLIO_FILE = path.join(process.cwd(), '.dexter', 'portfolio.json');

const INITIAL_PORTFOLIO: PortfolioData = {
  balance: 100.0,
  positions: {},
  history: [],
};

function ensureFileExists() {
  const dir = path.dirname(PORTFOLIO_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(PORTFOLIO_FILE)) {
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(INITIAL_PORTFOLIO, null, 2), 'utf-8');
  }
}

export function readPortfolio(): PortfolioData {
  ensureFileExists();
  try {
    const raw = fs.readFileSync(PORTFOLIO_FILE, 'utf-8');
    return JSON.parse(raw) as PortfolioData;
  } catch (err) {
    console.error('Failed to read portfolio, returning default', err);
    return INITIAL_PORTFOLIO;
  }
}

export function writePortfolio(data: PortfolioData) {
  ensureFileExists();
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function buyStock(ticker: string, shares: number, price: number): { success: boolean; message: string; data?: PortfolioData } {
  const t = ticker.toUpperCase();
  const portfolio = readPortfolio();
  const totalCost = shares * price;

  if (portfolio.balance < totalCost) {
    return { success: false, message: `Yetersiz bakiye. Gerekli: $${totalCost.toFixed(2)}, Mevcut: $${portfolio.balance.toFixed(2)}` };
  }

  portfolio.balance -= totalCost;

  if (!portfolio.positions[t]) {
    portfolio.positions[t] = { ticker: t, shares: 0, avgCost: 0 };
  }

  const pos = portfolio.positions[t];
  const oldTotalValue = pos.shares * pos.avgCost;
  pos.shares += shares;
  pos.avgCost = (oldTotalValue + totalCost) / pos.shares;

  portfolio.history.push({
    date: new Date().toISOString(),
    type: 'BUY',
    ticker: t,
    shares,
    price,
    total: totalCost,
  });

  writePortfolio(portfolio);
  return { success: true, message: `${shares} adet ${t} başarıyla $${price.toFixed(2)} fiyattan alındı.`, data: portfolio };
}

export function sellStock(ticker: string, shares: number, price: number): { success: boolean; message: string; data?: PortfolioData } {
  const t = ticker.toUpperCase();
  const portfolio = readPortfolio();
  
  const pos = portfolio.positions[t];
  if (!pos || pos.shares < shares) {
    return { success: false, message: `Yetersiz hisse. Sahip olunan: ${pos?.shares || 0}, Satılmak istenen: ${shares}` };
  }

  const totalRevenue = shares * price;
  portfolio.balance += totalRevenue;
  pos.shares -= shares;

  if (pos.shares === 0) {
    delete portfolio.positions[t];
  }

  portfolio.history.push({
    date: new Date().toISOString(),
    type: 'SELL',
    ticker: t,
    shares,
    price,
    total: totalRevenue,
  });

  writePortfolio(portfolio);
  return { success: true, message: `${shares} adet ${t} başarıyla $${price.toFixed(2)} fiyattan satıldı.`, data: portfolio };
}
