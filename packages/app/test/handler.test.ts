import { describe, it, expect, vi } from 'vitest';
import { handleQueryLink, EMPTY_RESPONSE, AUTH_RESPONSE } from '../src/handler.js';
import { loadCoreConfig } from '@gitlab-unfurl-teams/core';

const config = loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.example.com' });

const activity = (url: string, userId = '29:user-a') => ({
  type: 'invoke',
  name: 'composeExtension/queryLink',
  channelId: 'msteams',
  from: { id: userId },
  value: { url },
});

const payload = {
  title: 'Add the thing',
  state: 'opened',
  web_url: 'https://gitlab.example.com/g/p/-/issues/1',
  author: { name: 'Ada' },
  assignees: [],
  labels: [],
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
};

const okFetch = (async () =>
  new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;

const good = 'https://gitlab.example.com/g/p/-/issues/1';

describe('handleQueryLink', () => {
  it('returns a card for a valid link and an authorized user', async () => {
    const res = (await handleQueryLink(activity(good), {
      config,
      lookupToken: async () => 'tok',
      fetchImpl: okFetch,
    })) as { composeExtension: { type: string; attachments: { preview?: unknown }[] } };

    expect(res.composeExtension.type).toBe('result');
    expect(res.composeExtension.attachments[0]!.preview).toBeDefined();
  });

  it('returns the sign-in card when the user has no token', async () => {
    const res = await handleQueryLink(activity(good), {
      config,
      lookupToken: async () => null,
      fetchImpl: okFetch,
    });
    expect(res).toEqual(AUTH_RESPONSE);
  });

  // I7 — the confused-deputy check.
  it('looks the token up by the authenticated user id, never a fixed one', async () => {
    const lookup = vi.fn(async () => 'tok');
    await handleQueryLink(activity(good, '29:user-b'), {
      config,
      lookupToken: lookup,
      fetchImpl: okFetch,
    });
    expect(lookup).toHaveBeenCalledWith('29:user-b');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('sends user A the token belonging to A, never to B', async () => {
    const tokens: Record<string, string> = { '29:a': 'token-a', '29:b': 'token-b' };
    const seen: string[] = [];
    const spyFetch = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('authorization')!);
      return new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await handleQueryLink(activity(good, '29:a'), {
      config,
      lookupToken: async (id) => tokens[id] ?? null,
      fetchImpl: spyFetch,
    });
    expect(seen).toEqual(['Bearer token-a']);
  });

  it('never calls GitLab when the URL fails validation (I2)', async () => {
    const spy = vi.fn(okFetch);
    const res = await handleQueryLink(activity('https://evil.example/g/p/-/issues/1'), {
      config,
      lookupToken: async () => 'tok',
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(res).toEqual(EMPTY_RESPONSE);
  });

  it('never calls GitLab when the activity is rejected (I6)', async () => {
    const spy = vi.fn(okFetch);
    const res = await handleQueryLink(
      { type: 'message' },
      { config, lookupToken: async () => 'tok', fetchImpl: spy as unknown as typeof fetch },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(res).toEqual(EMPTY_RESPONSE);
  });

  it('does not look up a token before the URL is validated', async () => {
    const lookup = vi.fn(async () => 'tok');
    await handleQueryLink(activity('https://evil.example/g/p/-/issues/1'), {
      config,
      lookupToken: lookup,
      fetchImpl: okFetch,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  // I10
  it('returns byte-identical responses for 403 and 404', async () => {
    const make = (status: number) =>
      handleQueryLink(activity(good), {
        config,
        lookupToken: async () => 'tok',
        fetchImpl: (async () => new Response('{}', { status })) as unknown as typeof fetch,
      });

    const [a, b] = await Promise.all([make(403), make(404)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toEqual(EMPTY_RESPONSE);
  });

  it('returns the empty response when GitLab times out', async () => {
    const aborting = (async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    expect(
      await handleQueryLink(activity(good), {
        config,
        lookupToken: async () => 'tok',
        fetchImpl: aborting,
      }),
    ).toEqual(EMPTY_RESPONSE);
  });

  // I11
  it('never logs the token, the full URL or the raw project path', async () => {
    const lines: Record<string, string | number>[] = [];
    await handleQueryLink(
      activity('https://gitlab.example.com/acquisition/project-x/-/issues/1'),
      {
        config,
        lookupToken: async () => 'super-secret-token',
        fetchImpl: okFetch,
        log: (fields) => lines.push(fields),
      },
    );

    const dump = JSON.stringify(lines);
    expect(dump).not.toContain('super-secret-token');
    expect(dump).not.toContain('acquisition');
    expect(dump).not.toContain('project-x');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('logs an outcome even when the activity is rejected', async () => {
    const lines: Record<string, string | number>[] = [];
    await handleQueryLink(
      { type: 'message' },
      { config, lookupToken: async () => null, log: (fields) => lines.push(fields) },
    );
    expect(lines[0]!.outcome).toContain('rejected-activity');
  });
});
