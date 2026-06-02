import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export const CHRONOS_FORECAST_DESCRIPTION = `
Runs Amazon's Chronos time-series ML model to forecast the future 30-day stock price based on historical candlestick data. Returns a JSON with the 30-day target confidence interval (10th percentile low, 50th percentile median, 90th percentile high).
`.trim();

const ChronosInputSchema = z.object({
  ticker: z.string().describe("The stock ticker symbol to forecast. For Turkish stocks, append '.IS' (e.g. 'THYAO.IS')."),
  days: z.number().optional().describe("Number of days into the future to forecast. Defaults to 30."),
});

export function parseChronosStdout(stdout: string): { success: boolean, data?: any, error?: string } {
  const line = String(stdout || '').split('\n').reverse().find((l: string) => l.startsWith('{'));
  if (line) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.status === 'success') {
        return { success: true, data: parsed.data };
      }
      return { success: false, error: parsed.message || 'Bilinmeyen model hatası' };
    } catch {}
  }
  return { success: false, error: 'Çıktı çözümlenemedi' };
}

export async function executeChronosForecast(tickerSymbol: string, daysToForecast: number = 30): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const ticker = tickerSymbol.trim().toUpperCase();
    const days = Math.min(365, Math.max(1, Math.floor(daysToForecast)));
    
    // 1) Eğer dış API yapılandırılmışsa API'ye istek at
    const apiUrl = process.env.CHRONOS_API_URL;
    if (apiUrl) {
      const apiKey = process.env.CHRONOS_API_KEY || '';
      
      const response = await fetch(`${apiUrl}/forecast?ticker=${encodeURIComponent(ticker)}&days=${days}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errText = await response.text();
        return { success: false, error: `Chronos API Hatası (${response.status}): ${errText}` };
      }
      
      const json = await response.json();
      if (json.status === 'success') {
        return { success: true, data: json.data };
      } else {
        return { success: false, error: json.message || 'API bilinmeyen hata döndürdü.' };
      }
    }

    // 2) API yoksa yerel (lokal) fallback script'ini çalıştır (Mac için vs.)
    const venvPython = join(process.cwd(), '.venv', 'bin', 'python');
    const scriptPath = join(process.cwd(), 'src', 'python', 'chronos_forecast.py');

    const { stdout, stderr } = await execFileAsync(venvPython, [scriptPath, ticker, days.toString()], {
      timeout: 120_000,
      killSignal: 'SIGKILL',
      maxBuffer: 10 * 1024 * 1024,
    });
    
    const parsed = parseChronosStdout(stdout);
    if (parsed.success) return parsed;
    return { success: false, error: `ML Model hatası: ${parsed.error}. Stderr: ${stderr}` };
  } catch (error: any) {
    if (error.killed || error.signal === 'SIGKILL') return { success: false, error: 'ML Model zaman aşımına uğradı.' };
    if (error.stdout) {
      const parsed = parseChronosStdout(error.stdout);
      if (!parsed.success && parsed.error !== 'Çıktı çözümlenemedi') {
        return { success: false, error: `ML Model hatası: ${parsed.error}` };
      }
    }
    return { success: false, error: `ML Model çalıştırılamadı: ${error.message}` };
  }
}

export const getChronosForecast = new DynamicStructuredTool({
  name: 'get_chronos_forecast',
  description: 'Uses an ML foundation model (Chronos) to predict the future price trajectory of a stock.',
  schema: ChronosInputSchema,
  func: async (input) => {
    const result = await executeChronosForecast(input.ticker, input.days);
    if (result.success) return JSON.stringify(result.data, null, 2);
    return result.error || 'Bilinmeyen hata';
  },
});
