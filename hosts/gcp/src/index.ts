import { serve } from '@hono/node-server';
import { createServer } from '@gitlab-unfurl-teams/app';
import { buildDeps } from './deps.js';

const port = Number(process.env.PORT ?? 8080);

serve({ fetch: createServer(buildDeps()).fetch, port });
console.log(JSON.stringify({ event: 'listening', port }));
