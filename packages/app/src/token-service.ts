import type { BotConfig } from './bot-config.js';
import { BoundaryError, isRecord, requestJson } from './http.js';

/** Microsoft stores and refreshes user grants; only the bot access token is cached here. */
export function createTokenService(config: BotConfig, fetchImpl: typeof fetch = fetch) {
  let cached: { token: string; until: number } | undefined;
  let pending: Promise<string> | undefined;
  const accessToken = async (signal?: AbortSignal): Promise<string> => {
    if (cached && cached.until > Date.now()) return cached.token;
    // Do not bind the shared acquisition to one caller's cancellation.
    pending ??= (async () => {
      const result = await requestJson(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.botId,
          client_secret: config.password, scope: 'https://api.botframework.com/.default' }),
      }, fetchImpl);
      const value = result.value;
      if (!isRecord(value) || typeof value.access_token !== 'string' || !value.access_token
        || typeof value.expires_in !== 'number' || value.expires_in <= 60) throw new BoundaryError('upstream');
      cached = { token: value.access_token, until: Date.now() + (Math.min(value.expires_in, 86400) - 60) * 1000 };
      return cached.token;
    })().finally(() => { pending = undefined; });
    const token = await pending;
    signal?.throwIfAborted();
    return token;
  };
  const call = async (path: string, params: Record<string, string>, signal?: AbortSignal) => {
    const token = await accessToken(signal);
    const url = new URL(path, config.oauthOrigin);
    url.search = new URLSearchParams(params).toString();
    return requestJson(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, fetchImpl, signal);
  };
  return {
    ready: async () => { await accessToken(); },
    lookup: async (userId: string, code?: string, signal?: AbortSignal): Promise<string | null> => {
      const { status, value } = await call('/api/usertoken/GetToken', {
        userId, connectionName: config.connectionName, channelId: 'msteams', ...(code ? { code } : {}),
      }, signal);
      if (status === 404 || value === null) return null;
      if (!isRecord(value) || value.connectionName !== config.connectionName || value.channelId !== 'msteams'
        || typeof value.token !== 'string' || !value.token) throw new BoundaryError('upstream');
      return value.token;
    },
    signInUrl: async (activity: unknown, signal?: AbortSignal): Promise<string> => {
      if (!isRecord(activity)) throw new BoundaryError('upstream');
      // Conversation reference binds the sign-in URL to the verified Teams caller.
      const state = Buffer.from(JSON.stringify({
        connectionName: config.connectionName, msAppId: config.botId,
        conversation: { activityId: activity.id, user: activity.from, bot: activity.recipient,
          conversation: activity.conversation, channelId: 'msteams', serviceUrl: activity.serviceUrl,
          locale: activity.locale },
      })).toString('base64');
      const { value } = await call('/api/botsignin/GetSignInResource', { state }, signal);
      if (!isRecord(value) || typeof value.signInLink !== 'string') throw new BoundaryError('upstream');
      const url = new URL(value.signInLink);
      if (url.origin !== config.oauthOrigin || url.username || url.password) throw new BoundaryError('upstream');
      return url.href;
    },
    signOut: async (userId: string, signal?: AbortSignal): Promise<void> => {
      await call('/api/usertoken/SignOut', { userId, connectionName: config.connectionName, channelId: 'msteams' }, signal);
    },
  };
}
