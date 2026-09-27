import { loadCoreConfig } from '@gitlab-unfurl-teams/core';
import { loadBotConfig } from './bot-config.js';
import { createJwtVerifier } from './jwt.js';
import { createTokenService } from './token-service.js';
import type { ServerDeps } from './server.js';

export function buildProductionDeps(env: Record<string, string | undefined> = process.env): ServerDeps {
  const config = loadCoreConfig(env);
  const bot = loadBotConfig(env, config.previewMode === 'metadata');
  const verifier = createJwtVerifier(bot);
  const tokens = createTokenService(bot);
  return {
    config, verifyJwt: verifier.verify,
    lookupToken: tokens.lookup, getSignInUrl: tokens.signInUrl, signOut: tokens.signOut,
    ready: async () => {
      await verifier.ready();
      if (config.previewMode === 'metadata') await tokens.ready();
    },
    log: (fields) => { console.log(JSON.stringify(fields)); },
  };
}
