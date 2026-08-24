import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { dependencies?: Record<string, string> };

const FORBIDDEN = ['hono', '@hono/node-server'];

describe('packages/core dependency boundary', () => {
  it('declares no runtime dependency on a web framework or the Teams SDK', () => {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      expect(FORBIDDEN).not.toContain(name);
      expect(name.startsWith('@microsoft/teams.')).toBe(false);
    }
  });

  it('declares no dependencies at all in v1', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});
