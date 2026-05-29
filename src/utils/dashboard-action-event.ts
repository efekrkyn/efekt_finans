export type ToolActionEvent = {
  type: 'tool_action';
  action: 'open-tab';
  tab: 'derinrapor' | 'compare' | 'portfolio' | 'kap';
  ticker?: string;
  discountRate?: number;
  tickers?: string[];
};

export function mapActionEvent(tool: string, args: Record<string, unknown>): ToolActionEvent | null {
  switch (tool) {
    case 'open_deep_report':
      return { 
        type: 'tool_action', 
        action: 'open-tab', 
        tab: 'derinrapor',
        ticker: String(args.ticker ?? '').toUpperCase(),
        ...(typeof args.discountRate === 'number' ? { discountRate: args.discountRate } : {}) 
      };
    case 'open_compare':
      return { 
        type: 'tool_action', 
        action: 'open-tab', 
        tab: 'compare',
        tickers: Array.isArray(args.tickers) ? args.tickers.map(t => String(t).toUpperCase()) : [] 
      };
    case 'open_portfolio_analysis':
      return { type: 'tool_action', action: 'open-tab', tab: 'portfolio' };
    case 'open_kap_news':
      return { type: 'tool_action', action: 'open-tab', tab: 'kap' };
    default:
      return null;
  }
}
