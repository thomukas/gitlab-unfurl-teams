import { describe, it, expect } from 'vitest';
import { checkActivity } from '../src/activity.js';

const valid = {
  type: 'invoke',
  name: 'composeExtension/queryLink',
  channelId: 'msteams',
  from: { id: '29:user-a', aadObjectId: 'oid-a' },
  value: { url: 'https://gitlab.example.com/g/p/-/issues/1' },
};

describe('checkActivity', () => {
  it('accepts the expected invoke and returns the url and user id', () => {
    expect(checkActivity(valid)).toEqual({
      ok: true,
      url: 'https://gitlab.example.com/g/p/-/issues/1',
      userId: '29:user-a',
    });
  });

  it.each([
    [{ ...valid, type: 'message' }, 'type'],
    [{ ...valid, name: 'composeExtension/query' }, 'name'],
    [{ ...valid, name: 'composeExtension/anonymousQueryLink' }, 'name'],
    [{ ...valid, channelId: 'directline' }, 'channel'],
    [{ ...valid, value: {} }, 'url'],
    [{ ...valid, value: { url: 42 } }, 'url'],
    [{ ...valid, value: { url: '' } }, 'url'],
    [{ ...valid, value: { url: 'x'.repeat(3000) } }, 'url'],
    [{ ...valid, from: {} }, 'identity'],
    [{ ...valid, from: undefined }, 'identity'],
    [{ ...valid, from: { id: '' } }, 'identity'],
    [null, 'shape'],
    ['a string', 'shape'],
    [42, 'shape'],
  ])('rejects a malformed activity (case %#) as %s', (activity, reason) => {
    expect(checkActivity(activity)).toEqual({ ok: false, reason });
  });

  it('rejects the anonymous invoke, since v1 has no anonymous path', () => {
    // supportsAnonymizedPayloads is deliberately absent from the
    // manifest: an anonymous invoke carries no user identity, so there
    // would be no token to act with.
    expect(checkActivity({ ...valid, name: 'composeExtension/anonymousQueryLink' }).ok).toBe(false);
  });
});
