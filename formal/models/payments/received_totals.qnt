// @source backend/payments/public-records.ts
// @source backend/payments/handler.ts
// @source backend/projects/edge-cache.ts
// @source src/lib/received-totals.ts
// @evidence backend/payments/public-records.test.ts
// One aggregate build and one optional later cache hit; two actors, four vault
// suffix rowids, three direct suffix rowids and one privacy/login change class.
// Page size2 represents the separate source sizes100(vault)/500(direct), not
// their byte bounds. Each scan may have a fixed, already-read valid public USD
// prefix of0/19999/20000 rows; every prefix row contributes one unit for actor1.
// This quotient retains the exact >20000 per-table guard without enumerating
// 40000 rows. Prefix membership/bytes never change; actor2 suffix membership may.
// Vault1 is production reference USD, vault2 another asset/actor2, vault3 testnet
// reference USD, vault4 unmatched/nonpaid. Direct2 belongs to actor2. All other
// suffix rows belong to actor1. Amounts are small exact integer representatives;
// no floating point, market valuation or authority to pay is introduced here.
// Each table freezes MAX(rowid) separately. Pages query live membership/login;
// they are not a database snapshot, and already-read rows are never rechecked.
// Vault evidence/amount/time/month/asset equality is the invalid-row predicate.
// Direct validation is only the source actor/amount predicate. Internal partial
// sums on failure are unobservable and collapsed. Every fetched vault row is
// validated before testnet exclusion; unrelated private settlement tables never
// enter either scan. Absent monthly attribution is permitted by publicRecord.
// isUsdMicroAsset's reviewed network/address/decimals match is a fixed predicate.
// Other-asset network/address buckets collapse to one bucket; sort order and
// full JSON/client-envelope parsing are outside this model. No provider read
// establishes new finality here: these are retained, reconciled payment rows.
// A cache hit means an unexpired matching-URL entry was returned by the cache;
// no TTL, cross-colo freshness, or immediate privacy revocation is claimed.
// Cache failures fall back or leave a successful build usable, as in source.
// Existing tests cover real migrated reads, sums, tier filtering and paging;
// interleavings and exact20k boundary classes below are authored, not executed.
module received_totals {
  val actors = Set(1, 2)
  val vaultIds = Set(1, 2, 3, 4)
  val directIds = Set(1, 2, 3)
  val prefixes = Set(0, 19999, 20000)
  type Scan = { through: int, after: int, seen: Set[int], count: int,
    logins: int -> int }
  val noScan: Scan = { through: -1, after: 0, seen: Set(), count: 0,
    logins: vaultIds.mapBy(_ => 0) }
  var s: { configured: bool, phase: str, testnets: bool, vault: Set[int], direct: Set[int],
    members: int -> int, names: int -> int, badVault: int, badDirect: int,
    vaultPrefix: int, directPrefix: int, v: Scan, d: Scan, acceptedVault: Set[int],
    people: Set[int], logins: int -> int, directUsd: int, vaultUsd: int, other: int,
    vaultPayments: int, status: str, response: str, ready: bool, cache: bool,
    cachedPeople: Set[int], cachedVault: Set[int], cacheServed: bool }
  action init = s' = { configured: false, phase: "configure", testnets: false,
    vault: Set(), direct: Set(), members: actors.mapBy(_ => 1), names: actors.mapBy(_ => 1),
    badVault: 0, badDirect: 0, vaultPrefix: 0, directPrefix: 0, v: noScan, d: noScan,
    acceptedVault: Set(), people: Set(), logins: actors.mapBy(_ => 0), directUsd: 0,
    vaultUsd: 0, other: 0, vaultPayments: 0, status: "none", response: "none", ready: false,
    cache: false, cachedPeople: Set(), cachedVault: Set(), cacheServed: false }
  def actor(row: int): int = if (row == 2) 2 else 1
  def maximum(rows: Set[int]): int = rows.fold(0, (a, b) => if (a > b) a else b)
  def first(rows: Set[int]): Set[int] = rows.filter(row => rows.filter(other => other < row).size() < 2)
  def visible(row: int): bool = row != 4 and Set(0, 1).contains(s.members.get(actor(row)))
  def observedLogin(row: int): int = if (s.members.get(actor(row)) == 1) s.names.get(actor(row)) else 0
  def directAmount(row: int): int = if (row == 1) 11 else if (row == 2) 13 else 17
  def vaultAmount(row: int): int = if (row == 1) 9 else if (row == 2) 7 else 5
  def read(scan: Scan, rows: Set[int]): Scan = scan.with("seen", scan.seen.union(rows))
    .with("count", scan.count + rows.size()).with("after", maximum(rows))
    .with("logins", vaultIds.mapBy(row => if (rows.contains(row)) observedLogin(row) else scan.logins.get(row)))
  def directLogin(who: int): int = {
    val rows = s.d.seen.filter(row => actor(row) == who)
    val last = maximum(rows)
    if (last != 0) (if (s.d.logins.get(last) == 0) 3 else s.d.logins.get(last))
    else if (who == 1 and s.directPrefix > 0) 1 else 0
  }
  def vaultLogin(who: int, accepted: Set[int]): int = {
    val rows = accepted.filter(row => actor(row) == who and s.v.logins.get(row) != 0)
    val firstRows = rows.filter(row => rows.forall(other => row <= other))
    val firstId = maximum(firstRows)
    if (who == 1 and s.vaultPrefix > 0) 1 else if (firstId == 0) 0 else s.v.logins.get(firstId)
  }
  action configure(vaultCount: int, directCount: int, vp: int, dp: int, badV: int, badD: int, testnets: bool): bool = all {
    not(s.configured), Set(0, 1, 2, 3, 4).contains(vaultCount), Set(0, 1, 2, 3).contains(directCount),
    prefixes.contains(vp), prefixes.contains(dp), Set(0, 1, 2, 3).contains(badV), Set(0, 1, 2, 3).contains(badD),
    s' = s.with("configured", true).with("phase", "vault-boundary").with("testnets", testnets)
      .with("vault", vaultIds.filter(row => row <= vaultCount)).with("direct", directIds.filter(row => row <= directCount))
      .with("vaultPrefix", vp).with("directPrefix", dp).with("badVault", badV).with("badDirect", badD) }
  action membership(mode: int): bool = all { s.configured, Set(0, 1, 2, 3).contains(mode),
    s' = s.with("members", s.members.set(2, mode)) }
  action rename(who: int, name: int): bool = all { s.configured, actors.contains(who), Set(1, 2).contains(name),
    s' = s.with("names", s.names.set(who, name)) }
  action appendVault = all { s.configured, maximum(s.vault) < 4,
    s' = s.with("vault", s.vault.union(Set(maximum(s.vault) + 1))) }
  action appendDirect = all { s.configured, maximum(s.direct) < 3,
    s' = s.with("direct", s.direct.union(Set(maximum(s.direct) + 1))) }
  action vaultBoundary = all { s.phase == "vault-boundary", s' = s.with("phase", "vault-page")
    .with("v", noScan.with("through", maximum(s.vault)).with("count", s.vaultPrefix)) }
  action vaultPage = {
    val rows = first(s.vault.filter(row => visible(row) and row > s.v.after and row <= s.v.through))
    val nextValue = read(s.v, rows)
    all { s.phase == "vault-page", s' = if (rows.size() == 0) s.with("phase", "direct-boundary")
      else s.with("v", nextValue).with("phase", if (nextValue.count > 20000) "response" else "vault-page")
        .with("status", if (nextValue.count > 20000) "503" else s.status) }
  }
  action directBoundary = all { s.phase == "direct-boundary", s' = s.with("phase", "direct-page")
    .with("d", noScan.with("through", maximum(s.direct)).with("count", s.directPrefix)) }
  action directPage = {
    val rows = first(s.direct.filter(row => row > s.d.after and row <= s.d.through))
    val nextValue = read(s.d, rows)
    all { s.phase == "direct-page", s' = if (rows.size() == 0) s.with("phase", "direct-validate")
      else s.with("d", nextValue).with("phase", if (nextValue.count > 20000) "response" else "direct-page")
        .with("status", if (nextValue.count > 20000) "503" else s.status) }
  }
  action readFailure = all { Set("vault-boundary", "vault-page", "direct-boundary", "direct-page").contains(s.phase),
    s' = s.with("phase", "response").with("status", "503") }
  action validateDirect = {
    val valid = not(s.d.seen.contains(s.badDirect))
    val people = actors.filter(who => s.d.seen.exists(row => actor(row) == who) or (who == 1 and s.directPrefix > 0))
    all { s.phase == "direct-validate", s' = if (not(valid)) s.with("phase", "response").with("status", "503")
      else s.with("phase", "vault-validate").with("people", people).with("logins", actors.mapBy(who => directLogin(who)))
        .with("directUsd", s.directPrefix + s.d.seen.fold(0, (sum, row) => sum + directAmount(row))) }
  }
  action validateVault = {
    val valid = not(s.v.seen.contains(s.badVault))
    val accepted = s.v.seen.filter(row => s.testnets or row != 3)
    val people = s.people.union(actors.filter(who => accepted.exists(row => actor(row) == who) or (who == 1 and s.vaultPrefix > 0)))
    all { s.phase == "vault-validate", s' = if (not(valid)) s.with("phase", "response").with("status", "503")
      else s.with("phase", "cache-write").with("status", "200").with("people", people).with("acceptedVault", accepted)
        .with("vaultPayments", s.vaultPrefix + accepted.size())
        .with("vaultUsd", s.vaultPrefix + accepted.filter(row => row != 2).fold(0, (sum, row) => sum + vaultAmount(row)))
        .with("other", accepted.filter(row => row == 2).fold(0, (sum, row) => sum + vaultAmount(row)))
        .with("logins", actors.mapBy(who => if (s.logins.get(who) != 0) s.logins.get(who) else vaultLogin(who, accepted))) }
  }
  action cacheWrite(stored: bool): bool = all { s.phase == "cache-write", s' = s.with("phase", "response")
    .with("cache", stored).with("cachedPeople", if (stored) s.people else Set())
    .with("cachedVault", if (stored) s.acceptedVault else Set()) }
  action respond(delivered: bool): bool = all { s.phase == "response", s' = s.with("phase", "done")
    .with("response", if (delivered) s.status else "lost").with("ready", delivered and s.status == "200") }
  action cachedRead = all { s.phase == "done", s.cache, not(s.cacheServed), s' = s.with("cacheServed", true) }
  action step = {
    nondet nv = Set(0, 1, 2, 3, 4).oneOf()
    nondet nd = Set(0, 1, 2, 3).oneOf()
    nondet vp = prefixes.oneOf()
    nondet dp = prefixes.oneOf()
    nondet badV = Set(0, 1, 2, 3).oneOf()
    nondet badD = Set(0, 1, 2, 3).oneOf()
    nondet mode = Set(0, 1, 2, 3).oneOf()
    nondet who = actors.oneOf()
    nondet name = Set(1, 2).oneOf()
    nondet yes = Set(false, true).oneOf()
    any { configure(nv, nd, vp, dp, badV, badD, yes), membership(mode), rename(who, name),
      appendVault, appendDirect, vaultBoundary, vaultPage, directBoundary, directPage, readFailure,
      validateDirect, validateVault, cacheWrite(yes), respond(yes), cachedRead, s' = s }
  }
  val invariant = all {
    s.v.seen.subseteq(s.vault), s.d.seen.subseteq(s.direct), not(s.v.seen.contains(4)),
    s.v.seen.forall(row => row <= s.v.through), s.d.seen.forall(row => row <= s.d.through),
    s.v.count == (if (s.v.through == -1) 0 else s.vaultPrefix + s.v.seen.size()),
    s.d.count == (if (s.d.through == -1) 0 else s.directPrefix + s.d.seen.size()),
    s.acceptedVault.subseteq(s.v.seen), s.people.subseteq(actors),
    (s.status == "200") implies all {
      s.v.count <= 20000, s.d.count <= 20000, not(s.v.seen.contains(s.badVault)), not(s.d.seen.contains(s.badDirect)),
      s.testnets or not(s.acceptedVault.contains(3)), s.vaultPayments == s.vaultPrefix + s.acceptedVault.size(),
      s.directUsd == s.directPrefix + s.d.seen.fold(0, (sum, row) => sum + directAmount(row)),
      s.vaultUsd == s.vaultPrefix + s.acceptedVault.filter(row => row != 2).fold(0, (sum, row) => sum + vaultAmount(row))
    }, s.ready implies s.response == "200", s.cache implies s.status == "200",
    s.cacheServed implies s.cache }
  action small(vp: int, dp: int): bool = init.then(configure(1, 1, vp, dp, 0, 0, false))
  action scanSmall = vaultBoundary.then(vaultPage).then(vaultPage).then(directBoundary).then(directPage).then(directPage)
  action finish = validateDirect.then(validateVault).then(cacheWrite(false)).then(respond(true))

  run exactIntegerReferenceAmountsTest = small(0, 0).then(scanSmall).then(finish)
    .expect(s.ready and s.directUsd == 11 and s.vaultUsd == 9 and s.other == 0 and s.people == Set(1) and invariant)
  run emptyAggregateIsSuccessfulTest = init.then(configure(0, 0, 0, 0, 0, 0, false)).then(vaultBoundary).then(vaultPage)
    .then(directBoundary).then(directPage).then(finish).expect(s.ready and s.people == Set() and s.directUsd + s.vaultUsd == 0 and invariant)
  run vaultAndDirectCaptureSeparateAppendBoundariesTest = small(0, 0).then(vaultBoundary).then(appendVault).then(appendDirect)
    .then(vaultPage).then(vaultPage).then(directBoundary).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.v.through == 1 and s.d.through == 2 and s.v.seen == Set(1) and s.d.seen == Set(1, 2) and invariant)
  run appendedDirectAfterItsBoundaryIsExcludedTest = small(0, 0).then(vaultBoundary).then(vaultPage).then(vaultPage)
    .then(directBoundary).then(appendDirect).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.d.seen == Set(1) and s.directUsd == 11 and invariant)
  run membershipWithdrawalBeforePageHidesOnlyVaultTest = init.then(configure(2, 2, 0, 0, 0, 0, false)).then(membership(2))
    .then(scanSmall).then(finish).expect(s.ready and s.v.seen == Set(1) and s.d.seen == Set(1, 2) and s.people.contains(2) and invariant)
  run closedMemberAlsoHidesOnlyVaultTest = init.then(configure(2, 2, 0, 0, 0, 0, false)).then(membership(3))
    .then(scanSmall).then(finish).expect(s.ready and not(s.acceptedVault.contains(2)) and s.directUsd == 24 and invariant)
  run absentMemberStillHasPublicVaultHistoryTest = init.then(configure(2, 1, 0, 0, 0, 0, false)).then(membership(0))
    .then(scanSmall).then(finish).expect(s.ready and s.acceptedVault.contains(2) and s.logins.get(2) == 0 and invariant)
  run withdrawalAfterVaultPageDoesNotRetractSnapshotTest = init.then(configure(2, 1, 0, 0, 0, 0, false))
    .then(vaultBoundary).then(vaultPage).then(membership(2)).then(vaultPage).then(directBoundary).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.acceptedVault.contains(2) and s.logins.get(2) == 1 and invariant)
  run visibilityAcrossPagesIsNotOneSnapshotTest = init.then(configure(3, 1, 0, 0, 0, 0, true)).then(membership(2))
    .then(vaultBoundary).then(vaultPage).then(membership(1)).then(vaultPage).then(directBoundary).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.v.seen == Set(1, 3) and not(s.acceptedVault.contains(2)) and invariant)
  run laterDirectMemberLoginWinsEarlierVaultObservationTest = small(0, 0).then(vaultBoundary).then(vaultPage).then(rename(1, 2))
    .then(vaultPage).then(directBoundary).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.v.logins.get(1) == 1 and s.d.logins.get(1) == 2 and s.logins.get(1) == 2 and invariant)
  run privateDirectRecipientUsesDisclosedLoginTest = init.then(configure(1, 2, 0, 0, 0, 0, false)).then(membership(2))
    .then(scanSmall).then(finish).expect(s.ready and s.logins.get(2) == 3 and invariant)
  run otherAssetIsNotConvertedToUsdTest = init.then(configure(2, 1, 0, 0, 0, 0, false)).then(scanSmall).then(finish)
    .expect(s.ready and s.vaultUsd == 9 and s.other == 7 and s.vaultPayments == 2 and invariant)
  run productionValidatesThenExcludesTestnetTest = init.then(configure(3, 1, 0, 0, 0, 0, false))
    .then(vaultBoundary).then(vaultPage).then(vaultPage).then(vaultPage).then(directBoundary).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.v.seen.contains(3) and not(s.acceptedVault.contains(3)) and s.vaultUsd == 9 and invariant)
  run stagingIncludesReferenceTestnetAmountTest = init.then(configure(3, 1, 0, 0, 0, 0, true))
    .then(vaultBoundary).then(vaultPage).then(vaultPage).then(vaultPage).then(directBoundary).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.acceptedVault.contains(3) and s.vaultUsd == 14 and invariant)
  run corruptExcludedTestnetStillRefusesAggregateTest = init.then(configure(3, 1, 0, 0, 3, 0, false))
    .then(vaultBoundary).then(vaultPage).then(vaultPage).then(vaultPage).then(directBoundary).then(directPage).then(directPage)
    .then(validateDirect).then(validateVault).then(respond(true)).expect(s.response == "503" and not(s.ready) and not(s.cache) and invariant)
  run invalidDirectRecordRefusesWholeAggregateTest = init.then(configure(1, 1, 0, 0, 0, 1, false)).then(scanSmall)
    .then(validateDirect).then(respond(true)).expect(s.response == "503" and s.acceptedVault == Set() and not(s.ready) and invariant)
  run exactlyTwentyThousandPerTableIsAllowedTest = small(19999, 19999).then(scanSmall).then(finish)
    .expect(s.ready and s.v.count == 20000 and s.d.count == 20000 and s.v.count + s.d.count == 40000 and invariant)
  run vaultOverTwentyThousandRefusesBeforeDirectScanTest = small(20000, 0).then(vaultBoundary).then(vaultPage).then(respond(true))
    .expect(s.response == "503" and s.v.count == 20001 and s.d.through == -1 and not(s.ready) and invariant)
  run directOverTwentyThousandRefusesAfterVaultScanTest = small(0, 20000).then(vaultBoundary).then(vaultPage).then(vaultPage)
    .then(directBoundary).then(directPage).then(respond(true))
    .expect(s.response == "503" and s.d.count == 20001 and s.v.seen == Set(1) and not(s.ready) and invariant)
  run unmatchedNonpaidRowRaisesBoundaryWithoutReceiptTest = init.then(configure(4, 1, 0, 0, 0, 0, true))
    .then(vaultBoundary).then(vaultPage).then(vaultPage).then(vaultPage).then(directBoundary).then(directPage).then(directPage).then(finish)
    .expect(s.ready and s.v.through == 4 and s.v.seen == Set(1, 2, 3) and invariant)
  run missingLaterPageRefusesPartialScanTest = small(0, 0).then(vaultBoundary).then(vaultPage).then(vaultPage)
    .then(directBoundary).then(readFailure).then(respond(true)).expect(s.response == "503" and not(s.ready) and invariant)
  run cacheWriteFailureKeepsSuccessfulBuildTest = small(0, 0).then(scanSmall).then(finish)
    .expect(s.ready and not(s.cache) and invariant)
  run laterCacheHitDoesNotRecheckMembershipTest = init.then(configure(2, 1, 0, 0, 0, 0, false)).then(scanSmall)
    .then(validateDirect).then(validateVault).then(cacheWrite(true)).then(respond(true)).then(membership(2)).then(cachedRead)
    .expect(s.cacheServed and s.cachedVault.contains(2) and s.cachedPeople.contains(2) and invariant)
  run lostResponseMayLeaveSuccessfulCacheEntryTest = small(0, 0).then(scanSmall).then(validateDirect).then(validateVault)
    .then(cacheWrite(true)).then(respond(false)).then(cachedRead).expect(s.response == "lost" and not(s.ready) and s.cacheServed and invariant)
}
