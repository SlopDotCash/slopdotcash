export interface GlobalJoinRow {
  actor: number;
  project: number;
  cycle: number;
  kind: "cycle" | "event" | "deduction" | "view";
}
export interface GlobalJoinPlan {
  first: number[];
  next: number[];
  actorSource: number[];
  projects: number[];
  cycles: number[];
}

//@ verify
//@ requires length >= 0
//@ ensures \result.length == length
//@ ensures forall(i, 0 <= i && i < length ==> \result[i] == value)
function filledNumbers(length: number, value: number): number[] {
  const result: number[] = [];
  let i = 0;
  while (i < length) {
    //@ invariant 0 <= i && i <= length && result.length == i
    //@ invariant forall(j, 0 <= j && j < i ==> result[j] == value)
    result.push(value);
    i += 1;
  }
  return result;
}

//@ verify
//@ requires length >= 0
//@ ensures \result.length == length
//@ ensures forall(i, 0 <= i && i < length ==> !\result[i])
function emptyFlags(length: number): boolean[] {
  const result: boolean[] = [];
  let i = 0;
  while (i < length) {
    //@ invariant 0 <= i && i <= length && result.length == i
    //@ invariant forall(j, 0 <= j && j < i ==> !result[j])
    result.push(false);
    i += 1;
  }
  return result;
}

/** Complete stable actor links, actor metadata source and distinct memberships. */
//@ verify
//@ requires actorCount >= 0 && projectCount >= 0 && cycleCount >= 0
//@ requires forall(i, 0 <= i && i < rows.length ==> -1 <= rows[i].actor && rows[i].actor < actorCount && -1 <= rows[i].project && rows[i].project < projectCount && -1 <= rows[i].cycle && rows[i].cycle < cycleCount)
//@ requires forall(i, 0 <= i && i < rows.length && rows[i].actor < 0 ==> rows[i].project == -1 && rows[i].cycle == -1)
//@ requires forall(i, 0 <= i && i < rows.length ==> forall(j, 0 <= j && j < rows.length ==> ((rows[i].project >= 0 && rows[i].project == rows[j].project) || (rows[i].cycle >= 0 && rows[i].cycle == rows[j].cycle)) ==> rows[i].actor == rows[j].actor))
//@ ensures \result.first.length == actorCount && \result.actorSource.length == actorCount && \result.projects.length == actorCount && \result.cycles.length == actorCount && \result.next.length == rows.length
//@ ensures forall(a, 0 <= a && a < actorCount ==> \result.first[a] == FirstActorRow(rows, a) && \result.actorSource[a] == ActorMetadataSource(rows, a) && \result.projects[a] == MembershipCount(rows, a, false) && \result.cycles[a] == MembershipCount(rows, a, true))
//@ ensures forall(i, 0 <= i && i < rows.length ==> \result.next[i] == NextActorRow(rows, i))
//@ ensures forall(a, 0 <= a && a < actorCount ==> -1 <= \result.first[a] && \result.first[a] < rows.length && -1 <= \result.actorSource[a] && \result.actorSource[a] < rows.length)
//@ ensures forall(i, 0 <= i && i < rows.length ==> \result.next[i] == -1 || (i < \result.next[i] && \result.next[i] < rows.length))
//@ ensures forall(a, 0 <= a && a < actorCount ==> \result.projects[a] == UniqueMembershipCount(rows, a, false) && \result.cycles[a] == UniqueMembershipCount(rows, a, true))
export function planGlobalJoin(
  rows: readonly GlobalJoinRow[],
  actorCount: number,
  projectCount: number,
  cycleCount: number,
): GlobalJoinPlan {
  const first = filledNumbers(actorCount, -1);
  const last = filledNumbers(actorCount, -1);
  const actorSource = filledNumbers(actorCount, -1);
  const projects = filledNumbers(actorCount, 0);
  const cycles = filledNumbers(actorCount, 0);
  const seenProjects = emptyFlags(projectCount);
  const seenCycles = emptyFlags(cycleCount);
  const next: number[] = [];
  let i = 0;
  while (i < rows.length) {
    //@ invariant 0 <= i && i <= rows.length && next.length == i
    //@ invariant first.length == actorCount && last.length == actorCount && actorSource.length == actorCount && projects.length == actorCount && cycles.length == actorCount
    //@ invariant seenProjects.length == projectCount && seenCycles.length == cycleCount
    //@ invariant forall(a, 0 <= a && a < actorCount ==> first[a] == FirstActorRow(rows.slice(0, i), a) && last[a] == LastActorRow(rows.slice(0, i), a) && actorSource[a] == ActorMetadataSource(rows.slice(0, i), a) && projects[a] == MembershipCount(rows.slice(0, i), a, false) && cycles[a] == MembershipCount(rows.slice(0, i), a, true))
    //@ invariant forall(k, 0 <= k && k < i ==> next[k] == NextActorRow(rows.slice(0, i), k))
    //@ invariant forall(k, 0 <= k && k < projectCount ==> (seenProjects[k] <==> MembershipSeen(rows.slice(0, i), k, false)))
    //@ invariant forall(k, 0 <= k && k < cycleCount ==> (seenCycles[k] <==> MembershipSeen(rows.slice(0, i), k, true)))
    const row = rows[i];
    next.push(-1);
    if (row.actor >= 0) {
      if (first[row.actor] < 0) first[row.actor] = i;
      else next[last[row.actor]] = i;
      last[row.actor] = i;
      if (
        row.kind !== "deduction" &&
        (actorSource[row.actor] < 0 ||
          row.kind === "event" ||
          row.kind === "view")
      )
        actorSource[row.actor] = i;
      if (row.project >= 0 && !seenProjects[row.project]) {
        seenProjects[row.project] = true;
        projects[row.actor] = projects[row.actor] + 1;
      }
      if (row.cycle >= 0 && !seenCycles[row.cycle]) {
        seenCycles[row.cycle] = true;
        cycles[row.actor] = cycles[row.actor] + 1;
      }
    }
    i += 1;
  }
  return { first, next, actorSource, projects, cycles };
}

