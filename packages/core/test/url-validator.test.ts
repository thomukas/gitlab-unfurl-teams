import { describe, it, expect } from 'vitest';
import { validateUrl } from '../src/url-validator.js';
import type { CoreConfig } from '../src/config.js';
import type { RejectionReason } from '../src/types.js';

const cfg: CoreConfig = {
  origin: 'https://gitlab.example.com',
  projectAllowlist: [],
  timeoutMs: 3000,
  maxResponseBytes: 262144,
};

const check = (url: string) => validateUrl(url, cfg);

describe('validateUrl: accepts', () => {
  it('a merge request', () => {
    expect(check('https://gitlab.example.com/group/proj/-/merge_requests/42')).toEqual({
      ok: true,
      ref: { kind: 'merge_request', namespacePath: 'group/proj', iid: 42 },
    });
  });

  it('an issue', () => {
    expect(check('https://gitlab.example.com/group/proj/-/issues/7')).toEqual({
      ok: true,
      ref: { kind: 'issue', namespacePath: 'group/proj', iid: 7 },
    });
  });

  it('a nested subgroup path', () => {
    expect(check('https://gitlab.example.com/a/b/c/proj/-/issues/1')).toMatchObject({
      ok: true,
      ref: { namespacePath: 'a/b/c/proj' },
    });
  });

  it('a trailing segment such as /diffs, ignoring it', () => {
    expect(check('https://gitlab.example.com/g/p/-/merge_requests/42/diffs')).toMatchObject({
      ok: true,
      ref: { iid: 42 },
    });
  });

  it('a fragment such as #note_1, ignoring it', () => {
    expect(check('https://gitlab.example.com/g/p/-/issues/3#note_1')).toMatchObject({
      ok: true,
      ref: { iid: 3 },
    });
  });

  it('a query string, ignoring it', () => {
    expect(check('https://gitlab.example.com/g/p/-/issues/3?foo=bar')).toMatchObject({
      ok: true,
      ref: { iid: 3 },
    });
  });

  it('an epic, which lives under /groups/ and uses a group path', () => {
    expect(check('https://gitlab.example.com/groups/acme/-/epics/17')).toEqual({
      ok: true,
      ref: { kind: 'epic', namespacePath: 'acme', iid: 17 },
    });
  });

  it('an epic in a nested subgroup', () => {
    expect(check('https://gitlab.example.com/groups/acme/platform/-/epics/3')).toMatchObject({
      ok: true,
      ref: { kind: 'epic', namespacePath: 'acme/platform' },
    });
  });

  it('an explicit default port, which canonicalises to the same origin', () => {
    expect(check('https://gitlab.example.com:443/g/p/-/issues/1')).toMatchObject({ ok: true });
  });
});

describe('validateUrl: rejects (the hostile-input corpus)', () => {
  const cases: ReadonlyArray<readonly [string, RejectionReason]> = [
    ['http://gitlab.example.com/g/p/-/issues/1', 'scheme'],
    ['ftp://gitlab.example.com/g/p/-/issues/1', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,x', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    // Both userinfo forms are caught by the userinfo check, which runs
    // before the origin check. The second one is the dangerous case:
    // its origin EQUALS the configured origin, so origin equality alone
    // would let it through.
    ['https://gitlab.example.com@evil.com/g/p/-/issues/1', 'userinfo'],
    ['https://evil.com@gitlab.example.com/g/p/-/issues/1', 'userinfo'],
    ['https://gitlab.example.com.evil.com/g/p/-/issues/1', 'origin'],
    ['https://gitlab.example.com./g/p/-/issues/1', 'origin'],
    ['https://127.0.0.1/g/p/-/issues/1', 'origin'],
    ['https://[::1]/g/p/-/issues/1', 'origin'],
    ['https://2130706433/g/p/-/issues/1', 'origin'],
    ['https://0x7f000001/g/p/-/issues/1', 'origin'],
    ['https://xn--gitlb-jua.example.com/g/p/-/issues/1', 'origin'],
    ['https://gitlab.example.com:8443/g/p/-/issues/1', 'origin'],
    // pathname keeps %2F encoded, so decoding before the split would
    // turn `g%2Fp` into the different project `g/p`.
    ['https://gitlab.example.com/g%2Fp/-/issues/1', 'encoded-separator'],
    ['https://gitlab.example.com/g%2fp/-/issues/1', 'encoded-separator'],
    // The URL parser resolves dot segments itself, so traversal collapses
    // into a path that no longer matches the entity shape.
    ['https://gitlab.example.com/g/p/-/issues/../../../secret', 'shape'],
    ['https://gitlab.example.com/g/p/-/issues/%2e%2e/%2e%2e/secret', 'shape'],
    ['https://gitlab.example.com/g/p/-/snippets/1', 'shape'],
    // The URL shape and the entity kind must agree.
    ['https://gitlab.example.com/g/p/-/epics/1', 'shape'],
    ['https://gitlab.example.com/groups/acme/-/issues/1', 'shape'],
    ['https://gitlab.example.com/groups/acme/-/merge_requests/1', 'shape'],
    // A project whose namespace merely starts with those letters.
    ['https://gitlab.example.com/groupsX/proj/-/epics/1', 'shape'],
    ['https://gitlab.example.com/groups/-/epics/1', 'shape'],
    ['https://gitlab.example.com/g/p/-/commit/abc123', 'shape'],
    ['https://gitlab.example.com/proj/-/issues/1', 'shape'],
    ['https://gitlab.example.com/g/p/-/issues', 'iid'],
    ['https://gitlab.example.com/g/p/-/issues/abc', 'iid'],
    ['https://gitlab.example.com/g/p/-/issues/0', 'iid'],
    ['https://gitlab.example.com/g/p/-/issues/-1', 'iid'],
    ['not a url at all', 'unparseable'],
    ['', 'unparseable'],
  ];

  it.each(cases)('rejects %s as %s', (url, reason) => {
    expect(validateUrl(url, cfg)).toEqual({ ok: false, reason });
  });

  it('rejects an over-long URL before parsing', () => {
    const long = `https://gitlab.example.com/g/p/-/issues/1?x=${'a'.repeat(3000)}`;
    expect(validateUrl(long, cfg)).toEqual({ ok: false, reason: 'too-long' });
  });

  it('rejects a project outside the allowlist', () => {
    const scoped: CoreConfig = { ...cfg, projectAllowlist: ['company/platform'] };
    expect(
      validateUrl('https://gitlab.example.com/company/platform-evil/-/issues/1', scoped),
    ).toEqual({ ok: false, reason: 'allowlist' });
  });
});

describe('validateUrl: the returned ref carries no host (I2)', () => {
  it('never exposes a host field', () => {
    const result = validateUrl('https://gitlab.example.com/g/p/-/issues/1', cfg);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.ref).sort()).toEqual(['iid', 'kind', 'namespacePath']);
    }
  });
});
