import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const TefasSchema = z.object({
  fund_code: z.string().describe('TEFAS fon kodu (örn: YAS, MAC, NNF, TCD)'),
});

/**
 * TEFAS Fon Verisi Çekici
 * pytefas üzerinden güncel yatırım fonu verilerini (fiyat, portföy büyüklüğü, aylık getiri) getirir.
 */
export const getTefasFundData = tool(
  async (input) => {
    try {
      const fundCode = input.fund_code.toUpperCase();
      // Bun ortamında VIRTUAL_ENV kontrolü, yoksa yerel .venv
      const pyEnv = process.env.VIRTUAL_ENV 
        ? path.join(process.env.VIRTUAL_ENV, 'bin', 'python') 
        : '.venv/bin/python';
        
      const scriptPath = path.join(process.cwd(), 'src', 'python', 'tefas_fetcher.py');

      const { stdout } = await execFileAsync(pyEnv, [scriptPath, fundCode], { timeout: 15000 });
      
      const parsed = JSON.parse(stdout);
      
      if (parsed.error) {
        return `[TEFAS Hatası] ${parsed.error}`;
      }

      return `TEFAS Fon Verisi (${parsed.fund_code}):
- Fon Adı: ${parsed.fund_name}
- Tarih: ${parsed.date}
- Fiyat: ${parsed.price} TL
- Portföy Büyüklüğü: ${(parsed.portfolio_size / 1e6).toFixed(2)} Milyon TL
- Yatırımcı Sayısı: ${parsed.investor_count}
- Aylık Getiri: %${parsed.monthly_return_pct}
`;

    } catch (err) {
      return `[TEFAS Beklenmeyen Hata] ${(err as Error).message}`;
    }
  },
  {
    name: 'get_tefas_fund_data',
    description: 'TEFAS (Türkiye Elektronik Fon Alım Satım Platformu) üzerinden yatırım fonlarının güncel fiyat, getiri ve büyüklük verilerini getirir.',
    schema: TefasSchema,
  }
);
