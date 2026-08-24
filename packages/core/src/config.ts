export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface CoreConfig {
  readonly origin: string;
  readonly projectAllowlist: readonly string[];
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

const DEFAULT_ORIGIN = 'https://gitlab.com';
const TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Validates GITLAB_ORIGIN and normalises it to a bare origin.
 *
 * The application must not start with an invalid value (I4). A bad
 * origin is a deployment error, and failing at startup surfaces it
 * immediately instead of at the first pasted link.
 */
function parseOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('GITLAB_ORIGIN is not a valid URL');
  }
  if (url.protocol !== 'https:') throw new ConfigError('GITLAB_ORIGIN must use https');
  if (url.username !== '' || url.password !== '') {
    throw new ConfigError('GITLAB_ORIGIN must not contain userinfo');
  }
  if (url.pathname !== '/') throw new ConfigError('GITLAB_ORIGIN must not contain a path');
  if (url.search !== '') throw new ConfigError('GITLAB_ORIGIN must not contain a query');
  if (url.hash !== '') throw new ConfigError('GITLAB_ORIGIN must not contain a fragment');
  return url.origin;
}

export function loadCoreConfig(env: Record<string, string | undefined>): CoreConfig {
  const raw = env.GITLAB_ORIGIN;

  // A variable that is present but blank is a misconfiguration, not a
  // request for the default.
  if (raw !== undefined && raw.trim() === '') {
    throw new ConfigError('GITLAB_ORIGIN is set but empty');
  }

  const origin = parseOrigin(raw === undefined ? DEFAULT_ORIGIN : raw.trim());

  const projectAllowlist = (env.PROJECT_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    origin,
    projectAllowlist,
    timeoutMs: TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  };
}
