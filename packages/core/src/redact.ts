import { createHash } from 'node:crypto';
import type { GitLabRef } from './types.js';

const DIGEST_LENGTH = 12;

/**
 * Short, stable digest. Enough to correlate log lines for one project,
 * not enough to disclose which project it is.
 */
export function hashProjectPath(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, DIGEST_LENGTH);
}

export interface SafeLogInput {
  readonly ref?: GitLabRef;
  readonly origin: string;
  readonly outcome: string;
  readonly latencyMs: number;
}

/**
 * The only approved way to build a log record.
 *
 * Spec 7.8 forbids tokens, JWTs, full URLs, response bodies and raw
 * project paths (I11). A path such as `/acquisition/project-x/` is
 * itself confidential business information, so it is hashed rather than
 * logged, and the entity number is dropped entirely because it would
 * narrow the hash to a single item.
 */
export function safeLogFields(input: SafeLogInput): Record<string, string | number> {
  const fields: Record<string, string | number> = {
    host: new URL(input.origin).host,
    outcome: input.outcome,
    latency_ms: input.latencyMs,
  };

  if (input.ref !== undefined) {
    fields.entity = input.ref.kind;
    fields.project = hashProjectPath(input.ref.projectPath);
  }

  return fields;
}
