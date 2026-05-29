import { describe, test, expect } from 'bun:test';
import { mapActionEvent } from './dashboard-action-event.js';

describe('mapActionEvent', () => {
  test('open_deep_report', () => {
    expect(mapActionEvent('open_deep_report', { ticker: 'garan' })).toEqual({
      type: 'tool_action', action: 'open-tab', tab: 'derinrapor', ticker: 'GARAN'
    });
    expect(mapActionEvent('open_deep_report', { ticker: 'garan', discountRate: 0.35 })).toEqual({
      type: 'tool_action', action: 'open-tab', tab: 'derinrapor', ticker: 'GARAN', discountRate: 0.35
    });
  });

  test('open_compare', () => {
    expect(mapActionEvent('open_compare', { tickers: ['garan', 'akbnk'] })).toEqual({
      type: 'tool_action', action: 'open-tab', tab: 'compare', tickers: ['GARAN', 'AKBNK']
    });
  });

  test('open_portfolio_analysis', () => {
    expect(mapActionEvent('open_portfolio_analysis', {})).toEqual({
      type: 'tool_action', action: 'open-tab', tab: 'portfolio'
    });
  });

  test('open_kap_news', () => {
    expect(mapActionEvent('open_kap_news', {})).toEqual({
      type: 'tool_action', action: 'open-tab', tab: 'kap'
    });
  });

  test('unknown tool returns null', () => {
    expect(mapActionEvent('unknown_tool', { ticker: 'a' })).toBeNull();
  });
});
