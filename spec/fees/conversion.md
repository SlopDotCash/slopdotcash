# Received-fee conversion journal and native holds

PRD section 6 "Received-fee handling" and section 11 govern the fee-only
service for one wallet token on one network. Sources: the pinned
`workers/fee-converter/{core,store,native-gas,evm,solana}.ts`,
`workers/verified-fee-replacement.ts`, migrations `0022`, `0076`, `0082`,
`0087`, `0088`, `0092`, `0095` and `0121`, and the legacy models
`fee_conversion`, `fee_value_caps`, `fee_lease_journal`, `fee_quote_policy`,
`fee_nonce_reuse`, `native_budget`, `earned_fee_history`, `solana_route` and
`solana_expiry`.

Each instance owns the journal of one token in one network fee wallet: its
rows (`fee_conversions`), its native-gas reservations (`fee_native_gas`) and
the network lease (`fee_converter_locks`). The published Worker
configuration is the [runtime component](./runtime.md). Values are integer
USDC micro-units. EVM native amounts are integer gwei, rounded up by the
adapter, and Solana native amounts are lamports. Token amounts are exact base
units of the one token. Clock values are UTC epoch milliseconds from the
trusted Worker clock.

Evidence records name their verified source. `FinalizedTransfer`,
`SendReceipt`, `DeadlineEvidence` and `ExpiryObservation` come from the chain
observation adapter at a finalized block, `Quote` from the pinned aggregator
quote reader, and `SignedSend` from the signer after it inspected every
instruction, account, lookup table and token program of the exact bytes.

## Story: Run one network at a time under a fenced lease

### A run needs the published Worker, a fresh run identity and a free or expired lease

`Off` starts nothing: no lease, no read and no reconciliation. A later run
may take an expired lease; the earlier holder then can neither sign nor
commit. Taking the lease retires every reservation another run left
unsigned. A reservation can never precede a broadcast, so retiring it
cannot strand a send.

```quint
import runtime as R from "./runtime"
type AssetKind = TargetStable | ProjectToken | NativeAsset
type Trigger = Receipts | Recovery
type SendKind = Conversion | Approval | Claim
type RowState = Quoted | DustPending | Skipped | NoRoute | Submitted | Unknown | Finalized | Failed
type Reason = NoReason | BelowMinimum | BelowGasMultiple | RunCapReached | DayCapReached | ExceedsRemaining
  | UnsafeValue | ImpactUnknown | ImpactAbove | SlippageOutside | NoRouteFound | PrepareFailed
  | RunEndedBeforeSigning | Reverted | ExpiredUnlanded | BroadcastUnknown
type GasState = Reserved | Signed | Abandoned
type Attempt = { tx: int, maxFee: int, priority: int, at: int }
type Row = { id: int, kind: SendKind, live: bool, state: RowState, reason: Reason, runId: int, wallet: int,
  amountIn: int, valueMicro: int, balanceBefore: int, minimumOutput: int, nonce: int, gasLimit: int,
  deadline: int, attempts: List[Attempt], output: int, createdAt: int }
type Reservation = { id: int, runId: int, nonce: int, maximum: int, state: GasState, row: int, tx: int,
  settled: bool, actual: int, settledDay: int }
type Lease = { holder: int, expiresAt: int }
type Fee = { runtime: R::Runtime, network: R::Network, asset: AssetKind, clock: int, lease: Lease, nextRun: int,
  trigger: Trigger, runValue: int, balance: int, feeIncome: int, topUps: int, sold: int, usdcOut: int,
  accrued: int, claimed: int, receipts: List[int], rows: List[Row], gas: List[Reservation], overrun: bool }
pure val initial: Fee = { runtime: R::initial, network: R::Base, asset: ProjectToken, clock: 0,
  lease: { holder: 0, expiresAt: 0 }, nextRun: 1, trigger: Recovery, runValue: 0, balance: 0, feeIncome: 0,
  topUps: 0, sold: 0, usdcOut: 0, accrued: 0, claimed: 0, receipts: List(), rows: List(), gas: List(), overrun: false }
pure val lockMs = 840000
pure val dayMs = 86400000
pure val quoteAbandonMs = 3600000
pure val replacementWaitMs = 180000
pure def day(f: Fee): int = f.clock / dayMs
pure def leaseHeld(f: Fee, runId: int): bool = runId > 0 and f.lease.holder == runId and f.clock <= f.lease.expiresAt
pure def canChooseInstance(f: Fee, network: R::Network, asset: AssetKind): bool =
  f.rows.length() == 0 and f.receipts.length() == 0 and f.balance == 0 and f.accrued == 0 and f.nextRun == 1
pure def chooseInstance(f: Fee, network: R::Network, asset: AssetKind): Fee = { ...f, network: network, asset: asset }
pure def canAdvanceClock(f: Fee, elapsed: int): bool = elapsed > 0
pure def advanceClock(f: Fee, elapsed: int): Fee = { ...f, clock: f.clock + elapsed }
pure def canAcquireLease(f: Fee, runId: int, trigger: Trigger): bool =
  R::runs(f.runtime) and runId == f.nextRun and (f.lease.holder == 0 or f.clock > f.lease.expiresAt)
pure def acquireLease(f: Fee, runId: int, trigger: Trigger): Fee =
  { ...f, lease: { holder: runId, expiresAt: f.clock + lockMs }, nextRun: runId + 1, trigger: trigger, runValue: 0,
    gas: f.gas.listMap(g => if (g.state == Reserved) { ...g, state: Abandoned } else g) }
pure def canRenewLease(f: Fee, runId: int): bool = leaseHeld(f, runId)
pure def renewLease(f: Fee, runId: int): Fee = { ...f, lease: { holder: runId, expiresAt: f.clock + lockMs } }
pure def canReleaseLease(f: Fee, runId: int): bool = leaseHeld(f, runId)
pure def releaseLease(f: Fee, runId: int): Fee = { ...f, lease: { holder: 0, expiresAt: 0 } }
pure def alwaysLeaseIdentity(f: Fee): bool = f.lease.holder >= 0 and f.lease.holder < f.nextRun
  and f.gas.every(g => g.runId > 0 and g.runId < f.nextRun) and f.rows.every(r => r.runId > 0 and r.runId < f.nextRun)
pure def stepStaleRunCannotSign(before: Fee, via: str, after: Fee): bool =
  after.gas.length() > before.gas.length() implies leaseHeld(before, after.gas.nthOr(before.gas.length(), noGas).runId)
```

