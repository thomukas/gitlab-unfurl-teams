export type EntityKind = 'merge_request' | 'issue' | 'epic';

/**
 * Which GitLab API namespace an entity lives under. Merge requests and
 * issues belong to a project; epics belong to a group. The URL shapes
 * differ too, so this is not cosmetic.
 */
export type Scope = 'project' | 'group';

export const SCOPE_OF: Readonly<Record<EntityKind, Scope>> = {
  merge_request: 'project',
  issue: 'project',
  epic: 'group',
};

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
  /** Project path for merge requests and issues; group path for epics. */
  readonly namespacePath: string;
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
  readonly namespacePath: string;
  readonly iid: number;
  readonly webUrl: string;
  readonly author: { readonly name: string };
  readonly assignees: readonly { readonly name: string }[];
  readonly labels: readonly string[];
  readonly pipeline?: { readonly status: string };
  readonly createdAt: string;
  readonly updatedAt: string;
}
