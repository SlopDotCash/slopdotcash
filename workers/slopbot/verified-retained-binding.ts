/** Complete reachability of the captured parent graph, including cycles. */
//@ verify
//@ requires -1 <= start && start < graph.length
//@ requires forall(i, 0 <= i && i < graph.length ==> forall(j, 0 <= j && j < graph[i].length ==> 0 <= graph[i][j] && graph[i][j] < graph.length))
//@ ensures \result.length == graph.length
//@ ensures forall(i, 0 <= i && i < graph.length ==> (\result[i] <==> GraphReachable(graph, start, i)))
export function retainedAncestors(
  graph: readonly number[][],
  start: number,
): boolean[] {
  const seen: boolean[] = [];
  let i = 0;
  while (i < graph.length) {
    //@ invariant 0 <= i && i <= graph.length
    //@ invariant seen.length == i
    //@ invariant forall(k, 0 <= k && k < i ==> !seen[k])
    seen.push(false);
    i += 1;
  }
  if (start < 0) return seen;
  seen[start] = true;
  const queue: number[] = [start];
  let head = 0;
  while (head < graph.length && head < queue.length) {
    //@ invariant 0 <= head && head <= queue.length && queue.length <= graph.length
    //@ invariant seen.length == graph.length && seen[start]
    //@ invariant queue.length == SeenCount(seen)
    //@ invariant forall(k, 0 <= k && k < queue.length ==> 0 <= queue[k] && queue[k] < graph.length && GraphReachable(graph, start, queue[k]))
    //@ invariant forall(k, 0 <= k && k < graph.length ==> (seen[k] <==> IndexListed(queue, k)))
    //@ invariant forall(k, 0 <= k && k < head ==> forall(j, 0 <= j && j < graph[queue[k]].length ==> seen[graph[queue[k]][j]]))
    const vertex = queue[head];
    let j = 0;
    while (j < graph[vertex].length) {
      //@ invariant 0 <= j && j <= graph[vertex].length
      //@ invariant 0 <= head && head < queue.length && queue.length <= graph.length
      //@ invariant seen.length == graph.length && seen[start]
      //@ invariant vertex == queue[head] && GraphReachable(graph, start, vertex)
      //@ invariant queue.length == SeenCount(seen)
      //@ invariant forall(k, 0 <= k && k < queue.length ==> 0 <= queue[k] && queue[k] < graph.length && GraphReachable(graph, start, queue[k]))
      //@ invariant forall(k, 0 <= k && k < graph.length ==> (seen[k] <==> IndexListed(queue, k)))
      //@ invariant forall(k, 0 <= k && k < head ==> forall(p, 0 <= p && p < graph[queue[k]].length ==> seen[graph[queue[k]][p]]))
      //@ invariant forall(k, 0 <= k && k < j ==> seen[graph[vertex][k]])
      const next = graph[vertex][j];
      if (!seen[next]) {
        seen[next] = true;
        queue.push(next);
      }
      j += 1;
    }
    head += 1;
  }
  return seen;
}

//@ verify
//@ ensures \result <==> HunkListed(values, target)
function hunkListed(values: readonly string[], target: string): boolean {
  let i = 0;
  while (i < values.length) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant !HunkListed(values.slice(0, i), target)
    if (values[i] === target) return true;
    i += 1;
  }
  return false;
}

export type HunkDifference =
  | { kind: "invalid" }
  | { kind: "subset"; missing: number[] };

/** The copy must retain a nonempty proper subset in the original hunk order. */
//@ verify
//@ ensures (\result.kind == "subset") <==> ProperHunkSubset(before, after)
//@ ensures \result.kind == "subset" ==> \result.missing == MissingHunkIndices(before, after)
//@ ensures \result.kind == "subset" ==> forall(i, 0 <= i && i < \result.missing.length ==> 0 <= \result.missing[i] && \result.missing[i] < before.length)
export function orderedHunkDifference(
  before: readonly string[],
  after: readonly string[],
): HunkDifference {
  if (after.length === 0 || after.length >= before.length)
    return { kind: "invalid" };
  const kept: string[] = [];
  const missing: number[] = [];
  let i = 0;
  while (i < before.length) {
    //@ invariant 0 <= i && i <= before.length
    //@ invariant kept == KeptHunks(before.slice(0, i), after)
    //@ invariant missing == MissingHunkIndices(before.slice(0, i), after)
    //@ invariant forall(k, 0 <= k && k < missing.length ==> 0 <= missing[k] && missing[k] < i)
    if (hunkListed(after, before[i])) kept.push(before[i]);
    else missing.push(i);
    i += 1;
  }
  if (kept.length !== after.length) return { kind: "invalid" };
  i = 0;
  while (i < after.length) {
    //@ invariant 0 <= i && i <= after.length
    //@ invariant kept.length == after.length
    //@ invariant forall(k, 0 <= k && k < i ==> kept[k] == after[k])
    if (kept[i] !== after[i]) return { kind: "invalid" };
    i += 1;
  }
  return { kind: "subset", missing };
}