### The Worker configuration is a published component

The release workflow and the owner change the component through its own
guards; this journal never changes it.

```quint
pure def canPublishWorker(f: Fee, config: R::WorkerConfig, by: R::Sender): bool = R::canPublish(f.runtime, config, by)
pure def publishWorker(f: Fee, config: R::WorkerConfig, by: R::Sender): Fee = { ...f, runtime: R::publish(f.runtime, config, by) }
pure def canSetReleaseVariable(f: Fee, variable: bool, by: R::Sender): bool = R::canSetReleaseVariable(f.runtime, variable, by)
pure def setReleaseVariable(f: Fee, variable: bool, by: R::Sender): Fee = { ...f, runtime: R::setReleaseVariable(f.runtime, variable, by) }
pure def canVerifyReadiness(f: Fee, by: R::Sender): bool = R::canVerifyReadiness(f.runtime, f.network, by)
pure def verifyReadiness(f: Fee, by: R::Sender): Fee = { ...f, runtime: R::verifyReadiness(f.runtime, f.network, by) }
pure def canWithdrawReadiness(f: Fee, by: R::Sender): bool = R::canWithdrawReadiness(f.runtime, f.network, by)
pure def withdrawReadiness(f: Fee, by: R::Sender): Fee = { ...f, runtime: R::withdrawReadiness(f.runtime, f.network, by) }
pure def canSetReplacement(f: Fee, active: bool, by: R::Sender): bool = R::canSetReplacement(f.runtime, active, by)
pure def setReplacement(f: Fee, active: bool, by: R::Sender): Fee = { ...f, runtime: R::setReplacement(f.runtime, active, by) }
pure def alwaysRuntimeSound(f: Fee): bool = R::alwaysPublishedPassedPreflight(f.runtime) and R::alwaysUnpublishedInert(f.runtime)
  and R::alwaysBuybackNeedsLiveConverter(f.runtime) and R::alwaysStagingBuybackOff(f.runtime) and R::alwaysReadyOnlyForEnabledNetworks(f.runtime)
```

## Story: Know what the wallet received before anything converts

### Only finalized fee receipts and claims are fee income; gas top-ups never are

A receipt identifier counts once. A native top-up adds to the balance and
never to fee income, so a native-asset conversion can never sell gas that was
deposited to pay for sends. Vault accrual is a chain fact that only a
finalized claim moves into the wallet.

```quint
type FinalizedTransfer = { receipt: int, amount: int, toFeeWallet: bool, sameAsset: bool, finalized: bool }
pure def canReceiveFee(f: Fee, transfer: FinalizedTransfer): bool = transfer.receipt > 0 and not(f.receipts.includes(transfer.receipt))
  and transfer.amount > 0 and transfer.toFeeWallet and transfer.sameAsset and transfer.finalized
pure def receiveFee(f: Fee, transfer: FinalizedTransfer): Fee = { ...f, balance: f.balance + transfer.amount,
  feeIncome: f.feeIncome + transfer.amount, receipts: f.receipts.append(transfer.receipt) }
pure def canReceiveTopUp(f: Fee, amount: int): bool = f.asset == NativeAsset and amount > 0
pure def receiveTopUp(f: Fee, amount: int): Fee = { ...f, balance: f.balance + amount, topUps: f.topUps + amount }
pure def canAccrue(f: Fee, amount: int): bool = amount > 0
pure def accrue(f: Fee, amount: int): Fee = { ...f, accrued: f.accrued + amount }
pure def perTransactionReserve(f: Fee): int = if (f.asset == NativeAsset) R::transactionCeilingOf(f.network) else 0
pure def spendable(f: Fee): int =
  val earned = f.feeIncome - f.sold - perTransactionReserve(f)
  if (f.asset != NativeAsset) f.balance else if (earned <= 0) 0 else if (earned < f.balance) earned else f.balance
pure def alwaysTopUpsNeverSold(f: Fee): bool = f.balance == f.feeIncome + f.topUps - f.sold and f.sold >= 0 and f.sold + openAmount(f) <= f.feeIncome
  and f.balance >= openAmount(f) and f.topUps >= 0 and (f.asset != NativeAsset implies f.topUps == 0)
pure def sometimesTopUpRetained(f: Fee): bool = f.topUps > 0 and f.feeIncome > 0 and spendable(f) < f.balance
```

## Story: Evaluate a wallet token once per run and record why it waits

### Each evaluation records one outcome from the pinned order of checks

A run first reconciles; an open send blocks its token. Robinhood Chain and
the network's own USDC are never evaluated: they stay in the wallet and show
**not converted** or need no conversion. A receipts run skips a token whose
balance equals the latest recorded attempt's starting balance unless that
attempt finalized. The checks run in the pinned order: no route; remaining
value cap; quote above the remaining cap; unsafe integer value; below 5 USDC
or ten times the gas cost (dust, which waits in the wallet); unknown or high
price impact; minimum output outside 1% slippage. A dry run records the
quote, counts it against the run cap and never signs. A repeated waiting
outcome with the same amount, reason and mode adds no row.

