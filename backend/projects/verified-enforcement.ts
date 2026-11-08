export type HistoryActor = { kind: "none" } | { kind: "actor"; id: string };

/** Actual record fields used by the chronological restriction reducers. */
export interface EnforcementHistoryRow {
  action: string;
  stateAfter: string;
  appealAfter: string;
  actor: HistoryActor;
  actorRole: string;
  sequence: number;
  bannedAccounts: string[];
  reinstatedAccounts: string[];
}

export interface RestrictionEpisode {
  state: string;
  appeal: string;
  opening: number;
  actorSources: number[];
  last: number;
}

export type HistoryLimit =
  | { kind: "all" }
  | { kind: "before"; sequence: number };

export interface ProjectAppealSelection {
  boundary: number;
  indices: number[];
}

/** Select exact history records; the caller retains their complete metadata. */
//@ verify
//@ ensures \result.state == FinalState(records)
//@ ensures \result.appeal == FinalAppeal(records)
//@ ensures \result.opening == OpeningRecord(records)
//@ ensures \result.actorSources == RestrictorSources(records)
//@ ensures \result.last == records.length - 1
//@ ensures -1 <= \result.opening && \result.opening < records.length
//@ ensures forall(k, 0 <= k && k < \result.actorSources.length ==> 0 <= \result.actorSources[k] && \result.actorSources[k] < records.length && records[\result.actorSources[k]].actor.kind == "actor")
//@ ensures forall(k, 0 <= k && k < \result.actorSources.length ==> forall(j, k < j && j < \result.actorSources.length ==> !SameActor(records[\result.actorSources[k]].actor, records[\result.actorSources[j]].actor)))
function foldRestrictionEpisode(
  records: readonly EnforcementHistoryRow[],
): RestrictionEpisode {
  let state = "clear";
  let appeal = "none";
  let opening = -1;
  let actorSources: number[] = [];
  let i = 0;
  while (i < records.length) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant state == FinalState(records.slice(0, i)) && appeal == FinalAppeal(records.slice(0, i))
    //@ invariant opening == OpeningRecord(records.slice(0, i)) && -1 <= opening && opening < i
    //@ invariant actorSources == RestrictorSources(records.slice(0, i))
    //@ invariant forall(k, 0 <= k && k < actorSources.length ==> 0 <= actorSources[k] && actorSources[k] < i && records[actorSources[k]].actor.kind == "actor")
    //@ invariant forall(k, 0 <= k && k < actorSources.length ==> forall(j, k < j && j < actorSources.length ==> !SameActor(records[actorSources[k]].actor, records[actorSources[j]].actor)))
    const record = records[i];
    const restrictive =
      record.action === "quarantine" || record.action === "ban";
    if (restrictive && state === "clear") {
      opening = i;
      actorSources = [];
    }
    if (restrictive && record.actor.kind === "actor") {
      let found = false;
      let j = 0;
      while (j < actorSources.length) {
        //@ invariant 0 <= j && j <= actorSources.length
        //@ invariant found <==> exists(k, 0 <= k && k < j && SameActor(records[actorSources[k]].actor, record.actor))
        const previous = records[actorSources[j]].actor;
        if (previous.kind === "actor" && previous.id === record.actor.id)
          found = true;
        j += 1;
      }
      if (!found) actorSources.push(i);
    }
    state = record.stateAfter;
    appeal = record.appealAfter;
    if (state === "clear") {
      opening = -1;
      actorSources = [];
    }
    i += 1;
  }
  return { state, appeal, opening, actorSources, last: i - 1 };
}

