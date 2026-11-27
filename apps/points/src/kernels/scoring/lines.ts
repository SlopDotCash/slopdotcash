//@ backend dafny
// spec/points/authorship.md, "A verified October carry goes to the original contributor; otherwise primary authorship precedes the fallbacks"; spec/points/authorship.md, "Recipient line weights sum additions plus deletions over claimed commit paths"; spec/points/authorship.md, "Only accepted unique commits contribute line weight, a merge only through its one merge resolution"
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced in Dafny //@ ensures contract
import { type ActorKind, eligibleKind, linesFor } from "../../../gen/points__authorship.ts";

export interface CommitActor { id: string; kind: string }

export interface AuthoredCommit { author: CommitActor | null; additions: number; deletions: number }

export interface MergedCommit {
  oid: string;
  author: CommitActor | null;
  retainedAuthor: CommitActor | null;
  parentCount: number;
  owned: boolean;
  additions: number;
  deletions: number;
}

export interface LineWeight { actorId: string; lines: number }

export type LineWeights = { kind: "weights"; weights: LineWeight[] } | { kind: "incomplete" };

/** @throws {never} */
//@ pure
export function isAgentAccount(id: string): boolean {
  return id === "MDQ6VXNlcjgxODQ3" || id === "U_kgDOD-0LXg" || id === "U_kgDOC972lw";
}

/** @throws {never} */
//@ pure
export function commitActorKind(actor: CommitActor): ActorKind {
  return actor.kind === "Bot" ? "Bot" : isAgentAccount(actor.id) ? "VendorAgent" : "User";
}

/** @throws {never} */
//@ pure
export function isCreditEligibleCommitAuthor(actor: CommitActor | null): boolean {
  if (actor === null) return false;
  return actor.kind !== "Bot" && !isAgentAccount(actor.id);
}

/** @throws {never} */
export function lineWeight(additions: number, deletions: number): number {
  //@ requires additions >= 0 && deletions >= 0
  //@ ensures \result === additions + deletions
  //@ ensures \result === linesFor([{ claim: 1, actor: 1, creditedActors: 1, actorsKnown: true, file: 7, merge: false, resolutions: 0, attributed: true, limited: false, fileFound: true, additions: additions, deletions: deletions }], 1)
  return additions + deletions;
}

/** @throws {never} */
export function compareCodeUnits(left: string, right: string): number {
  let i = 0;
  while (i < left.length && i < right.length) {
    //@ invariant 0 <= i && i <= left.length && i <= right.length
    const a = left.charCodeAt(i);
    const b = right.charCodeAt(i);
    if (a !== b) return a < b ? -1 : 1;
    i = i + 1;
  }
  return left.length === right.length ? 0 : (left.length < right.length ? -1 : 1);
}

/** @throws {never} */
export function creditedBefore(left: CommitActor, right: CommitActor, sourceId: string): boolean {
  if (left.id === sourceId) return true;
  if (right.id === sourceId) return false;
  return compareCodeUnits(left.id, right.id) < 0;
}

/** @throws {never} */
export function withActor(actors: CommitActor[], actor: CommitActor): CommitActor[] {
  const out: CommitActor[] = [];
  let found = false;
  for (const existing of actors) {
    if (existing.id === actor.id) {
      out.push(actor);
      found = true;
    } else {
      out.push(existing);
    }
  }
  if (!found) out.push(actor);
  return out;
}

/** @throws {never} */
export function sortCredited(actors: CommitActor[], sourceId: string): CommitActor[] {
  let sorted: CommitActor[] = [];
  for (const actor of actors) {
    const next: CommitActor[] = [];
    let placed = false;
    for (const existing of sorted) {
      if (!placed && creditedBefore(actor, existing, sourceId)) {
        next.push(actor);
        placed = true;
      }
      next.push(existing);
    }
    if (!placed) next.push(actor);
    sorted = next;
  }
  return sorted;
}

