/**
 * LOCAL DEV SERVER — never part of a deployment.
 *
 * Runs the real Hono server with the two credential seams stubbed, for
 * local use only:
 *
 *   verifyJwt   -> accepts everything (production validates Bot Framework JWTs)
 *   lookupToken -> returns GITLAB_TOKEN (production uses the signed-in
 *                  Teams user's own OAuth token)
 *
 * Everything else is the real path: activity validation, URL validation,
 * the GitLab client, the card builder.
 *
 *   GITLAB_TOKEN=<token> pnpm dev
 */
import { serve } from '@hono/node-server';
import { loadCoreConfig } from '../packages/core/src/index.js';
import { createServer } from '../packages/app/src/index.js';

const token = process.env.GITLAB_TOKEN;
if (token === undefined || token === '') {
  console.error('Set GITLAB_TOKEN to a read_api token for local testing.');
  process.exit(1);
}

const server = createServer({
  config: loadCoreConfig(process.env),
  lookupToken: async () => token,
  verifyJwt: async () => true, // LOCAL ONLY
  log: (fields) => {
    console.log(JSON.stringify(fields));
  },
});

const port = Number(process.env.PORT ?? 3978);
serve({ fetch: server.fetch, port });

console.log(`Local dev server on http://localhost:${port}`);
console.log('WARNING: JWT validation is disabled. Local use only.\n');
console.log(`curl -s localhost:${port}/api/messages -H 'content-type: application/json' -d '{"type":"invoke","name":"composeExtension/queryLink","channelId":"msteams","from":{"id":"29:local"},"value":{"url":"https://gitlab.com/gitlab-org/gitlab/-/issues/1"}}' | jq .`);