/** Keep the original last-boundary rule and newest-first request order. */
//@ verify
//@ ensures \result.boundary == ProjectBoundary(records, kept, limit)
//@ ensures \result.indices == ProjectRequests(records, \result.boundary, limit)
//@ ensures forall(k, 0 <= k && k < \result.indices.length ==> 0 <= \result.indices[k] && \result.indices[k] < records.length)
//@ ensures forall(k, 0 <= k && k < \result.indices.length ==> forall(j, k < j && j < \result.indices.length ==> \result.indices[k] > \result.indices[j]))
export function selectProjectAppeals(
  records: readonly EnforcementHistoryRow[],
  kept: boolean,
  limit: HistoryLimit,
): ProjectAppealSelection {
  let boundary = 0;
  let i = 0;
  while (i < records.length) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant boundary == ProjectBoundary(records.slice(0, i), kept, limit)
    const record = records[i];
    const allowed = limit.kind === "all" || record.sequence < limit.sequence;
    if (
      allowed &&
      ((record.action === "ban" &&
        (record.actorRole === "vetting-service"
          ? !(kept && record.appealAfter === "requested")
          : record.appealAfter !== "requested")) ||
        record.action === "quarantine" ||
        record.action === "reinstate" ||
        record.action === "deny_reinstatement")
    )
      boundary = record.sequence;
    i += 1;
  }
  const indices: number[] = [];
  i = records.length - 1;
  while (i >= 0) {
    //@ invariant -1 <= i && i < records.length
    //@ invariant indices + ProjectRequests(records.slice(0, i + 1), boundary, limit) == ProjectRequests(records, boundary, limit)
    //@ invariant forall(k, 0 <= k && k < indices.length ==> i < indices[k] && indices[k] < records.length)
    //@ invariant forall(k, 0 <= k && k < indices.length ==> forall(j, k < j && j < indices.length ==> indices[k] > indices[j]))
    const record = records[i];
    if (
      (limit.kind === "all" || record.sequence < limit.sequence) &&
      record.action === "request_reinstatement" &&
      record.actorRole !== "banned-account" &&
      record.sequence > boundary
    )
      indices.push(i);
    i -= 1;
  }
  return { boundary, indices };
}

/** Preserve every ban row whose exact ban/account pair has no release. */
//@ verify
//@ requires keyCount >= 0
//@ requires forall(i, 0 <= i && i < bans.length ==> 0 <= bans[i] && bans[i] < keyCount)
//@ requires forall(i, 0 <= i && i < releases.length ==> 0 <= releases[i] && releases[i] < keyCount)
//@ ensures \result == UnreleasedIndices(bans, releases)
//@ ensures forall(i, 0 <= i && i < \result.length ==> 0 <= \result[i] && \result[i] < bans.length && !ContainsKey(releases, bans[\result[i]]))
//@ ensures forall(i, 0 <= i && i < bans.length && !ContainsKey(releases, bans[i]) ==> ContainsKey(\result, i))
//@ ensures forall(i, 0 <= i && i < \result.length ==> forall(j, i < j && j < \result.length ==> \result[i] < \result[j]))
export function selectActiveBanIndices(
  keyCount: number,
  bans: readonly number[],
  releases: readonly number[],
): number[] {
  const released: boolean[] = [];
  let i = 0;
  while (i < keyCount) {
    //@ invariant 0 <= i && i <= keyCount
    //@ invariant released.length == i
    //@ invariant forall(k, 0 <= k && k < i ==> !released[k])
    released.push(false);
    i += 1;
  }
  i = 0;
  while (i < releases.length) {
    //@ invariant 0 <= i && i <= releases.length
    //@ invariant released.length == keyCount
    //@ invariant forall(k, 0 <= k && k < keyCount ==> (released[k] <==> ContainsKey(releases.slice(0, i), k)))
    released[releases[i]] = true;
    i += 1;
  }
  const result: number[] = [];
  i = 0;
  while (i < bans.length) {
    //@ invariant 0 <= i && i <= bans.length
    //@ invariant result == UnreleasedIndices(bans.slice(0, i), releases)
    //@ invariant forall(k, 0 <= k && k < result.length ==> 0 <= result[k] && result[k] < i && !ContainsKey(releases, bans[result[k]]))
    //@ invariant forall(k, 0 <= k && k < i && !ContainsKey(releases, bans[k]) ==> ContainsKey(result, k))
    //@ invariant forall(k, 0 <= k && k < result.length ==> forall(j, k < j && j < result.length ==> result[k] < result[j]))
    if (!released[bans[i]]) result.push(i);
    i += 1;
  }
  return result;
}

//@ verify
//@ ensures \result <==> AccountListed(accounts, target)
function containsAccount(accounts: readonly string[], target: string): boolean {
  let i = 0;
  while (i < accounts.length) {
    //@ invariant 0 <= i && i <= accounts.length
    //@ invariant forall(k, 0 <= k && k < i ==> accounts[k] != target)
    if (accounts[i] === target) return true;
    i += 1;
  }
  return false;
}

