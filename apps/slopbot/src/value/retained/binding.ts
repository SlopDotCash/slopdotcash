//@ backend dafny
// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"

export interface Ancestry {
  complete: boolean;
  seen: boolean[];
  depth: number[];
  parent: number[];
  edge: number[];
}

export interface Ranking {
  acyclic: boolean;
  rank: number[];
}

export type HunkDifference = { kind: "invalid" } | { kind: "subset"; missing: number[] };

export type ParsedHunks = { kind: "unavailable" } | { kind: "parsed"; values: string[] };

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

export type HunkBindings = { kind: "ambiguous" } | { kind: "bound"; candidates: number[] };

/** @throws {never} */
export function retainedAncestors(graph: readonly number[][], start: number): Ancestry {
  //@ requires -1 <= start && start < graph.length
  //@ requires forall(i, 0 <= i && i < graph.length ==> forall(j, 0 <= j && j < graph[i].length ==> 0 <= graph[i][j] && graph[i][j] < graph.length))
  //@ ensures \result.seen.length === graph.length && \result.depth.length === graph.length && \result.parent.length === graph.length && \result.edge.length === graph.length
  //@ ensures start < 0 ==> \result.complete && forall(i, 0 <= i && i < graph.length ==> !\result.seen[i])
  //@ ensures start >= 0 ==> \result.seen[start] && \result.depth[start] === 0
  //@ ensures forall(i, 0 <= i && i < graph.length && \result.seen[i] ==> \result.depth[i] >= 0)
  //@ ensures forall(i, 0 <= i && i < graph.length && \result.seen[i] && i !== start ==> 0 <= \result.parent[i] && \result.parent[i] < graph.length && \result.seen[\result.parent[i]] && \result.depth[\result.parent[i]] < \result.depth[i] && 0 <= \result.edge[i] && \result.edge[i] < graph[\result.parent[i]].length && graph[\result.parent[i]][\result.edge[i]] === i)
  //@ ensures \result.complete ==> forall(i, 0 <= i && i < graph.length && \result.seen[i] ==> forall(e, 0 <= e && e < graph[i].length ==> \result.seen[graph[i][e]]))
  const seen: boolean[] = [];
  const depth: number[] = [];
  const parent: number[] = [];
  const edge: number[] = [];
  let i = 0;
  while (i < graph.length) {
    //@ invariant 0 <= i && i <= graph.length
    //@ invariant seen.length === i && depth.length === i && parent.length === i && edge.length === i
    //@ invariant forall(k, 0 <= k && k < i ==> !seen[k] && depth[k] === 0)
    //@ decreases graph.length - i
    seen.push(false);
    depth.push(0);
    parent.push(-1);
    edge.push(-1);
    i = i + 1;
  }
  if (start < 0) return { complete: true, seen: seen, depth: depth, parent: parent, edge: edge };
  seen[start] = true;
  let changed = true;
  let round = 0;
  while (changed && round <= graph.length) {
    //@ invariant 0 <= round && round <= graph.length + 1
    //@ invariant seen.length === graph.length && depth.length === graph.length && parent.length === graph.length && edge.length === graph.length
    //@ invariant seen[start] && depth[start] === 0
    //@ invariant forall(k, 0 <= k && k < graph.length && seen[k] ==> depth[k] >= 0)
    //@ invariant forall(k, 0 <= k && k < graph.length && seen[k] && k !== start ==> 0 <= parent[k] && parent[k] < graph.length && seen[parent[k]] && depth[parent[k]] < depth[k] && 0 <= edge[k] && edge[k] < graph[parent[k]].length && graph[parent[k]][edge[k]] === k)
    //@ invariant !changed ==> forall(k, 0 <= k && k < graph.length && seen[k] ==> forall(e, 0 <= e && e < graph[k].length ==> seen[graph[k][e]]))
    //@ decreases graph.length + 1 - round
    changed = false;
    let v = 0;
    while (v < graph.length) {
      //@ invariant 0 <= v && v <= graph.length
      //@ invariant seen.length === graph.length && depth.length === graph.length && parent.length === graph.length && edge.length === graph.length
      //@ invariant seen[start] && depth[start] === 0
      //@ invariant forall(k, 0 <= k && k < graph.length && seen[k] ==> depth[k] >= 0)
      //@ invariant forall(k, 0 <= k && k < graph.length && seen[k] && k !== start ==> 0 <= parent[k] && parent[k] < graph.length && seen[parent[k]] && depth[parent[k]] < depth[k] && 0 <= edge[k] && edge[k] < graph[parent[k]].length && graph[parent[k]][edge[k]] === k)
      //@ invariant !changed ==> forall(k, 0 <= k && k < v && seen[k] ==> forall(e, 0 <= e && e < graph[k].length ==> seen[graph[k][e]]))
      //@ decreases graph.length - v
      if (seen[v]) {
        let e = 0;
        while (e < graph[v].length) {
          //@ invariant 0 <= e && e <= graph[v].length
          //@ invariant seen.length === graph.length && depth.length === graph.length && parent.length === graph.length && edge.length === graph.length
          //@ invariant seen[start] && depth[start] === 0 && seen[v]
          //@ invariant forall(k, 0 <= k && k < graph.length && seen[k] ==> depth[k] >= 0)
          //@ invariant forall(k, 0 <= k && k < graph.length && seen[k] && k !== start ==> 0 <= parent[k] && parent[k] < graph.length && seen[parent[k]] && depth[parent[k]] < depth[k] && 0 <= edge[k] && edge[k] < graph[parent[k]].length && graph[parent[k]][edge[k]] === k)
          //@ invariant !changed ==> forall(k, 0 <= k && k < v && seen[k] ==> forall(f, 0 <= f && f < graph[k].length ==> seen[graph[k][f]]))
          //@ invariant !changed ==> forall(f, 0 <= f && f < e ==> seen[graph[v][f]])
          //@ decreases graph[v].length - e
          const next = graph[v][e];
          if (!seen[next]) {
            seen[next] = true;
            depth[next] = depth[v] + 1;
            parent[next] = v;
            edge[next] = e;
            changed = true;
          }
          e = e + 1;
        }
      }
      v = v + 1;
    }
    round = round + 1;
  }
  return { complete: !changed, seen: seen, depth: depth, parent: parent, edge: edge };
}

