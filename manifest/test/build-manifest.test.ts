import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain .mjs module without types
import { renderManifest } from '../build-manifest.mjs';

const template = readFileSync(
  fileURLToPath(new URL('../manifest.template.json', import.meta.url)),
  'utf8',
);

const env = { BOT_ID: '11111111-1111-4111-8111-111111111111', GITLAB_ORIGIN: 'https://gitlab.example.com', DEVELOPER_NAME: 'Company IT', WEBSITE_URL: 'https://company.internal/support', PRIVACY_URL: 'https://company.internal/privacy', TERMS_URL: 'https://company.internal/terms' };

describe('renderManifest', () => {
  it('substitutes the bot id and the GitLab host', () => {
    const manifest = JSON.parse(renderManifest(template, env));
    expect(manifest.id).toBe(env.BOT_ID);
    expect(manifest.composeExtensions[0].messageHandlers[0].value.domains).toEqual([
      'gitlab.example.com',
    ]);
    expect(manifest.validDomains).toEqual(['gitlab.example.com', 'token.botframework.com']);
  });

  it('registers the exact host, never a wildcard', () => {
    const domains = JSON.parse(renderManifest(template, env)).validDomains;
    expect(domains[0]).not.toContain('*');
  });

  // Deliberately absent: an anonymous invoke carries no user identity,
  // so there would be no token to act with. Spec section 2.
  it('never enables supportsAnonymizedPayloads', () => {
    expect(renderManifest(template, env)).not.toContain('supportsAnonymizedPayloads');
  });

  it('leaves no unsubstituted placeholder', () => {
    expect(renderManifest(template, env)).not.toContain('{{');
  });

  it.each(['BOT_ID', 'GITLAB_ORIGIN', 'DEVELOPER_NAME', 'WEBSITE_URL', 'PRIVACY_URL', 'TERMS_URL'])('throws when %s is missing', (key) => {
    const partial: Record<string, string> = { ...env };
    delete partial[key];
    expect(() => renderManifest(template, partial)).toThrow(/Missing required/);
  });

  it('refuses a non-https origin', () => {
    expect(() => renderManifest(template, { ...env, GITLAB_ORIGIN: 'http://gitlab.example.com' }))
      .toThrow(/https/);
  });
});

describe('production manifest validation', () => {
  it('escapes publisher strings without changing JSON structure', () => {
    expect(JSON.parse(renderManifest(template, { ...env, DEVELOPER_NAME: 'Company "R&D"' })).developer.name).toBe('Company "R&D"');
  });
  it('rejects invalid bot IDs rather than making an uploadable-looking ZIP', () => {
    expect(() => renderManifest(template, { ...env, BOT_ID: 'ci-placeholder' })).toThrow(/GUID/);
  });
  it('rejects placeholder privacy information', () => {
    expect(() => renderManifest(template, { ...env, PRIVACY_URL: 'https://example.com/privacy' })).toThrow(/placeholder/);
  });
  it('checks the actual versioned Teams schema', () => {
    expect(() => renderManifest(template, { ...env, APP_VERSION: 'not-a-version' })).toThrow(/Invalid Teams manifest/);
    const bad = JSON.stringify({ ...JSON.parse(template), unexpectedProperty: true });
    expect(() => renderManifest(bad, env)).toThrow(/Invalid Teams manifest/);
  });
  it('keeps the selected OAuth region in validDomains', () => {
    expect(JSON.parse(renderManifest(template, { ...env, OAUTH_ORIGIN: 'https://europe.token.botframework.com' })).validDomains).toContain('europe.token.botframework.com');
  });
  it('rejects OAuth endpoints outside the Microsoft allowlist', () => {
    expect(() => renderManifest(template, { ...env, OAUTH_ORIGIN: 'https://evil.example' })).toThrow(/OAUTH_ORIGIN/);
  });
  it.each(['https://gitlab.example.com/path', 'https://user:pass@gitlab.example.com', 'https://gitlab.example.com/?x=1'])('rejects an origin the runtime would reject: %s', (origin) => {
    expect(() => renderManifest(template, { ...env, GITLAB_ORIGIN: origin })).toThrow(/GITLAB_ORIGIN/);
  });
});