export type ParsedHunks =
  | { kind: "unavailable" }
  | { kind: "parsed"; values: string[] };
export interface CandidateHunkFile {
  path: string;
  hunks: ParsedHunks;
}
export interface HunkCandidate {
  sha: string;
  vertex: number;
  limitations: number;
  files: CandidateHunkFile[];
}
export type HunkBindings =
  | { kind: "ambiguous" }
  | { kind: "bound"; candidates: number[] };

//@ verify
//@ ensures \result <==> CandidateHasHunk(candidate, path, hunk)
function candidateHasHunk(
  candidate: HunkCandidate,
  path: string,
  hunk: string,
): boolean {
  let i = 0;
  while (i < candidate.files.length) {
    //@ invariant 0 <= i && i <= candidate.files.length
    //@ invariant forall(k, 0 <= k && k < i ==> !FileHasHunk(candidate.files[k], path, hunk))
    const file = candidate.files[i];
    if (file.path === path && file.hunks.kind === "parsed") {
      if (hunkListed(file.hunks.values, hunk)) return true;
    }
    i += 1;
  }
  return false;
}

/** Every missing hunk requires exactly one complete captured ancestor attribution. */
//@ verify
//@ requires -1 <= start && start < graph.length
//@ requires forall(i, 0 <= i && i < graph.length ==> forall(j, 0 <= j && j < graph[i].length ==> 0 <= graph[i][j] && graph[i][j] < graph.length))
//@ requires forall(i, 0 <= i && i < candidates.length ==> -1 <= candidates[i].vertex && candidates[i].vertex < graph.length)
//@ requires forall(i, 0 <= i && i < missing.length ==> 0 <= missing[i] && missing[i] < before.length)
//@ ensures (\result.kind == "bound") <==> AllUniqueHunks(graph, start, acceptedSha, path, before, missing, candidates)
//@ ensures \result.kind == "bound" ==> \result.candidates == HunkBindingIndices(graph, start, acceptedSha, path, before, missing, candidates)
//@ ensures \result.kind == "bound" ==> forall(i, 0 <= i && i < \result.candidates.length ==> 0 <= \result.candidates[i] && \result.candidates[i] < candidates.length)
export function uniqueHunkBindings(
  graph: readonly number[][],
  start: number,
  acceptedSha: string,
  path: string,
  before: readonly string[],
  missing: readonly number[],
  candidates: readonly HunkCandidate[],
): HunkBindings {
  const ancestors = retainedAncestors(graph, start);
  const selected: number[] = [];
  let i = 0;
  while (i < missing.length) {
    //@ invariant 0 <= i && i <= missing.length
    //@ invariant AllUniqueHunks(graph, start, acceptedSha, path, before, missing.slice(0, i), candidates)
    //@ invariant selected == HunkBindingIndices(graph, start, acceptedSha, path, before, missing.slice(0, i), candidates)
    //@ invariant forall(k, 0 <= k && k < selected.length ==> 0 <= selected[k] && selected[k] < candidates.length)
    const hunk = before[missing[i]];
    let count = 0;
    let found = -1;
    let j = 0;
    while (j < candidates.length) {
      //@ invariant 0 <= j && j <= candidates.length
      //@ invariant count == CandidateMatchCount(graph, start, acceptedSha, path, hunk, candidates.slice(0, j))
      //@ invariant found == LastCandidateMatch(graph, start, acceptedSha, path, hunk, candidates.slice(0, j))
      //@ invariant -1 <= found && found < j
      const candidate = candidates[j];
      if (
        candidate.sha !== acceptedSha &&
        candidate.limitations === 0 &&
        candidate.vertex >= 0
      ) {
        if (
          ancestors[candidate.vertex] &&
          candidateHasHunk(candidate, path, hunk)
        ) {
          count += 1;
          found = j;
        }
      }
      j += 1;
    }
    if (count !== 1) return { kind: "ambiguous" };
    selected.push(found);
    i += 1;
  }
  return { kind: "bound", candidates: selected };
}