/** @throws {never} */
export function commitRanks(graph: readonly number[][]): Ranking {
  //@ requires forall(i, 0 <= i && i < graph.length ==> forall(j, 0 <= j && j < graph[i].length ==> 0 <= graph[i][j] && graph[i][j] < graph.length))
  //@ ensures \result.rank.length === graph.length
  //@ ensures \result.acyclic ==> forall(i, 0 <= i && i < graph.length ==> forall(e, 0 <= e && e < graph[i].length ==> \result.rank[graph[i][e]] < \result.rank[i]))
  const rank: number[] = [];
  let i = 0;
  while (i < graph.length) {
    //@ invariant 0 <= i && i <= graph.length
    //@ invariant rank.length === i
    //@ decreases graph.length - i
    rank.push(0);
    i = i + 1;
  }
  let changed = true;
  let round = 0;
  while (changed && round <= graph.length) {
    //@ invariant 0 <= round && round <= graph.length + 1
    //@ invariant rank.length === graph.length
    //@ invariant !changed ==> forall(k, 0 <= k && k < graph.length ==> forall(e, 0 <= e && e < graph[k].length ==> rank[graph[k][e]] < rank[k]))
    //@ decreases graph.length + 1 - round
    changed = false;
    let v = 0;
    while (v < graph.length) {
      //@ invariant 0 <= v && v <= graph.length
      //@ invariant rank.length === graph.length
      //@ invariant !changed ==> forall(k, 0 <= k && k < v ==> forall(e, 0 <= e && e < graph[k].length ==> rank[graph[k][e]] < rank[k]))
      //@ decreases graph.length - v
      let e = 0;
      while (e < graph[v].length) {
        //@ invariant 0 <= e && e <= graph[v].length
        //@ invariant rank.length === graph.length
        //@ invariant !changed ==> forall(k, 0 <= k && k < v ==> forall(f, 0 <= f && f < graph[k].length ==> rank[graph[k][f]] < rank[k]))
        //@ invariant !changed ==> forall(f, 0 <= f && f < e ==> rank[graph[v][f]] < rank[v])
        //@ decreases graph[v].length - e
        const next = graph[v][e];
        if (rank[v] <= rank[next]) {
          rank[v] = rank[next] + 1;
          changed = true;
        }
        e = e + 1;
      }
      v = v + 1;
    }
    round = round + 1;
  }
  return { acyclic: !changed, rank: rank };
}

//@ pure
export function hunkIn(values: readonly string[], target: string, count: number): boolean {
  //@ requires 0 <= count && count <= values.length
  //@ decreases count
  if (count === 0) return false;
  return values[count - 1] === target || hunkIn(values, target, count - 1);
}

/** @throws {never} */
export function hunkListed(values: readonly string[], target: string): boolean {
  //@ ensures \result === hunkIn(values, target, values.length)
  let i = values.length;
  while (i > 0) {
    //@ invariant 0 <= i && i <= values.length
    //@ invariant hunkIn(values, target, values.length) === hunkIn(values, target, i)
    //@ decreases i
    if (values[i - 1] === target) return true;
    i = i - 1;
  }
  return false;
}

