import { describe, it, expect } from 'vitest';
import { loadCoreConfig, ConfigError } from '../src/config.js';

const base = { GITLAB_ORIGIN: 'https://gitlab.example.com' };

describe('loadCoreConfig', () => {
  it('defaults to gitlab.com', () => {
    expect(loadCoreConfig({}).origin).toBe('https://gitlab.com');
  });

  it('normalises an origin with an explicit default port', () => {
    expect(loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.example.com:443' }).origin).toBe(
      'https://gitlab.example.com',
    );
  });

  it('preserves a non-default port', () => {
    expect(loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.example.com:8443' }).origin).toBe(
      'https://gitlab.example.com:8443',
    );
  });

  it.each([
    ['http://gitlab.example.com', 'not https'],
    ['ftp://gitlab.example.com', 'not https'],
    ['gitlab.example.com', 'no scheme'],
    ['https://user:pw@gitlab.example.com', 'userinfo'],
    ['https://gitlab.example.com/path', 'has a path'],
    ['https://gitlab.example.com/?a=1', 'has a query'],
    ['https://gitlab.example.com/#f', 'has a fragment'],
    ['', 'empty'],
  ])('rejects %s (%s)', (origin) => {
    expect(() => loadCoreConfig({ GITLAB_ORIGIN: origin })).toThrow(ConfigError);
  });

  it('parses a comma-separated allowlist and trims entries', () => {
    expect(loadCoreConfig({ ...base, PROJECT_ALLOWLIST: 'a/b, c/d ' }).projectAllowlist).toEqual([
      'a/b',
      'c/d',
    ]);
  });

  it('treats an empty allowlist as allow-all', () => {
    expect(loadCoreConfig(base).projectAllowlist).toEqual([]);
  });

  it('applies the documented limits', () => {
    const c = loadCoreConfig(base);
    expect(c.timeoutMs).toBe(3000);
    expect(c.maxResponseBytes).toBe(256 * 1024);
  });
});