export interface ArchiveCandidate {
  scope: number;
  afterStart: boolean;
}

/** Complete original-order anti-join against immutable closed project/month keys. */
//@ verify
//@ requires forall(i, 0 <= i && i < rows.length ==> 0 <= rows[i].scope && rows[i].scope < archived.length)
//@ ensures \result == OpenSourceIndices(rows, archived)
export function openSourceIndices(
  rows: readonly ArchiveCandidate[],
  archived: readonly boolean[],
): number[] {
  const result: number[] = [];
  let i = 0;
  while (i < rows.length) {
    //@ invariant 0 <= i && i <= rows.length
    //@ invariant result == OpenSourceIndices(rows.slice(0, i), archived)
    if (rows[i].afterStart && !archived[rows[i].scope]) result.push(i);
    i += 1;
  }
  return result;
}

export interface PaidCycleCandidate {
  kind: string;
  state: string;
  settledAt: string;
  settlement: string;
  contributorState: string;
  amount: bigint;
}

/** Ordered paid-recipient selection, independent of amount size and send count. */
//@ verify
//@ ensures \result == PaidRecipientIndices(rows)
export function paidRecipientIndices(
  rows: readonly PaidCycleCandidate[],
): number[] {
  const result: number[] = [];
  let i = 0;
  while (i < rows.length) {
    //@ invariant 0 <= i && i <= rows.length
    //@ invariant result == PaidRecipientIndices(rows.slice(0, i))
    if (
      rows[i].kind === "monthly-pool" &&
      rows[i].state === "paid" &&
      rows[i].settledAt !== "" &&
      rows[i].settlement !== "" &&
      rows[i].contributorState === "paid" &&
      rows[i].amount > 0n
    )
      result.push(i);
    i += 1;
  }
  return result;
}
