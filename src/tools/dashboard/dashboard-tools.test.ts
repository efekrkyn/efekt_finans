import { describe, test, expect } from 'bun:test';
import { DASHBOARD_ACTION_TOOLS, DASHBOARD_ACTION_TOOL_NAMES } from './index.js';

describe('Dashboard Action Tools', () => {
  test('exports tools correctly', () => {
    expect(DASHBOARD_ACTION_TOOLS.length).toBe(4);
    expect(DASHBOARD_ACTION_TOOL_NAMES.has('open_deep_report')).toBe(true);
    expect(DASHBOARD_ACTION_TOOL_NAMES.has('open_compare')).toBe(true);
    expect(DASHBOARD_ACTION_TOOL_NAMES.has('open_portfolio_analysis')).toBe(true);
    expect(DASHBOARD_ACTION_TOOL_NAMES.has('open_kap_news')).toBe(true);
  });
  
  test('open_deep_report executes and returns correct string', async () => {
    const tool = DASHBOARD_ACTION_TOOLS.find(t => t.name === 'open_deep_report')!;
    const res = await tool.invoke({ ticker: 'garan' });
    expect(res).toContain('GARAN için Derin Rapor');
  });

  test('open_compare executes and returns correct string', async () => {
    const tool = DASHBOARD_ACTION_TOOLS.find(t => t.name === 'open_compare')!;
    const res = await tool.invoke({ tickers: ['garan', 'akbnk'] });
    expect(res).toContain('GARAN, AKBNK karşılaştırması');
  });
});
