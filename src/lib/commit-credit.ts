/** SCR-04: credit GitHub-linked primary authors, never vendor agent accounts. */
const AGENT_COMMIT_ACCOUNT_IDS: ReadonlySet<string> = new Set([
  "MDQ6VXNlcjgxODQ3", // claude (Anthropic)
  "U_kgDOD-0LXg", // codex (OpenAI)
  "U_kgDOC972lw", // cursoragent (Cursor)
]);

/**
 * GitHub links the placeholder commit identity `x <x@x>` to this account.
 * Scoring drops it. Value collection still lists it, so recorded evidence
 * keeps the source digest that its assessment was made from.
 */
const PLACEHOLDER_COMMIT_ACCOUNT_IDS: ReadonlySet<string> = new Set([
  "MDQ6VXNlcjM4MjUwNTA=", // xxxxxxxxxxxxx
]);

/** Value collection: a commit author that recorded evidence lists. */
export function isCreditEligibleCommitAuthor(
  actor: { id: string; kind: string } | null,
): boolean {
  return (
    actor !== null &&
    actor.kind !== "Bot" &&
    !AGENT_COMMIT_ACCOUNT_IDS.has(actor.id)
  );
}

/** Merge scoring: a listed commit author that is not a placeholder account. */
export function isMergeCreditCommitAuthor(
  actor: { id: string; kind: string } | null,
): boolean {
  return (
    actor !== null &&
    isCreditEligibleCommitAuthor(actor) &&
    !PLACEHOLDER_COMMIT_ACCOUNT_IDS.has(actor.id)
  );
}

/**
 * Drops placeholder accounts from the actor list of a recorded assessment,
 * except the given pull-request author.
 */
export function scoredImplementationActorIds(
  ids: readonly string[],
  authorId: string | undefined,
): string[] {
  return ids.filter(
    (id) => id === authorId || !PLACEHOLDER_COMMIT_ACCOUNT_IDS.has(id),
  );
}
