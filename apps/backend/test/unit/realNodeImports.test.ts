/**
 * Loads every module the way the real server does (Node ESM via tsx), not through vitest's
 * more forgiving module interop. Catches imports that only work in tests — e.g. a named import
 * from a CommonJS package — which would otherwise crash `npm run dev` at startup.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backend = fileURLToPath(new URL('../..', import.meta.url));

describe('real Node module loading', () => {
  it('imports the whole app (all route modules and their dependencies)', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/app.ts'); await import('./src/modules/index.ts');"], {
      cwd: backend,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(r.stderr).not.toMatch(/SyntaxError|does not provide an export/);
    expect(r.status).toBe(0);
  });
});
