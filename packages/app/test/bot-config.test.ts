import { describe, expect, it } from 'vitest';
import { loadBotConfig } from '../src/bot-config.js';
const env = { BOT_ID: '11111111-1111-4111-8111-111111111111', BOT_TENANT_ID: '22222222-2222-4222-8222-222222222222' };
describe('bot configuration', () => {
  it('does not require an outbound credential for generic link cards', () => {
    expect(loadBotConfig(env, false).password).toBe('');
  });
  it('requires a credential for metadata lookup', () => {
    expect(() => loadBotConfig(env, true)).toThrow(/BOT_PASSWORD/);
  });
  it.each(['BOT_ID', 'BOT_TENANT_ID'])('requires a valid %s', (key) => {
    expect(() => loadBotConfig({ ...env, [key]: 'bad' }, false)).toThrow(key);
  });
  it.each(['http://token.botframework.com', 'https://evil.example', 'https://token.botframework.com/path'])('rejects unsafe OAuth origin %s', (origin) => {
    expect(() => loadBotConfig({ ...env, OAUTH_ORIGIN: origin }, false)).toThrow(/OAUTH_ORIGIN/);
  });
});
