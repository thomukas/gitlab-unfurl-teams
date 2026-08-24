import type { CoreConfig } from './config.js';
import { isAllowed } from './allowlist.js';
import { SCOPE_OF } from './types.js';
import type { EntityKind, GitLabRef, RejectionReason, ValidationResult } from './types.js';

const MAX_URL_LENGTH = 2048;
const PATH_MARKER = '/-/';

const SEGMENT_TO_KIND: Readonly<Record<string, EntityKind>> = {
  merge_requests: 'merge_request',
  issues: 'issue',
  epics: 'epic',
};

/** Epics live under /groups/<group>/-/epics/<iid>. Nothing else does. */
const GROUP_PREFIX = '/groups/';

/** A project path needs a namespace and a project. A group path needs neither. */
const MIN_SEGMENTS: Readonly<Record<'project' | 'group', number>> = { project: 2, group: 1 };

/** GitLab iids are positive integers. Bounded to keep the value sane. */
const IID_PATTERN = /^[1-9][0-9]{0,9}$/;

/** %2F and %5C survive URL parsing and would forge a project path if decoded. */
const ENCODED_SEPARATOR = /%2f|%5c/i;

function reject(reason: RejectionReason): ValidationResult {
  return { ok: false, reason };
}

/**
 * The control that stops untrusted input choosing where a credential goes.
 *
 * Returns a GitLabRef with NO host. The caller uses config.origin
 * unconditionally, so a pasted URL can never redirect an authenticated
 * request (I2).
 *
 * Two checks below exist because of verified parser behaviour, not
 * caution:
 *
 *  - `https://evil.com@gitlab.example.com/...` parses with an origin
 *    EQUAL to the configured one and a username of `evil.com`. Origin
 *    equality alone does not catch it, so userinfo is checked explicitly.
 *
 *  - `https://gitlab.example.com/g%2Fp/-/issues/1` keeps `%2F` encoded in
 *    `pathname`. Decoding before the split would turn `g%2Fp` into the
 *    different project `g/p`, so encoded separators are rejected before
 *    any decoding happens.
 */
export function validateUrl(raw: string, config: CoreConfig): ValidationResult {
  if (raw.length > MAX_URL_LENGTH) return reject('too-long');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('unparseable');
  }

  if (url.protocol !== 'https:') return reject('scheme');
  if (url.username !== '' || url.password !== '') return reject('userinfo');
  if (url.origin !== config.origin) return reject('origin');
  if (ENCODED_SEPARATOR.test(url.pathname)) return reject('encoded-separator');

  // The /groups/ prefix is what distinguishes a group URL from a project
  // whose namespace merely begins with those letters, so it is matched
  // exactly rather than by prefix.
  const isGroupUrl = url.pathname.startsWith(GROUP_PREFIX);
  const pathBody = isGroupUrl ? url.pathname.slice(GROUP_PREFIX.length - 1) : url.pathname;

  const marker = pathBody.indexOf(PATH_MARKER);
  if (marker <= 0) return reject('shape');

  const namespacePath = pathBody.slice(1, marker);
  const segments = namespacePath.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return reject('shape');

  const rest = pathBody.slice(marker + PATH_MARKER.length).split('/');

  const kindSegment = rest[0];
  const kind = kindSegment === undefined ? undefined : SEGMENT_TO_KIND[kindSegment];
  if (kind === undefined) return reject('shape');

  // The URL shape and the entity kind must agree. An epic outside
  // /groups/, or a merge request inside it, is not a real GitLab URL.
  const scope = SCOPE_OF[kind];
  if ((scope === 'group') !== isGroupUrl) return reject('shape');
  if (segments.length < MIN_SEGMENTS[scope]) return reject('shape');

  const iidSegment = rest[1];
  if (iidSegment === undefined || !IID_PATTERN.test(iidSegment)) return reject('iid');

  if (!isAllowed(namespacePath, config.projectAllowlist)) return reject('allowlist');

  const ref: GitLabRef = { kind, namespacePath, iid: Number(iidSegment) };
  return { ok: true, ref };
}
