# Submission fee resolver sends

PRD section 6, "Submission fee deposits" (operator decisions of 18, 19 and
21 November 2026; live since 21 November): the submission-fee Worker sends
the refunds and kept fees that are due as `resolveMany` transactions of the
published `SubmissionDeposits` contract, signed by its own resolver key
(`SUBMISSION_FEE_RESOLVER_KEY`), which is separate from every fee-wallet
key. Sources at Slop development `8660a6121`:
`workers/submission-fee/core.ts` (`send`, `reconcile`, `recheck`,
`runNetwork`), `chain.ts` (`prepare`, `broadcast`, `status`, `probe`),
`store.ts` (sends, parked deposits, the native budget), `config.ts`,
`index.ts`, `wrangler.toml`, migration `0139_submission_fee_deposits.sql`
and development's own model `formal/models/fees/submission_fee_send.qnt`
(#3053, #3092, #3186).

What is due comes from the [deposit judgement](./submissionFeeDeposits.md)
and the [report deposit judgement](./submissionFeeReportDeposits.md); the
contracts, chain ids and start blocks are the published
[terms](../backend/submissionFeeTerms.md). The release program publishes the
Worker's mode and ceilings and refuses `live` unless both contracts and the
key are in place ([release](../operations/release.md)).

One instance follows the send journal of one network. A send is signed,
recorded with its bytes, then broadcast, and a run may die between any two
steps. `Release` publishes the configuration, `Chain` reports what the
contract and the network do (its record of each deposit, a payout the token
refuses, a revert no deposit explains, a mined transaction), and `Worker`
is the run. Native amounts are wei; the ceilings are at most 2^53 - 1 by
the configuration's own parse, and a product of gas and fee price beyond
that range is above the per-transaction ceiling and is refused before this
rule is asked.

## Story: Send only what is due, once, inside the native ceilings

> As Slop, I want the resolver to return or keep each deposit exactly as
> its pull request or report says, with every signature recorded before it
> leaves and never more native spend than the ceilings allow.

### The resolver signs only resolveMany for due deposits on the published contract, inside its native ceilings

Each run reads the contract's own record of every planned deposit first:
one that differs from the stored row in payer, token, amount, kept
destination or item stops the network for this run, and one no longer open
on chain is left out (its event is still on its way through the finalized
scan). At most 20 deposits go in one transaction, oldest first. The batch
is simulated at the latest block; the signed gas limit is the estimate
times 1.3 rounded up, and the signed maximum, gas limit times
`maxFeePerGas`, must be positive, at most the per-transaction ceiling, and
with the live sends already recorded this UTC day at most the daily ceiling,
or nothing is signed (`gas_budget`). Production ceilings are 0.0002 ETH per
transaction and 0.002 ETH per UTC day on each network; the daily ceiling
must cover one transaction. The key signs only `resolveMany(ids, refunds)`
to the network's published contract on its chain id, with ascending ids
and one refund flag each.

```quint
import runtime as R from "./runtime"
type Actor = Release | Chain | Worker
type Ceilings = { perTxWei: int, perDayWei: int }
type ResolveIntent = { chainId: int, contract: str, ids: List[int], refunds: List[bool] }
type PublishedContract = { chainId: int, contract: str }
type IdRun = { ascending: bool, previous: int }
pure val maxBatch = 20
pure val productionCeilings: Ceilings = { perTxWei: 200000000000000, perDayWei: 2000000000000000 }
pure val maxSafeWei = 9007199254740991
pure def validCeilings(ceilings: Ceilings): bool = ceilings.perTxWei > 0 and ceilings.perDayWei >= ceilings.perTxWei
  and ceilings.perDayWei <= maxSafeWei
pure def gasLimitFor(estimate: int): int = (estimate * 13 + 9) / 10
pure def withinNativeCeilings(maximum: int, spentToday: int, ceilings: Ceilings): bool = maximum > 0
  and maximum <= ceilings.perTxWei and spentToday + maximum <= ceilings.perDayWei
pure def firstBatch(ids: List[int]): List[int] = ids.foldl(List(), (batch, id) => if (batch.length() < maxBatch) batch.append(id) else batch)
pure def ascendingIds(ids: List[int]): bool =
  ids.foldl({ ascending: true, previous: 0 }, (scan, id) => { ascending: scan.ascending and id > scan.previous, previous: id }).ascending
pure def resolverMaySign(intent: ResolveIntent, published: PublishedContract): bool = published.contract != ""
  and intent.chainId == published.chainId and intent.contract == published.contract and intent.ids.length() > 0
  and intent.ids.length() <= maxBatch and intent.refunds.length() == intent.ids.length() and ascendingIds(intent.ids)
pure def lawGasLimitCoversEstimate(estimate: int): bool = estimate > 0 implies
  (gasLimitFor(estimate) * 10 >= estimate * 13 and gasLimitFor(estimate) * 10 < estimate * 13 + 10)
pure def lawProductionCeilingsValid(ceilings: Ceilings): bool = ceilings == productionCeilings implies validCeilings(ceilings)
pure def lawBatchAtMostTwenty(ids: List[int]): bool = firstBatch(ids).length() <= maxBatch
  and (ids.length() <= maxBatch implies firstBatch(ids) == ids)
pure def lawSignsOnlyThePublishedContract(intent: ResolveIntent, published: PublishedContract): bool =
  resolverMaySign(intent, published) implies (intent.contract == published.contract and intent.chainId == published.chainId
    and intent.ids.length() <= maxBatch)
pure val estimateValues = Set(1, 21000, 153847, 1000000)
pure val ceilingsValues = Set(productionCeilings, { perTxWei: 200000000000000, perDayWei: 199999999999999 })
pure val idsValues = Set(List(), List(1, 2, 3), List(3, 2),
  List(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21))
pure val intentValues = Set(
  { chainId: 8453, contract: "0xde40b32a4156abc2a05987367966d994bcfbf8d8", ids: List(4, 9), refunds: List(true, false) },
  { chainId: 4663, contract: "0xde40b32a4156abc2a05987367966d994bcfbf8d8", ids: List(4, 9), refunds: List(true, false) },
  { chainId: 8453, contract: "0xde40b32a4156abc2a05987367966d994bcfbf8d8", ids: List(9, 4), refunds: List(true, false) },
  { chainId: 8453, contract: "0x0000000000000000000000000000000000000001", ids: List(4), refunds: List(true) },
  { chainId: 8453, contract: "0xde40b32a4156abc2a05987367966d994bcfbf8d8", ids: List(4), refunds: List() })
pure val publishedValues = Set({ chainId: 8453, contract: "0xde40b32a4156abc2a05987367966d994bcfbf8d8" },
  { chainId: 4663, contract: "" })
```

### Off is inert, dry_run signs nothing, live needs the key

`off` reads and writes nothing, even with the rest of the configuration
incomplete. Without Slopbot's item table (`submission_fee_items`, migration
0141) no deposit can be matched, so nothing is read on any network
(`items_table_missing`). A network with no published contract is skipped and logged; a
chain whose id differs from the published one is not read at all; one
network's failure never stops the other, and its result names the failing
step. `dry_run` reads, judges and marks pull requests paid, and records the
list it would send once per change (an unchanged list records nothing),
loads no key, and signs, simulates and parks nothing. `live` also signs,
and refuses to start without the key. The ceilings are required in every
mode but `off`.

