import { describe, expect, it, vi } from 'vitest';
import { createTokenService } from '../src/token-service.js';
import { loadBotConfig } from '../src/bot-config.js';

const config = loadBotConfig({ BOT_ID: '11111111-1111-4111-8111-111111111111', BOT_TENANT_ID: '22222222-2222-4222-8222-222222222222', BOT_PASSWORD: 'secret', OAUTH_ORIGIN: 'https://europe.token.botframework.com' }, true);
const identity = { from: { id: '29:alice' }, recipient: { id: `28:${config.botId}` }, conversation: { id: 'conv' }, serviceUrl: 'https://smba.trafficmanager.net/emea/', channelId: 'msteams', id: 'invoke' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const make = (respond: (url: URL) => Response = () => json({ channelId: 'msteams', connectionName: 'gitlab', token: 'user-token' })) => {
  const calls: URL[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const parsed = new URL(String(url)); calls.push(parsed);
    return parsed.hostname === 'login.microsoftonline.com' ? json({ access_token: 'bot-token', expires_in: 3600 }) : respond(parsed);
  });
  return { service: createTokenService(config, fetcher), calls, fetcher };
};

describe('Microsoft token service', () => {
  it('binds lookup to user, connection and Teams; passes the returned code for server validation', async () => {
    const { service, calls, fetcher } = make();
    expect(await service.lookup('29:alice', '123456')).toBe('user-token');
    expect(calls[0]!.pathname).toBe(`/${config.tenantId}/oauth2/v2.0/token`);
    expect(calls[1]!.origin).toBe(config.oauthOrigin);
    expect(Object.fromEntries(calls[1]!.searchParams)).toEqual({ userId: '29:alice', connectionName: 'gitlab', channelId: 'msteams', code: '123456' });
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer bot-token' } });
    expect(String(fetcher.mock.calls[0]![1]?.body)).toContain('grant_type=client_credentials');
  });
  it('caches bot authentication, never another user token', async () => {
    const { service, calls } = make((url) => json({ channelId: 'msteams', connectionName: 'gitlab', token: url.searchParams.get('userId') }));
    expect(await service.lookup('29:a')).toBe('29:a');
    expect(await service.lookup('29:b')).toBe('29:b');
    expect(calls.filter((url) => url.hostname === 'login.microsoftonline.com')).toHaveLength(1);
    expect(calls.filter((url) => url.pathname === '/api/usertoken/GetToken')).toHaveLength(2);
  });
  it('treats a missing grant as a sign-in requirement', async () => {
    expect(await make(() => new Response(null, { status: 404 })).service.lookup('29:a')).toBeNull();
  });
  it('creates a caller-bound sign-in resource without trusting a client redirect', async () => {
    const { service, calls } = make(() => json({ signInLink: `${config.oauthOrigin}/signin/abc` }));
    expect(await service.signInUrl(identity)).toBe(`${config.oauthOrigin}/signin/abc`);
    const state = JSON.parse(Buffer.from(calls[1]!.searchParams.get('state')!, 'base64').toString());
    expect(state).toMatchObject({ connectionName: 'gitlab', msAppId: config.botId, conversation: { user: identity.from, bot: identity.recipient, conversation: identity.conversation, channelId: 'msteams', serviceUrl: identity.serviceUrl } });
    expect(calls[1]!.searchParams.has('finalRedirect')).toBe(false);
  });
  it('rejects an unexpected sign-in destination', async () => {
    await expect(make(() => json({ signInLink: 'https://evil.example/login' })).service.signInUrl(identity)).rejects.toThrow('upstream');
  });
  it('signs out only the selected user and connection', async () => {
    const { service, calls } = make(() => new Response(null, { status: 204 }));
    await service.signOut('29:alice');
    expect(calls[1]!.pathname).toBe('/api/usertoken/SignOut');
    expect(Object.fromEntries(calls[1]!.searchParams)).toEqual({ userId: '29:alice', connectionName: 'gitlab', channelId: 'msteams' });
  });
  it('does not turn service outages into a missing grant', async () => {
    await expect(make(() => json({ error: 'secret' }, 500)).service.lookup('29:a')).rejects.toThrow('upstream');
  });
  it('rejects a mismatched token response', async () => {
    await expect(make(() => json({ connectionName: 'other', channelId: 'msteams', token: 'secret' })).service.lookup('29:a')).rejects.toThrow('upstream');
  });
  it('bounds upstream response bodies', async () => {
    await expect(make(() => new Response('x'.repeat(300_000))).service.lookup('29:a')).rejects.toThrow('too-large');
  });
});
