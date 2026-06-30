import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load environment variables from a `.env` file in the current working
 * directory, if one exists. Real environment variables already set take
 * precedence is NOT applied here — Node's loader sets keys from the file; values
 * already exported in the shell are overwritten by the file, matching the usual
 * dotenv expectation that `.env` is the source of truth for local runs.
 *
 * Uses Node's built-in `process.loadEnvFile` (Node 20.12+), so there is no
 * dependency. A missing file or older runtime is a silent no-op — the app then
 * relies on whatever is already in the environment.
 */
export function loadEnvFile(cwd: string = process.cwd()): void {
  const path = resolve(cwd, '.env');
  if (!existsSync(path)) return;
  const loader = (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loader === 'function') {
    try {
      loader(path);
    } catch {
      // Malformed .env — ignore and fall back to the ambient environment.
    }
  }
}
