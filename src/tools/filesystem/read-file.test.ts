import { expect, test } from 'bun:test';
import { readFileTool } from './read-file';

test('read_file blocks secrets', async () => {
  const secretPaths = [
    '.env',
    'src/.env',
    '.env.local',
    '.git/config',
    'keys/private.pem',
    'id_rsa',
    'id_ed25519',
    'cert.crt'
  ];

  for (const p of secretPaths) {
    let error: any = null;
    try {
      await readFileTool.func({ path: p });
    } catch (e: any) {
      error = e;
    }
    expect(error).not.toBeNull();
    expect(error.message).toBe('Bu dosyaya erişim güvenlik nedeniyle engellendi.');
  }

  // Normal file should not be blocked by this logic (might throw ENOENT, which is fine)
  let normalError: any = null;
  try {
    await readFileTool.func({ path: 'package.json' });
  } catch (e: any) {
    normalError = e;
  }
  if (normalError) {
    expect(normalError.message).not.toBe('Bu dosyaya erişim güvenlik nedeniyle engellendi.');
  }
});