```quint
type SendConfig = { mode: R::Mode, contract: bool, key: bool, itemsTable: bool, ceilings: Ceilings }
type SendRow = NoSendRow | Submitted | Unknown | Finalized | Failed
type SendPhase = Idle | Signed | Journaled
type SendResult = NothingSent | WorkerOff | ItemsTableMissing | ContractUnset | ChainMismatch | ListRecorded | ListUnchanged | BatchSent | SendInFlight
  | OverGasBudget | DepositParked | BatchReverted
type ChainRecords = { storedMatches: bool, stillOpen: bool }
type Sends = { config: SendConfig, chainMatches: bool, records: ChainRecords, phase: SendPhase, row: SendRow, signedBytes: int,
  signatures: int, journaled: Set[int], broadcasts: Set[int], mined: Set[int], batch: int, settledBatches: Set[int],
  listRecorded: bool, spentToday: int, reserved: int, stuck: bool, everStuck: bool, parked: bool, parks: int, inBatch: bool,
  systemic: bool, result: SendResult }
pure val offConfig: SendConfig = { mode: R::Off, contract: false, key: false, itemsTable: false, ceilings: productionCeilings }
pure val initial: Sends = { config: offConfig, chainMatches: true, records: { storedMatches: true, stillOpen: true }, phase: Idle,
  row: NoSendRow, signedBytes: 0, signatures: 0, journaled: Set(), broadcasts: Set(), mined: Set(), batch: 1, settledBatches: Set(),
  listRecorded: false, spentToday: 0, reserved: 0, stuck: false, everStuck: false, parked: false, parks: 0, inBatch: false,
  systemic: false, result: NothingSent }
pure def openSend(s: Sends): bool = s.row == Submitted or s.row == Unknown
pure def reads(s: Sends): bool = s.config.mode != R::Off and s.config.itemsTable and s.config.contract and s.chainMatches
pure def due(s: Sends): bool = s.records.storedMatches and s.records.stillOpen and not(s.settledBatches.contains(s.batch))
pure def liveRun(s: Sends): bool = reads(s) and s.config.mode == R::Live and s.config.key
pure def canPublish(s: Sends, sendConfig: SendConfig, by: Actor): bool = by == Release and s.phase == Idle
  and validCeilings(sendConfig.ceilings)
pure def publish(s: Sends, sendConfig: SendConfig, by: Actor): Sends = { ...s, config: sendConfig }
pure def canChangeChain(s: Sends, matches: bool, by: Actor): bool = by == Chain and s.phase == Idle and matches != s.chainMatches
pure def changeChain(s: Sends, matches: bool, by: Actor): Sends = { ...s, chainMatches: matches }
pure def canReportRecords(s: Sends, records: ChainRecords, by: Actor): bool = by == Chain and s.phase == Idle and records != s.records
pure def reportRecords(s: Sends, records: ChainRecords, by: Actor): Sends = { ...s, records: records }
pure def canStayInert(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and not(reads(s))
pure def stayInert(s: Sends, by: Actor): Sends =
  { ...s, result: if (s.config.mode == R::Off) WorkerOff else if (not(s.config.itemsTable)) ItemsTableMissing
    else if (not(s.config.contract)) ContractUnset else ChainMismatch }
pure def canRecordList(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and reads(s) and s.config.mode == R::DryRun
  and due(s)
pure def recordList(s: Sends, by: Actor): Sends = { ...s, listRecorded: true, result: if (s.listRecorded) ListUnchanged else ListRecorded }
pure def stepSignsOnlyLiveWithKeyInsideCeilings(before: Sends, after: Sends): bool = after.signatures > before.signatures implies
  (after.signatures == before.signatures + 1 and before.config.mode == R::Live and before.config.contract and before.config.key
    and before.config.itemsTable
    and not(openSend(before)) and withinNativeCeilings(after.reserved, before.spentToday, before.config.ceilings))
pure def sometimesListRecordedOnce(s: Sends): bool = s.result == ListUnchanged and s.signatures == 0
pure val sendConfigValues = Set(
  { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings },
  { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: { perTxWei: 200000000000000, perDayWei: 200000000000000 } },
  { mode: R::DryRun, contract: true, key: false, itemsTable: true, ceilings: productionCeilings },
  { mode: R::Live, contract: true, key: false, itemsTable: true, ceilings: productionCeilings },
  { mode: R::Live, contract: false, key: true, itemsTable: true, ceilings: productionCeilings },
  { mode: R::Live, contract: true, key: true, itemsTable: false, ceilings: productionCeilings },
  { mode: R::Off, contract: false, key: false, itemsTable: false, ceilings: { perTxWei: 0, perDayWei: 0 } })
pure val recordsValues = Set({ storedMatches: true, stillOpen: true }, { storedMatches: false, stillOpen: true },
  { storedMatches: true, stillOpen: false })
pure val byValues = Set(Release, Chain, Worker)
```