```quint
type RouteResult = Found | NoRouteResult
type Quote = { route: RouteResult, amountIn: int, output: int, minimumOutput: int, gasValue: int, impactBps: int }
type Outcome = { state: RowState, reason: Reason }
pure val runCap = 1000000000
pure val dayCap = 5000000000
pure val maximumSafeValue = 9007199254740991
pure def isOpen(r: Row): bool = r.state == Submitted or r.state == Unknown or (r.state == Quoted and r.live)
pure def openAmount(f: Fee): int = f.rows.foldl(0, (t, r) => if (isOpen(r) and r.kind == Conversion) t + r.amountIn else t)
pure def openRows(f: Fee): int = f.rows.foldl(0, (t, r) => if (isOpen(r)) t + 1 else t)
pure def dayValue(f: Fee): int = f.rows.foldl(0, (t, r) =>
  if (r.kind == Conversion and r.live and (r.state == Submitted or r.state == Unknown or r.state == Finalized)
    and r.createdAt > f.clock - dayMs) t + r.valueMicro else t)
pure def remaining(f: Fee): int =
  val runLeft = runCap - f.runValue
  val dayLeft = dayCap - dayValue(f)
  if (runLeft < dayLeft) runLeft else dayLeft
pure def evaluated(f: Fee): bool = f.asset != TargetStable and R::converts(f.network)
pure def lastConversion(f: Fee): Row = f.rows.foldl(noRow, (latest, r) => if (r.kind == Conversion) r else latest)
pure def outcomeOf(f: Fee, quote: Quote): Outcome =
  if (quote.route == NoRouteResult) { state: NoRoute, reason: NoRouteFound }
  else if (remaining(f) <= 0) { state: Skipped, reason: if (runCap - f.runValue <= 0) RunCapReached else DayCapReached }
  else if (quote.output > remaining(f)) { state: Skipped, reason: ExceedsRemaining }
  else if (quote.output > maximumSafeValue) { state: Skipped, reason: UnsafeValue }
  else if (quote.output < 5000000) { state: DustPending, reason: BelowMinimum }
  else if (quote.output < quote.gasValue * 10) { state: DustPending, reason: BelowGasMultiple }
  else if (quote.impactBps < 0) { state: Skipped, reason: ImpactUnknown }
  else if (quote.impactBps > 200) { state: Skipped, reason: ImpactAbove }
  else if (quote.minimumOutput <= 0 or quote.minimumOutput * 10000 < quote.output * 9900 or quote.minimumOutput > quote.output)
    { state: Skipped, reason: SlippageOutside }
  else { state: Quoted, reason: NoReason }
pure def canEvaluate(f: Fee, runId: int, quote: Quote): bool =
  val latest = lastConversion(f)
  leaseHeld(f, runId) and evaluated(f) and openRows(f) == 0 and spendable(f) > 0
    and quote.amountIn > 0 and quote.amountIn <= spendable(f) and quote.output >= 0 and quote.gasValue >= 0
    and (f.trigger == Receipts implies latest.id == 0 or latest.state == Finalized or latest.balanceBefore != spendable(f))
pure def evaluationRow(f: Fee, runId: int, quote: Quote): Row =
  val decided = outcomeOf(f, quote)
  { ...noRow, id: f.rows.length() + 1, kind: Conversion, live: f.runtime.converterMode == R::Live, state: decided.state,
    reason: decided.reason, runId: runId, wallet: f.runtime.wallet, amountIn: quote.amountIn,
    valueMicro: if (quote.output > maximumSafeValue) 0 else quote.output, balanceBefore: spendable(f),
    minimumOutput: quote.minimumOutput, createdAt: f.clock }
pure def repeatsWaiting(f: Fee, row: Row): bool =
  val latest = lastConversion(f)
  (row.state == DustPending or row.state == Skipped or row.state == NoRoute)
    and latest.id > 0 and latest.state == row.state and latest.reason == row.reason and latest.amountIn == row.amountIn and latest.live == row.live
pure def evaluate(f: Fee, runId: int, quote: Quote): Fee =
  val row = evaluationRow(f, runId, quote)
  if (repeatsWaiting(f, row)) f
  else { ...f, rows: f.rows.append(row), runValue: if (row.state == Quoted and not(row.live)) f.runValue + row.valueMicro else f.runValue }
pure def alwaysNotConvertedRetained(f: Fee): bool = not(evaluated(f)) implies f.rows.every(r => r.kind != Conversion) and f.sold == 0
pure def alwaysRunValueBounded(f: Fee): bool = f.runValue >= 0 and f.runValue <= runCap and dayValue(f) <= dayCap
pure def sometimesDust(f: Fee): bool = f.rows.some(r => r.state == DustPending)
pure def sometimesSkippedForCap(f: Fee): bool = f.rows.some(r => r.state == Skipped)
pure def sometimesNoRoute(f: Fee): bool = f.rows.some(r => r.state == NoRoute)
pure def sometimesDryQuoted(f: Fee): bool = f.rows.some(r => r.state == Quoted and not(r.live))
pure def sometimesRobinhoodRetained(f: Fee): bool = f.network == R::Robinhood and f.balance > 0
```

## Story: Sign only a reserved, inspected, same-wallet send

### Native gas is reserved before signing and committed atomically with the signed row

Approvals, claims, conversions and replacements share one native budget. A
reservation records the worst-case fee: `gasLimit * maxFee` on EVM and the
whole per-transaction ceiling on Solana. Each UTC day's liability is the
actual fees settled that day plus, for each nonce, the largest unsettled
reservation. Settled fees count on their settlement day, and unsettled
reservations count on every day until a receipt settles them. A send that
exceeds its reservation holds every later signature on the network. A lost
lease between reservation and signature leaves an unsigned reservation that
the stepped run abandons.

