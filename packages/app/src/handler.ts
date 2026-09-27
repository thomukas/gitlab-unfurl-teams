import {
  buildLinkResponse,
  buildUnfurlResponse,
  fetchEntity,
  safeLogFields,
  validateUrl,
  type CoreConfig,
  type GitLabRef,
} from '@gitlab-unfurl-teams/core';
import { isRecord } from './http.js';
import { checkActivity } from './activity.js';

export type TokenLookup = (teamsUserId: string, code?: string, signal?: AbortSignal) => Promise<string | null>;

export interface HandlerDeps {
  readonly config: CoreConfig;
  readonly lookupToken: TokenLookup;
  readonly getSignInUrl: (activity: unknown, signal?: AbortSignal) => Promise<string>;
  readonly signOut: (userId: string, signal?: AbortSignal) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (fields: Record<string, string | number>) => void;
}

const NO_CACHE_ACTION = Object.freeze({
  type: 'setCachePolicy',
  value: '{"type":"no-cache"}',
});

/**
 * The single no-card response.
 *
 * One frozen object shared by every failure path, so a 403 and a 404
 * cannot diverge into distinguishable responses and turn the
 * application into a project-enumeration oracle (I10).
 */
export const EMPTY_RESPONSE: object = Object.freeze({
  composeExtension: Object.freeze({
    type: 'result',
    attachmentLayout: 'list',
    attachments: Object.freeze([]),
    suggestedActions: Object.freeze({ actions: Object.freeze([NO_CACHE_ACTION]) }),
  }),
});

/** The token service supplies a caller-bound URL; never reuse it for another user. */
function authResponse(url: string): object {
  return { composeExtension: { type: 'auth', suggestedActions: { actions: [
    { type: 'openUrl', title: 'Connect your GitLab account', value: url },
  ] } } };
}

/**
 * Order matters here, and it is a security property, not a style choice.
 *
 * The activity is validated first, then the URL, and only then is a
 * token looked up. Nothing that fails validation ever reaches a token
 * lookup or an outbound request (I2, I6).
 *
 * The token is looked up by the authenticated Teams user id from the
 * validated activity, so user A can never cause a request carrying user
 * B's token (I7).
 */
export async function handleQueryLink(activity: unknown, deps: HandlerDeps): Promise<object> {
  const started = Date.now();

  const emit = (outcome: string, ref?: GitLabRef): void => {
    deps.log?.(
      safeLogFields({
        ...(ref === undefined ? {} : { ref }),
        origin: deps.config.origin,
        outcome,
        latencyMs: Date.now() - started,
      }),
    );
  };

  const checked = checkActivity(activity);
  if (!checked.ok) {
    emit(`rejected-activity:${checked.reason}`);
    return EMPTY_RESPONSE;
  }

  const validated = validateUrl(checked.url, deps.config);
  if (!validated.ok) {
    emit(`rejected-url:${validated.reason}`);
    return EMPTY_RESPONSE;
  }

  if (deps.config.previewMode === 'link') {
    emit('link-only');
    return buildLinkResponse(validated.ref, deps.config);
  }

  const token = await deps.lookupToken(checked.userId, checked.code, deps.signal);
  if (token === null) {
    emit('auth-required', validated.ref);
    return authResponse(await deps.getSignInUrl(activity, deps.signal));
  }

  const result = await fetchEntity(validated.ref, token, deps.config, deps.fetchImpl, deps.signal);
  if (!result.ok) {
    emit(`gitlab:${result.reason}`, validated.ref);
    if (result.reason === 'unauthorized') {
      await deps.signOut(checked.userId, deps.signal);
      return authResponse(await deps.getSignInUrl(activity, deps.signal));
    }
    return EMPTY_RESPONSE;
  }

  emit('ok', validated.ref);
  return buildUnfurlResponse(result.entity, deps.config);
}

/** Account actions use only the authenticated caller, never an ID in action data. */
export async function handleActivity(activity: unknown, deps: HandlerDeps): Promise<object> {
  if (!isRecord(activity) || activity.type !== 'invoke' || activity.channelId !== 'msteams'
    || !isRecord(activity.from) || typeof activity.from.id !== 'string' || !activity.from.id
    || !isRecord(activity.value)) return EMPTY_RESPONSE;
  const value = activity.value;
  if (activity.name === 'signin/verifyState') {
    if (typeof value.state !== 'string' || !value.state || value.state.length > 512) return EMPTY_RESPONSE;
    const token = await deps.lookupToken(activity.from.id, value.state, deps.signal);
    return { status: token ? 200 : 401 };
  }
  if (value.commandId === 'disconnect' && activity.name === 'composeExtension/fetchTask') {
    return { task: { type: 'continue', value: { title: 'Disconnect GitLab', height: 'small', width: 'small',
      card: { contentType: 'application/vnd.microsoft.card.adaptive', content: {
        type: 'AdaptiveCard', version: '1.3',
        body: [{ type: 'TextBlock', wrap: true, text: 'Disconnect your GitLab account from this app? Existing cards remain in Teams. To revoke the grant itself, also revoke Teams Unfurl in GitLab Authorized applications.' }],
        actions: [{ type: 'Action.Submit', title: 'Disconnect', data: { confirm: true } }],
      } },
    } } };
  }
  if (value.commandId === 'disconnect' && activity.name === 'composeExtension/submitAction') {
    if (!isRecord(value.data) || value.data.confirm !== true) return { task: { type: 'message', value: 'Disconnect cancelled.' } };
    await deps.signOut(activity.from.id, deps.signal);
    return { task: { type: 'message', value: 'Disconnected. Existing Teams cards remain. Revoke the grant in GitLab Authorized applications to remove authorization.' } };
  }
  return handleQueryLink(activity, deps);
}
