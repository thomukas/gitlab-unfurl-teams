import { describe, it, expect, vi } from 'vitest';
import { createServer, type ServerDeps } from '../src/server.js';
import { loadCoreConfig } from '@gitlab-unfurl-teams/core';

const config = loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.example.com' });

const deps: ServerDeps = {
  config,
  getSignInUrl: async () => 'https://token.botframework.com/signin/test',
  signOut: async () => {},
  ready: async () => {},
  lookupToken: async () => null,
  verifyJwt: async (header) => header === 'Bearer good' ? () => true : null,
};

const post = (body: string, headers: Record<string, string> = {}) =>
  createServer(deps).request('/api/messages', { method: 'POST', body, headers });

describe('createServer', () => {
  it('returns 401 without an Authorization header (I5)', async () => {
    expect((await post('{}')).status).toBe(401);
  });

  it('returns 401 with a bad token (I5)', async () => {
    expect((await post('{}', { authorization: 'Bearer bad' })).status).toBe(401);
  });

  it('does not parse the body before authenticating', async () => {
    // Malformed JSON with a bad token must still be 401, not 400:
    // authentication comes first.
    expect((await post('not json', { authorization: 'Bearer bad' })).status).toBe(401);
  });

  it('accepts a verified request', async () => {
    const res = await post(JSON.stringify({ type: 'message' }), {
      authorization: 'Bearer good',
      'content-type': 'application/json',
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 on a body that is not JSON', async () => {
    const res = await post('not json', {
      authorization: 'Bearer good',
      'content-type': 'application/json',
    });
    expect(res.status).toBe(400);
  });

  it('exposes an unauthenticated health endpoint', async () => {
    expect((await createServer(deps).request('/healthz')).status).toBe(200);
  });

  it('does not expose any other route', async () => {
    expect((await createServer(deps).request('/')).status).toBe(404);
  });

  it('denies when the verifier itself throws', async () => {
    const failing: ServerDeps = {
      ...deps,
      verifyJwt: async () => {
        throw new Error('jwks unreachable');
      },
    };
    const res = await createServer(failing).request('/api/messages', {
      method: 'POST',
      body: '{}',
      headers: { authorization: 'Bearer good' },
    });
    expect(res.status).toBe(401);
  });
});

describe('operational boundaries', () => {
  it('rejects streamed oversized input even with a dishonest content-length', async () => {
    const body = JSON.stringify({ unused: 'x'.repeat(70_000) });
    for (const headers of [{ authorization: 'Bearer good' }, { authorization: 'Bearer good', 'content-length': '2' }]) {
      const result = await post(body, headers);
      expect(result.status).toBe(413);
    }
  });
  it('keeps liveness separate from failed dependency readiness without exposing upstream errors', async () => {
    const app = createServer({ ...deps, ready: async () => { throw new Error('secret-value'); } });
    expect((await app.request('/healthz')).status).toBe(200);
    const response = await app.request('/readyz');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret-value');
  });
  it('caches readiness checks rather than calling dependencies on every health request', async () => {
    const ready = vi.fn(async () => {}); const app = createServer({ ...deps, ready });
    expect((await app.request('/readyz')).status).toBe(200);
    expect((await app.request('/readyz')).status).toBe(200);
    expect(ready).toHaveBeenCalledTimes(1);
  });
  it('denies an activity that fails binding before looking up a token', async () => {
    const lookupToken = vi.fn(async () => 'secret');
    const app = createServer({ ...deps, lookupToken, verifyJwt: async () => () => false });
    expect((await app.request('/api/messages', { method: 'POST', body: '{}' })).status).toBe(403);
    expect(lookupToken).not.toHaveBeenCalled();
  });
  it('rate limits one authenticated user while allowing another', async () => {
    const app = createServer(deps);
    const call = (id: string) => app.request('/api/messages', { method: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ from: { id } }) });
    for (let i = 0; i < 30; i++) expect((await call('29:a')).status).toBe(200);
    expect((await call('29:a')).status).toBe(429);
    expect((await call('29:b')).status).toBe(200);
  });
  it('returns a diagnostic ID and sanitizes dependency exceptions', async () => {
    const app = createServer({ ...deps,
      config: loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.example.com', PREVIEW_MODE: 'metadata', PROJECT_ALLOWLIST: 'g' }),
      lookupToken: async () => { throw new Error('secret-token-in-upstream-URL'); },
    });
    const response = await app.request('/api/messages', { method: 'POST', headers: { authorization: 'Bearer good' }, body: JSON.stringify({ type: 'invoke', name: 'composeExtension/queryLink', channelId: 'msteams', from: { id: '29:a' }, value: { url: 'https://gitlab.example.com/g/p/-/issues/1' } }) });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await response.text()).not.toContain('secret-token');
  });
});