### A signed send is recorded before broadcast and one send per network is in flight

The signed bytes, their transaction id, nonce and native maximum are
recorded as `submitted` before they are broadcast, and the insert repeats
the daily ceiling and holds the one-open-send index, so a concurrent signer
that loses never broadcasts. Bytes lost before they were recorded are never
broadcast. A broadcast that fails leaves the send `unknown`. While a send is
`submitted` or `unknown`, each live run reconciles it and signs nothing:
a finalized successful receipt makes it `finalized`; a reverted receipt, or
its nonce used by another finalized transaction, makes it `failed`, which
is final, and its deposits stay due for a later send; otherwise the same
bytes are broadcast again, never a new signature. A send row's identity and
bytes never change, and `finalized`, `failed` and a dry run's `recorded` row
are final.

```quint
type SendCost = { maximum: int }
pure def canSign(s: Sends, cost: SendCost, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s) and not(openSend(s))
  and due(s) and not(s.systemic) and (not(s.stuck) or s.parked) and withinNativeCeilings(cost.maximum, s.spentToday, s.config.ceilings)
pure def sign(s: Sends, cost: SendCost, by: Actor): Sends =
  { ...s, phase: Signed, signatures: s.signatures + 1, signedBytes: s.signatures + 1, reserved: cost.maximum, inBatch: not(s.parked) }
pure def canRefuseOverBudget(s: Sends, cost: SendCost, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s)
  and not(openSend(s)) and due(s) and not(withinNativeCeilings(cost.maximum, s.spentToday, s.config.ceilings))
pure def refuseOverBudget(s: Sends, cost: SendCost, by: Actor): Sends = { ...s, result: OverGasBudget }
pure def canJournal(s: Sends, by: Actor): bool = by == Worker and s.phase == Signed and not(openSend(s))
  and s.spentToday + s.reserved <= s.config.ceilings.perDayWei
pure def journal(s: Sends, by: Actor): Sends = { ...s, phase: Journaled, row: Submitted, journaled: s.journaled.union(Set(s.signedBytes)),
  spentToday: s.spentToday + s.reserved }
pure def canLoseSigned(s: Sends, by: Actor): bool = by == Worker and s.phase == Signed
pure def loseSigned(s: Sends, by: Actor): Sends = { ...s, phase: Idle, reserved: 0 }
pure def canBroadcast(s: Sends, accepted: bool, by: Actor): bool = by == Worker and s.phase == Journaled
pure def broadcast(s: Sends, accepted: bool, by: Actor): Sends =
  { ...s, phase: Idle, broadcasts: if (accepted) s.broadcasts.union(Set(s.signedBytes)) else s.broadcasts,
    row: if (accepted) Submitted else Unknown, result: if (accepted) BatchSent else SendInFlight }
pure def canDieAfterRecording(s: Sends, by: Actor): bool = by == Worker and s.phase == Journaled
pure def dieAfterRecording(s: Sends, by: Actor): Sends = { ...s, phase: Idle, result: SendInFlight }
pure def canRebroadcast(s: Sends, accepted: bool, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s) and openSend(s)
  and not(s.mined.contains(s.signedBytes))
pure def rebroadcast(s: Sends, accepted: bool, by: Actor): Sends =
  { ...s, broadcasts: if (accepted) s.broadcasts.union(Set(s.signedBytes)) else s.broadcasts, row: if (accepted) Submitted else Unknown,
    result: SendInFlight }
pure def canMine(s: Sends, by: Actor): bool = by == Chain and openSend(s) and s.broadcasts.contains(s.signedBytes)
  and not(s.mined.contains(s.signedBytes)) and not(s.inBatch and s.stuck)
pure def mine(s: Sends, by: Actor): Sends = { ...s, mined: s.mined.union(Set(s.signedBytes)) }
pure def canRecordFinalized(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s) and openSend(s)
  and s.mined.contains(s.signedBytes)
pure def recordFinalized(s: Sends, by: Actor): Sends =
  { ...s, row: Finalized, settledBatches: s.settledBatches.union(Set(s.batch)), result: NothingSent }
pure def canRecordFailed(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s) and openSend(s)
  and not(s.mined.contains(s.signedBytes))
pure def recordFailed(s: Sends, by: Actor): Sends = { ...s, row: Failed, result: NothingSent }
pure def canPlanNextBatch(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and not(openSend(s))
  and s.settledBatches.contains(s.batch)
pure def planNextBatch(s: Sends, by: Actor): Sends = { ...s, batch: s.batch + 1, listRecorded: false }
pure def canStartDay(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and s.spentToday > 0
pure def startDay(s: Sends, by: Actor): Sends = { ...s, spentToday: 0 }
pure def alwaysOnlyRecordedBytesLeave(s: Sends): bool = s.broadcasts.subseteq(s.journaled) and s.mined.subseteq(s.broadcasts)
  and (openSend(s) implies s.journaled.contains(s.signedBytes))
  and (s.phase == Journaled implies s.journaled.contains(s.signedBytes) and s.row == Submitted)
  and (s.phase == Signed implies s.journaled.size() < s.signatures)
  and (s.journaled.size() <= s.signatures) and s.signedBytes <= s.signatures and s.signedBytes >= 0
  and (s.phase != Idle implies s.signedBytes == s.signatures and s.signatures > 0)
pure def stepRecordedWithinTheDay(before: Sends, after: Sends): bool = after.spentToday > before.spentToday implies
  (after.spentToday <= before.config.ceilings.perDayWei and before.phase == Signed)
pure def stepSendRowsFinal(before: Sends, after: Sends): bool = (before.row == Finalized or before.row == Failed) implies
  (after.row == before.row or (after.row == Submitted and after.phase == Journaled and after.signedBytes == after.signatures))
pure def sometimesSettled(s: Sends): bool = s.settledBatches.contains(1)
pure def sometimesFailedThenSentAgain(s: Sends): bool = s.signatures >= 2 and s.settledBatches.contains(1)
pure def sometimesSecondBatchSettled(s: Sends): bool = s.settledBatches.contains(2)
pure def sometimesOverBudget(s: Sends): bool = s.result == OverGasBudget and s.signatures >= 1
pure val costValues = Set({ maximum: 1 }, { maximum: 200000000000000 }, { maximum: 200000000000001 }, { maximum: 0 })
pure val matchesValues = Set(true, false)
pure val acceptedValues = Set(true, false)
```

