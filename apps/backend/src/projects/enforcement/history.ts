//@ backend dafny
// spec/security/enforcement.md, "Restriction state, appeals and findings stay consistent"; spec/backend/access.md, "A banned account keeps its appeal and a moderator decides it"; spec/backend/access.md, "One moderator decision reinstates selected accounts, each on its own appeal"

export interface HistoryRow {
  action: string;
  stateAfter: string;
  appealAfter: string;
  actorId: string;
  actorRole: string;
  sequence: number;
  bannedAccounts: string[];
  reinstatedAccounts: string[];
}

export interface Episode {
  state: string;
  appeal: string;
  opening: number;
  restrictors: number[];
  last: number;
}

//@ pure
export function restrictive(action: string): boolean {
  return action === "quarantine" || action === "ban";
}

//@ pure
export function finalState(records: HistoryRow[]): string {
  return records.length === 0 ? "clear" : records[records.length - 1].stateAfter;
}

//@ pure
export function finalAppeal(records: HistoryRow[]): string {
  return records.length === 0 ? "none" : records[records.length - 1].appealAfter;
}

//@ pure
export function openingRecord(records: HistoryRow[]): number {
  //@ decreases records.length
  return records.length === 0
    ? -1
    : records[records.length - 1].stateAfter === "clear"
      ? -1
      : restrictive(records[records.length - 1].action) && finalState(records.slice(0, records.length - 1)) === "clear"
        ? records.length - 1
        : openingRecord(records.slice(0, records.length - 1));
}

//@ pure
export function restrictorKnown(records: HistoryRow[], sources: number[], actorId: string): boolean {
  return sources.some((source: number) => 0 <= source && source < records.length && records[source].actorId === actorId);
}

//@ pure
export function restrictorSources(records: HistoryRow[]): number[] {
  //@ decreases records.length
  if (records.length === 0) return [];
  const last = records.length - 1;
  const row = records[last];
  const before = restrictive(row.action) && finalState(records.slice(0, last)) === "clear" ? [] : restrictorSources(records.slice(0, last));
  return row.stateAfter === "clear"
    ? []
    : restrictive(row.action) && row.actorId !== "" && !restrictorKnown(records, before, row.actorId)
      ? before.concat([last])
      : before;
}

export function foldRestriction(records: HistoryRow[]): Episode {
  //@ ensures \result.state === finalState(records)
  //@ ensures \result.appeal === finalAppeal(records)
  //@ ensures \result.opening === openingRecord(records)
  //@ ensures \result.restrictors === restrictorSources(records)
  //@ ensures \result.last === records.length - 1
  //@ ensures -1 <= \result.opening && \result.opening < records.length
  //@ ensures forall(k, 0 <= k && k < \result.restrictors.length ==> 0 <= \result.restrictors[k] && \result.restrictors[k] < records.length && records[\result.restrictors[k]].actorId !== "")
  //@ ensures forall(k, 0 <= k && k < \result.restrictors.length ==> forall(j, k < j && j < \result.restrictors.length ==> records[\result.restrictors[k]].actorId !== records[\result.restrictors[j]].actorId))
  let state = "clear";
  let appeal = "none";
  let opening = -1;
  let restrictors: number[] = [];
  let i = 0;
  while (i < records.length) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant state === finalState(records.slice(0, i)) && appeal === finalAppeal(records.slice(0, i))
    //@ invariant opening === openingRecord(records.slice(0, i)) && -1 <= opening && opening < i
    //@ invariant restrictors === restrictorSources(records.slice(0, i))
    //@ invariant forall(k, 0 <= k && k < restrictors.length ==> 0 <= restrictors[k] && restrictors[k] < i && records[restrictors[k]].actorId !== "")
    //@ invariant forall(k, 0 <= k && k < restrictors.length ==> forall(j, k < j && j < restrictors.length ==> records[restrictors[k]].actorId !== records[restrictors[j]].actorId))
    //@ decreases records.length - i
    const record = records[i];
    //@ assert records.slice(0, i + 1).slice(0, i) === records.slice(0, i)
    //@ assert records.slice(0, i + 1)[i] === record
    //@ assert forall(k, 0 <= k && k < i ==> records.slice(0, i + 1)[k] === records[k])
    if (restrictive(record.action) && state === "clear") {
      opening = i;
      restrictors = [];
    }
    //@ assert restrictorKnown(records.slice(0, i + 1), restrictors, record.actorId) === restrictorKnown(records, restrictors, record.actorId)
    if (restrictive(record.action) && record.actorId !== "" && !restrictorKnown(records, restrictors, record.actorId)) restrictors.push(i);
    state = record.stateAfter;
    appeal = record.appealAfter;
    if (state === "clear") {
      opening = -1;
      restrictors = [];
    }
    i = i + 1;
  }
  //@ assert records.slice(0, i) === records
  return { state: state, appeal: appeal, opening: opening, restrictors: restrictors, last: records.length - 1 };
}

