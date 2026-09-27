import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { handleActivity, type HandlerDeps } from './handler.js';
import { BoundaryError, isRecord, readBounded } from './http.js';
import type { AuthorizedActivity } from './jwt.js';

export interface ServerDeps extends HandlerDeps {
  /** Verifies the signature before parsing the body; returned guard binds claims to the activity. */
  readonly verifyJwt: (authorizationHeader: string | undefined) => Promise<AuthorizedActivity | null>;
  readonly ready: () => Promise<void>;
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();
  let inFlight = 0;
  let windowStart = Date.now();
  let total = 0;
  const users = new Map<string, number>();
  let readyUntil = 0;
  let readyResult = false;
  let readyPending: Promise<void> | undefined;

  // Never let framework defaults print raw upstream exceptions or token-bearing URLs.
  app.onError((_error, c) => c.json({ error: 'service unavailable' }, 503));
  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/readyz', async (c) => {
    if (Date.now() >= readyUntil) {
      readyPending ??= deps.ready().then(() => {
        readyResult = true; readyUntil = Date.now() + 30_000;
      }, () => {
        readyResult = false; readyUntil = Date.now() + 5_000;
      }).finally(() => { readyPending = undefined; });
      await readyPending;
    }
    return c.json({ status: readyResult ? 'ready' : 'unavailable' }, readyResult ? 200 : 503);
  });

  app.post('/api/messages', async (c) => {
    const requestId = randomUUID();
    const started = Date.now();
    const signal = AbortSignal.timeout(4500);
    c.header('x-request-id', requestId);
    if (inFlight >= 40) return c.json({ error: 'busy' }, 503);
    inFlight++;
    let outcome = 'error';
    try {
      let authorize: AuthorizedActivity | null = null;
      try { authorize = await deps.verifyJwt(c.req.header('authorization')); }
      catch { /* A verifier failure is a denial. */ }
      if (!authorize) { outcome = 'unauthorized'; return c.json({ error: 'unauthorized' }, 401); }
      let activity: unknown;
      try {
        const raw = await readBounded(c.req.raw.body, 64 * 1024, signal);
        activity = JSON.parse(raw) as unknown;
      } catch (error) {
        if (signal.aborted) { outcome = 'timeout'; return c.json({ error: 'timeout' }, 503); }
        if (error instanceof BoundaryError && error.category === 'too-large') {
          outcome = 'too-large'; return c.json({ error: 'payload too large' }, 413);
        }
        outcome = 'bad-request'; return c.json({ error: 'bad request' }, 400);
      }
      if (!authorize(activity)) { outcome = 'forbidden'; return c.json({ error: 'forbidden' }, 403); }
      // Per-process guards. A shared gateway limit is still needed across replicas.
      if (Date.now() - windowStart >= 60_000) {
        users.clear(); total = 0; windowStart = Date.now();
      }
      const user = isRecord(activity) && isRecord(activity.from) && typeof activity.from.id === 'string' ? activity.from.id : '';
      const count = users.get(user) ?? 0;
      if (total >= 600 || count >= 30) {
        outcome = 'rate-limited'; c.header('retry-after', '60');
        return c.json({ error: 'rate limited' }, 429);
      }
      users.set(user, count + 1); total++;
      const result = await handleActivity(activity, { ...deps, signal });
      signal.throwIfAborted();
      outcome = 'ok';
      if (isRecord(activity) && activity.name === 'signin/verifyState' && isRecord(result)) {
        return c.json({}, result.status === 200 ? 200 : 401);
      }
      return c.json(result);
    } catch {
      outcome = signal.aborted ? 'timeout' : 'dependency-unavailable';
      return c.json({ error: 'service unavailable', requestId }, 503);
    } finally {
      inFlight--;
      deps.log?.({ event: 'request', request_id: requestId, outcome, latency_ms: Date.now() - started });
    }
  });
  return app;
}