### A deposit whose payout the token refuses is parked and never holds up the rest

`resolveMany` is all or nothing, so one deposit whose payout the token
refuses (a paused token, a blacklisted payer) would fail every batch it is
in. When the simulation reverts with `PayoutFailed(id)` for a deposit of
the batch, that deposit is parked (`payout_failed`) and the rest are
simulated again; when the revert names none, each deposit is simulated
alone, and those that fail are parked (`reverted_alone`) only when another
goes through, so a fault of the whole contract or key parks nothing and
signs nothing (`reverted`). A parked deposit keeps its due state, is left out
of every batch, and is simulated again at most five per network and live
run, those not looked at for 24 hours first; it is released when its payout
would go through or it is no longer open on chain. Nothing is parked or
released outside `live`, and a deposit parked again after a release keeps
one row.

```quint
pure val parkedChecksPerRun = 5
pure val parkedRecheckMs = 86400000
pure def canRefusePayout(s: Sends, refused: bool, by: Actor): bool = by == Chain and s.stuck != refused
pure def refusePayout(s: Sends, refused: bool, by: Actor): Sends = { ...s, stuck: refused, everStuck: s.everStuck or refused }
pure def canBreakResolver(s: Sends, broken: bool, by: Actor): bool = by == Chain and s.systemic != broken
pure def breakResolver(s: Sends, broken: bool, by: Actor): Sends = { ...s, systemic: broken }
pure def canPark(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s) and not(openSend(s)) and due(s)
  and not(s.systemic) and s.stuck and not(s.parked)
pure def park(s: Sends, by: Actor): Sends = { ...s, parked: true, parks: s.parks + 1, result: DepositParked }
pure def canRevert(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s) and not(openSend(s)) and due(s)
  and s.systemic
pure def revert(s: Sends, by: Actor): Sends = { ...s, result: BatchReverted }
pure def canReleaseParked(s: Sends, by: Actor): bool = by == Worker and s.phase == Idle and liveRun(s) and s.parked
  and (not(s.stuck) or not(s.records.stillOpen))
pure def releaseParked(s: Sends, by: Actor): Sends = { ...s, parked: false }
pure def alwaysParksOnlyARefusedPayout(s: Sends): bool = (s.parks > 0 implies s.everStuck) and (s.parked implies s.parks > 0)
  and s.parks >= 0 and (s.stuck implies s.everStuck)
pure def stepParksOnlyLive(before: Sends, after: Sends): bool = after.parks > before.parks implies
  (before.config.mode == R::Live and before.config.key and before.config.contract and before.config.itemsTable and before.stuck
    and not(before.systemic) and after.signatures == before.signatures)
pure def sometimesParkedAndRestSent(s: Sends): bool = s.parks >= 1 and s.settledBatches.contains(1) and not(s.inBatch)
pure def sometimesRevertParksNothing(s: Sends): bool = s.result == BatchReverted and s.parks == 0 and s.signatures == 0
pure def sometimesParkedReleased(s: Sends): bool = s.parks >= 1 and not(s.parked)
pure val refusedValues = Set(true, false)
pure val brokenValues = Set(true, false)
pure val eval_witness_sometimesSettled = (
  ("publish", { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings }, Release),
  ("sign", { maximum: 1 }, Worker),
  ("journal", Worker),
  ("broadcast", true, Worker),
  ("mine", Chain),
  ("recordFinalized", Worker))
pure val eval_witness_sometimesFailedThenSentAgain = (
  ("publish", { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings }, Release),
  ("sign", { maximum: 1 }, Worker),
  ("journal", Worker),
  ("broadcast", false, Worker),
  ("rebroadcast", true, Worker),
  ("recordFailed", Worker),
  ("sign", { maximum: 1 }, Worker),
  ("journal", Worker),
  ("broadcast", true, Worker),
  ("mine", Chain),
  ("recordFinalized", Worker))
pure val eval_witness_sometimesSecondBatchSettled = (
  ("publish", { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings }, Release),
  ("sign", { maximum: 1 }, Worker),
  ("journal", Worker),
  ("broadcast", true, Worker),
  ("mine", Chain),
  ("recordFinalized", Worker),
  ("planNextBatch", Worker),
  ("sign", { maximum: 1 }, Worker),
  ("journal", Worker),
  ("broadcast", true, Worker),
  ("mine", Chain),
  ("recordFinalized", Worker))
pure val eval_witness_sometimesOverBudget = (
  ("publish", { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings }, Release),
  ("sign", { maximum: 1 }, Worker),
  ("journal", Worker),
  ("broadcast", true, Worker),
  ("mine", Chain),
  ("recordFinalized", Worker),
  ("planNextBatch", Worker),
  ("refuseOverBudget", { maximum: 200000000000001 }, Worker))
pure val eval_witness_sometimesParkedAndRestSent = (
  ("publish", { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings }, Release),
  ("refusePayout", true, Chain),
  ("park", Worker),
  ("sign", { maximum: 1 }, Worker),
  ("journal", Worker),
  ("broadcast", true, Worker),
  ("mine", Chain),
  ("recordFinalized", Worker))
pure val eval_witness_sometimesRevertParksNothing = (
  ("publish", { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings }, Release),
  ("breakResolver", true, Chain),
  ("revert", Worker))
pure val eval_witness_sometimesParkedReleased = (
  ("publish", { mode: R::Live, contract: true, key: true, itemsTable: true, ceilings: productionCeilings }, Release),
  ("refusePayout", true, Chain),
  ("park", Worker),
  ("refusePayout", false, Chain),
  ("releaseParked", Worker))
```

