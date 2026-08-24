import { describe, it, expect } from 'vitest';
import { buildDeps } from '../src/deps.js';

describe('host deps fail closed', () => {
  it('refuses every JWT until the verifier is wired (I5)', async () => {
    await expect(buildDeps().verifyJwt('Bearer anything')).resolves.toBe(false);
  });

  it('returns no token until the token service is wired', async () => {
    await expect(buildDeps().lookupToken('29:anyone')).resolves.toBeNull();
  });

  it('still loads a valid configuration', () => {
    expect(buildDeps().config.origin).toBe('https://gitlab.com');
  });
});