```quint
type EvmFees = { maxFee: int, priority: int }
type RouteInspection = Inspected | Unresolved
type SignedSend = { kind: SendKind, tx: int, nonce: int, gasLimit: int, fees: EvmFees, inspection: RouteInspection,
  outputToFeeWallet: bool, minimumOutput: int, deadline: int }
pure val noGas: Reservation = { id: 0, runId: 0, nonce: -1, maximum: 0, state: Abandoned, row: 0, tx: 0, settled: true, actual: 0, settledDay: 0 }
pure val noRow: Row = { id: 0, kind: Conversion, live: false, state: Failed, reason: NoReason, runId: 0, wallet: 0, amountIn: 0,
  valueMicro: 0, balanceBefore: 0, minimumOutput: 0, nonce: -1, gasLimit: 0, deadline: 0, attempts: List(), output: 0, createdAt: 0 }
pure def bucketHolds(gas: List[Reservation], g: Reservation): bool =
  g.state != Abandoned and not(g.settled) and gas.every(o => o.state == Abandoned or o.settled or o.nonce != g.nonce
    or o.maximum < g.maximum or (o.maximum == g.maximum and o.id >= g.id))
pure def liabilityOf(gas: List[Reservation], today: int): int = gas.foldl(0, (t, g) =>
  if (g.state != Abandoned and g.settled and g.settledDay == today) t + g.actual
  else if (bucketHolds(gas, g)) t + g.maximum else t)
pure def liability(f: Fee): int = liabilityOf(f.gas, day(f))
pure def worstCase(f: Fee, gasLimit: int, fees: EvmFees): int =
  if (f.network == R::Solana) R::transactionCeilingOf(f.network) else gasLimit * fees.maxFee
pure def expiredRow(f: Fee, id: int): bool = f.rows.some(r => r.id == id and r.reason == ExpiredUnlanded)
pure def nonceFloor(f: Fee): int = f.gas.foldl(0, (t, g) =>
  if (g.state == Signed and not(expiredRow(f, g.row)) and g.nonce >= t) g.nonce + 1 else t)
pure def solanaSequence(f: Fee): int = f.gas.foldl(0, (t, g) => if (g.nonce >= t) g.nonce + 1 else t)
pure def ownReservation(f: Fee, runId: int): Reservation =
  f.gas.foldl(noGas, (found, g) => if (g.state == Reserved and g.runId == runId) g else found)
pure def pendingIntent(f: Fee, runId: int): Row =
  f.rows.foldl(noRow, (found, r) => if (r.state == Quoted and r.live and r.runId == runId) r else found)
pure def canReserveGas(f: Fee, runId: int, nonce: int, maximum: int): bool =
  val intent = pendingIntent(f, runId)
  leaseHeld(f, runId) and intent.id > 0 and ownReservation(f, runId).id == 0 and not(f.overrun)
    and maximum > 0 and maximum <= R::transactionCeilingOf(f.network)
    and (if (f.network == R::Solana) nonce == solanaSequence(f) and maximum == R::transactionCeilingOf(f.network) else nonce >= nonceFloor(f))
    and liabilityOf(f.gas.append({ ...noGas, id: f.gas.length() + 1, nonce: nonce, maximum: maximum, state: Reserved, settled: false }), day(f))
      <= R::dailyCeilingOf(f.network)
pure def reserveGas(f: Fee, runId: int, nonce: int, maximum: int): Fee =
  { ...f, gas: f.gas.append({ id: f.gas.length() + 1, runId: runId, nonce: nonce, maximum: maximum, state: Reserved,
    row: 0, tx: 0, settled: false, actual: 0, settledDay: 0 }) }
pure def txUsed(f: Fee, tx: int): bool = f.gas.some(g => g.tx == tx)
pure def canSign(f: Fee, runId: int, send: SignedSend): bool =
  val intent = pendingIntent(f, runId)
  val held = ownReservation(f, runId)
  leaseHeld(f, runId) and R::conversionSigns(f.runtime, f.network) and not(f.overrun) and intent.id > 0 and held.id > 0
    and intent.wallet == f.runtime.wallet and send.tx > 0 and not(txUsed(f, send.tx)) and send.nonce == held.nonce
    and send.gasLimit > 0 and send.fees.maxFee > 0 and send.fees.priority >= 0 and send.fees.priority <= send.fees.maxFee
    and worstCase(f, send.gasLimit, send.fees) == held.maximum
    and send.inspection == Inspected and send.outputToFeeWallet and send.deadline > f.clock
    and (send.kind == Conversion or (send.kind == Approval and f.network != R::Solana))
    and (send.kind == Conversion implies send.minimumOutput >= intent.minimumOutput and send.minimumOutput > 0)
    and intent.valueMicro <= remaining(f)
pure def sign(f: Fee, runId: int, send: SignedSend): Fee =
  val intent = pendingIntent(f, runId)
  val held = ownReservation(f, runId)
  { ...f, rows: f.rows.listMap(r => if (r.id == intent.id) { ...r, kind: send.kind, state: Submitted, nonce: send.nonce,
      gasLimit: send.gasLimit, deadline: send.deadline, minimumOutput: if (send.kind == Approval) 0 else send.minimumOutput,
      attempts: List({ tx: send.tx, maxFee: send.fees.maxFee, priority: send.fees.priority, at: f.clock }) } else r),
    gas: f.gas.listMap(g => if (g.id == held.id) { ...g, state: Signed, row: intent.id, tx: send.tx } else g),
    runValue: if (send.kind == Conversion) f.runValue + intent.valueMicro else f.runValue }
pure def canFailPreparation(f: Fee, runId: int): bool = leaseHeld(f, runId) and pendingIntent(f, runId).id > 0
pure def failPreparation(f: Fee, runId: int): Fee =
  val intent = pendingIntent(f, runId)
  { ...f, rows: f.rows.listMap(r => if (r.id == intent.id) { ...r, state: Failed, reason: PrepareFailed } else r),
    gas: f.gas.listMap(g => if (g.state == Reserved and g.runId == runId) { ...g, state: Abandoned } else g) }
pure def canAbandonIntent(f: Fee, runId: int, id: int): bool =
  val row = f.rows.nthOr(id - 1, noRow)
  leaseHeld(f, runId) and row.id == id and row.state == Quoted and row.live and row.runId != runId
    and f.clock - row.createdAt > quoteAbandonMs
pure def abandonIntent(f: Fee, runId: int, id: int): Fee =
  { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Failed, reason: RunEndedBeforeSigning } else r) }
pure def canBroadcastFail(f: Fee, runId: int, id: int): bool =
  leaseHeld(f, runId) and f.rows.some(r => r.id == id and r.state == Submitted)
pure def broadcastFail(f: Fee, runId: int, id: int): Fee =
  { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Unknown, reason: BroadcastUnknown } else r) }
pure def alwaysLiabilityWithinDay(f: Fee): bool = not(f.overrun) implies liability(f) <= R::dailyCeilingOf(f.network)
pure def alwaysReservationsWithinTransaction(f: Fee): bool = f.gas.every(g => g.maximum > 0 and g.maximum <= R::transactionCeilingOf(f.network)
  and g.actual >= 0 and (g.state == Reserved implies g.row == 0 and not(g.settled)) and (g.settled implies g.state == Signed))
pure def alwaysOneOpenSend(f: Fee): bool = openRows(f) <= 1
pure def alwaysOpenSendHeld(f: Fee): bool = f.rows.every(r => (r.state == Submitted or r.state == Unknown) implies
  r.attempts.length() > 0 and r.attempts.every(a => f.gas.some(g => g.row == r.id and g.tx == a.tx and g.state == Signed and not(g.settled))))
pure def alwaysSignedRowsAttributed(f: Fee): bool = f.gas.every(g => g.state == Signed implies
  f.rows.some(r => r.id == g.row and r.nonce == g.nonce and r.attempts.some(a => a.tx == g.tx)))
pure def sometimesAbandonedReservation(f: Fee): bool = f.gas.some(g => g.state == Abandoned and g.row == 0)
pure def sometimesUnknown(f: Fee): bool = f.rows.some(r => r.state == Unknown)
pure def sometimesRunEnded(f: Fee): bool = f.rows.some(r => r.reason == RunEndedBeforeSigning)
```

