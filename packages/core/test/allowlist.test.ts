import { describe, it, expect } from 'vitest';
import { isAllowed } from '../src/allowlist.js';

describe('isAllowed', () => {
  it('allows everything when the allowlist is empty', () => {
    expect(isAllowed('anything/at/all', [])).toBe(true);
  });

  it('matches an exact project path', () => {
    expect(isAllowed('company/platform', ['company/platform'])).toBe(true);
  });

  it('matches a project inside an allowed namespace', () => {
    expect(isAllowed('company/platform/api', ['company/platform'])).toBe(true);
  });

  // The prefix bug the security review called out: startsWith() would
  // wrongly allow this.
  it('does NOT match a sibling that merely shares a string prefix', () => {
    expect(isAllowed('company/platform-evil', ['company/platform'])).toBe(false);
  });

  it('does not match a shorter path than the entry', () => {
    expect(isAllowed('company', ['company/platform'])).toBe(false);
  });

  it('does not match a different namespace', () => {
    expect(isAllowed('other/platform', ['company/platform'])).toBe(false);
  });

  it('matches against any entry in the list', () => {
    expect(isAllowed('b/two', ['a/one', 'b/two'])).toBe(true);
  });

  it('is case-sensitive, matching GitLab path semantics', () => {
    expect(isAllowed('Company/Platform', ['company/platform'])).toBe(false);
  });
});
