import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createJwtVerifier } from '../src/jwt.js';
import { loadBotConfig } from '../src/bot-config.js';

const config = loadBotConfig({ BOT_ID: '11111111-1111-4111-8111-111111111111', BOT_TENANT_ID: '22222222-2222-4222-8222-222222222222' }, false);
const serviceUrl = 'https://smba.trafficmanager.net/emea/';
const activity = { channelId: 'msteams', serviceUrl, from: { id: '29:user' }, recipient: { id: `28:${config.botId}` },
  channelData: { tenant: { id: config.tenantId } }, conversation: { id: 'conv', tenantId: config.tenantId } };
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: JWK;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey; publicJwk = await exportJWK(pair.publicKey);
});
const signed = (overrides: Record<string, unknown> = {}) => new SignJWT({
  iss: 'https://api.botframework.com', aud: config.botId, nbf: Math.floor(Date.now() / 1000) - 1,
  exp: Math.floor(Date.now() / 1000) + 300, serviceurl: serviceUrl, ...overrides,
}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
const verifier = (endorsements: string[] = ['msteams']) => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', endorsements }] })));
  return { ...createJwtVerifier(config, fetcher), fetcher };
};

describe('Connector JWT and activity boundary', () => {
  it('verifies a real RSA signature and binds it to tenant, recipient, channel and service URL', async () => {
    const verify = verifier();
    const guard = await verify.verify(`Bearer ${await signed()}`);
    expect(guard?.(activity)).toBe(true);
    expect(guard?.({ ...activity, serviceUrl: 'https://evil.example' })).toBe(false);
    expect(guard?.({ ...activity, channelId: 'directline' })).toBe(false);
    expect(guard?.({ ...activity, recipient: { id: '28:other' } })).toBe(false);
    expect(guard?.({ ...activity, channelData: { tenant: { id: 'other' } } })).toBe(false);
    expect(guard?.({ ...activity, conversation: { id: 'conv', tenantId: 'other' } })).toBe(false);
    expect(guard?.({ ...activity, from: {} })).toBe(false);
    expect(guard?.({ ...activity, channelData: undefined })).toBe(false);
  });
  it.each([
    { aud: 'other' }, { iss: 'https://evil.example' }, { exp: 1 },
    { nbf: Math.floor(Date.now() / 1000) + 600 }, { exp: undefined }, { nbf: undefined },
    { serviceurl: undefined }, { serviceurl: 'http://example.com' },
  ])('rejects invalid or missing claims %#', async (claims) => {
    expect(await verifier().verify(`Bearer ${await signed(claims)}`)).toBeNull();
  });
  it('rejects an unendorsed signing key', async () => {
    expect(await verifier(['directline']).verify(`Bearer ${await signed()}`)).toBeNull();
  });
  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256');
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(other.privateKey);
    expect(await verifier().verify(`Bearer ${token}`)).toBeNull();
  });
  it('rejects algorithm confusion and malformed headers without fetching keys', async () => {
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'test-key' }).sign(new Uint8Array(32));
    const verify = verifier();
    expect(await verify.verify(`Bearer ${token}`)).toBeNull();
    expect(await verify.verify('Basic x')).toBeNull();
    expect(await verify.verify(undefined)).toBeNull();
    expect(verify.fetcher).not.toHaveBeenCalled();
  });
  it('uses a cached trusted JWKS for repeated verification', async () => {
    const verify = verifier(); const token = `Bearer ${await signed()}`;
    await verify.verify(token); await verify.verify(token);
    expect(verify.fetcher).toHaveBeenCalledTimes(1);
    expect(String(verify.fetcher.mock.calls[0]![0])).toBe('https://login.botframework.com/v1/.well-known/keys');
    expect(verify.fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });
  it('denies and fails readiness when JWKS cannot be loaded', async () => {
    const verify = createJwtVerifier(config, async () => { throw new Error('sensitive upstream URL'); });
    expect(await verify.verify(`Bearer ${await signed()}`)).toBeNull();
    await expect(verify.ready()).rejects.toThrow();
  });
  it('loads and verifies against a large signing-key set with certificate chains', async () => {
    // Microsoft publishes hundreds of keys, including certificate-chain metadata.
    const body = JSON.stringify({ keys: Array.from({ length: 228 }, (_, index) => ({
      ...publicJwk, kid: index === 0 ? 'test-key' : `rotated-${index}`, endorsements: ['msteams'],
      x5c: ['A'.repeat(3000)],
    })) });
    expect(Buffer.byteLength(body)).toBeGreaterThan(256 * 1024);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(body));
    const verify = createJwtVerifier(config, fetcher);
    await expect(verify.ready()).resolves.toBeUndefined();
    expect((await verify.verify(`Bearer ${await signed()}`))?.(activity)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('still bounds streamed signing-key responses without trusting content-length', async () => {
    const verify = createJwtVerifier(config, async () => new Response(' '.repeat(2 * 1024 * 1024 + 1), {
      headers: { 'content-length': '2' },
    }));
    await expect(verify.ready()).rejects.toThrow('too-large');
    expect(await verify.verify(`Bearer ${await signed()}`)).toBeNull();
  });
});
