import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error -- plain .mjs module without types
import { renderManifest } from '../build-manifest.mjs';

const template = readFileSync(
  fileURLToPath(new URL('../manifest.template.json', import.meta.url)),
  'utf8',
);

const env = { BOT_ID: 'bot-123', GITLAB_ORIGIN: 'https://gitlab.example.com' };

describe('renderManifest', () => {
  it('substitutes the bot id and the GitLab host', () => {
    const manifest = JSON.parse(renderManifest(template, env));
    expect(manifest.id).toBe('bot-123');
    expect(manifest.composeExtensions[0].messageHandlers[0].value.domains).toEqual([
      'gitlab.example.com',
    ]);
    expect(manifest.validDomains).toEqual(['gitlab.example.com']);
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

  it.each(['BOT_ID', 'GITLAB_ORIGIN'])('throws when %s is missing', (key) => {
    const partial: Record<string, string> = { ...env };
    delete partial[key];
    expect(() => renderManifest(template, partial)).toThrow(/Missing required/);
  });

  it('refuses a non-https origin', () => {
    expect(() => renderManifest(template, { ...env, GITLAB_ORIGIN: 'http://gitlab.example.com' }))
      .toThrow(/https/);
  });
});
