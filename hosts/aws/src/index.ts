import { handle } from 'hono/aws-lambda';
import { createServer } from '@gitlab-unfurl-teams/app';
import { buildDeps } from './deps.js';

export const handler = handle(createServer(buildDeps()));