## Story: Reconcile every send from finalized evidence before another starts

### Only a finalized receipt of one of the row's own attempts settles it

A finalized receipt settles its whole nonce group: the landed attempt is
charged its actual fee and every other attempt with that nonce is charged
nothing. A success credits the exact output; the balance before is evidence
only. A revert consumes its actual fee and leaves the token in the wallet. A
claim moves exactly its claimed amount from the vault into fee income. An
approval moves no value. A record from a different fee wallet stays open and
blocks its token: a wallet change is no authority to reinterpret a retained
send.

```quint
type SendReceipt = { tx: int, succeeded: bool, output: int, actualNative: int, finalized: bool }
pure def landedIn(r: Row, tx: int): bool = r.attempts.some(a => a.tx == tx)
pure def settleGas(f: Fee, r: Row, tx: int, actualNative: int): List[Reservation] =
  f.gas.listMap(g => if (g.state == Signed and not(g.settled) and g.nonce == r.nonce)
    { ...g, settled: true, actual: if (g.tx == tx) actualNative else 0, settledDay: day(f) } else g)
pure def overran(f: Fee, tx: int, actualNative: int): bool = f.gas.some(g => g.tx == tx and actualNative > g.maximum)
pure def canFinalizeSend(f: Fee, runId: int, id: int, receipt: SendReceipt): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  leaseHeld(f, runId) and r.id == id and (r.state == Submitted or r.state == Unknown) and r.wallet == f.runtime.wallet
    and receipt.finalized and landedIn(r, receipt.tx) and receipt.actualNative >= 0 and receipt.output >= 0
    and (r.kind == Approval implies receipt.output == 0)
pure def finalizeSend(f: Fee, runId: int, id: int, receipt: SendReceipt): Fee =
  val r = f.rows.nthOr(id - 1, noRow)
  val credited = receipt.succeeded
  { ...f, rows: f.rows.listMap(x => if (x.id == id) { ...x, state: if (credited) Finalized else Failed,
      reason: if (credited) NoReason else Reverted, output: if (credited and r.kind == Conversion) receipt.output else 0 } else x),
    gas: settleGas(f, r, receipt.tx, receipt.actualNative),
    overrun: f.overrun or overran(f, receipt.tx, receipt.actualNative),
    balance: if (credited and r.kind == Conversion) f.balance - r.amountIn else if (credited and r.kind == Claim) f.balance + r.amountIn else f.balance,
    sold: if (credited and r.kind == Conversion) f.sold + r.amountIn else f.sold,
    usdcOut: if (credited and r.kind == Conversion) f.usdcOut + receipt.output else f.usdcOut,
    feeIncome: if (credited and r.kind == Claim) f.feeIncome + r.amountIn else f.feeIncome,
    claimed: if (credited and r.kind == Claim) f.claimed + r.amountIn else f.claimed,
    accrued: if (r.kind == Claim) f.accrued + (if (credited) 0 else r.amountIn) else f.accrued }
pure def finalizedOutput(f: Fee): int = f.rows.foldl(0, (t, r) => if (r.kind == Conversion and r.state == Finalized) t + r.output else t)
pure def alwaysOutputFromReceipts(f: Fee): bool = f.usdcOut == finalizedOutput(f)
  and f.sold == f.rows.foldl(0, (t, r) => if (r.kind == Conversion and r.state == Finalized) t + r.amountIn else t)
pure def alwaysClaimsFromReceipts(f: Fee): bool = f.claimed == f.rows.foldl(0, (t, r) => if (r.kind == Claim and r.state == Finalized) t + r.amountIn else t)
  and f.claimed <= f.feeIncome and f.accrued >= 0
pure def sometimesConverted(f: Fee): bool = f.rows.some(r => r.kind == Conversion and r.state == Finalized and r.output > 0)
pure def sometimesReverted(f: Fee): bool = f.rows.some(r => r.reason == Reverted)
pure def sometimesApprovalFinalized(f: Fee): bool = f.rows.some(r => r.kind == Approval and r.state == Finalized)
pure def sometimesOverrunHolds(f: Fee): bool = f.overrun
```

### An unknown send is rebroadcast unchanged; only proven expiry retires it

A restart first delivers the exact journaled bytes, in dry run too. A failed
rebroadcast keeps the send unknown. An EVM send whose router deadline passed
at a finalized block without inclusion closes as failed, but its nonce keeps
its largest reservation until a canonical receipt for that nonce settles it,
so a later send may reuse the nonce without a second liability. A Solana send
releases its reservation only with two independent full-history providers
that both prove an invalid blockhash at finalized commitment and find neither
signature nor transaction, with retained history covering the signed slot.

