import { expect, test } from 'bun:test';
import { parseChronosStdout } from './chronos-forecast';

test('parseChronosStdout success', () => {
  const stdout = `Loading model...\nModel loaded.\n{"status": "success", "data": {"median": [100.5, 101.2]}}`;
  const result = parseChronosStdout(stdout);
  expect(result.success).toBe(true);
  expect(result.data).toEqual({ median: [100.5, 101.2] });
});

test('parseChronosStdout error message', () => {
  const stdout = `Some error logs...\n{"status": "error", "message": "Ticker not found"}`;
  const result = parseChronosStdout(stdout);
  expect(result.success).toBe(false);
  expect(result.error).toBe('Ticker not found');
});

test('parseChronosStdout unparseable', () => {
  const stdout = `Just random text\nno json here`;
  const result = parseChronosStdout(stdout);
  expect(result.success).toBe(false);
  expect(result.error).toBe('Çıktı çözümlenemedi');
});