//@ pure
export function withinLimit(record: HistoryRow, before: number): boolean {
  return before <= 0 || record.sequence < before;
}

//@ pure
export function closesProjectAppeals(record: HistoryRow, kept: boolean): boolean {
  return (record.action === "ban" && (record.actorRole === "vetting-service" ? !(kept && record.appealAfter === "requested") : record.appealAfter !== "requested"))
    || record.action === "quarantine"
    || record.action === "reinstate"
    || record.action === "deny_reinstatement";
}

//@ pure
export function projectBoundary(records: HistoryRow[], kept: boolean, before: number): number {
  //@ decreases records.length
  return records.length === 0
    ? 0
    : withinLimit(records[records.length - 1], before) && closesProjectAppeals(records[records.length - 1], kept)
      ? records[records.length - 1].sequence
      : projectBoundary(records.slice(0, records.length - 1), kept, before);
}

//@ pure
export function isProjectRequest(record: HistoryRow, boundary: number, before: number): boolean {
  return withinLimit(record, before) && record.action === "request_reinstatement" && record.actorRole !== "banned-account" && record.sequence > boundary;
}

//@ pure
export function projectRequests(records: HistoryRow[], boundary: number, before: number): number[] {
  //@ decreases records.length
  return records.length === 0
    ? []
    : (isProjectRequest(records[records.length - 1], boundary, before) ? [records.length - 1] : []).concat(projectRequests(records.slice(0, records.length - 1), boundary, before));
}

export function openProjectAppeals(records: HistoryRow[], kept: boolean, before: number): number[] {
  //@ ensures \result === projectRequests(records, projectBoundary(records, kept, before), before)
  //@ ensures forall(k, 0 <= k && k < \result.length ==> 0 <= \result[k] && \result[k] < records.length)
  //@ ensures forall(k, 0 <= k && k < \result.length ==> forall(j, k < j && j < \result.length ==> \result[k] > \result[j]))
  let boundary = 0;
  let i = 0;
  while (i < records.length) {
    //@ invariant 0 <= i && i <= records.length
    //@ invariant boundary === projectBoundary(records.slice(0, i), kept, before)
    //@ decreases records.length - i
    const record = records[i];
    //@ assert records.slice(0, i + 1).slice(0, i) === records.slice(0, i)
    //@ assert records.slice(0, i + 1)[i] === record
    if (withinLimit(record, before) && closesProjectAppeals(record, kept)) boundary = record.sequence;
    i = i + 1;
  }
  //@ assert records.slice(0, i) === records
  const indices: number[] = [];
  let j = records.length - 1;
  //@ assert records.slice(0, j + 1) === records
  while (j >= 0) {
    //@ invariant -1 <= j && j < records.length
    //@ invariant indices.concat(projectRequests(records.slice(0, j + 1), boundary, before)) === projectRequests(records, boundary, before)
    //@ invariant forall(k, 0 <= k && k < indices.length ==> j < indices[k] && indices[k] < records.length)
    //@ invariant forall(k, 0 <= k && k < indices.length ==> forall(m, k < m && m < indices.length ==> indices[k] > indices[m]))
    //@ decreases j + 1
    const record = records[j];
    //@ assert records.slice(0, j + 1).slice(0, j) === records.slice(0, j)
    //@ assert records.slice(0, j + 1)[j] === record
    if (isProjectRequest(record, boundary, before)) indices.push(j);
    j = j - 1;
  }
  return indices;
}

//@ pure
export function unreleasedIndices(bans: number[], releases: number[]): number[] {
  //@ decreases bans.length
  return bans.length === 0
    ? []
    : unreleasedIndices(bans.slice(0, bans.length - 1), releases).concat(releases.includes(bans[bans.length - 1]) ? [] : [bans.length - 1]);
}

