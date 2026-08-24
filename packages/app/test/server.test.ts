import { describe, it, expect } from 'vitest';
import { createServer, type ServerDeps } from '../src/server.js';
import { loadCoreConfig } from '@gitlab-unfurl-teams/core';

const config = loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.example.com' });

const deps: ServerDeps = {
  config,
  lookupToken: async () => null,
  verifyJwt: async (header) => header === 'Bearer good',
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