//@ pure
export function keptHunks(before: readonly string[], after: readonly string[], count: number): string[] {
  //@ requires 0 <= count && count <= before.length
  //@ ensures \result.length <= count
  //@ decreases count
  if (count === 0) return [];
  return hunkIn(after, before[count - 1], after.length)
    ? keptHunks(before, after, count - 1).concat([before[count - 1]])
    : keptHunks(before, after, count - 1);
}

//@ pure
export function missingHunkIndices(before: readonly string[], after: readonly string[], count: number): number[] {
  //@ requires 0 <= count && count <= before.length
  //@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < count)
  //@ decreases count
  if (count === 0) return [];
  return hunkIn(after, before[count - 1], after.length)
    ? missingHunkIndices(before, after, count - 1)
    : missingHunkIndices(before, after, count - 1).concat([count - 1]);
}

/** @throws {never} */
export function orderedHunkDifference(before: readonly string[], after: readonly string[]): HunkDifference {
  //@ ensures (\result.kind === "subset") <==> (0 < after.length && after.length < before.length && keptHunks(before, after, before.length) === after)
  //@ ensures \result.kind === "subset" ==> \result.missing === missingHunkIndices(before, after, before.length)
  //@ ensures \result.kind === "subset" ==> forall(i, 0 <= i && i < \result.missing.length ==> 0 <= \result.missing[i] && \result.missing[i] < before.length)
  if (after.length === 0 || after.length >= before.length) return { kind: "invalid" };
  const kept: string[] = [];
  const missing: number[] = [];
  let i = 0;
  while (i < before.length) {
    //@ invariant 0 <= i && i <= before.length
    //@ invariant kept === keptHunks(before, after, i)
    //@ invariant missing === missingHunkIndices(before, after, i)
    //@ invariant forall(k, 0 <= k && k < missing.length ==> 0 <= missing[k] && missing[k] < i)
    //@ decreases before.length - i
    const listed = hunkListed(after, before[i]);
    if (listed) kept.push(before[i]);
    else missing.push(i);
    i = i + 1;
  }
  if (kept.length !== after.length) return { kind: "invalid" };
  i = 0;
  while (i < after.length) {
    //@ invariant 0 <= i && i <= after.length
    //@ invariant kept.length === after.length
    //@ invariant kept === keptHunks(before, after, before.length)
    //@ invariant missing === missingHunkIndices(before, after, before.length)
    //@ invariant forall(k, 0 <= k && k < missing.length ==> 0 <= missing[k] && missing[k] < before.length)
    //@ invariant forall(k, 0 <= k && k < i ==> kept[k] === after[k])
    //@ decreases after.length - i
    if (kept[i] !== after[i]) return { kind: "invalid" };
    i = i + 1;
  }
  //@ assert kept === after
  return { kind: "subset", missing: missing };
}

//@ pure
export function fileHasHunk(file: CandidateHunkFile, path: string, hunk: string): boolean {
  return file.path === path && file.hunks.kind === "parsed" && hunkIn(file.hunks.values, hunk, file.hunks.values.length);
}

//@ pure
export function candidateHasHunkIn(candidate: HunkCandidate, path: string, hunk: string, count: number): boolean {
  //@ requires 0 <= count && count <= candidate.files.length
  //@ decreases count
  if (count === 0) return false;
  return fileHasHunk(candidate.files[count - 1], path, hunk) || candidateHasHunkIn(candidate, path, hunk, count - 1);
}

/** @throws {never} */
export function candidateHasHunk(candidate: HunkCandidate, path: string, hunk: string): boolean {
  //@ ensures \result === candidateHasHunkIn(candidate, path, hunk, candidate.files.length)
  let i = candidate.files.length;
  while (i > 0) {
    //@ invariant 0 <= i && i <= candidate.files.length
    //@ invariant candidateHasHunkIn(candidate, path, hunk, candidate.files.length) === candidateHasHunkIn(candidate, path, hunk, i)
    //@ decreases i
    const file = candidate.files[i - 1];
    if (file.path === path && file.hunks.kind === "parsed") {
      const listed = hunkListed(file.hunks.values, hunk);
      if (listed) return true;
    }
    i = i - 1;
  }
  return false;
}

//@ pure
export function matchingCandidate(ancestors: readonly boolean[], acceptedSha: string, path: string, hunk: string, candidate: HunkCandidate): boolean {
  return candidate.sha !== acceptedSha && candidate.limitations === 0 && candidate.vertex >= 0 && candidate.vertex < ancestors.length &&
    ancestors[candidate.vertex] && candidateHasHunkIn(candidate, path, hunk, candidate.files.length);
}

//@ pure
export function matchCount(ancestors: readonly boolean[], acceptedSha: string, path: string, hunk: string, candidates: readonly HunkCandidate[], count: number): number {
  //@ requires 0 <= count && count <= candidates.length
  //@ ensures 0 <= \result && \result <= count
  //@ decreases count
  if (count === 0) return 0;
  return matchCount(ancestors, acceptedSha, path, hunk, candidates, count - 1) +
    (matchingCandidate(ancestors, acceptedSha, path, hunk, candidates[count - 1]) ? 1 : 0);
}

