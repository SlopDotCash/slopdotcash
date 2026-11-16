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

export interface AccountBanSource {
  accountId: string;
  moderator: HistoryActor;
}

export interface EnforcementDecisionInput {
  action: string;
  actorId: string;
  actorRole: string;
  hasActorRole: boolean;
  state: string;
  appeal: string;
  records: EnforcementHistoryRow[];
  restrictedBy: string[];
  bannedAccounts: string[];
  activeBans: AccountBanSource[];
  responsibleAccounts: string[];
  manifestStatus: string;
  manifestTier: string;
  listedBefore: boolean;
}

export type EnforcementDecision =
  | { kind: "refused"; status: number; code: string; message: string }
  | {
      kind: "plan";
      stateAfter: string;
      appealAfter: string;
      bansMaintainer: boolean;
      revision: string;
    };

//@ verify
//@ ensures -1 <= \result && \result < records.length
//@ ensures \result == LastRestriction(records)
function latestRestrictionSource(
  records: readonly EnforcementHistoryRow[],
): number {
  let i = records.length - 1;
  while (i >= 0) {
    //@ invariant -1 <= i && i < records.length
    //@ invariant LastRestriction(records) == LastRestriction(records.slice(0, i + 1))
    if (records[i].action === "ban" || records[i].action === "quarantine")
      return i;
    i -= 1;
  }
  return -1;
}

//@ verify
//@ ensures \result == OpenAccountIds(records, banned, accounts)
function openAccountIds(
  records: readonly EnforcementHistoryRow[],
  banned: readonly string[],
  accounts: readonly string[],
): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < accounts.length) {
    //@ invariant 0 <= i && i <= accounts.length
    //@ invariant result == OpenAccountIds(records, banned, accounts.slice(0, i))
    const account = accounts[i];
    if (containsAccount(banned, account)) {
      if (openAccountAppealSource(records, account) >= 0) {
        if (!containsAccount(result, account)) result.push(account);
      }
    }
    i += 1;
  }
  return result;
}

/**
 * Exact project-moderator conflict, including every kept appellant. A newer
 * request does not make an earlier appellant independent, and the actor who
 * placed a restriction cannot decide it. Preserve placing-actor refusal first.
 */
//@ verify
//@ ensures \result == ProjectModeratorConflict(records, restrictedBy, actor)
function projectModeratorConflict(
  records: readonly EnforcementHistoryRow[],
  restrictedBy: readonly string[],
  actor: string,
): number {
  const placed = containsAccount(restrictedBy, actor);
  const appeals = selectProjectAppeals(records, true, { kind: "all" });
  let appealed = false;
  let i = 0;
  while (i < appeals.indices.length) {
    //@ invariant 0 <= i && i <= appeals.indices.length
    //@ invariant appealed <==> ActorInSources(records, appeals.indices.slice(0, i), actor)
    const source = records[appeals.indices[i]].actor;
    if (source.kind === "actor" && source.id === actor) appealed = true;
    i += 1;
  }
  return placed ? 1 : appealed ? 2 : 0;
}

/** A selected account and the moderator who banned it cannot decide its appeal. */
//@ verify
//@ ensures \result <==> AccountModeratorIndependent(bans, accounts, actor)
function accountModeratorIndependent(
  bans: readonly AccountBanSource[],
  accounts: readonly string[],
  actor: string,
): boolean {
  if (containsAccount(accounts, actor)) return false;
  let i = 0;
  while (i < bans.length) {
    //@ invariant 0 <= i && i <= bans.length
    //@ invariant forall(k, 0 <= k && k < i ==> !BanConflict(bans[k], accounts, actor))
    if (containsAccount(accounts, bans[i].accountId)) {
      const moderator = bans[i].moderator;
      if (moderator.kind === "actor" && moderator.id === actor) return false;
    }
    i += 1;
  }
  return true;
}

