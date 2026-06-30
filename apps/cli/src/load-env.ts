import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load environment variables from a `.env` file in the current working
 * directory, if one exists. Uses Node's built-in `process.loadEnvFile`
 * (Node 20.12+), so there is no dependency; a missing file or older runtime is
 * a silent no-op and the CLI falls back to the ambient environment.
 */
export function loadEnvFile(cwd: string = process.cwd()): void {
  const path = resolve(cwd, '.env');
  if (!existsSync(path)) return;
  const loader = (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loader === 'function') {
    try {
      loader(path);
    } catch {
      // Malformed .env — ignore and use the ambient environment.
    }
  }
}
