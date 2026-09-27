import { ConfigError } from '@gitlab-unfurl-teams/core';

export const OAUTH_ORIGINS = [
  'https://token.botframework.com',
  'https://europe.token.botframework.com',
  'https://unitedstates.token.botframework.com',
  'https://india.token.botframework.com',
] as const;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface BotConfig {
  readonly botId: string;
  readonly tenantId: string;
  readonly password: string;
  readonly connectionName: string;
  readonly oauthOrigin: string;
}

export function loadBotConfig(env: Record<string, string | undefined>, needsOAuth: boolean): BotConfig {
  const botId = env.BOT_ID ?? '';
  const tenantId = env.BOT_TENANT_ID ?? '';
  if (!GUID.test(botId)) throw new ConfigError('BOT_ID must be a GUID');
  if (!GUID.test(tenantId)) throw new ConfigError('BOT_TENANT_ID must be a GUID');
  const password = env.BOT_PASSWORD ?? '';
  if (needsOAuth && password.trim() === '') throw new ConfigError('Metadata mode requires BOT_PASSWORD from a secret store');
  const connectionName = env.OAUTH_CONNECTION_NAME ?? 'gitlab';
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(connectionName)) throw new ConfigError('Invalid OAUTH_CONNECTION_NAME');
  const oauthOrigin = env.OAUTH_ORIGIN ?? OAUTH_ORIGINS[0];
  if (!(OAUTH_ORIGINS as readonly string[]).includes(oauthOrigin)) throw new ConfigError('OAUTH_ORIGIN must be a supported Microsoft public-cloud token origin');
  return { botId, tenantId, password, connectionName, oauthOrigin };
}