/** A complete action plan over actual history and actor identities. */
//@ verify
//@ requires input.action == "quarantine" || input.action == "ban" || input.action == "request_reinstatement" || input.action == "reinstate_accounts" || input.action == "reinstate" || input.action == "deny_reinstatement"
//@ ensures \result == ActionPlan(input)
//@ ensures \result.kind == "refused" ==> \result.status == 403 || \result.status == 409
//@ ensures \result.kind == "plan" ==> \result.revision == "none" || \result.revision == "retired" || \result.revision == "community"
//@ ensures \result.kind == "plan" && \result.bansMaintainer ==> input.action == "ban" && MaliciousDecision(input)
//@ ensures \result.kind == "plan" && \result.revision == "community" ==> input.action == "reinstate" && input.listedBefore && \result.stateAfter == "clear" && \result.appealAfter == "granted"
export function planEnforcementAction(
  input: EnforcementDecisionInput,
): EnforcementDecision {
  const latest = latestRestrictionSource(input.records);
  const deciding =
    input.state === "banned" &&
    latest >= 0 &&
    input.records[latest].action === "ban" &&
    input.records[latest].actorRole === "vetting-service";
  if (input.action === "quarantine" || input.action === "ban") {
    if (input.action === "quarantine" && input.state !== "clear")
      return {
        kind: "refused",
        status: 409,
        code: "already_restricted",
        message: `The project is already ${input.state}`,
      };
    if (input.action === "ban" && input.state === "banned" && !deciding)
      return {
        kind: "refused",
        status: 409,
        code: "already_restricted",
        message: "The project is already banned",
      };
    // A malicious decision may close a kept project appeal and re-ban account
    // appellants. Each appeal it closes needs its own independent reviewer.
    let closesProjectAppeal = false;
    let reBanned: string[] = [];
    if (deciding) {
      if (input.appeal === "requested") {
        const kept = selectProjectAppeals(input.records, true, { kind: "all" });
        if (kept.indices.length > 0) closesProjectAppeal = true;
        else {
          const open = openAccountIds(
            input.records,
            input.bannedAccounts,
            input.bannedAccounts,
          );
          closesProjectAppeal = open.length === 0;
        }
      }
      reBanned = openAccountIds(
        input.records,
        input.bannedAccounts,
        input.responsibleAccounts,
      );
    }
    if (closesProjectAppeal) {
      const conflict = projectModeratorConflict(
        input.records,
        input.restrictedBy,
        input.actorId,
      );
      if (conflict !== 0)
        return {
          kind: "refused",
          status: 403,
          code: "independent_review_required",
          message:
            conflict === 1
              ? "A moderator who did not place this restriction must decide the appeal"
              : "Another moderator must decide an appeal its author filed",
        };
    }
    if (!accountModeratorIndependent(input.activeBans, reBanned, input.actorId))
      return {
        kind: "refused",
        status: 403,
        code: "independent_review_required",
        message:
          "A moderator who did not ban this account must decide its appeal.",
      };
    return {
      kind: "plan",
      stateAfter: input.action === "ban" ? "banned" : "quarantined",
      appealAfter:
        input.appeal !== "requested"
          ? "none"
          : closesProjectAppeal || reBanned.length > 0
            ? "denied"
            : "requested",
      bansMaintainer: deciding,
      revision: "retired",
    };
  }
  let project = false;
  if (input.state !== "clear") {
    const pending = selectProjectAppeals(input.records, false, { kind: "all" });
    project = pending.indices.length > 0;
  }
  if (input.action === "request_reinstatement") {
    const isAccountAppeal =
      containsAccount(input.bannedAccounts, input.actorId) &&
      (!input.hasActorRole || input.actorRole === "banned-account");
    if (input.state === "clear" && !isAccountAppeal)
      return {
        kind: "refused",
        status: 409,
        code: "not_restricted",
        message: "The project has no restriction to appeal",
      };
    let open = project;
    if (isAccountAppeal)
      open = openAccountAppealSource(input.records, input.actorId) >= 0;
    if (open)
      return {
        kind: "refused",
        status: 409,
        code: "appeal_open",
        message: "A reinstatement request is already open",
      };
    return {
      kind: "plan",
      stateAfter: input.state,
      appealAfter: "requested",
      bansMaintainer: false,
      revision: "none",
    };
  }
  if (input.action === "reinstate_accounts") {
    // An account release leaves the project appeal for its own decision.
    if (input.appeal !== "requested" || input.bannedAccounts.length === 0)
      return {
        kind: "refused",
        status: 409,
        code: "no_open_appeal",
        message: "Record an appeal before reinstating an account",
      };
    if (!project) {
      let i = 0;
      while (i < input.responsibleAccounts.length) {
        //@ invariant 0 <= i && i <= input.responsibleAccounts.length
        //@ invariant forall(k, 0 <= k && k < i ==> !UnappealedSelected(input.records, input.bannedAccounts, input.responsibleAccounts[k]))
        const account = input.responsibleAccounts[i];
        if (
          containsAccount(input.bannedAccounts, account) &&
          openAccountAppealSource(input.records, account) < 0
        )
          return {
            kind: "refused",
            status: 409,
            code: "no_open_appeal",
            message: "Record an appeal before reinstating an account",
          };
        i += 1;
      }
    }
    if (
      !accountModeratorIndependent(
        input.activeBans,
        input.responsibleAccounts,
        input.actorId,
      )
    )
      return {
        kind: "refused",
        status: 403,
        code: "independent_review_required",
        message:
          "A moderator who did not ban this account must decide its appeal.",
      };
    const kept = selectProjectAppeals(input.records, true, { kind: "all" });
    const open = openAccountIds(
      input.records,
      input.bannedAccounts,
      input.bannedAccounts,
    );
    let remaining = false;
    let i = 0;
    while (i < open.length) {
      //@ invariant 0 <= i && i <= open.length
      //@ invariant remaining <==> exists(k, 0 <= k && k < i && !AccountListed(input.responsibleAccounts, open[k]))
      if (!containsAccount(input.responsibleAccounts, open[i]))
        remaining = true;
      i += 1;
    }
    return {
      kind: "plan",
      stateAfter: input.state,
      appealAfter:
        (input.state !== "clear" && kept.indices.length > 0) || remaining
          ? "requested"
          : "granted",
      bansMaintainer: false,
      revision: "none",
    };
  }
  // An account-only appeal cannot authorize project reinstatement. A denial
  // without a project appeal decides the open accounts instead.
  if (
    input.state === "clear" ||
    (input.action === "reinstate" ? !project : input.appeal !== "requested")
  )
    return {
      kind: "refused",
      status: 409,
      code: "no_open_appeal",
      message: "Record a reinstatement request before a decision",
    };
  if (input.action === "reinstate" || project) {
    const conflict = projectModeratorConflict(
      input.records,
      input.restrictedBy,
      input.actorId,
    );
    if (conflict !== 0)
      return {
        kind: "refused",
        status: 403,
        code: "independent_review_required",
        message:
          conflict === 1
            ? "A moderator who did not place this restriction must decide the appeal"
            : "Another moderator must decide an appeal its author filed",
      };
  } else {
    const open = openAccountIds(
      input.records,
      input.bannedAccounts,
      input.bannedAccounts,
    );
    if (!accountModeratorIndependent(input.activeBans, open, input.actorId))
      return {
        kind: "refused",
        status: 403,
        code: "independent_review_required",
        message:
          "A moderator who did not ban this account must decide its appeal.",
      };
  }
  if (input.action === "deny_reinstatement") {
    if (deciding)
      return {
        kind: "refused",
        status: 409,
        code: "malicious_decision_required",
        message:
          "A confirmed malicious result needs a decision: ban the project and its maintainer, or reinstate it",
      };
    return {
      kind: "plan",
      stateAfter: input.state,
      appealAfter: "denied",
      bansMaintainer: false,
      revision: "none",
    };
  }
  // Clearing a pending paused/retired revision would restore the old active
  // listing. That revision must land before reinstatement can clear it.
  if (input.manifestStatus !== "paused" || input.manifestTier !== "retired")
    return {
      kind: "refused",
      status: 409,
      code: "revision_pending",
      message:
        "Append the paused, retired revision of this restriction before reinstatement",
    };
  return {
    kind: "plan",
    stateAfter: "clear",
    appealAfter: "granted",
    bansMaintainer: false,
    revision:
      input.listedBefore && input.manifestTier === "retired"
        ? "community"
        : "none",
  };
}

