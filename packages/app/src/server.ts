import { Hono } from 'hono';
import { handleQueryLink, type HandlerDeps } from './handler.js';

export interface ServerDeps extends HandlerDeps {
  /**
   * Bot Framework JWT validation (I5). Supplied by the host, because the
   * JWKS fetch and cache belong to the deployment rather than to this
   * package. Must validate signature, issuer, audience, lifetime and
   * algorithm.
   */
  readonly verifyJwt: (authorizationHeader: string | undefined) => Promise<boolean>;
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ status: 'ok' }));

  app.post('/api/messages', async (c) => {
    // Authenticate before touching the body. A caller that fails
    // verification learns nothing about how we parse input.
    let authenticated = false;
    try {
      authenticated = await deps.verifyJwt(c.req.header('authorization'));
    } catch {
      // A verifier that throws (unreachable JWKS, malformed token) is a
      // denial, never an allow.
      authenticated = false;
    }
    if (!authenticated) return c.json({ error: 'unauthorized' }, 401);

    let activity: unknown;
    try {
      activity = await c.req.json();
    } catch {
      return c.json({ error: 'bad request' }, 400);
    }

    return c.json(await handleQueryLink(activity, deps));
  });

  return app;
}
