// @source contracts/solana/programs/slop-submission-deposits/src/lib.rs
// @source contracts/solana/programs/slop-submission-deposits/Cargo.toml
// @evidence contracts/solana/integration/submission-deposits.e2e.mjs
// @evidence contracts/solana/integration/submission-deposits-invariant.e2e.mjs
// @evidence contracts/solana/integration/submission-deposits-rehearsal.e2e.mjs
// The Solana counterpart of submission_deposits. Two deposit ids of one unit each,
// three callers (1 first owner, 2 first resolver, 3 a payer; roles may move among
// them), the upgrade authority as its own actor, one valid kept wallet (4), ticks
// 0..3 and a reclaim delay of 2 ticks. Deposits are made at ticks 0..1 so the delay
// can run out. An instruction is one atomic step: a transfer the token program
// refuses fails the whole instruction, so there is no in-flight state and no lock.
// What differs from the EVM contract and is modeled here: the program exists before
// its Config and only the upgrade authority creates it, once; the authority can be
// removed and never returns; a deposit's record is an account that exists exactly
// while the deposit is open, and its rent returns to the payer on every outcome; a
// refund and a kept payout go to the wallet's associated token account, which the
// wallet or the token's issuer can make unusable (closed, frozen, handed to another
// owner: one "blocked" state); a reclaim may also go to another token account the
// payer owns; and the next id is part of the record's address, so a deposit built
// for any other id is refused.
// Not modeled: several mints and their ledgers, amounts other than one, tokens sent
// to a vault without a deposit, and the Token program's own rules.
module solana_submission_deposits {
  type D = { state: str, payer: int, to: int, at: int, dest: str, rentTo: int }
  type S = { authority: bool, config: bool, owner: int, pending: int, resolver: int,
    paused: bool, tick: int, held: int, count: int, payerAccount: str, keptAccount: str,
    d: int -> D }
  var s: S
  pure val Kept = 4
  pure val Delay = 2
  pure val empty: D = { state: "none", payer: 0, to: 0, at: 0, dest: "", rentTo: 0 }
  action init = s' = { authority: true, config: false, owner: 0, pending: 0, resolver: 0,
    paused: false, tick: 0, held: 0, count: 0, payerAccount: "ok", keptAccount: "ok",
    d: Map(1 -> empty, 2 -> empty) }
  action tick = all { s.tick < 3, s' = s.with("tick", s.tick + 1) }

  // initialize(owner, resolver, reclaim_delay): the upgrade authority only, once.
  action initialize(byAuthority: bool, owner: int, resolver: int, delayValid: bool): bool = all {
    s.authority, byAuthority, not(s.config), owner > 0, resolver > 0, owner != resolver, delayValid,
    s' = s.with("config", true).with("owner", owner).with("resolver", resolver) }
  // The loader's own instruction; the program has no say in it. It cannot be undone.
  action removeAuthority(byAuthority: bool): bool = all { s.authority, byAuthority,
    s' = s.with("authority", false) }

  // deposit(item, amount, kept_to) for the record at address `id`.
  action deposit(caller: int, keptTo: int, id: int): bool = all {
    s.config, not(s.paused), keptTo == Kept, s.count < 2, id == s.count + 1, s.tick <= 1,
    s' = s.with("count", id).with("held", s.held + 1)
      .with("d", s.d.set(id, { state: "open", payer: caller, to: keptTo, at: s.tick, dest: "", rentTo: 0 })) }

  // resolve(refund) with the destination the transaction names. Only the associated
  // account of the right wallet is accepted, and only while it is usable.
  action resolve(caller: int, id: int, refund: bool, destination: str): bool = all {
    s.config, caller == s.resolver, s.d.get(id).state == "open",
    destination == (if (refund) "payer-associated" else "kept-associated"),
    (if (refund) s.payerAccount else s.keptAccount) == "ok",
    s' = s.with("held", s.held - 1)
      .with("d", s.d.set(id, s.d.get(id).with("state", if (refund) "refunded" else "kept")
        .with("dest", destination).with("rentTo", s.d.get(id).payer))) }

  // reclaim(): the payer, after the delay, to any token account the payer owns.
  action reclaim(caller: int, id: int, destination: str): bool = all {
    s.config, s.d.get(id).state == "open", caller == s.d.get(id).payer,
    s.tick >= s.d.get(id).at + Delay,
    Set("payer-associated", "payer-other").contains(destination),
    destination == "payer-associated" implies s.payerAccount == "ok",
    s' = s.with("held", s.held - 1)
      .with("d", s.d.set(id, s.d.get(id).with("state", "reclaimed")
        .with("dest", destination).with("rentTo", s.d.get(id).payer))) }

  // The payer closes, hands over or recreates their associated account; the issuer
  // freezes or thaws either one. Nothing the program does.
  action payerAccountBecomes(state: str): bool = s' = s.with("payerAccount", state)
  action keptAccountBecomes(state: str): bool = s' = s.with("keptAccount", state)

  action setResolver(caller: int, candidate: int): bool = all { s.config, caller == s.owner, candidate > 0,
    candidate != s.owner, candidate != s.pending, candidate != s.resolver, s' = s.with("resolver", candidate) }
  action pauseDeposits(caller: int, paused: bool): bool = all { s.config, caller == s.owner, paused != s.paused,
    s' = s.with("paused", paused) }
  action transferOwner(caller: int, candidate: int): bool = all { s.config, caller == s.owner,
    candidate != s.resolver, s' = s.with("pending", candidate) }
  action acceptOwner(caller: int): bool = all { s.config, caller > 0, caller == s.pending,
    s' = s.with("owner", caller).with("pending", 0) }

  // Each action draws only the choices it reads, so the graph stays small.
  pure val Callers = Set(1, 2, 3)
  pure val Candidates = Set(0, 1, 2, 3)
  pure val Ids = Set(1, 2)
  pure val Flags = Set(true, false)
  pure val Destinations = Set("payer-associated", "payer-other", "kept-associated", "resolver-own")
  action stepInitialize = {
    nondet byAuthority = oneOf(Flags)
    nondet owner = oneOf(Candidates)
    nondet resolver = oneOf(Candidates)
    nondet delayValid = oneOf(Flags)
    initialize(byAuthority, owner, resolver, delayValid)
  }
  action stepRemoveAuthority = { nondet byAuthority = oneOf(Flags) removeAuthority(byAuthority) }
  action stepDeposit = {
    nondet caller = oneOf(Callers)
    nondet keptTo = oneOf(Set(0, 4))
    nondet id = oneOf(Ids)
    deposit(caller, keptTo, id)
  }
  action stepResolve = {
    nondet caller = oneOf(Callers)
    nondet id = oneOf(Ids)
    nondet refund = oneOf(Flags)
    nondet destination = oneOf(Destinations)
    resolve(caller, id, refund, destination)
  }
  action stepReclaim = {
    nondet caller = oneOf(Callers)
    nondet id = oneOf(Ids)
    nondet destination = oneOf(Destinations)
    reclaim(caller, id, destination)
  }
  action stepAccounts = {
    nondet account = oneOf(Set("ok", "blocked"))
    any { payerAccountBecomes(account), keptAccountBecomes(account) }
  }
  action stepOwner = {
    nondet caller = oneOf(Callers)
    nondet candidate = oneOf(Candidates)
    nondet flag = oneOf(Flags)
    any { setResolver(caller, candidate), pauseDeposits(caller, flag), transferOwner(caller, candidate),
      acceptOwner(caller) }
  }
  action step = any { tick, stepInitialize, stepRemoveAuthority, stepDeposit, stepResolve, stepReclaim,
    stepAccounts, stepOwner, s' = s }

  def open(id: int): bool = s.d.get(id).state == "open"
  def recorded(id: int): bool = s.d.get(id).state != "none"
  // A deposit leaves the open state once, to its own payer (refund, reclaim) or its
  // own kept wallet (kept), and the rent of its record goes to its payer.
  def paidRight(id: int): bool = {
    val r = s.d.get(id)
    all {
      (r.state == "none" or r.state == "open") implies (r.dest == "" and r.rentTo == 0),
      r.state == "kept" implies (r.dest == "kept-associated" and r.rentTo == r.payer),
      r.state == "refunded" implies (r.dest == "payer-associated" and r.rentTo == r.payer),
      r.state == "reclaimed" implies (Set("payer-associated", "payer-other").contains(r.dest) and r.rentTo == r.payer),
      recorded(id) implies (r.to == Kept and r.payer > 0),
      r.state == "reclaimed" implies s.tick >= r.at + Delay }
  }
  def holds(id: int): int = if (open(id)) 1 else 0
  val invariant = all {
    // Nothing exists before the upgrade authority's one initialize.
    not(s.config) implies (s.count == 0 and s.owner == 0 and s.resolver == 0 and not(s.paused)),
    s.config implies (s.owner > 0 and s.resolver > 0 and s.resolver != s.owner and s.resolver != s.pending),
    paidRight(1), paidRight(2),
    // The vault holds exactly the open deposits, whose records are the only ones that exist.
    s.held == holds(1) + holds(2),
    // Ids count up from 1 with no gap.
    recorded(2) implies recorded(1), s.count == (if (recorded(2)) 2 else if (recorded(1)) 1 else 0) }

  run ready = init.then(initialize(true, 1, 2, true))
  run oneOpen = ready.then(deposit(3, 4, 1))
  run onlyTheAuthorityInitializesTest = init.then(initialize(false, 1, 2, true).fail())
  run initializeRefusesASharedRoleTest = init.then(initialize(true, 1, 1, true).fail())
  run initializeRefusesAMissingOwnerTest = init.then(initialize(true, 0, 2, true).fail())
  run initializeRefusesAMissingResolverTest = init.then(initialize(true, 1, 0, true).fail())
  run initializeRefusesABadDelayTest = init.then(initialize(true, 1, 2, false).fail())
  run initializesOnceTest = ready.then(initialize(true, 3, 2, true).fail())
  run noDepositBeforeInitializeTest = init.then(deposit(3, 4, 1).fail())
  run removedAuthorityCannotInitializeTest = init.then(removeAuthority(true)).then(initialize(true, 1, 2, true).fail())
  run removedAuthorityDoesNotReturnTest = ready.then(removeAuthority(true)).then(removeAuthority(true).fail())
  run programWorksWithoutTheAuthorityTest = ready.then(removeAuthority(true)).then(deposit(3, 4, 1))
    .then(resolve(2, 1, true, "payer-associated")).expect(s.held == 0 and invariant)
  run refundGoesToThePayerTest = oneOpen.then(resolve(2, 1, true, "payer-associated"))
    .expect(s.d.get(1).dest == "payer-associated" and s.d.get(1).rentTo == 3 and s.held == 0 and invariant)
  run keptGoesToTheKeptWalletTest = oneOpen.then(resolve(2, 1, false, "kept-associated"))
    .expect(s.d.get(1).dest == "kept-associated" and s.d.get(1).rentTo == 3 and s.held == 0 and invariant)
  run refundCannotGoToTheResolverTest = oneOpen.then(resolve(2, 1, true, "resolver-own").fail())
  run keptCannotGoToTheResolverTest = oneOpen.then(resolve(2, 1, false, "resolver-own").fail())
  run refundCannotGoToTheKeptWalletTest = oneOpen.then(resolve(2, 1, true, "kept-associated").fail())
  run keptCannotGoToThePayerTest = oneOpen.then(resolve(2, 1, false, "payer-associated").fail())
  run refundCannotGoToAnotherPayerAccountTest = oneOpen.then(resolve(2, 1, true, "payer-other").fail())
  run resolvesOnceTest = oneOpen.then(resolve(2, 1, true, "payer-associated"))
    .then(resolve(2, 1, false, "kept-associated").fail())
  run ownerCannotSettleTest = oneOpen.then(resolve(1, 1, true, "payer-associated").fail())
  run payerCannotSettleTest = oneOpen.then(resolve(3, 1, true, "payer-associated").fail())
  run skippedIdRefusedTest = ready.then(deposit(3, 4, 2).fail())
  run usedIdRefusedTest = oneOpen.then(deposit(1, 4, 1).fail())
  run blockedPayerAccountBlocksTheRefundTest = oneOpen.then(payerAccountBecomes("blocked"))
    .then(resolve(2, 1, true, "payer-associated").fail())
  run blockedPayerAccountStillAllowsKeptTest = oneOpen.then(payerAccountBecomes("blocked"))
    .then(resolve(2, 1, false, "kept-associated")).expect(s.d.get(1).dest == "kept-associated" and invariant)
  run blockedPayerAccountRecoversTest = oneOpen.then(payerAccountBecomes("blocked")).then(payerAccountBecomes("ok"))
    .then(resolve(2, 1, true, "payer-associated")).expect(s.held == 0 and invariant)
  run blockedPayerCannotReclaimToThatAccountTest = oneOpen.then(payerAccountBecomes("blocked"))
    .then(tick).then(tick).then(reclaim(3, 1, "payer-associated").fail())
  run blockedPayerReclaimsToAnotherAccountTest = oneOpen.then(payerAccountBecomes("blocked"))
    .then(tick).then(tick).then(reclaim(3, 1, "payer-other"))
    .expect(s.d.get(1).state == "reclaimed" and s.d.get(1).rentTo == 3 and s.held == 0 and invariant)
  run blockedKeptAccountBlocksKeptTest = oneOpen.then(keptAccountBecomes("blocked"))
    .then(resolve(2, 1, false, "kept-associated").fail())
  run blockedKeptAccountStillAllowsTheRefundTest = oneOpen.then(keptAccountBecomes("blocked"))
    .then(resolve(2, 1, true, "payer-associated")).expect(s.held == 0 and invariant)
  run ownerCannotReclaimTest = oneOpen.then(tick).then(tick).then(reclaim(1, 1, "payer-other").fail())
  run earlyReclaimRefusedTest = oneOpen.then(tick).then(reclaim(3, 1, "payer-associated").fail())
  run reclaimNeverReachesTheKeptWalletTest = oneOpen.then(tick).then(tick)
    .then(reclaim(3, 1, "kept-associated").fail())
  run reclaimNeverReachesTheResolverTest = oneOpen.then(tick).then(tick).then(reclaim(3, 1, "resolver-own").fail())
  run reclaimedCannotBeSettledTest = oneOpen.then(tick).then(tick)
    .then(reclaim(3, 1, "payer-associated")).then(resolve(2, 1, false, "kept-associated").fail())
  run settledCannotBeReclaimedTest = oneOpen.then(resolve(2, 1, false, "kept-associated"))
    .then(tick).then(tick).then(reclaim(3, 1, "payer-associated").fail())
  run pausedDepositRefusedTest = ready.then(pauseDeposits(1, true)).then(deposit(3, 4, 1).fail())
  run pauseNeverBlocksSettlementTest = oneOpen.then(pauseDeposits(1, true))
    .then(resolve(2, 1, true, "payer-associated")).expect(s.held == 0 and invariant)
  run pauseNeverBlocksReclaimTest = oneOpen.then(pauseDeposits(1, true)).then(tick).then(tick)
    .then(reclaim(3, 1, "payer-associated")).expect(s.held == 0 and invariant)
  run missingKeptWalletRefusedTest = ready.then(deposit(3, 0, 1).fail())
  run ownerCannotBecomeResolverTest = ready.then(setResolver(1, 1).fail())
  run pendingOwnerCannotBecomeResolverTest = ready.then(transferOwner(1, 3)).then(setResolver(1, 3).fail())
  run resolverCannotBeNamedOwnerTest = ready.then(transferOwner(1, 2).fail())
  run cancelledOwnershipCannotBeAcceptedTest = ready.then(transferOwner(1, 3)).then(transferOwner(1, 0)).then(acceptOwner(3).fail())
  run replacedResolverLosesPowerTest = oneOpen.then(setResolver(1, 3))
    .then(resolve(2, 1, true, "payer-associated").fail())
  run handedOver = oneOpen.then(transferOwner(1, 3)).then(acceptOwner(3)).then(setResolver(3, 1))
  run newResolverCannotRedirectTest = handedOver.then(resolve(1, 1, true, "resolver-own").fail())
  run newResolverStillHasOnlyTheTwoOutcomesTest = handedOver.then(resolve(1, 1, false, "kept-associated"))
    .expect(s.d.get(1).dest == "kept-associated" and s.d.get(1).payer == 3 and s.owner == 3 and s.resolver == 1 and invariant)
  run twoDepositsSettleIndependentlyTest = oneOpen.then(tick).then(deposit(1, 4, 2))
    .then(resolve(2, 2, false, "kept-associated")).then(tick).then(reclaim(3, 1, "payer-other"))
    .expect(s.d.get(1).rentTo == 3 and s.d.get(2).rentTo == 1 and s.held == 0 and invariant)
  run secondDepositHasItsOwnClockTest = oneOpen.then(tick).then(deposit(3, 4, 2)).then(tick)
    .then(reclaim(3, 2, "payer-associated").fail())
}
