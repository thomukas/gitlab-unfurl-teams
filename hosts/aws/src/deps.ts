import { loadCoreConfig } from '@gitlab-unfurl-teams/core';
import type { ServerDeps } from '@gitlab-unfurl-teams/app';

/**
 * Both credential paths are stubs until the Bot Framework token service
 * and JWKS validation are wired, which needs live Azure resources.
 *
 * Both stubs DENY. A deployment that ships before that work refuses
 * every request rather than serving one unauthenticated. See the
 * See "Not yet implemented" in SECURITY-REVIEW.md.
 */
export function buildDeps(): ServerDeps {
  return {
    config: loadCoreConfig(process.env),
    lookupToken: async () => null,
    verifyJwt: async () => false,
    log: (fields) => {
      console.log(JSON.stringify(fields));
    },
  };
}
