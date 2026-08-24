/**
 * Segment-wise containment.
 *
 * `company/platform` allows `company/platform` and `company/platform/api`,
 * but never `company/platform-evil`. String prefix matching would allow
 * that sibling, which is why this compares path segments.
 *
 * This is a blast-radius control, not a security boundary. GitLab stays
 * authoritative for access (I8): a user who cannot see a project gets no
 * card whether or not the allowlist permits it.
 */
export function isAllowed(namespacePath: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;

  const actual = namespacePath.split('/');

  return allowlist.some((entry) => {
    const wanted = entry.split('/');
    if (wanted.length > actual.length) return false;
    return wanted.every((segment, index) => segment === actual[index]);
  });
}
