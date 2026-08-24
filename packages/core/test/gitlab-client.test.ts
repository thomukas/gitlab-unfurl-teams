import { describe, it, expect, vi } from 'vitest';
import { fetchEntity } from '../src/gitlab-client.js';
import type { CoreConfig } from '../src/config.js';
import type { GitLabRef } from '../src/types.js';

const cfg: CoreConfig = {
  origin: 'https://gitlab.example.com',
  projectAllowlist: [],
  timeoutMs: 3000,
  maxResponseBytes: 1024,
};

const ref: GitLabRef = { kind: 'merge_request', namespacePath: 'g/p', iid: 42 };

const payload = {
  title: 'Add the thing',
  state: 'opened',
  web_url: 'https://gitlab.example.com/g/p/-/merge_requests/42',
  author: { name: 'Ada' },
  assignees: [{ name: 'Grace' }],
  labels: ['backend'],
  head_pipeline: { status: 'success' },
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-02T10:00:00Z',
};

/** Matches fetch's signature so `mock.calls` is a correctly typed tuple. */
const spyFetch = (impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) =>
  vi.fn(impl);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const okFetch = (async () => jsonResponse(payload)) as unknown as typeof fetch;

describe('fetchEntity', () => {
  it('calls the configured origin, never a host from the ref (I2)', async () => {
    const spy = spyFetch(async () => jsonResponse(payload));
    await fetchEntity(ref, 'tok', cfg, spy as unknown as typeof fetch);
    const url = String(spy.mock.calls[0]![0]);
    expect(url.startsWith('https://gitlab.example.com/api/v4/')).toBe(true);
    expect(url).toContain(encodeURIComponent('g/p'));
    expect(url).toContain('/merge_requests/42');
  });

  it('sets redirect:error so a redirect cannot move the token (I3)', async () => {
    const spy = spyFetch(async () => jsonResponse(payload));
    await fetchEntity(ref, 'tok', cfg, spy as unknown as typeof fetch);
    expect(spy.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });

  it('sends the bearer token', async () => {
    const spy = spyFetch(async () => jsonResponse(payload));
    await fetchEntity(ref, 'tok', cfg, spy as unknown as typeof fetch);
    const init = spy.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
  });

  it('maps a good response to an Entity', async () => {
    expect(await fetchEntity(ref, 'tok', cfg, okFetch)).toEqual({
      ok: true,
      entity: {
        kind: 'merge_request',
        title: 'Add the thing',
        state: 'opened',
        namespacePath: 'g/p',
        iid: 42,
        webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/42',
        author: { name: 'Ada' },
        assignees: [{ name: 'Grace' }],
        labels: ['backend'],
        pipeline: { status: 'success' },
        createdAt: '2026-08-01T10:00:00Z',
        updatedAt: '2026-08-02T10:00:00Z',
      },
    });
  });

  // I10: the caller must not be able to tell these apart.
  it.each([403, 404])('maps %i to not-found', async (status) => {
    const f = (async () => jsonResponse({}, status)) as unknown as typeof fetch;
    expect(await fetchEntity(ref, 'tok', cfg, f)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('fails rather than following a refused redirect (I3)', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await fetchEntity(ref, 'tok', cfg, failing)).toEqual({ ok: false, reason: 'network' });
  });

  it('reports a timeout distinctly', async () => {
    const aborting = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    expect(await fetchEntity(ref, 'tok', cfg, aborting)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('rejects a response larger than the cap (I13)', async () => {
    const huge = (async () =>
      jsonResponse({ ...payload, title: 'x'.repeat(4096) })) as unknown as typeof fetch;
    expect(await fetchEntity(ref, 'tok', cfg, huge)).toEqual({ ok: false, reason: 'too-large' });
  });

  it('rejects an oversized response declared by content-length without reading it', async () => {
    const declared = (async () =>
      new Response('{}', { headers: { 'content-length': '999999' } })) as unknown as typeof fetch;
    expect(await fetchEntity(ref, 'tok', cfg, declared)).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('rejects a response that is not the expected shape', async () => {
    const wrong = (async () => jsonResponse({ nope: 1 })) as unknown as typeof fetch;
    expect(await fetchEntity(ref, 'tok', cfg, wrong)).toEqual({
      ok: false,
      reason: 'bad-response',
    });
  });

  it('makes exactly one request per call (I13)', async () => {
    const spy = spyFetch(async () => jsonResponse(payload));
    await fetchEntity(ref, 'tok', cfg, spy as unknown as typeof fetch);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('routes an epic to /groups, not /projects', async () => {
    const spy = spyFetch(async () => jsonResponse(payload));
    const epic = { kind: 'epic', namespacePath: 'acme', iid: 17 } as const;
    await fetchEntity(epic, 'tok', cfg, spy as unknown as typeof fetch);
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toBe('https://gitlab.example.com/api/v4/groups/acme/epics/17');
  });

  it('encodes a nested group path for an epic', async () => {
    const spy = spyFetch(async () => jsonResponse(payload));
    const epic = { kind: 'epic', namespacePath: 'acme/platform', iid: 3 } as const;
    await fetchEntity(epic, 'tok', cfg, spy as unknown as typeof fetch);
    expect(String(spy.mock.calls[0]![0])).toContain(encodeURIComponent('acme/platform'));
  });

  it('tolerates a missing pipeline', async () => {
    const { head_pipeline: _omit, ...rest } = payload;
    const f = (async () => jsonResponse(rest)) as unknown as typeof fetch;
    const result = await fetchEntity(ref, 'tok', cfg, f);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entity.pipeline).toBeUndefined();
  });
});