```quint
type DeadlineEvidence = { finalizedTime: int, included: bool }
type ExpiryObservation = { providerA: str, providerB: str, signedSlot: int,
  firstA: int, firstB: int, finalizedA: int, finalizedB: int,
  invalidA: bool, invalidB: bool, signatureA: bool, signatureB: bool,
  transactionA: bool, transactionB: bool }
pure def expiryProvesAbsence(observation: ExpiryObservation): bool =
  observation.providerA != "" and observation.providerB != "" and observation.providerA != observation.providerB
    and observation.signedSlot > 0 and observation.firstA <= observation.signedSlot and observation.firstB <= observation.signedSlot
    and observation.finalizedA >= observation.signedSlot and observation.finalizedB >= observation.signedSlot
    and observation.invalidA and observation.invalidB and not(observation.signatureA) and not(observation.signatureB)
    and not(observation.transactionA) and not(observation.transactionB)
pure def canRebroadcast(f: Fee, runId: int, id: int, accepted: bool): bool =
  leaseHeld(f, runId) and f.rows.some(r => r.id == id and r.state == Unknown and r.wallet == f.runtime.wallet)
pure def rebroadcast(f: Fee, runId: int, id: int, accepted: bool): Fee =
  if (accepted) { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Submitted, reason: NoReason } else r) } else f
pure def canExpireEvm(f: Fee, runId: int, id: int, deadline: DeadlineEvidence): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  leaseHeld(f, runId) and f.network != R::Solana and r.id == id and r.kind == Conversion
    and (r.state == Submitted or r.state == Unknown) and deadline.finalizedTime > r.deadline and not(deadline.included)
pure def expireEvm(f: Fee, runId: int, id: int, deadline: DeadlineEvidence): Fee =
  { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Failed, reason: ExpiredUnlanded } else r) }
pure def canExpireSolana(f: Fee, runId: int, id: int, observation: ExpiryObservation): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  leaseHeld(f, runId) and f.network == R::Solana and r.id == id and (r.state == Submitted or r.state == Unknown)
    and expiryProvesAbsence(observation)
pure def expireSolana(f: Fee, runId: int, id: int, observation: ExpiryObservation): Fee =
  val r = f.rows.nthOr(id - 1, noRow)
  { ...f, rows: f.rows.listMap(x => if (x.id == id) { ...x, state: Failed, reason: ExpiredUnlanded } else x),
    gas: settleGas(f, r, 0, 0) }
pure def lawExpiryNeedsTwoProviders(observation: ExpiryObservation): bool = expiryProvesAbsence(observation) implies
  observation.providerA != observation.providerB
    and not(observation.signatureA or observation.signatureB or observation.transactionA or observation.transactionB)
pure def sometimesExpiredEvmNonceHeld(f: Fee): bool = f.rows.some(r => r.reason == ExpiredUnlanded)
  and f.gas.some(g => g.state == Signed and not(g.settled) and f.rows.some(r => r.id == g.row and r.state == Failed))
```

### A same-nonce EVM replacement changes only its fees, in bounded steps

Replacement needs its own owner activation and a live, ready network. The
latest attempt must have waited three minutes and its maximum fee must be
below the observed network fee. Each fee field rises to the rounded-up 125%
of the latest attempt, capped by three times the original and, for the
maximum fee, by the per-transaction ceiling; a step below the node's 110%
rule, or a priority above the maximum, is refused. The replacement is
reserved and journaled before broadcast, and every attempt stays in the
journal.

```quint
pure def ceilPercent(value: int, percent: int): int = (value * percent + 99) / 100
pure def lesser(a: int, b: int): int = if (a < b) a else b
pure def nextFees(original: EvmFees, latest: EvmFees, feeCeiling: int): EvmFees =
  { maxFee: lesser(ceilPercent(latest.maxFee, 125), lesser(original.maxFee * 3, feeCeiling)),
    priority: lesser(ceilPercent(latest.priority, 125), original.priority * 3) }
pure def replacementStepValid(original: EvmFees, latest: EvmFees, feeCeiling: int): bool =
  val stepped = nextFees(original, latest, feeCeiling)
  stepped.maxFee >= ceilPercent(latest.maxFee, 110) and stepped.priority >= ceilPercent(latest.priority, 110) and stepped.priority <= stepped.maxFee
pure def lawReplacementBounded(original: EvmFees, latest: EvmFees, feeCeiling: int): bool =
  val stepped = nextFees(original, latest, feeCeiling)
  (original.maxFee > 0 and original.priority >= 0 and latest.maxFee > 0 and latest.priority >= 0 and feeCeiling > 0
    and replacementStepValid(original, latest, feeCeiling)) implies
    stepped.maxFee <= original.maxFee * 3 and stepped.maxFee <= feeCeiling and stepped.priority <= original.priority * 3
      and stepped.priority <= stepped.maxFee and stepped.maxFee * 100 >= latest.maxFee * 110
pure def firstAttempt(r: Row): Attempt = r.attempts.nthOr(0, { tx: 0, maxFee: 0, priority: 0, at: 0 })
pure def latestAttempt(r: Row): Attempt = r.attempts.nthOr(r.attempts.length() - 1, { tx: 0, maxFee: 0, priority: 0, at: 0 })
pure def feesOf(a: Attempt): EvmFees = { maxFee: a.maxFee, priority: a.priority }
pure def canReplace(f: Fee, runId: int, id: int, tx: int, networkFee: int): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  val latest = latestAttempt(r)
  val ceiling = R::transactionCeilingOf(f.network) / (if (r.gasLimit > 0) r.gasLimit else 1)
  val stepped = nextFees(feesOf(firstAttempt(r)), feesOf(latest), ceiling)
  leaseHeld(f, runId) and R::replacementSigns(f.runtime, f.network) and not(f.overrun) and r.id == id and r.live
    and (r.state == Submitted or r.state == Unknown) and r.wallet == f.runtime.wallet and r.attempts.length() > 0
    and f.clock - latest.at >= replacementWaitMs and latest.maxFee < networkFee and tx > 0 and not(txUsed(f, tx))
    and replacementStepValid(feesOf(firstAttempt(r)), feesOf(latest), ceiling)
    and liabilityOf(f.gas.append({ ...noGas, id: f.gas.length() + 1, nonce: r.nonce, maximum: r.gasLimit * stepped.maxFee,
      state: Signed, settled: false }), day(f)) <= R::dailyCeilingOf(f.network)
pure def replace(f: Fee, runId: int, id: int, tx: int, networkFee: int): Fee =
  val r = f.rows.nthOr(id - 1, noRow)
  val ceiling = R::transactionCeilingOf(f.network) / (if (r.gasLimit > 0) r.gasLimit else 1)
  val stepped = nextFees(feesOf(firstAttempt(r)), feesOf(latestAttempt(r)), ceiling)
  { ...f, rows: f.rows.listMap(x => if (x.id == id) { ...x, state: Submitted, reason: NoReason,
      attempts: x.attempts.append({ tx: tx, maxFee: stepped.maxFee, priority: stepped.priority, at: f.clock }) } else x),
    gas: f.gas.append({ id: f.gas.length() + 1, runId: runId, nonce: r.nonce, maximum: r.gasLimit * stepped.maxFee,
      state: Signed, row: id, tx: tx, settled: false, actual: 0, settledDay: 0 }) }
pure def alwaysAttemptsKeepContent(f: Fee): bool = f.rows.every(r => r.attempts.every(a =>
  a.maxFee >= firstAttempt(r).maxFee and a.maxFee <= firstAttempt(r).maxFee * 3 and a.priority <= a.maxFee))
pure def sometimesReplaced(f: Fee): bool = f.rows.some(r => r.attempts.length() > 1)
```

