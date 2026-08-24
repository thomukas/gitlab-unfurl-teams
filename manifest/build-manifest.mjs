#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

export function renderManifest(template, env) {
  const missing = ['BOT_ID', 'GITLAB_ORIGIN'].filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const origin = new URL(env.GITLAB_ORIGIN);
  if (origin.protocol !== 'https:') {
    throw new Error('GITLAB_ORIGIN must use https');
  }

  const values = {
    BOT_ID: env.BOT_ID,
    GITLAB_HOST: origin.host,
    DEVELOPER_NAME: env.DEVELOPER_NAME ?? 'Unknown',
    WEBSITE_URL: env.WEBSITE_URL ?? 'https://example.com',
    PRIVACY_URL: env.PRIVACY_URL ?? 'https://example.com/privacy',
    TERMS_URL: env.TERMS_URL ?? 'https://example.com/terms',
  };

  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }

  // Fail loudly rather than emitting a manifest Teams will reject.
  JSON.parse(output);
  return output;
}

// Only run when invoked directly, so the renderer stays testable.
if (process.argv[1] === here('build-manifest.mjs')) {
  try {
    const template = readFileSync(here('manifest.template.json'), 'utf8');
    const output = renderManifest(template, process.env);
    mkdirSync(here('build'), { recursive: true });
    writeFileSync(here('build/manifest.json'), output);

    // The zip must contain the three files at its ROOT, not in a folder.
    for (const icon of ['color.png', 'outline.png']) {
      copyFileSync(here(icon), here(`build/${icon}`));
    }

    const zip = here('build/gitlab-unfurl-teams.zip');
    try {
      execFileSync('zip', ['-j', '-q', zip, here('build/manifest.json'),
                           here('build/color.png'), here('build/outline.png')]);
      console.log(`Wrote ${zip}`);
    } catch {
      console.log('Wrote manifest/build/. `zip` not found — package it yourself:');
      console.log('  cd manifest/build && zip -j ../gitlab-unfurl-teams.zip manifest.json color.png outline.png');
    }
    console.log(`Host registered for unfurling: ${new URL(process.env.GITLAB_ORIGIN).host}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
