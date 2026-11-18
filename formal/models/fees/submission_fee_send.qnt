// @source workers/submission-fee/core.ts
// @source workers/submission-fee/store.ts
// @source workers/submission-fee/chain.ts
// @source workers/submission-fee/index.ts
// @source workers/submission-fee/config.ts
// @source workers/submission-fee/wrangler.toml
// @source scripts/release-submission-fee.ts
// @source migrations/0139_submission_fee_deposits.sql
// @evidence workers/submission-fee/submission-fee.test.ts
// @evidence scripts/release-submission-fee.test.ts
// The resolver's send journal for one network. A send is signed, recorded
// with its bytes, then broadcast; a run may die between any two steps. Two
// batches of due deposits (1 then 2), at most three signatures. `raw` names
// the signed bytes of the current attempt. `budget` abstracts the two native
// fee ceilings and `onChainOpen` the contract's own record read before
// signing. Mode, deployed contract, Slopbot's table and the key gate the
// run; the release refuses `live` without the contract and the key. Exact
// gas arithmetic, the receipt checks and the contract are separate
// contracts. Scheduler fairness is not assumed: a send may stay in flight.
module submission_fee_send {
  var s: { mode: str, contract: bool, items: bool, key: bool, released: bool,
    phase: str, row: str, raw: int, signatures: int, journaled: Set[int], broadcasts: Set[int],
    mined: Set[int], due: int, settled: Set[int], recorded: int, dryRecorded: bool,
    budget: bool, onChainOpen: bool, result: str }
  action init = s' = { mode: "off", contract: false, items: false, key: false, released: false,
    phase: "idle", row: "none", raw: 0, signatures: 0, journaled: Set(), broadcasts: Set(),
    mined: Set(), due: 1, settled: Set(), recorded: 0, dryRecorded: false,
    budget: true, onChainOpen: true, result: "none" }

  // Operator steps: deploy the contract, add Slopbot's table, install the key.
  action deployContract = all { not(s.contract), s' = s.with("contract", true) }
  action addItems = all { not(s.items), s' = s.with("items", true) }
  action installKey = all { not(s.key), s' = s.with("key", true) }
  // The release check: live needs the contract and the key; off and dry_run need neither.
  action release(mode) = all { s.phase == "idle",
    mode == "live" implies (s.contract and s.key),
    s' = s.with("mode", mode).with("released", true) }
  action policy(budget, onChainOpen) = all { s.phase == "idle",
    s' = s.with("budget", budget).with("onChainOpen", onChainOpen) }

  val open = Set("submitted", "unknown").contains(s.row)
  val runs = s.released and s.mode != "off" and s.contract and s.items
  // A run that cannot start says why and touches nothing.
  action inert = all { s.phase == "idle", not(runs),
    s' = s.with("result", if (not(s.released) or s.mode == "off") "off"
      else if (not(s.contract)) "contract_unset" else "items_table_missing") }
  // dry_run records the list it would send, once, and signs nothing.
  action dryRun = all { s.phase == "idle", runs, s.mode == "dry_run", s.onChainOpen,
    not(s.settled.contains(s.due)),
    s' = s.with("dryRecorded", true).with("result", if (s.dryRecorded) "unchanged" else "recorded") }
  action prepare = all { s.phase == "idle", runs, s.mode == "live", s.key, not(open),
    s.budget, s.onChainOpen, not(s.settled.contains(s.due)), s.signatures < 3,
    s' = s.with("phase", "prepared").with("signatures", s.signatures + 1).with("raw", s.signatures + 1) }
  // Refused before signing: nothing is recorded.
  action blocked = all { s.phase == "idle", runs, s.mode == "live", not(open),
    not(s.budget) or not(s.onChainOpen) or not(s.key),
    s' = s.with("result", if (not(s.key)) "no_resolver_key"
      else if (not(s.onChainOpen)) "none" else "gas_budget") }
  // Durable before broadcast. The one-in-flight index refuses a second row.
  action journal = all { s.phase == "prepared", not(open),
    s' = s.with("phase", "journaled").with("row", "submitted").with("recorded", s.recorded + 1)
      .with("journaled", s.journaled.union(Set(s.raw))) }
  // The run dies after signing and before recording: the bytes are lost unsent.
  action dieUnjournaled = all { s.phase == "prepared", s' = s.with("phase", "idle") }
  action broadcast(ok) = all { s.phase == "journaled",
    s' = s.with("phase", "idle")
      .with("broadcasts", if (ok) s.broadcasts.union(Set(s.raw)) else s.broadcasts)
      .with("row", if (ok) "submitted" else "unknown").with("result", if (ok) "sent" else "in_flight") }
  // The run dies after recording and before the bytes leave.
  action dieJournaled = all { s.phase == "journaled", s' = s.with("phase", "idle").with("result", "in_flight") }
  // A later run resends the same bytes; it never signs again while one is open.
  action rebroadcast(ok) = all { s.phase == "idle", runs, s.mode == "live", open, not(s.mined.contains(s.raw)),
    s' = s.with("broadcasts", if (ok) s.broadcasts.union(Set(s.raw)) else s.broadcasts)
      .with("row", if (ok) "submitted" else "unknown").with("result", "in_flight") }
  action mine = all { open, s.broadcasts.contains(s.raw), not(s.mined.contains(s.raw)),
    s' = s.with("mined", s.mined.union(Set(s.raw))) }
  action pending = all { s.phase == "idle", runs, s.mode == "live", open, s' = s.with("result", "in_flight") }
  action finalized = all { s.phase == "idle", runs, s.mode == "live", open, s.mined.contains(s.raw),
    s' = s.with("row", "finalized").with("settled", s.settled.union(Set(s.due))).with("result", "none") }
  // Reverted, or its nonce was used by another finalized transaction.
  action failed = all { s.phase == "idle", runs, s.mode == "live", open, not(s.mined.contains(s.raw)),
    s' = s.with("row", "failed").with("result", "none") }
  action nextBatch = all { s.phase == "idle", s.due == 1, s.settled.contains(1), not(open),
    s' = s.with("due", 2) }

  action step = { nondet a = Set(true, false).oneOf() nondet b = Set(true, false).oneOf()
    nondet m = Set("off", "dry_run", "live").oneOf()
    any { deployContract, addItems, installKey, release(m), policy(a, b), inert, dryRun, prepare, blocked,
      journal, dieUnjournaled, broadcast(a), dieJournaled, rebroadcast(a), mine, pending, finalized,
      failed, nextBatch, s' = s } }

  val invariant = all {
    s.signatures <= 3,
    // Only recorded bytes are ever broadcast, and only broadcast bytes are mined.
    s.broadcasts.subseteq(s.journaled), s.mined.subseteq(s.broadcasts),
    // An open send always has its bytes on record.
    open implies s.journaled.contains(s.raw),
    // Nothing is signed or recorded outside live mode with a contract, a table and a key.
    s.signatures > 0 implies (s.contract and s.items and s.key),
    // A batch is settled only by a mined transaction.
    s.settled.size() <= s.mined.size(),
    s.recorded == s.journaled.size()
  }

  run offIsInertTest = init.then(deployContract).then(addItems).then(installKey).then(release("off"))
    .then(inert).then(prepare.fail())
  run unsetContractIsInertTest = init.then(addItems).then(release("dry_run")).then(inert)
    .expect(s.result == "contract_unset" and s.signatures == 0 and not(s.dryRecorded) and invariant)
  run missingItemsTableIsInertTest = init.then(deployContract).then(release("dry_run")).then(inert)
    .expect(s.result == "items_table_missing" and invariant)
  run liveRefusedWithoutKeyTest = init.then(deployContract).then(addItems).then(release("live").fail())
  run dryRunRecordsOnceAndNeverSignsTest = init.then(deployContract).then(addItems).then(release("dry_run"))
    .then(dryRun).then(dryRun)
    .expect(s.result == "unchanged" and s.signatures == 0 and s.recorded == 0 and invariant)
  run dryRunNeverPreparesTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("dry_run")).then(prepare.fail())
  run sentThenSettledTest = init.then(deployContract).then(addItems).then(installKey).then(release("live"))
    .then(prepare).then(journal).then(broadcast(true)).then(pending).then(mine).then(finalized)
    .expect(s.settled == Set(1) and s.signatures == 1 and invariant)
  run diedAfterRecordingResendsSameBytesTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("live")).then(prepare).then(journal).then(dieJournaled).then(prepare.fail())
  run resendKeepsOneSignatureTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("live")).then(prepare).then(journal).then(dieJournaled).then(rebroadcast(false))
    .then(rebroadcast(true)).then(mine).then(finalized)
    .expect(s.signatures == 1 and s.broadcasts == Set(1) and s.settled == Set(1) and invariant)
  run diedBeforeRecordingSendsNothingTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("live")).then(prepare).then(dieUnjournaled)
    .expect(s.broadcasts == Set() and s.row == "none" and invariant)
  run oneInFlightTest = init.then(deployContract).then(addItems).then(installKey).then(release("live"))
    .then(prepare).then(journal).then(broadcast(true)).then(prepare.fail())
  run failedSendIsSentForAgainTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("live")).then(prepare).then(journal).then(broadcast(true)).then(failed)
    .then(prepare).then(journal).then(broadcast(true)).then(mine).then(finalized)
    .expect(s.signatures == 2 and s.settled == Set(1) and invariant)
  run gasBudgetSignsNothingTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("live")).then(policy(false, true)).then(blocked)
    .expect(s.result == "gas_budget" and s.signatures == 0 and invariant)
  run resolvedOnChainIsNotSentAgainTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("live")).then(policy(true, false)).then(prepare.fail())
  run secondBatchWaitsForFirstTest = init.then(deployContract).then(addItems).then(installKey)
    .then(release("live")).then(prepare).then(journal).then(broadcast(true)).then(nextBatch.fail())
}
