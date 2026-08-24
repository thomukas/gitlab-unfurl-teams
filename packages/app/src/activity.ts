const MAX_URL_LENGTH = 2048;
const EXPECTED_TYPE = 'invoke';
const EXPECTED_NAME = 'composeExtension/queryLink';
const EXPECTED_CHANNEL = 'msteams';

export type ActivityCheck =
  | { readonly ok: true; readonly url: string; readonly userId: string }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Authenticating the caller is not enough.
 *
 * Without this check, /api/messages is a general-purpose authenticated
 * bot endpoint: anything holding a valid Bot Framework token could send
 * any activity and have it processed. Only the one invoke this
 * application exists to serve is accepted (I6).
 *
 * `composeExtension/anonymousQueryLink` is rejected along with
 * everything else. An anonymous invoke carries no user identity, so
 * there is no token to act with.
 */
export function checkActivity(activity: unknown): ActivityCheck {
  if (!isRecord(activity)) return { ok: false, reason: 'shape' };
  if (activity.type !== EXPECTED_TYPE) return { ok: false, reason: 'type' };
  if (activity.name !== EXPECTED_NAME) return { ok: false, reason: 'name' };
  if (activity.channelId !== EXPECTED_CHANNEL) return { ok: false, reason: 'channel' };

  const from = activity.from;
  if (!isRecord(from) || typeof from.id !== 'string' || from.id.length === 0) {
    return { ok: false, reason: 'identity' };
  }

  const value = activity.value;
  if (!isRecord(value)) return { ok: false, reason: 'url' };

  const url = value.url;
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) {
    return { ok: false, reason: 'url' };
  }

  return { ok: true, url, userId: from.id };
}
