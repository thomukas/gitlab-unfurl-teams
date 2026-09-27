#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv-draft-04';
import addFormats from 'ajv-formats';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(here('MicrosoftTeams.schema.json'), 'utf8')));
const oauthOrigins = ['https://token.botframework.com', 'https://europe.token.botframework.com',
  'https://unitedstates.token.botframework.com', 'https://india.token.botframework.com'];

export function renderManifest(template, env) {
  const required = ['BOT_ID', 'GITLAB_ORIGIN', 'DEVELOPER_NAME', 'WEBSITE_URL', 'PRIVACY_URL', 'TERMS_URL'];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.BOT_ID)) throw new Error('BOT_ID must be a GUID');
  const origin = new URL(env.GITLAB_ORIGIN);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('GITLAB_ORIGIN must be a bare https origin without credentials, path, query or fragment');
  }
  for (const key of ['WEBSITE_URL', 'PRIVACY_URL', 'TERMS_URL']) {
    const url = new URL(env[key]);
    if (url.protocol !== 'https:' || url.username || url.password
      || /(^|\.)(example\.(com|org|net)|localhost)$/.test(url.hostname)) {
      throw new Error(`${key} must be a real https publisher URL, not a placeholder`);
    }
  }
  if (env.DEVELOPER_NAME.trim().toLowerCase() === 'unknown') throw new Error('DEVELOPER_NAME must identify the publisher');
  const oauthOrigin = env.OAUTH_ORIGIN ?? oauthOrigins[0];
  if (!oauthOrigins.includes(oauthOrigin)) throw new Error('OAUTH_ORIGIN must be a supported Microsoft public-cloud token origin');
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(env.APP_VERSION ?? '0.1.0')) throw new Error('Invalid Teams manifest: APP_VERSION must be major.minor.patch');
  const values = { BOT_ID: env.BOT_ID, GITLAB_HOST: origin.hostname,
    OAUTH_HOST: new URL(oauthOrigin).hostname, APP_VERSION: env.APP_VERSION ?? '0.1.0',
    DEVELOPER_NAME: env.DEVELOPER_NAME, WEBSITE_URL: env.WEBSITE_URL,
    PRIVACY_URL: env.PRIVACY_URL, TERMS_URL: env.TERMS_URL };
  // Substitute values into parsed JSON, so quotes in names cannot change its structure.
  const visit = (value) => {
    if (typeof value === 'string') return value.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => {
      if (!(key in values)) throw new Error(`Unknown manifest placeholder: ${key}`);
      return values[key];
    });
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]));
    return value;
  };
  const manifest = visit(JSON.parse(template));
  if (!validate(manifest)) throw new Error(`Invalid Teams manifest: ${ajv.errorsText(validate.errors)}`);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

if (process.argv[1] === here('build-manifest.mjs')) {
  try {
    const output = renderManifest(readFileSync(here('manifest.template.json'), 'utf8'), process.env);
    mkdirSync(here('build'), { recursive: true });
    writeFileSync(here('build/manifest.json'), output);
    for (const icon of ['color.png', 'outline.png']) copyFileSync(here(icon), here(`build/${icon}`));
    const zip = here('build/gitlab-unfurl-teams.zip');
    // Never leave old files in an updated archive, or report success without a ZIP.
    rmSync(zip, { force: true });
    execFileSync('zip', ['-j', '-q', zip, here('build/manifest.json'), here('build/color.png'), here('build/outline.png')]);
    console.log(`Wrote ${zip}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