## Story: Claim only accrued fees from reviewed vaults

### A claim delivers the accrued amount to the configured fee wallet and shares the native budget

A claim runs only in a recovery scan of a live network. It needs the
reviewed vault, its deployment bytes, the fee recipient equal to this fee
wallet, the same asset and network, and a value of at least 5 USDC and ten
times its gas cost. Permissionless claims confer no owner or withdrawal role.
A dry run reports and signs nothing. Sweeps are executed by the owner
outside the Worker.

```quint
type VaultClaim = { vaultReviewed: bool, deploymentMatches: bool, recipientIsFeeWallet: bool, assetMatches: bool,
  networkMatches: bool, amount: int, valueMicro: int, gasValue: int, tx: int, nonce: int, gasLimit: int, fees: EvmFees }
pure def claimAdmitted(c: VaultClaim): bool = c.vaultReviewed and c.deploymentMatches and c.recipientIsFeeWallet
  and c.assetMatches and c.networkMatches and c.amount > 0 and c.valueMicro >= 5000000 and c.valueMicro >= c.gasValue * 10
pure def canClaim(f: Fee, runId: int, claim: VaultClaim): bool =
  val maximum = worstCase(f, claim.gasLimit, claim.fees)
  leaseHeld(f, runId) and f.trigger == Recovery and R::networkSigns(f.runtime, f.network) and f.runtime.converterMode == R::Live
    and (R::converts(f.network) or R::buybackSigns(f.runtime, f.network))
    and not(f.overrun) and openRows(f) == 0 and claimAdmitted(claim) and claim.amount <= f.accrued
    and claim.tx > 0 and not(txUsed(f, claim.tx)) and claim.gasLimit > 0 and claim.fees.maxFee > 0
    and claim.fees.priority >= 0 and claim.fees.priority <= claim.fees.maxFee
    and (if (f.network == R::Solana) claim.nonce == solanaSequence(f) else claim.nonce >= nonceFloor(f))
    and maximum > 0 and maximum <= R::transactionCeilingOf(f.network)
    and liabilityOf(f.gas.append({ ...noGas, id: f.gas.length() + 1, nonce: claim.nonce, maximum: maximum, state: Signed, settled: false }), day(f))
      <= R::dailyCeilingOf(f.network)
pure def claim(f: Fee, runId: int, claim: VaultClaim): Fee =
  val id = f.rows.length() + 1
  { ...f, accrued: f.accrued - claim.amount,
    rows: f.rows.append({ ...noRow, id: id, kind: Claim, live: true, state: Submitted, runId: runId, wallet: f.runtime.wallet,
      amountIn: claim.amount, valueMicro: claim.valueMicro, nonce: claim.nonce, gasLimit: claim.gasLimit, createdAt: f.clock,
      attempts: List({ tx: claim.tx, maxFee: claim.fees.maxFee, priority: claim.fees.priority, at: f.clock }) }),
    gas: f.gas.append({ id: f.gas.length() + 1, runId: runId, nonce: claim.nonce, maximum: worstCase(f, claim.gasLimit, claim.fees),
      state: Signed, row: id, tx: claim.tx, settled: false, actual: 0, settledDay: 0 }) }
pure def sometimesClaimFinalized(f: Fee): bool = f.claimed > 0
```

## Story: Keep every journal record and its evidence

### Rows and reservations are append-only and settled records never change

A row in a terminal or waiting state never changes again. A signed
reservation keeps its nonce, maximum and transaction, and its settlement is
written once. Signing, replacement and claims happen only under the live
runtime; dry runs only quote and reconcile.

