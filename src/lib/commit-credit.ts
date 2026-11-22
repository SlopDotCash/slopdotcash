/** SCR-04: credit GitHub-linked primary authors, never vendor agent accounts. */
const AGENT_COMMIT_ACCOUNT_IDS: ReadonlySet<string> = new Set([
  "MDQ6VXNlcjgxODQ3", // claude (Anthropic)
  "U_kgDOD-0LXg", // codex (OpenAI)
  "U_kgDOC972lw", // cursoragent (Cursor)
]);

export function isCreditEligibleCommitAuthor(
  actor: { id: string; kind: string } | null,
): boolean {
  return (
    actor !== null &&
    actor.kind !== "Bot" &&
    !AGENT_COMMIT_ACCOUNT_IDS.has(actor.id)
  );
}

/** Attribute implementation to primary commit authors, not the PR carrier.
 * A source PR's creator remains the fallback for an unlinked or agent-authored
 * commit. Callers that prove a retained copy must pass the original source
 * creator, so that fallback never transfers to the maintainer carrying it.
 */
export function implementationCreditActors<
  Actor extends { id: string; kind: string },
>(
  sourceAuthor: Actor | null,
  commitAuthors: readonly (Actor | null)[],
): Actor[] {
  const fallback = isCreditEligibleCommitAuthor(sourceAuthor)
    ? sourceAuthor
    : null;
  const actors = new Map<string, Actor>();
  for (const author of commitAuthors) {
    const credited = isCreditEligibleCommitAuthor(author) ? author : fallback;
    if (credited) actors.set(credited.id, credited);
  }
  if (commitAuthors.length === 0 && fallback) actors.set(fallback.id, fallback);
  return [...actors.values()].sort((left, right) =>
    left.id === sourceAuthor?.id
      ? -1
      : right.id === sourceAuthor?.id
        ? 1
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0,
  );
}

/** A carried diff cannot be assigned to an empty commit's author. Zero-line
 * commits with verified changed paths can still provide independent evidence. */
export function isUnprovedZeroLinePromotion<
  Commit extends {
    parentCount?: number;
    additions?: number | null;
    deletions?: number | null;
    files?: readonly unknown[];
  },
>(commits: readonly Commit[], owns: (commit: Commit) => boolean): boolean {
  let emptyMarker = false;
  let carriedChanges = false;
  for (const commit of commits) {
    if (commit.parentCount === undefined) return false;
    if (commit.parentCount > 1) continue;
    if (owns(commit)) {
      if (
        commit.additions !== 0 ||
        commit.deletions !== 0 ||
        commit.files?.length
      )
        return false;
      emptyMarker = true;
    } else if ((commit.additions ?? 0) > 0 || (commit.deletions ?? 0) > 0) {
      carriedChanges = true;
    }
  }
  return emptyMarker && carriedChanges;
}

/** Complete GitHub additions/deletions are allocation weights, never value.
 * Callers provide each first-accepted, non-merge commit once and substitute a
 * verified original author before calling this for retained copies.
 */
export function implementationLineWeights<
  Actor extends { id: string; kind: string },
>(
  sourceAuthor: Actor | null,
  commits: readonly {
    author: Actor | null;
    additions?: number;
    deletions?: number;
  }[],
): Map<string, bigint> | null {
  const weights = new Map<string, bigint>();
  for (const commit of commits) {
    const actors = implementationCreditActors(sourceAuthor, [commit.author]);
    if (actors.length === 0) continue;
    if (
      !Number.isSafeInteger(commit.additions) ||
      !Number.isSafeInteger(commit.deletions) ||
      (commit.additions as number) < 0 ||
      (commit.deletions as number) < 0
    )
      return null;
    const lines =
      BigInt(commit.additions as number) + BigInt(commit.deletions as number);
    const actor = actors[0];
    weights.set(actor.id, (weights.get(actor.id) ?? 0n) + lines);
  }
  return weights;
}
