import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export const openDeepReportTool = new DynamicStructuredTool({
  name: 'open_deep_report',
  description: 'Kullanıcı bir hissenin derin raporunu (DCF, detaylı analiz) net bir şekilde görmek istediğinde bu aracı çağır.',
  schema: z.object({
    ticker: z.string().describe('Hisse sembolü (örn. AKBNK)'),
    discountRate: z.number().optional().describe('Kullanıcı spesifik bir iskonto oranı istediyse ondalık olarak (örn. %30 için 0.30)')
  }),
  func: async ({ ticker }) => {
    return `${ticker.toUpperCase()} için Derin Rapor sekmesi açılıyor (~30 sn).`;
  }
});

export const openCompareTool = new DynamicStructuredTool({
  name: 'open_compare',
  description: 'Kullanıcı 2 veya daha fazla hisseyi karşılaştırmak / kıyaslamak istediğinde bu aracı çağır.',
  schema: z.object({
    tickers: z.array(z.string()).min(2).describe('Karşılaştırılacak hisse sembolleri (örn. ["GARAN", "YKBNK"])')
  }),
  func: async ({ tickers }) => {
    const formatted = tickers.map(t => t.toUpperCase());
    return `${formatted.join(', ')} karşılaştırması açılıyor.`;
  }
});

export const openPortfolioAnalysisTool = new DynamicStructuredTool({
  name: 'open_portfolio_analysis',
  description: 'Kullanıcı mevcut portföyünü analiz etmek istediğinde bu aracı çağır.',
  schema: z.object({}),
  func: async () => {
    return `Portföy analizi açılıyor.`;
  }
});

export const openKapNewsTool = new DynamicStructuredTool({
  name: 'open_kap_news',
  description: 'Kullanıcı genel KAP bildirimlerini veya haberleri okumak istediğinde bu aracı çağır.',
  schema: z.object({}),
  func: async () => {
    return `Günün KAP bildirimleri açılıyor.`;
  }
});

export const DASHBOARD_ACTION_TOOLS = [
  openDeepReportTool,
  openCompareTool,
  openPortfolioAnalysisTool,
  openKapNewsTool
];

export const DASHBOARD_ACTION_TOOL_NAMES: Set<string> = new Set(
  DASHBOARD_ACTION_TOOLS.map(t => t.name)
);