export function unreleasedBans(keyCount: number, bans: number[], releases: number[]): number[] {
  //@ requires keyCount >= 0
  //@ requires forall(k, 0 <= k && k < bans.length ==> 0 <= bans[k] && bans[k] < keyCount)
  //@ requires forall(k, 0 <= k && k < releases.length ==> 0 <= releases[k] && releases[k] < keyCount)
  //@ ensures \result === unreleasedIndices(bans, releases)
  //@ ensures forall(k, 0 <= k && k < \result.length ==> 0 <= \result[k] && \result[k] < bans.length && !releases.includes(bans[\result[k]]))
  //@ ensures forall(k, 0 <= k && k < bans.length && !releases.includes(bans[k]) ==> \result.includes(k))
  //@ ensures forall(k, 0 <= k && k < \result.length ==> forall(j, k < j && j < \result.length ==> \result[k] < \result[j]))
  const released: boolean[] = [];
  let i = 0;
  while (i < keyCount) {
    //@ invariant 0 <= i && i <= keyCount
    //@ invariant released.length === i
    //@ invariant forall(k, 0 <= k && k < i ==> !released[k])
    //@ decreases keyCount - i
    released.push(false);
    i = i + 1;
  }
  i = 0;
  while (i < releases.length) {
    //@ invariant 0 <= i && i <= releases.length
    //@ invariant released.length === keyCount
    //@ invariant forall(k, 0 <= k && k < keyCount ==> (released[k] <==> releases.slice(0, i).includes(k)))
    //@ decreases releases.length - i
    //@ assert releases.slice(0, i + 1) === releases.slice(0, i).concat([releases[i]])
    released[releases[i]] = true;
    i = i + 1;
  }
  //@ assert releases.slice(0, i) === releases
  const result: number[] = [];
  i = 0;
  while (i < bans.length) {
    //@ invariant 0 <= i && i <= bans.length
    //@ invariant released.length === keyCount
    //@ invariant forall(k, 0 <= k && k < keyCount ==> (released[k] <==> releases.includes(k)))
    //@ invariant result === unreleasedIndices(bans.slice(0, i), releases)
    //@ invariant forall(k, 0 <= k && k < result.length ==> 0 <= result[k] && result[k] < i && !releases.includes(bans[result[k]]))
    //@ invariant forall(k, 0 <= k && k < i && !releases.includes(bans[k]) ==> result.includes(k))
    //@ invariant forall(k, 0 <= k && k < result.length ==> forall(j, k < j && j < result.length ==> result[k] < result[j]))
    //@ decreases bans.length - i
    //@ assert bans.slice(0, i + 1).slice(0, i) === bans.slice(0, i)
    //@ assert bans.slice(0, i + 1)[i] === bans[i]
    if (!released[bans[i]]) result.push(i);
    i = i + 1;
  }
  //@ assert bans.slice(0, i) === bans
  return result;
}

//@ pure
export function closesAccountAppeal(record: HistoryRow, all: HistoryRow[], account: string): boolean {
  return (record.action === "ban" && record.bannedAccounts.includes(account))
    || (record.action === "deny_reinstatement" && projectRequests(all, projectBoundary(all, false, record.sequence), record.sequence).length === 0)
    || (record.action === "reinstate_accounts" && record.reinstatedAccounts.includes(account));
}

//@ pure
export function accountBoundarySequence(records: HistoryRow[], all: HistoryRow[], account: string): number {
  //@ decreases records.length
  return records.length === 0
    ? 0
    : closesAccountAppeal(records[records.length - 1], all, account)
      ? records[records.length - 1].sequence
      : accountBoundarySequence(records.slice(0, records.length - 1), all, account);
}

function accountBoundary(records: HistoryRow[], account: string): number {
  //@ ensures \result === accountBoundarySequence(records, records, account)
  let i = records.length - 1;
  //@ assert records.slice(0, i + 1) === records
  while (i >= 0) {
    //@ invariant -1 <= i && i < records.length
    //@ invariant accountBoundarySequence(records, records, account) === accountBoundarySequence(records.slice(0, i + 1), records, account)
    //@ decreases i + 1
    const record = records[i];
    //@ assert records.slice(0, i + 1).slice(0, i) === records.slice(0, i)
    //@ assert records.slice(0, i + 1)[i] === record
    let closes = false;
    if (record.action === "ban") closes = record.bannedAccounts.includes(account);
    else if (record.action === "deny_reinstatement") closes = openProjectAppeals(records, false, record.sequence).length === 0;
    else if (record.action === "reinstate_accounts") closes = record.reinstatedAccounts.includes(account);
    //@ assert closes === closesAccountAppeal(record, records, account)
    if (closes) return record.sequence;
    i = i - 1;
  }
  return 0;
}