```quint
pure def settledState(s: RowState): bool = s == DustPending or s == Skipped or s == NoRoute or s == Finalized or s == Failed
pure def rowFrozen(r: Row): bool = settledState(r.state) or (r.state == Quoted and not(r.live))
pure def stepJournalAppendOnly(before: Fee, after: Fee): bool =
  after.rows.length() >= before.rows.length() and after.gas.length() >= before.gas.length()
    and before.rows.every(r => after.rows.some(a => a.id == r.id and (a.kind == r.kind or r.state == Quoted)))
    and before.rows.every(r => rowFrozen(r) implies after.rows.includes(r))
    and before.gas.every(g => after.gas.some(a => a.id == g.id and a.nonce == g.nonce and a.maximum == g.maximum and a.runId == g.runId))
    and before.gas.every(g => (g.settled or g.state == Abandoned) implies after.gas.includes(g))
pure def stepSignaturesNeedLive(before: Fee, via: str, after: Fee): bool =
  (via == "sign" or via == "replace" or via == "claim") implies before.runtime.converterMode == R::Live
pure def alwaysRowIdentity(f: Fee): bool = f.rows.every(r => r.id > 0 and f.rows.nthOr(r.id - 1, noRow) == r)
  and f.gas.every(g => g.id > 0 and f.gas.nthOr(g.id - 1, noGas).id == g.id)
pure def alwaysDryRowsNeverSign(f: Fee): bool = f.rows.every(r => not(r.live) implies r.attempts.length() == 0 and r.state != Submitted and r.state != Unknown)
```

### Simulation samples exercise the outcome order, both send families and conflicting evidence

These sets bound simulation only.

```quint
pure val elapsedValues = Set(180000, 3600001, 86400000)
pure val originalValues = Set({ maxFee: 50, priority: 2 }, { maxFee: 1, priority: 1 })
pure val latestValues = Set({ maxFee: 50, priority: 2 }, { maxFee: 120, priority: 4 }, { maxFee: 150, priority: 6 })
pure val feeCeilingValues = Set(100, 1000)
pure val runIdValues = Set(1, 2)
pure val idValues = Set(1, 2)
pure val txValues = Set(12, 13)
pure val nonceValues = Set(0)
pure val maximumValues = Set(50000, 5000000)
pure val amountValues = Set(1000000000)
pure val networkFeeValues = Set(1000)
pure val acceptedValues = Set(true, false)
pure val activeValues = Set(true)
pure val variableValues = Set(true)
pure val networkValues = Set(R::Base, R::Solana, R::Robinhood)
pure val assetValues = Set(ProjectToken, NativeAsset, TargetStable)
pure val byValues = Set(R::ReleaseWorkflow, R::Owner)
pure val configValues = Set(R::liveAll, { ...R::liveAll, source: 2, converterMode: R::DryRun, buybackMode: R::Off })
pure val transferValues = Set({ receipt: 1, amount: 1000000000, toFeeWallet: true, sameAsset: true, finalized: true },
  { receipt: 2, amount: 3000000, toFeeWallet: false, sameAsset: true, finalized: true })
pure val quoteValues = Set(
  { route: Found, amountIn: 500000000, output: 450000000, minimumOutput: 445500000, gasValue: 1000, impactBps: 50 },
  { route: Found, amountIn: 3000000, output: 3000000, minimumOutput: 2970000, gasValue: 1000, impactBps: 50 },
  { route: NoRouteResult, amountIn: 500000000, output: 0, minimumOutput: 0, gasValue: 0, impactBps: 0 },
  { route: Found, amountIn: 500000000, output: 450000000, minimumOutput: 445500000, gasValue: 1000, impactBps: -1 },
  { route: Found, amountIn: 500000000, output: 2000000000, minimumOutput: 1980000000, gasValue: 1000, impactBps: 50 })
pure val sendValues = Set(
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50, priority: 2 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000 },
  { kind: Approval, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50, priority: 2 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 0, deadline: 9000000000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50, priority: 2 }, inspection: Unresolved, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1, fees: { maxFee: 5000000, priority: 2 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000 })
pure val receiptValues = Set({ tx: 11, succeeded: true, output: 450000000, actualNative: 40000, finalized: true },
  { tx: 11, succeeded: false, output: 0, actualNative: 40000, finalized: true },
  { tx: 11, succeeded: true, output: 450000000, actualNative: 60000, finalized: true },
  { tx: 11, succeeded: true, output: 0, actualNative: 40000, finalized: true },
  { tx: 12, succeeded: true, output: 0, actualNative: 40000, finalized: true },
  { tx: 11, succeeded: true, output: 450000000, actualNative: 40000, finalized: false })
pure val deadlineValues = Set({ finalizedTime: 9000000001, included: false }, { finalizedTime: 9000000001, included: true })
pure val observationValues = Set(
  { providerA: "a", providerB: "b", signedSlot: 2, firstA: 1, firstB: 1, finalizedA: 3, finalizedB: 3,
    invalidA: true, invalidB: true, signatureA: false, signatureB: false, transactionA: false, transactionB: false },
  { providerA: "a", providerB: "a", signedSlot: 2, firstA: 1, firstB: 1, finalizedA: 3, finalizedB: 3,
    invalidA: true, invalidB: true, signatureA: false, signatureB: false, transactionA: false, transactionB: false })
pure val claimValues = Set(
  { vaultReviewed: true, deploymentMatches: true, recipientIsFeeWallet: true, assetMatches: true, networkMatches: true,
    amount: 1000000000, valueMicro: 900000000, gasValue: 1000, tx: 12, nonce: 0, gasLimit: 1000, fees: { maxFee: 50, priority: 2 } },
  { vaultReviewed: true, deploymentMatches: true, recipientIsFeeWallet: false, assetMatches: true, networkMatches: true,
    amount: 1000000000, valueMicro: 900000000, gasValue: 1000, tx: 12, nonce: 0, gasLimit: 1000, fees: { maxFee: 50, priority: 2 } })
pure val weight_evaluate = 8
pure val weight_reserveGas = 8
pure val weight_sign = 10
pure val weight_finalizeSend = 8
pure val weight_acquireLease = 8
pure val weight_publishWorker = 6
pure val weight_setReleaseVariable = 6
pure val weight_verifyReadiness = 6
pure val weight_receiveFee = 6
pure val weight_setReplacement = 3
pure val weight_replace = 6
pure val weight_broadcastFail = 4
pure val weight_expireEvm = 4
pure val weight_claim = 4
pure val weight_accrue = 3
```
