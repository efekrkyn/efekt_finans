import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { getKapProvider } from 'borsajs';

const execFileAsync = promisify(execFile);

export const KAP_AGENT_DESCRIPTION = `
Fetches and reads the latest disclosures (KAP bildirimleri) for a Turkish stock. It pulls recent headlines and then uses a Python ML microservice to extract and read the PDF/HTML content of a specific disclosure. Useful for reading official news, earnings releases, and regulatory filings.
`.trim();

const KapInputSchema = z.object({
  ticker: z.string().describe("The stock ticker symbol (e.g. 'TUPRS'). Do not include '.IS' suffix."),
  limit: z.number().optional().describe("Number of recent disclosures to fetch. Defaults to 5."),
  disclosureId: z.string().optional().describe("If provided, the agent will deeply read the full text (PDF/HTML) of this specific disclosure instead of listing recent headlines."),
});

export const kapAgentTool = new DynamicStructuredTool({
  name: 'kap_agent',
  description: 'Reads official KAP (Public Disclosure Platform) announcements and parses their PDF/HTML contents.',
  schema: KapInputSchema,
  func: async (input) => {
    try {
      const ticker = input.ticker.trim().toUpperCase().replace('.IS', '');
      
      // If a specific disclosureId is requested, parse its content using Python
      if (input.disclosureId) {
        const venvPython = join(process.cwd(), '.venv', 'bin', 'python');
        const scriptPath = join(process.cwd(), 'src', 'python', 'kap_parser.py');

        const { stdout, stderr } = await execFileAsync(venvPython, [scriptPath, input.disclosureId], {
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const line = stdout.split('\n').reverse().find((l: string) => l.startsWith('{'));
        if (!line) return `Hata: Çıktı çözümlenemedi. Stderr: ${stderr}`;

        const parsed = JSON.parse(line);
        if (parsed.status === 'success') {
          const data = parsed.data;
          let res = `Bildirim ID: ${data.disclosure_id}\nURL: ${data.url}\n\n`;
          if (data.html_text) res += `[HTML METNİ]\n${data.html_text}\n\n`;
          if (data.pdf_texts && data.pdf_texts.length > 0) {
            res += `[PDF İÇERİĞİ]\n${data.pdf_texts.join('\n\n---\n\n')}`;
          }
          return res.trim() || 'Bildirim içeriği boş.';
        }
        return `Hata: ${parsed.message || 'Bilinmeyen Python hatası'}`;
      }

      // Otherwise, list recent disclosures using borsajs
      const limit = Math.min(20, Math.max(1, Math.floor(input.limit || 5)));
      const kapProvider = await getKapProvider();
      const disclosures = await kapProvider.getDisclosures(ticker, limit);
      
      if (!disclosures || disclosures.length === 0) {
        return `${ticker} için güncel KAP bildirimi bulunamadı.`;
      }

      const list = disclosures.slice(0, limit).map((d: any) => 
        `- ${d.date} | [ID: ${d.disclosureIndex}] ${d.title}\n  URL: ${d.url}`
      ).join('\n\n');

      return `Son KAP Bildirimleri (${ticker}):\n\n${list}\n\n(Daha fazla detay için disclosureId vererek aracı tekrar çağırın.)`;

    } catch (error: any) {
      return `KAP Ajanı hatası: ${error.message}`;
    }
  },
});
