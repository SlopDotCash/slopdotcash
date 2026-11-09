// @source scripts/check-referral-roots.ts
// @source workers/referral-accrual/core.ts
// @source workers/referral-accrual/merkle.ts
// @evidence scripts/check-referral-roots.test.ts
// checkReferralFiles: two consecutive months, one accrual each, two actors,
// one project, two wallets, project cap 3 and pool cap 4. Historical schemas,
// exact body/header digests, eligible-asset formatting, complete cumulative
// referrer-set equality, retained other actors' wallet/leaf checks, Merkle roots
// and proof bytes are supplied predicates (the cumulative fault includes the
// retained-row checks). Only the current accrual actor's pin is explicit here.
// The model derives lifetime caps, obligation deduplication and wallet pins.
// HTTP/text/JSON failure returns no partial result; the actual read bounds characters after
// reading response.text, not bytes before allocation. This is not RPC evidence.
module referral_file_watch {
  type State = { phase: str, fault: str, fileCount: int, closed: int, due: int,
    file: int, secondActor: int, firstWallet: int, secondWallet: int,
    requested: int, declared: int, secondDeclared: int, excluded: bool, obligations: Set[int],
    totals: int -> int, pins: int -> int, walletOwners: int -> int,
    project: int, pool: int, returned: bool, awaiting: bool, error: str }
  var s: State
  val faults = Set("none", "index-http", "index-json", "index-schema", "coverage",
    "file-http", "digest", "identity", "arithmetic", "duplicate", "cumulative",
    "walletless-leaf", "wallet-format", "tree", "proof")
  val initial: State = { phase: "input", fault: "none", fileCount: 2, closed: 2, due: 2,
    file: 0, secondActor: 1, firstWallet: 1, secondWallet: 1, requested: 2, declared: 2, secondDeclared: 1,
    excluded: false, obligations: Set(), totals: Map(1 -> 0, 2 -> 0),
    pins: Map(1 -> 0, 2 -> 0), walletOwners: Map(1 -> 0, 2 -> 0),
    project: 0, pool: 0, returned: false, awaiting: false, error: "none" }
  action init = s' = initial
  def actor: int = if (s.file == 0) 1 else s.secondActor
  def wallet: int = if (s.file == 0) s.firstWallet else s.secondWallet
  def obligation: int = if (s.fault == "duplicate") 1 else s.file + 1
  def declared: int = if (s.file == 0) s.declared else s.secondDeclared
  def walletOwner: int = s.walletOwners.get(if (wallet == 0) 1 else wallet)
  def capped: int = if (s.requested < 3 - s.project) s.requested else 3 - s.project
  def credited: int = if (capped < 4 - s.pool) capped else 4 - s.pool
  def refused(reason: str): State = s.with("phase", "done").with("error", reason)
  action configure(fault: str, fileCount: int, closed: int, due: int, secondActor: int,
    firstWallet: int, secondWallet: int, requested: int, declared: int, excluded: bool): bool = all {
    s.phase == "input", faults.contains(fault), 0.to(2).contains(fileCount),
    0.to(2).contains(closed), 0.to(closed).contains(due), Set(1, 2).contains(secondActor),
    0.to(2).contains(firstWallet), 0.to(2).contains(secondWallet), 0.to(4).contains(requested),
    0.to(4).contains(declared), s' = s.with("fault", fault).with("fileCount", fileCount)
      .with("closed", closed).with("due", due).with("secondActor", secondActor)
      .with("firstWallet", firstWallet).with("secondWallet", secondWallet)
      .with("requested", requested).with("declared", declared).with("excluded", excluded) }
  action declareSecond(amount: int): bool = all { s.phase == "input", 0.to(4).contains(amount),
    s' = s.with("secondDeclared", amount) }
  action start = all { s.phase == "input", s' = s.with("phase", "index") }
  action indexRead = all { s.phase == "index", s' =
    if (Set("index-http", "index-json", "index-schema").contains(s.fault)) refused("index")
    else s.with("phase", "file") }
  action fileRead = all { s.phase == "file", s' =
    if (s.file >= s.fileCount) s.with("phase", "due")
    else if (s.fault == "coverage" or s.file >= s.closed) refused("coverage")
    else if (s.fault == "file-http") refused("file-http")
    else if (s.fault == "digest") refused("digest")
    else if (s.fault == "identity") refused("identity") else s.with("phase", "accrual") }
  action accrue = all { s.phase == "accrual", s' =
    if (s.obligations.contains(obligation)) refused("duplicate")
    else if (s.excluded and (s.requested != 0 or declared != 0)) refused("excluded")
    else if (not(s.excluded) and s.fault == "arithmetic") refused("arithmetic")
    else if (not(s.excluded) and declared != credited) refused("cap")
    else s.with("phase", "referrers").with("obligations", s.obligations.union(Set(obligation)))
      .with("totals", if (s.excluded) s.totals else s.totals.set(actor, s.totals.get(actor) + credited))
      .with("project", if (s.excluded) s.project else s.project + credited)
      .with("pool", if (s.excluded) s.pool else s.pool + credited) }
  action referrers = all { s.phase == "referrers", s' =
    if (s.fault == "cumulative") refused("cumulative")
    else if (s.pins.get(actor) != 0 and wallet != s.pins.get(actor)) refused("pin")
    else if (wallet == 0 and s.fault == "walletless-leaf") refused("walletless-leaf")
    else if (wallet != 0 and (s.fault == "wallet-format" or s.totals.get(actor) == 0)) refused("wallet")
    else if (wallet != 0 and walletOwner != 0 and walletOwner != actor) refused("wallet")
    else s.with("phase", "tree")
      .with("pins", if (wallet == 0) s.pins else s.pins.set(actor, wallet))
      .with("walletOwners", if (wallet == 0) s.walletOwners else s.walletOwners.set(wallet, actor)) }
  action tree = all { s.phase == "tree", s' =
    if (s.fault == "tree") refused("tree") else if (s.fault == "proof") refused("proof")
    else s.with("phase", "file").with("file", s.file + 1) }
  action due = all { s.phase == "due", s' =
    if (s.fileCount < s.due) refused("stale") else s.with("phase", "done").with("returned", true)
      .with("awaiting", s.fileCount < s.closed) }
  action step = {
    nondet fault = faults.oneOf() nondet wallet = 0.to(2).oneOf() nondet actor = Set(1, 2).oneOf()
    nondet amount = 0.to(4).oneOf()
    any { configure(fault, 2, 2, 2, actor, wallet, wallet, 2, 2, false),
      declareSecond(amount), start, indexRead, fileRead, accrue, referrers, tree, due, s' = s }
  }
  val invariant = all { s.project >= 0, s.project <= 3, s.pool == s.project, s.pool <= 4,
    s.totals.get(1) + s.totals.get(2) == s.pool,
    s.error != "none" implies not(s.returned),
    s.returned implies s.file == s.fileCount and s.fileCount >= s.due and s.fileCount <= s.closed,
    Set(1, 2).forall(a => if (s.pins.get(a) == 0) true else s.walletOwners.get(s.pins.get(a)) == a) }
  action one = fileRead.then(accrue).then(referrers).then(tree)
  action toFirst = start.then(indexRead).then(fileRead)
  action finish = start.then(indexRead).then(one).then(one).then(fileRead).then(due)
  run capsAccumulateAcrossFilesTest = init.then(finish).expect(s.returned and s.pool == 3 and invariant)
  run emptyBeforeFirstClosedMonthTest = init.then(configure("none", 0, 0, 0, 1, 0, 0, 0, 0, false)).then(start).then(indexRead).then(fileRead).then(due).expect(s.returned and not(s.awaiting) and invariant)
  run filingGraceAllowsPendingMonthTest = init.then(configure("none", 0, 1, 0, 1, 0, 0, 0, 0, false)).then(start).then(indexRead).then(fileRead).then(due).expect(s.returned and s.awaiting and invariant)
  run graceExpiryRefusesMissingFileTest = init.then(configure("none", 0, 1, 1, 1, 0, 0, 0, 0, false)).then(start).then(indexRead).then(fileRead).then(due).expect(s.error == "stale" and invariant)
  run indexFailureReturnsNoFilesTest = init.then(configure("index-http", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(start).then(indexRead).expect(s.error == "index" and invariant)
  run openMonthFileRefusedTest = init.then(configure("none", 2, 1, 1, 1, 1, 1, 2, 2, false)).then(start).then(indexRead).then(one).then(fileRead).expect(s.error == "coverage" and invariant)
  run exactBodyAndHeaderDigestRequiredTest = init.then(configure("digest", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(toFirst).expect(s.error == "digest" and invariant)
  run identityMismatchRefusedTest = init.then(configure("identity", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(toFirst).expect(s.error == "identity" and invariant)
  run repeatedObligationAcrossMonthsRefusedTest = init.then(configure("duplicate", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(start).then(indexRead).then(one).then(fileRead).then(accrue).expect(s.error == "duplicate" and invariant)
  run excludedAmountsMustBeZeroTest = init.then(configure("none", 2, 2, 2, 1, 0, 0, 2, 2, true)).then(toFirst).then(accrue).expect(s.error == "excluded" and invariant)
  run arithmeticMismatchRefusedTest = init.then(configure("arithmetic", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(toFirst).then(accrue).expect(s.error == "arithmetic" and invariant)
  run overCapDeclarationRefusedTest = init.then(configure("none", 2, 2, 2, 1, 1, 1, 4, 4, false)).then(toFirst).then(accrue).expect(s.error == "cap" and invariant)
  run laterFileCannotResetLifetimeCapTest = init.then(declareSecond(2)).then(start).then(indexRead).then(one).then(fileRead).then(accrue).expect(s.error == "cap" and s.pool == 2 and invariant)
  run missingCumulativeReferrerRefusedTest = init.then(configure("cumulative", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(toFirst).then(accrue).then(referrers).expect(s.error == "cumulative" and invariant)
  run walletlessCarriesIntoLaterRootTest = init.then(configure("none", 2, 2, 2, 1, 0, 1, 2, 2, false)).then(finish).expect(s.returned and s.pins.get(1) == 1 and s.pool == 3 and invariant)
  run pinnedWalletCannotChangeTest = init.then(configure("none", 2, 2, 2, 1, 1, 2, 2, 2, false)).then(start).then(indexRead).then(one).then(fileRead).then(accrue).then(referrers).expect(s.error == "pin" and invariant)
  run pinnedWalletCannotDisappearTest = init.then(configure("none", 2, 2, 2, 1, 1, 0, 2, 2, false)).then(start).then(indexRead).then(one).then(fileRead).then(accrue).then(referrers).expect(s.error == "pin" and invariant)
  run walletCannotMoveToOtherActorTest = init.then(configure("none", 2, 2, 2, 2, 1, 1, 2, 2, false)).then(start).then(indexRead).then(one).then(fileRead).then(accrue).then(referrers).expect(s.error == "wallet" and invariant)
  run walletlessCannotPublishLeafTest = init.then(configure("walletless-leaf", 2, 2, 2, 1, 0, 0, 2, 2, false)).then(toFirst).then(accrue).then(referrers).expect(s.error == "walletless-leaf" and invariant)
  run treeSummaryMismatchRefusedTest = init.then(configure("tree", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(toFirst).then(accrue).then(referrers).then(tree).expect(s.error == "tree" and invariant)
  run proofBytesMismatchRefusedTest = init.then(configure("proof", 2, 2, 2, 1, 1, 1, 2, 2, false)).then(toFirst).then(accrue).then(referrers).then(tree).expect(s.error == "proof" and invariant)
}