//@ pure
export function lastMatch(ancestors: readonly boolean[], acceptedSha: string, path: string, hunk: string, candidates: readonly HunkCandidate[], count: number): number {
  //@ requires 0 <= count && count <= candidates.length
  //@ ensures -1 <= \result && \result < count
  //@ ensures (\result === -1) <==> (matchCount(ancestors, acceptedSha, path, hunk, candidates, count) === 0)
  //@ decreases count
  if (count === 0) return -1;
  return matchingCandidate(ancestors, acceptedSha, path, hunk, candidates[count - 1])
    ? count - 1
    : lastMatch(ancestors, acceptedSha, path, hunk, candidates, count - 1);
}

//@ pure
export function allUniqueHunks(ancestors: readonly boolean[], acceptedSha: string, path: string, before: readonly string[], missing: readonly number[], candidates: readonly HunkCandidate[], count: number): boolean {
  //@ requires 0 <= count && count <= missing.length
  //@ decreases count
  if (count === 0) return true;
  return allUniqueHunks(ancestors, acceptedSha, path, before, missing, candidates, count - 1) &&
    0 <= missing[count - 1] && missing[count - 1] < before.length &&
    matchCount(ancestors, acceptedSha, path, before[missing[count - 1]], candidates, candidates.length) === 1;
}

//@ pure
export function hunkBindingIndices(ancestors: readonly boolean[], acceptedSha: string, path: string, before: readonly string[], missing: readonly number[], candidates: readonly HunkCandidate[], count: number): number[] {
  //@ requires 0 <= count && count <= missing.length
  //@ requires forall(i, 0 <= i && i < missing.length ==> 0 <= missing[i] && missing[i] < before.length)
  //@ decreases count
  if (count === 0) return [];
  return hunkBindingIndices(ancestors, acceptedSha, path, before, missing, candidates, count - 1)
    .concat([lastMatch(ancestors, acceptedSha, path, before[missing[count - 1]], candidates, candidates.length)]);
}

/** @throws {never} */
export function uniqueHunkBindings(
  ancestors: readonly boolean[],
  acceptedSha: string,
  path: string,
  before: readonly string[],
  missing: readonly number[],
  candidates: readonly HunkCandidate[],
): HunkBindings {
  //@ requires forall(i, 0 <= i && i < missing.length ==> 0 <= missing[i] && missing[i] < before.length)
  //@ ensures (\result.kind === "bound") <==> allUniqueHunks(ancestors, acceptedSha, path, before, missing, candidates, missing.length)
  //@ ensures \result.kind === "bound" ==> \result.candidates === hunkBindingIndices(ancestors, acceptedSha, path, before, missing, candidates, missing.length)
  //@ ensures \result.kind === "bound" ==> forall(i, 0 <= i && i < \result.candidates.length ==> 0 <= \result.candidates[i] && \result.candidates[i] < candidates.length)
  const selected: number[] = [];
  let unique = true;
  let i = 0;
  while (i < missing.length) {
    //@ invariant 0 <= i && i <= missing.length
    //@ invariant unique === allUniqueHunks(ancestors, acceptedSha, path, before, missing, candidates, i)
    //@ invariant selected === hunkBindingIndices(ancestors, acceptedSha, path, before, missing, candidates, i)
    //@ invariant unique ==> forall(k, 0 <= k && k < selected.length ==> 0 <= selected[k] && selected[k] < candidates.length)
    //@ decreases missing.length - i
    const hunk = before[missing[i]];
    let count = 0;
    let found = -1;
    let j = 0;
    while (j < candidates.length) {
      //@ invariant 0 <= j && j <= candidates.length
      //@ invariant count === matchCount(ancestors, acceptedSha, path, hunk, candidates, j)
      //@ invariant found === lastMatch(ancestors, acceptedSha, path, hunk, candidates, j)
      //@ invariant 0 <= count && count <= j && -1 <= found && found < j
      //@ invariant (found === -1) <==> (count === 0)
      //@ decreases candidates.length - j
      const candidate = candidates[j];
      if (candidate.sha !== acceptedSha && candidate.limitations === 0 && candidate.vertex >= 0 && candidate.vertex < ancestors.length && ancestors[candidate.vertex]) {
        const listed = candidateHasHunk(candidate, path, hunk);
        if (listed) {
          count = count + 1;
          found = j;
        }
      }
      j = j + 1;
    }
    if (count !== 1) unique = false;
    selected.push(found);
    i = i + 1;
  }
  if (!unique) return { kind: "ambiguous" };
  return { kind: "bound", candidates: selected };
}