/** A denial closes account appeals only when no prior project appeal is open. */
//@ verify
//@ ensures -1 <= \result && \result < records.length
//@ ensures \result == AccountBoundaryIndex(records, records, account)
//@ ensures (\result < 0 ? 0 : records[\result].sequence) == AccountBoundarySequence(records, records, account)
function findAccountBoundary(
  records: readonly EnforcementHistoryRow[],
  account: string,
): number {
  let i = records.length - 1;
  while (i >= 0) {
    //@ invariant -1 <= i && i < records.length
    //@ invariant AccountBoundaryIndex(records, records, account) == AccountBoundaryIndex(records.slice(0, i + 1), records, account)
    //@ invariant AccountBoundarySequence(records, records, account) == AccountBoundarySequence(records.slice(0, i + 1), records, account)
    const record = records[i];
    let closes = false;
    if (record.action === "ban") {
      closes = containsAccount(record.bannedAccounts, account);
    } else if (record.action === "deny_reinstatement") {
      const project = selectProjectAppeals(records, false, {
        kind: "before",
        sequence: record.sequence,
      });
      closes = project.indices.length === 0;
    } else if (record.action === "reinstate_accounts") {
      closes = containsAccount(record.reinstatedAccounts, account);
    }
    if (closes) return i;
    i -= 1;
  }
  return -1;
}

/** The latest request for this exact account after its applicable boundary. */
//@ verify
//@ ensures -1 <= \result && \result < records.length
//@ ensures \result == AccountRequestIndex(records, AccountBoundarySequence(records, records, account), account)
export function openAccountAppealSource(
  records: readonly EnforcementHistoryRow[],
  account: string,
): number {
  const boundarySource = findAccountBoundary(records, account);
  const boundary = boundarySource < 0 ? 0 : records[boundarySource].sequence;
  let i = records.length - 1;
  while (i >= 0) {
    //@ invariant -1 <= i && i < records.length
    //@ invariant AccountRequestIndex(records, boundary, account) == AccountRequestIndex(records.slice(0, i + 1), boundary, account)
    const record = records[i];
    if (
      record.action === "request_reinstatement" &&
      record.actorRole === "banned-account" &&
      record.actor.kind === "actor" &&
      record.actor.id === account &&
      record.sequence > boundary
    )
      return i;
    i -= 1;
  }
  return -1;
}

//@ verify
//@ ensures \result <==> AnyAccountRequest(records, accounts)
function anyAccountRequested(
  records: readonly EnforcementHistoryRow[],
  accounts: readonly string[],
): boolean {
  let i = 0;
  while (i < accounts.length) {
    //@ invariant 0 <= i && i <= accounts.length
    //@ invariant !AnyAccountRequest(records, accounts.slice(0, i))
    if (openAccountAppealSource(records, accounts[i]) >= 0) return true;
    i += 1;
  }
  return false;
}

/** Complete status fold, including project-first and active-account appeal precedence. */
//@ verify
//@ ensures \result.state == FinalState(records)
//@ ensures \result.appeal == EffectiveAppeal(records, activeAccounts)
//@ ensures \result.opening == OpeningRecord(records)
//@ ensures \result.actorSources == RestrictorSources(records)
//@ ensures \result.last == records.length - 1
//@ ensures -1 <= \result.opening && \result.opening < records.length
//@ ensures forall(k, 0 <= k && k < \result.actorSources.length ==> 0 <= \result.actorSources[k] && \result.actorSources[k] < records.length && records[\result.actorSources[k]].actor.kind == "actor")
//@ ensures forall(k, 0 <= k && k < \result.actorSources.length ==> forall(j, k < j && j < \result.actorSources.length ==> !SameActor(records[\result.actorSources[k]].actor, records[\result.actorSources[j]].actor)))
export function foldEnforcementStatus(
  records: readonly EnforcementHistoryRow[],
  activeAccounts: readonly string[],
): RestrictionEpisode {
  const episode = foldRestrictionEpisode(records);
  let appeal = episode.appeal;
  if (appeal !== "requested") {
    let projectRequested = false;
    if (episode.state !== "clear") {
      const project = selectProjectAppeals(records, false, { kind: "all" });
      projectRequested = project.indices.length > 0;
    }
    if (projectRequested || anyAccountRequested(records, activeAccounts))
      appeal = "requested";
  }
  return {
    state: episode.state,
    appeal,
    opening: episode.opening,
    actorSources: episode.actorSources,
    last: episode.last,
  };
}