## Story: Isolate Solana failed sends and configuration errors

> As Slop, I want a Solana resolve transaction that landed and failed on chain
> to isolate the failing deposit into single-deposit sends and park it on a
> single failure, and I want a Solana configuration error to never stop the EVM
> ledgers from running.

### A Solana deposit whose send landed and failed goes alone, and a failed single send is parked and sent last

A Solana resolve transaction carries at most five deposits (`solanaMaxBatch`),
and destinations and simulations are read at confirmed commitment right before
signing while recording and settlement proofs stay at finalized commitment
(operator decision, 26 November 2026; `formal/models/fees/submission_fee_solana_failed_send.qnt`,
#3378). A send whose blockhash expired before landing (`solanaExpiredReason`)
paid no fee and is excluded from the UTC day's lamport spend; a send that landed
and failed on chain (`solanaLandedFailedReason`) paid its fee and counts toward
the day's spend. Any deposit that was in a live send which landed and failed is
from then on sent alone (`solanaMayJoinBatch` accepts it only at batch size 0
and stops adding further deposits), so it can never fail another deposit's
batch. A deposit whose own single send landed and failed is parked
(`reverted_alone`) before marking the send failed, waits 24 hours before
recheck, and from then on is ordered after every other due deposit and sent
only while less than half of the day's lamport ceiling is spent
(`solanaCourtesyAllowed`, shared with unaccepted courtesy refunds).

```quint
pure val solanaMaxBatch = 5
pure val solanaExpiredReason = "blockhash expired before the transaction landed"
pure val solanaLandedFailedReason = "resolve transaction failed"
pure def solanaCountsTowardDailyBudget(mode: R::Mode, sendRow: SendRow, reason: str): bool =
  mode == R::Live and not(sendRow == Failed and reason == solanaExpiredReason)
pure def solanaMayJoinBatch(batchSize: int, tainted: bool): bool =
  if (tainted) batchSize == 0 else batchSize >= 0 and batchSize < solanaMaxBatch
pure def solanaCourtesyAllowed(live: bool, spentToday: int, perDayLamports: int): bool =
  not(live) or spentToday * 2 < perDayLamports
pure def solanaParkOnSingleFailure(depositCount: int, reason: str): bool =
  depositCount == 1 and reason == solanaLandedFailedReason
pure def lawSolanaExpiredPaysNoBudget(mode: R::Mode): bool =
  not(solanaCountsTowardDailyBudget(mode, Failed, solanaExpiredReason))
pure def lawSolanaLandedFailedCountsBudget(reason: str): bool =
  reason == solanaLandedFailedReason implies solanaCountsTowardDailyBudget(R::Live, Failed, reason)
pure def lawSolanaTaintedNeverBatchesWithAnother(batchSize: int): bool =
  batchSize > 0 implies not(solanaMayJoinBatch(batchSize, true))
pure def lawSolanaSingleFailureParksOnlySingleLandedFail(depositCount: int, reason: str): bool =
  solanaParkOnSingleFailure(depositCount, reason) implies (depositCount == 1 and reason == solanaLandedFailedReason)
pure val modeValues = Set(R::Off, R::DryRun, R::Live)
pure val sendRowValues = Set(NoSendRow, Submitted, Unknown, Finalized, Failed)
pure val reasonValues = Set("", solanaExpiredReason, solanaLandedFailedReason)
pure val batchSizeValues = Set(0, 1, 2, 4, 5)
pure val depositCountValues = Set(0, 1, 2, 5)
```

### A Solana configuration error fails only the Solana ledger and never stops the EVM ledgers

The Solana ledger has its own switch (`SUBMISSION_FEE_SOLANA_MODE`) and its own
configuration parse, isolated from Base and Robinhood Chain. When Solana is
`off` it is inert even with incomplete configuration; when Solana is `dry_run`
or `live` and its configuration cannot be read (missing endpoint, lamport limit
or live seed), only the Solana ledger records an error while the EVM ledgers
still run.

```quint
type WorkerLedgerResult = LedgerOff | LedgerRan | LedgerError
type WorkerOutcomes = { evm: WorkerLedgerResult, solana: WorkerLedgerResult }
pure def workerRunOutcomes(evmOn: bool, solanaMode: R::Mode, solanaConfigOk: bool): WorkerOutcomes =
  { evm: if (evmOn) LedgerRan else LedgerOff,
    solana: if (solanaMode == R::Off) LedgerOff else if (solanaConfigOk) LedgerRan else LedgerError }
pure def lawSolanaConfigErrorLeavesEvmRunning(evmOn: bool, solanaMode: R::Mode, solanaConfigOk: bool): bool =
  val outcomes = workerRunOutcomes(evmOn, solanaMode, solanaConfigOk)
  (outcomes.solana == LedgerError and evmOn) implies outcomes.evm == LedgerRan
pure def lawSolanaOffIsInert(evmOn: bool, solanaConfigOk: bool): bool =
  workerRunOutcomes(evmOn, R::Off, solanaConfigOk).solana == LedgerOff
pure val evmOnValues = Set(true, false)
pure val solanaModeValues = Set(R::Off, R::DryRun, R::Live)
pure val solanaConfigOkValues = Set(true, false)
```