//@ pure
export function isAccountRequest(record: HistoryRow, boundary: number, account: string): boolean {
  return record.action === "request_reinstatement" && record.actorRole === "banned-account" && record.actorId === account && record.sequence > boundary;
}

//@ pure
export function accountRequestIndex(records: HistoryRow[], boundary: number, account: string): number {
  //@ decreases records.length
  return records.length === 0
    ? -1
    : isAccountRequest(records[records.length - 1], boundary, account)
      ? records.length - 1
      : accountRequestIndex(records.slice(0, records.length - 1), boundary, account);
}

export function openAccountAppeal(records: HistoryRow[], account: string): number {
  //@ ensures \result === accountRequestIndex(records, accountBoundarySequence(records, records, account), account)
  //@ ensures -1 <= \result && \result < records.length
  const boundary = accountBoundary(records, account);
  let i = records.length - 1;
  //@ assert records.slice(0, i + 1) === records
  while (i >= 0) {
    //@ invariant -1 <= i && i < records.length
    //@ invariant accountRequestIndex(records, boundary, account) === accountRequestIndex(records.slice(0, i + 1), boundary, account)
    //@ decreases i + 1
    const record = records[i];
    //@ assert records.slice(0, i + 1).slice(0, i) === records.slice(0, i)
    //@ assert records.slice(0, i + 1)[i] === record
    if (isAccountRequest(record, boundary, account)) return i;
    i = i - 1;
  }
  return -1;
}

//@ pure
export function anyAccountRequest(records: HistoryRow[], accounts: string[]): boolean {
  return accounts.some((account: string) => accountRequestIndex(records, accountBoundarySequence(records, records, account), account) >= 0);
}

//@ pure
export function effectiveAppealOf(records: HistoryRow[], accounts: string[]): string {
  return finalAppeal(records) === "requested"
    || (finalState(records) !== "clear" && projectRequests(records, projectBoundary(records, false, 0), 0).length > 0)
    || anyAccountRequest(records, accounts)
    ? "requested"
    : finalAppeal(records);
}

export function effectiveAppeal(records: HistoryRow[], activeAccounts: string[]): string {
  //@ ensures \result === effectiveAppealOf(records, activeAccounts)
  const episode = foldRestriction(records);
  if (episode.appeal === "requested") return "requested";
  if (episode.state !== "clear" && openProjectAppeals(records, false, 0).length > 0) return "requested";
  let i = 0;
  while (i < activeAccounts.length) {
    //@ invariant 0 <= i && i <= activeAccounts.length
    //@ invariant !anyAccountRequest(records, activeAccounts.slice(0, i))
    //@ decreases activeAccounts.length - i
    //@ assert activeAccounts.slice(0, i + 1) === activeAccounts.slice(0, i).concat([activeAccounts[i]])
    //@ assert activeAccounts.includes(activeAccounts[i])
    if (openAccountAppeal(records, activeAccounts[i]) >= 0) return "requested";
    i = i + 1;
  }
  //@ assert activeAccounts.slice(0, i) === activeAccounts
  return episode.appeal;
}

//@ pure
export function awaitsVettingDecision(records: HistoryRow[]): boolean {
  //@ decreases records.length
  return records.length === 0
    ? false
    : restrictive(records[records.length - 1].action)
      ? records[records.length - 1].action === "ban" && records[records.length - 1].actorRole === "vetting-service"
      : awaitsVettingDecision(records.slice(0, records.length - 1));
}

export function awaitsMaliceDecision(records: HistoryRow[], state: string): boolean {
  //@ ensures \result === (state === "banned" && awaitsVettingDecision(records))
  if (state !== "banned") return false;
  let i = records.length - 1;
  //@ assert records.slice(0, i + 1) === records
  while (i >= 0) {
    //@ invariant -1 <= i && i < records.length
    //@ invariant awaitsVettingDecision(records) === awaitsVettingDecision(records.slice(0, i + 1))
    //@ decreases i + 1
    //@ assert records.slice(0, i + 1).slice(0, i) === records.slice(0, i)
    //@ assert records.slice(0, i + 1)[i] === records[i]
    if (restrictive(records[i].action)) return records[i].action === "ban" && records[i].actorRole === "vetting-service";
    i = i - 1;
  }
  return false;
}
