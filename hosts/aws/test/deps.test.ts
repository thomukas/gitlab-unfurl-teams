import { describe, it, expect, vi } from 'vitest';
import { buildDeps } from '../src/deps.js';

describe('production host configuration', () => {
  it('refuses to start without a bot identity', () => {
    vi.stubEnv('BOT_ID', '');
    try { expect(() => buildDeps()).toThrow(/BOT_ID/); }
    finally { vi.unstubAllEnvs(); }
  });
  it('refuses metadata mode without a managed secret value', () => {
    vi.stubEnv('BOT_ID', '11111111-1111-4111-8111-111111111111');
    vi.stubEnv('BOT_TENANT_ID', '22222222-2222-4222-8222-222222222222');
    vi.stubEnv('PREVIEW_MODE', 'metadata');
    vi.stubEnv('PROJECT_ALLOWLIST', 'company/project');
    vi.stubEnv('BOT_PASSWORD', '');
    try { expect(() => buildDeps()).toThrow(/BOT_PASSWORD/); }
    finally { vi.unstubAllEnvs(); }
  });
});
