import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DefeatBetaInputSchema = z.object({
  ticker: z.string().describe("The US stock ticker symbol to fetch deep financial data for (e.g., 'AAPL', 'MSFT'). Do not use for BIST stocks."),
});

export const getDefeatBetaData = new DynamicStructuredTool({
  name: 'get_defeatbeta_data',
  description: 'Fetches deep financial metrics and ratios for US stocks using the defeatbeta-api HuggingFace engine. Highly reliable alternative to Yahoo Finance for US equities.',
  schema: DefeatBetaInputSchema,
  func: async ({ ticker }) => {
    try {
      const pyEnv = (globalThis as any).Bun?.env?.VIRTUAL_ENV ? `${(globalThis as any).Bun.env.VIRTUAL_ENV}/bin/python` : '.venv/bin/python';
      const { stdout } = await execFileAsync(pyEnv, ['src/python/defeatbeta_proxy.py', ticker]);
      const data = JSON.parse(stdout);
      
      if (data.error) {
        return `Error from defeatbeta-api: ${data.error}`;
      }

      return `
DefeatBeta Analytics for ${ticker}:
- Price: ${data.price}
- Market Cap: ${data.market_cap}
- P/E Ratio (TTM): ${data.pe_ratio}
- P/B Ratio: ${data.pb_ratio}
- ROE: ${data.roe}
- ROA: ${data.roa}
- Debt to Equity: ${data.debt_to_equity}
`;
    } catch (err) {
      return `Failed to fetch from defeatbeta-api: ${(err as Error).message}`;
    }
  },
});
