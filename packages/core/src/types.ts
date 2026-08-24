export type EntityKind = 'merge_request' | 'issue';

/**
 * A validated reference to a GitLab entity.
 *
 * Deliberately carries NO host. The request destination comes from
 * configuration only, never from user input. See invariant I2 in
 * SECURITY-REVIEW.md: untrusted input must not influence where a
 * credential is sent.
 */
export interface GitLabRef {
  readonly kind: EntityKind;
  readonly projectPath: string;
  readonly iid: number;
}

export type RejectionReason =
  | 'unparseable'
  | 'scheme'
  | 'userinfo'
  | 'encoded-separator'
  | 'origin'
  | 'shape'
  | 'iid'
  | 'allowlist'
  | 'too-long';

export type ValidationResult =
  | { readonly ok: true; readonly ref: GitLabRef }
  | { readonly ok: false; readonly reason: RejectionReason };

export interface Entity {
  readonly kind: EntityKind;
  readonly title: string;
  readonly state: string;
  readonly projectPath: string;
  readonly iid: number;
  readonly webUrl: string;
  readonly author: { readonly name: string };
  readonly assignees: readonly { readonly name: string }[];
  readonly labels: readonly string[];
  readonly pipeline?: { readonly status: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}