/** @throws {never} */
export function implementationCreditActors(sourceAuthor: CommitActor | null, commitAuthors: (CommitActor | null)[]): CommitActor[] {
  const fallback: CommitActor | null = isCreditEligibleCommitAuthor(sourceAuthor) ? sourceAuthor : null;
  let actors: CommitActor[] = [];
  for (const author of commitAuthors) {
    const credited: CommitActor | null = isCreditEligibleCommitAuthor(author) ? author : fallback;
    if (credited !== null) actors = withActor(actors, credited);
  }
  if (commitAuthors.length === 0 && fallback !== null) actors = withActor(actors, fallback);
  return sortCredited(actors, sourceAuthor === null ? "" : sourceAuthor.id);
}

/** @throws {never} */
export function addLines(weights: LineWeight[], actorId: string, lines: number): LineWeight[] {
  //@ requires lines >= 0
  const out: LineWeight[] = [];
  let found = false;
  for (const weight of weights) {
    if (weight.actorId === actorId) {
      out.push({ actorId: actorId, lines: weight.lines + lines });
      found = true;
    } else {
      out.push(weight);
    }
  }
  if (!found) out.push({ actorId: actorId, lines: lines });
  return out;
}

/** @throws {never} */
export function completeCount(count: number): boolean {
  //@ ensures \result ==> count >= 0
  return Number.isSafeInteger(count) && count >= 0;
}

/** @throws {never} */
export function implementationLineWeights(sourceAuthor: CommitActor | null, commits: AuthoredCommit[]): LineWeights {
  let weights: LineWeight[] = [];
  for (const commit of commits) {
    const actors = implementationCreditActors(sourceAuthor, [commit.author]);
    if (actors.length > 0) {
      if (!completeCount(commit.additions) || !completeCount(commit.deletions)) return { kind: "incomplete" };
      weights = addLines(weights, actors[0].id, lineWeight(commit.additions, commit.deletions));
    }
  }
  return { kind: "weights", weights: weights };
}

/** @throws {never} */
export function creditedCommitAuthor(commit: MergedCommit): CommitActor | null {
  //@ ensures isCreditEligibleCommitAuthor(commit.author) ==> \result === commit.author
  if (isCreditEligibleCommitAuthor(commit.author)) return commit.author;
  return commit.retainedAuthor !== null ? commit.retainedAuthor : commit.author;
}

/** @throws {never} */
export function ownsNoImplementation(commits: MergedCommit[]): boolean {
  if (commits.length === 0) return false;
  let ordinary = false;
  for (const commit of commits) {
    if (commit.parentCount < 0) return false;
    if (commit.parentCount <= 1) {
      if (commit.owned) return false;
      ordinary = true;
    }
  }
  return ordinary;
}

/** @throws {never} */
export function mergeCreditActors(pullAuthor: CommitActor | null, commits: MergedCommit[]): CommitActor[] {
  const author = pullAuthor !== null && pullAuthor.kind !== "Bot" ? pullAuthor : null;
  if (ownsNoImplementation(commits)) return [];
  const authors: (CommitActor | null)[] = [];
  for (const commit of commits) {
    if (commit.parentCount <= 1 && commit.owned) authors.push(creditedCommitAuthor(commit));
  }
  return implementationCreditActors(author, authors);
}

/** @throws {never} */
export function seenOid(oids: string[], oid: string): boolean {
  for (const seen of oids) {
    if (seen === oid) return true;
  }
  return false;
}

/** @throws {never} */
export function mergeCreditLineWeights(pullAuthor: CommitActor | null, commits: MergedCommit[]): LineWeights {
  if (commits.length === 0) return { kind: "incomplete" };
  for (const commit of commits) {
    if (commit.parentCount < 0) return { kind: "incomplete" };
  }
  const oids: string[] = [];
  const owned: AuthoredCommit[] = [];
  for (const commit of commits) {
    if (commit.parentCount <= 1 && commit.owned && !seenOid(oids, commit.oid)) {
      oids.push(commit.oid);
      owned.push({ author: creditedCommitAuthor(commit), additions: commit.additions, deletions: commit.deletions });
    }
  }
  if (owned.length === 0) return { kind: "incomplete" };
  return implementationLineWeights(pullAuthor, owned);
}
