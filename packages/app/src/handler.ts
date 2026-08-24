import {
  buildUnfurlResponse,
  fetchEntity,
  safeLogFields,
  validateUrl,
  type CoreConfig,
  type GitLabRef,
} from '@gitlab-unfurl-teams/core';
import { checkActivity } from './activity.js';

export type TokenLookup = (teamsUserId: string) => Promise<string | null>;

export interface HandlerDeps {
  readonly config: CoreConfig;
  readonly lookupToken: TokenLookup;
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

/** Shown until the user connects their own GitLab account. */
export const AUTH_RESPONSE: object = Object.freeze({
  composeExtension: Object.freeze({
    type: 'auth',
    attachmentLayout: 'list',
    attachments: Object.freeze([]),
  }),
});

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

  const token = await deps.lookupToken(checked.userId);
  if (token === null) {
    emit('auth-required', validated.ref);
    return AUTH_RESPONSE;
  }

  const result = await fetchEntity(validated.ref, token, deps.config, deps.fetchImpl);
  if (!result.ok) {
    emit(`gitlab:${result.reason}`, validated.ref);
    return EMPTY_RESPONSE;
  }

  emit('ok', validated.ref);
  return buildUnfurlResponse(result.entity, deps.config);
}
