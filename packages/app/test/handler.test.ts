import { describe, it, expect, vi } from 'vitest';
import { handleQueryLink, handleActivity, EMPTY_RESPONSE } from '../src/handler.js';
import { loadCoreConfig } from '@gitlab-unfurl-teams/core';

const authDeps = { getSignInUrl: async () => 'https://token.botframework.com/signin/test', signOut: async () => {} };

const config = loadCoreConfig({ GITLAB_ORIGIN: 'https://gitlab.example.com', PREVIEW_MODE: 'metadata', PROJECT_ALLOWLIST: 'g,acquisition' });

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
      ...authDeps, config,
      lookupToken: async () => 'tok',
      fetchImpl: okFetch,
    })) as { composeExtension: { type: string; attachments: { preview?: unknown }[] } };

    expect(res.composeExtension.type).toBe('result');
    expect(res.composeExtension.attachments[0]!.preview).toBeDefined();
  });

  it('returns the sign-in card when the user has no token', async () => {
    const res = await handleQueryLink(activity(good), {
      ...authDeps, config,
      lookupToken: async () => null,
      fetchImpl: okFetch,
    });
    expect(res).toMatchObject({ composeExtension: { type: 'auth', suggestedActions: { actions: [{ type: 'openUrl', value: 'https://token.botframework.com/signin/test' }] } } });
  });

  // I7 — the confused-deputy check.
  it('looks the token up by the authenticated user id, never a fixed one', async () => {
    const lookup = vi.fn(async () => 'tok');
    await handleQueryLink(activity(good, '29:user-b'), {
      ...authDeps, config,
      lookupToken: lookup,
      fetchImpl: okFetch,
    });
    expect(lookup).toHaveBeenCalledWith('29:user-b', undefined, undefined);
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
      ...authDeps, config,
      lookupToken: async (id) => tokens[id] ?? null,
      fetchImpl: spyFetch,
    });
    expect(seen).toEqual(['Bearer token-a']);
  });

  it('never calls GitLab when the URL fails validation (I2)', async () => {
    const spy = vi.fn(okFetch);
    const res = await handleQueryLink(activity('https://evil.example/g/p/-/issues/1'), {
      ...authDeps, config,
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
      { ...authDeps, config, lookupToken: async () => 'tok', fetchImpl: spy as unknown as typeof fetch },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(res).toEqual(EMPTY_RESPONSE);
  });

  it('does not look up a token before the URL is validated', async () => {
    const lookup = vi.fn(async () => 'tok');
    await handleQueryLink(activity('https://evil.example/g/p/-/issues/1'), {
      ...authDeps, config,
      lookupToken: lookup,
      fetchImpl: okFetch,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  // I10
  it('returns byte-identical responses for 403 and 404', async () => {
    const make = (status: number) =>
      handleQueryLink(activity(good), {
        ...authDeps, config,
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
        ...authDeps, config,
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
        ...authDeps, config,
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
      { ...authDeps, config, lookupToken: async () => null, log: (fields) => lines.push(fields) },
    );
    expect(lines[0]!.outcome).toContain('rejected-activity');
  });
});

describe('metadata disclosure policy', () => {
  it('never acquires a token or calls GitLab in default mode', async () => {
    const lookupToken = vi.fn(async () => 'secret');
    const fetchImpl = vi.fn(okFetch);
    const result = await handleQueryLink(activity(`${good}/notes?secret=value#fragment`), {
      ...authDeps, config: loadCoreConfig({ GITLAB_ORIGIN: config.origin }), lookupToken, fetchImpl,
    });
    const json = JSON.stringify(result);
    expect(lookupToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(json).toContain('GitLab link');
    expect(json).toContain(good);
    expect(json).not.toContain('Add the thing');
    expect(json).not.toContain('"Ada"');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('fragment');
  });
  it('does not fetch from an unapproved namespace in metadata mode', async () => {
    const lookupToken = vi.fn(async () => 'secret');
    expect(await handleQueryLink(activity('https://gitlab.example.com/other/project/-/issues/1'), {
      ...authDeps, config, lookupToken,
    })).toEqual(EMPTY_RESPONSE);
    expect(lookupToken).not.toHaveBeenCalled();
  });
  it('withholds a confidential issue even from an approved project', async () => {
    const result = await handleQueryLink(activity(good), {
      ...authDeps, config, lookupToken: async () => 'secret',
      fetchImpl: async () => new Response(JSON.stringify({ ...payload, confidential: true })),
    });
    expect(result).toEqual(EMPTY_RESPONSE);
  });
});

describe('account lifecycle', () => {
  it('returns a new sign-in action when GitLab rejects a stored token', async () => {
    const signOut = vi.fn(async () => {});
    const result = await handleQueryLink(activity(good, '29:a'), {
      ...authDeps, config, signOut, lookupToken: async () => 'expired',
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    expect(signOut).toHaveBeenCalledWith('29:a', undefined);
    expect(result).toMatchObject({ composeExtension: { type: 'auth' } });
  });
  it('passes the resumed query code to the token service for validation', async () => {
    const lookupToken = vi.fn(async () => 'tok');
    const request = activity(good);
    await handleQueryLink({ ...request, value: { ...request.value, state: '123456' } }, { ...authDeps, config, lookupToken, fetchImpl: okFetch });
    expect(lookupToken).toHaveBeenCalledWith('29:user-a', '123456', undefined);
  });
  it('only disconnects the caller, ignoring a forged target in the command data', async () => {
    const signOut = vi.fn(async () => {});
    await handleActivity({ ...activity(good, '29:a'), name: 'composeExtension/submitAction', value: { commandId: 'disconnect', data: { confirm: true, userId: '29:victim' } } }, {
      ...authDeps, config, signOut, lookupToken: async () => null,
    });
    expect(signOut).toHaveBeenCalledWith('29:a', undefined);
  });
  it('does not disconnect on opening or cancelling the dialog', async () => {
    const signOut = vi.fn(async () => {});
    for (const name of ['composeExtension/fetchTask', 'composeExtension/submitAction']) {
      await handleActivity({ ...activity(good), name, value: { commandId: 'disconnect', data: { confirm: false } } }, { ...authDeps, config, signOut, lookupToken: async () => null });
    }
    expect(signOut).not.toHaveBeenCalled();
  });
  it('does not accept an unverified sign-in completion', async () => {
    const lookupToken = vi.fn(async () => null);
    const response = await handleActivity({ ...activity(good), name: 'signin/verifyState', value: { state: 'wrong-code' } }, { ...authDeps, config, lookupToken });
    expect(response).toEqual({ status: 401 });
    expect(lookupToken).toHaveBeenCalledWith('29:user-a', 'wrong-code', undefined);
  });
});
