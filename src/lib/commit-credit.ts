/** SCR-04: credit GitHub-linked primary authors, never vendor agent accounts. */
const AGENT_COMMIT_ACCOUNT_IDS: ReadonlySet<string> = new Set([
  "MDQ6VXNlcjgxODQ3", // claude (Anthropic)
  "U_kgDOD-0LXg", // codex (OpenAI)
  "U_kgDOC972lw", // cursoragent (Cursor)
  "MDQ6VXNlcjM4MjUwNTA=", // xxxxxxxxxxxxx: GitHub links the placeholder `x <x@x>` to it
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

/**
 * A recorded value assessment keeps the actor list of its collection time.
 * Credit follows the current rule. The pull-request author is never removed,
 * as in the merge-credit path that this rule does not apply to.
 */
export function creditEligibleImplementationActorIds(
  ids: readonly string[],
  authorId: string | undefined,
): string[] {
  return ids.filter(
    (id) => id === authorId || !AGENT_COMMIT_ACCOUNT_IDS.has(id),
  );
}
