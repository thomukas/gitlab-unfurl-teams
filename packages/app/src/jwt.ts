import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import type { BotConfig } from './bot-config.js';
import { isRecord, readBounded } from './http.js';

export type AuthorizedActivity = (activity: unknown) => boolean;
const JWKS_URL = 'https://login.botframework.com/v1/.well-known/keys';

/** Public-cloud Connector authentication. Emulator and unsigned local tokens are excluded. */
export function createJwtVerifier(config: BotConfig, fetchImpl: typeof fetch = fetch) {
  const keys = createRemoteJWKSet(new URL(JWKS_URL), {
    timeoutDuration: 2000, cooldownDuration: 30_000, cacheMaxAge: 60 * 60_000,
    [customFetch]: async (url, options) => {
      const response = await fetchImpl(url, { ...options, redirect: 'error' });
      if (response.status !== 200) throw new Error('jwks-unavailable');
      return new Response(await readBounded(response.body, 256 * 1024, options.signal));
    },
  });
  return {
    ready: async () => { if (!keys.fresh) await keys.reload(); },
    verify: async (header: string | undefined): Promise<AuthorizedActivity | null> => {
      if (!header || header.length > 16_384 || !/^Bearer [^\s]+$/i.test(header)) return null;
      try {
        const { payload, protectedHeader } = await jwtVerify(header.slice(7), keys, {
          algorithms: ['RS256'], issuer: 'https://api.botframework.com', audience: config.botId,
          requiredClaims: ['exp', 'nbf', 'serviceurl'], clockTolerance: 60,
        });
        const key = keys.jwks()?.keys.find((candidate) => candidate.kid === protectedHeader.kid);
        // Channel endorsement must come from the trusted JWKS, never from the JWT payload.
        const endorsements: unknown = key && 'endorsements' in key ? key.endorsements : undefined;
        if (!Array.isArray(endorsements) || !endorsements.includes('msteams')) return null;
        if (typeof payload.serviceurl !== 'string') return null;
        const serviceUrl = new URL(payload.serviceurl);
        if (serviceUrl.protocol !== 'https:' || serviceUrl.username || serviceUrl.password) return null;
        return (activity: unknown): boolean => {
          if (!isRecord(activity) || activity.serviceUrl !== payload.serviceurl || activity.channelId !== 'msteams') return false;
          const { channelData, recipient, from, conversation } = activity;
          return isRecord(channelData) && isRecord(channelData.tenant)
            && channelData.tenant.id === config.tenantId
            && isRecord(recipient) && recipient.id === `28:${config.botId}`
            && isRecord(from) && typeof from.id === 'string' && from.id.length > 0 && from.id.length <= 512
            && isRecord(conversation) && typeof conversation.id === 'string' && conversation.id.length > 0
            && (conversation.tenantId === undefined || conversation.tenantId === config.tenantId);
        };
      } catch { return null; }
    },
  };
}