export type RestrictionStart =
  | { kind: "absent" }
  | { kind: "at"; value: string };
export type ScanReinstatementDecision =
  | { kind: "unchanged" }
  | { kind: "reinstate"; stateAfter: string; appealAfter: string };

/** A fresh matching scan lifts only the latest contributor-flags quarantine. */
//@ verify
//@ ensures \result == FlagScanPlan(records, state, appeal, since, requestedAt, content, currentContent)
export function planFlagScanReinstatement(
  records: readonly EnforcementHistoryRow[],
  state: string,
  appeal: string,
  since: RestrictionStart,
  requestedAt: string,
  content: string,
  currentContent: string,
): ScanReinstatementDecision {
  if (state !== "quarantined" || since.kind === "absent")
    return { kind: "unchanged" };
  const latest = latestRestrictionSource(records);
  if (latest < 0 || records[latest].actorRole !== "contributor-flags")
    return { kind: "unchanged" };
  if (requestedAt < since.value || content !== currentContent)
    return { kind: "unchanged" };
  return {
    kind: "reinstate",
    stateAfter: "clear",
    appealAfter: appeal === "requested" ? "granted" : "none",
  };
}

/**
 * True exactly when the project is quarantined and contributor flags placed
 * the latest quarantine or ban record. Only such a pause reinstates on a
 * clean fresh scan; a moderator decides every other restriction.
 */
//@ verify
//@ ensures \result ==> state == "quarantined"
//@ ensures \result <==> state == "quarantined" && LastRestriction(records) >= 0 && records[LastRestriction(records)].actorRole == "contributor-flags"
export function pausedByFlagsOnly(
  records: readonly EnforcementHistoryRow[],
  state: string,
): boolean {
  if (state !== "quarantined") return false;
  const latest = latestRestrictionSource(records);
  return latest >= 0 && records[latest].actorRole === "contributor-flags";
}
