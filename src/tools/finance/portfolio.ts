import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { readPortfolio, buyStock, sellStock } from '../../portfolio/store';
import { getAlpacaPortfolio, submitAlpacaOrder } from '../../portfolio/alpaca';
import { fmpClient } from '../../utils/fmp';
import { yahooFinance } from '../../utils/yahoo';

// Helper to get live price for US stocks
async function getLivePrice(ticker: string): Promise<number> {
  const formattedTicker = ticker.toUpperCase();
  // Try FMP first if key exists
  if (process.env.FMP_API_KEY) {
    try {
      const qRes = await fmpClient.quote(formattedTicker);
      if (qRes && qRes.length > 0 && qRes[0].price) {
        return qRes[0].price;
      }
    } catch (e) {
      console.warn(`[portfolio] FMP failed for ${formattedTicker}, falling back to Yahoo`);
    }
  }

  // Fallback to Yahoo Finance
  const quote = await yahooFinance.quote(formattedTicker);
  if (quote && quote.regularMarketPrice) {
    return quote.regularMarketPrice;
  }
  
  throw new Error(`Canli fiyat bulunamadi: ${formattedTicker}`);
}

export const PORTFOLIO_GET_DESCRIPTION = `
Returns the current state of the virtual paper trading portfolio, including cash balance, held positions, average costs, and transaction history.
Use this to check how much money you have before buying, or how many shares you have before selling.
`.trim();

export const getPortfolioTool = new DynamicStructuredTool({
  name: 'portfolio_get',
  description: 'View the virtual paper trading portfolio balance and held stock positions.',
  schema: z.object({}),
  func: async () => {
    if (process.env.ALPACA_API_KEY) {
      try {
        const portfolio = await getAlpacaPortfolio();
        return JSON.stringify(portfolio, null, 2);
      } catch (e: any) {
        return JSON.stringify({ error: 'Alpaca API Error', message: e.message });
      }
    } else {
      const portfolio = readPortfolio();
      return JSON.stringify(portfolio, null, 2);
    }
  },
});

const TradeSchema = z.object({
  ticker: z.string().describe("The US stock ticker symbol (e.g. 'AAPL', 'MSFT', 'TSLA')."),
  shares: z.number().positive().describe("The number of shares to trade. You can use decimals for fractional shares (e.g. 0.5)."),
});

export const PORTFOLIO_BUY_DESCRIPTION = `
Executes a BUY order in the virtual paper trading portfolio for a US stock. 
It fetches the real-time market price and deducts the total cost from your cash balance.
`.trim();

export const buyPortfolioTool = new DynamicStructuredTool({
  name: 'portfolio_buy',
  description: 'Buy shares of a US stock in the virtual paper trading portfolio.',
  schema: TradeSchema,
  func: async (input) => {
    try {
      if (process.env.ALPACA_API_KEY) {
        const price = await getLivePrice(input.ticker);
        
        // 1. Sanal bakiye kontrolü (100$ limit)
        const localResult = buyStock(input.ticker, input.shares, price);
        if (!localResult.success) {
          return JSON.stringify(localResult, null, 2);
        }

        // 2. Kasa yeterliyse Alpaca'ya emri ilet
        const result = await submitAlpacaOrder(input.ticker, input.shares, 'buy');
        if (!result.success) {
           // Hata olursa sanal kasayı geri al
           sellStock(input.ticker, input.shares, price);
        }
        return JSON.stringify(result, null, 2);
      } else {
        const price = await getLivePrice(input.ticker);
        const result = buyStock(input.ticker, input.shares, price);
        return JSON.stringify(result, null, 2);
      }
    } catch (e: any) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
});

export const PORTFOLIO_SELL_DESCRIPTION = `
Executes a SELL order in the virtual paper trading portfolio for a US stock you already own.
It fetches the real-time market price and adds the total revenue to your cash balance.
`.trim();

export const sellPortfolioTool = new DynamicStructuredTool({
  name: 'portfolio_sell',
  description: 'Sell shares of a US stock in the virtual paper trading portfolio.',
  schema: TradeSchema,
  func: async (input) => {
    try {
      if (process.env.ALPACA_API_KEY) {
        const price = await getLivePrice(input.ticker);
        
        const localResult = sellStock(input.ticker, input.shares, price);
        if (!localResult.success) {
          return JSON.stringify(localResult, null, 2);
        }

        const result = await submitAlpacaOrder(input.ticker, input.shares, 'sell');
        if (!result.success) {
           buyStock(input.ticker, input.shares, price);
        }
        return JSON.stringify(result, null, 2);
      } else {
        const price = await getLivePrice(input.ticker);
        const result = sellStock(input.ticker, input.shares, price);
        return JSON.stringify(result, null, 2);
      }
    } catch (e: any) {
      return JSON.stringify({ success: false, message: e.message });
    }
  },
});
