# Received-fee conversion journal and native holds

PRD section 6 "Received-fee handling" and section 11 govern the fee-only
service of one network fee wallet. Sources: the pinned
`workers/fee-converter/{core,store,native-gas,evm,solana,solana-expiry}.ts`,
`workers/verified-fee-replacement.ts`, migrations `0022`, `0076`, `0082`,
`0087`, `0088`, `0092`, `0095` and `0121`, and the legacy models
`fee_conversion`, `fee_value_caps`, `fee_lease_journal`, `fee_quote_policy`,
`fee_nonce_reuse`, `native_budget`, `earned_fee_history`, `solana_route` and
`solana_expiry`.

Each instance owns the journal of one network fee wallet: the network lease
(`fee_converter_locks`), the run and rolling-day value caps, the native-gas
reservations (`fee_native_gas`) with their nonces and daily ceiling, and the
rows of every token the wallet holds (`fee_conversions`). One run loops over
every token under one lease, one run cap and one nonce sequence, exactly as
`runNetwork` does. The published Worker configuration is the
[runtime component](./runtime.md). Values are integer USDC micro-units. EVM
native amounts are integer megawei (10^6 wei), rounded up by the adapter,
and Solana native amounts are lamports. Token amounts are exact base units of their own
token. Clock values are UTC epoch milliseconds from the trusted Worker clock.

Evidence records name their verified source. `FinalizedTransfer`,
`VaultAccrual`, `SendReceipt`, `DeadlineEvidence`, `ExpiryScan` and
`NetworkFeeObservation` come from the chain observation adapter (finalized
blocks, or the node's current fee for a replacement), `Quote` from the pinned
aggregator quote reader, and `SignedSend` from the signer after it inspected
every instruction, account, lookup table and token program of the exact
bytes. Reviewed vaults are registered only by the release workflow from the
reviewed configuration.

## Story: Run one network at a time under a fenced lease

### A run needs the published Worker, a fresh run identity and a free or expired lease

`Off` starts nothing: no lease, no read and no reconciliation. A later run
may take an expired lease; the earlier holder then can neither sign nor
commit. Taking the lease retires every reservation another run left
unsigned. A reservation can never precede a broadcast, so retiring it
cannot strand a send.

```quint
import runtime as R from "./runtime"
import feeReplacement as FR from "../settlement/feeReplacement"
type HoldingKind = TargetStable | ProjectToken | NativeAsset
type Trigger = Receipts | Recovery
type SendKind = Conversion | Approval | Claim
type RowState = Quoted | DustPending | Skipped | NoRoute | Submitted | Unknown | Finalized | Failed
type Reason = NoReason | BelowMinimum | BelowGasMultiple | RunCapReached | DayCapReached | ExceedsRemaining
  | UnsafeValue | ImpactUnknown | ImpactAbove | SlippageOutside | NoRouteFound | PrepareFailed
  | RunEndedBeforeSigning | Reverted | ExpiredUnlanded | BroadcastUnknown | BelowSignedMinimum | NonceConsumed
type GasState = Reserved | Signed | Abandoned
type Attempt = { tx: int, maxFee: int, priority: int, at: int }
type Row = { id: int, token: int, kind: SendKind, live: bool, state: RowState, reason: Reason, runId: int, wallet: int,
  amountIn: int, valueMicro: int, balanceBefore: int, minimumOutput: int, nonce: int, gasLimit: int,
  deadline: int, attempts: List[Attempt], output: int, createdAt: int }
type Reservation = { id: int, runId: int, nonce: int, maximum: int, state: GasState, row: int, tx: int,
  settled: bool, actual: int, settledDay: int, blockhashSlot: int, imported: bool }
type Holding = { token: int, asset: HoldingKind, balance: int, feeIncome: int, topUps: int, sold: int, usdcOut: int,
  vault: int, vaultObserved: int, accrued: int, claimed: int }
type Lease = { holder: int, expiresAt: int }
type ReviewedVault = { vault: int, deployment: int, token: int }
type Fee = { runtime: R::Runtime, network: R::Network, clock: int, lease: Lease, nextRun: int,
  trigger: Trigger, runValue: int, receipts: List[int], holdings: List[Holding], vaults: List[ReviewedVault],
  rows: List[Row], gas: List[Reservation], overrun: bool, scans: List[ExpiryScan], proofs: List[ExpiryProof], rotation: Lease }
pure val initial: Fee = { runtime: R::initial, network: R::Base, clock: 0,
  lease: { holder: 0, expiresAt: 0 }, nextRun: 1, trigger: Recovery, runValue: 0, receipts: List(), holdings: List(),
  vaults: List(), rows: List(), gas: List(), overrun: false, scans: List(), proofs: List(), rotation: { holder: 0, expiresAt: 0 } }
pure val lockMs = 840000
pure val dayMs = 86400000
pure val quoteAbandonMs = 3600000
pure val replacementWaitMs = 180000
pure def day(f: Fee): int = f.clock / dayMs
pure def wallet(f: Fee): int = R::walletOf(f.runtime, f.network)
pure def leaseHeld(f: Fee, runId: int): bool = runId > 0 and f.lease.holder == runId and f.clock <= f.lease.expiresAt
pure def canChooseInstance(f: Fee, network: R::Network, by: R::Sender): bool =
  by == R::Worker and f.rows.length() == 0 and f.receipts.length() == 0 and f.holdings.length() == 0 and f.nextRun == 1
    and f.rotation.holder == 0
pure def chooseInstance(f: Fee, network: R::Network, by: R::Sender): Fee = { ...f, network: network }
pure def canAdvanceClock(f: Fee, elapsed: int, by: R::Sender): bool = by == R::Worker and elapsed > 0
pure def advanceClock(f: Fee, elapsed: int, by: R::Sender): Fee = { ...f, clock: f.clock + elapsed }
pure def canAcquireLease(f: Fee, runId: int, trigger: Trigger, by: R::Sender): bool =
  by == R::Worker and R::runs(f.runtime) and runId == f.nextRun and (f.lease.holder == 0 or f.clock > f.lease.expiresAt)
    and not(rotationHolds(f))
pure def acquireLease(f: Fee, runId: int, trigger: Trigger, by: R::Sender): Fee =
  { ...f, lease: { holder: runId, expiresAt: f.clock + lockMs }, nextRun: runId + 1, trigger: trigger, runValue: 0,
    gas: f.gas.listMap(g => if (g.state == Reserved) { ...g, state: Abandoned } else g) }
pure def canRenewLease(f: Fee, runId: int, by: R::Sender): bool = by == R::Worker and leaseHeld(f, runId)
pure def renewLease(f: Fee, runId: int, by: R::Sender): Fee = { ...f, lease: { holder: runId, expiresAt: f.clock + lockMs } }
pure def canReleaseLease(f: Fee, runId: int, by: R::Sender): bool = by == R::Worker and leaseHeld(f, runId)
pure def releaseLease(f: Fee, runId: int, by: R::Sender): Fee = { ...f, lease: { holder: 0, expiresAt: 0 } }
pure def alwaysLeaseIdentity(f: Fee): bool = f.lease.holder >= 0 and f.lease.holder < f.nextRun
  and f.gas.every(g => g.runId > 0 and g.runId < f.nextRun) and f.rows.every(r => r.runId > 0 and r.runId < f.nextRun)
pure def stepStaleRunCannotSign(before: Fee, via: str, after: Fee): bool =
  after.gas.length() > before.gas.length() implies leaseHeld(before, after.gas.nthOr(before.gas.length(), noGas).runId)
```

### An operator Solana RPC rotation holds the network lease only while the journal is quiet, and no run acquires, signs or commits meanwhile

The rotation of the live Solana RPC pair ([RPC rotation](./solanaRpcRotation.md))
takes the same `fee_converter_locks` row as a run, from the protected release
job: only on Solana, only when the lease is free or expired, and only while
the journal is quiet: no live row quoted, submitted or unknown (a conversion
whose approval landed and whose swap is unsigned is such a quoted intent
here) and no gas reservation reserved, or signed and unsettled. The pinned
query also counts a finalized Solana bridge deposit with no proven outcome;
that is the [bridge leg](./buyback.md)'s in-transit order, which the shell
checks in the same statement. A renewal needs the rotation's own unexpired
lease and a journal still quiet. The rotation releases only its own lease;
one whose activation is uncertain leaves it to expire
(`rotate-fee-solana-rpc.ts`, `acquireRotationLeaseSql`,
`renewRotationLeaseSql`). While it holds the lease no run can take it, so
no run reserves, signs, replaces or claims. A journal whose rotation lease
is recorded keeps its network, so the lease never outlives the Solana
instance it was taken on.

```quint
pure def rotationHolds(f: Fee): bool = f.rotation.holder > 0 and f.clock <= f.rotation.expiresAt
pure def runHolds(f: Fee): bool = f.lease.holder > 0 and f.clock <= f.lease.expiresAt
pure def journalQuiet(f: Fee): bool =
  f.rows.every(r => not(r.live and (r.state == Quoted or r.state == Submitted or r.state == Unknown)))
    and f.gas.every(g => g.state != Reserved and (g.state == Signed implies g.settled))
pure def canAcquireRotationLease(f: Fee, rotationId: int, by: R::Sender): bool =
  by == R::ReleaseWorkflow and f.network == R::Solana and rotationId > 0 and not(runHolds(f)) and not(rotationHolds(f))
    and journalQuiet(f)
pure def acquireRotationLease(f: Fee, rotationId: int, by: R::Sender): Fee =
  { ...f, rotation: { holder: rotationId, expiresAt: f.clock + lockMs } }
pure def canRenewRotationLease(f: Fee, rotationId: int, by: R::Sender): bool =
  by == R::ReleaseWorkflow and f.network == R::Solana and rotationId > 0 and f.rotation.holder == rotationId and rotationHolds(f)
    and journalQuiet(f)
pure def renewRotationLease(f: Fee, rotationId: int, by: R::Sender): Fee =
  { ...f, rotation: { holder: rotationId, expiresAt: f.clock + lockMs } }
pure def canReleaseRotationLease(f: Fee, rotationId: int, by: R::Sender): bool =
  by == R::ReleaseWorkflow and rotationId > 0 and f.rotation.holder == rotationId
pure def releaseRotationLease(f: Fee, rotationId: int, by: R::Sender): Fee = { ...f, rotation: { holder: 0, expiresAt: 0 } }
pure def alwaysRotationExcludesRuns(f: Fee): bool = rotationHolds(f) implies not(runHolds(f))
pure def alwaysRotationOnlyOnSolana(f: Fee): bool = f.rotation.holder > 0 implies f.network == R::Solana
pure def stepRotationBlocksRuns(before: Fee, via: str, after: Fee): bool = rotationHolds(before) implies
  not(via == "acquireLease" or via == "reserveGas" or via == "sign" or via == "replace" or via == "claim")
pure def stepRotationOnlyWhenQuiet(before: Fee, via: str, after: Fee): bool =
  (via == "acquireRotationLease" or via == "renewRotationLease") implies journalQuiet(before) and before.network == R::Solana
pure def sometimesRotationHoldsLease(f: Fee): bool = rotationHolds(f) and f.nextRun > 1
```

### The Worker configuration and the reviewed vaults are published components

The release workflow and the owner change the component through its own
guards; this journal never changes it. The release workflow registers each
reviewed vault deployment and the wallet token it pays.

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
pure def canRegisterVault(f: Fee, reviewed: ReviewedVault, by: R::Sender): bool = by == R::ReleaseWorkflow
  and reviewed.vault > 0 and reviewed.deployment > 0 and validToken(f, reviewed.token) and not(f.vaults.some(v => v.vault == reviewed.vault))
pure def registerVault(f: Fee, reviewed: ReviewedVault, by: R::Sender): Fee = { ...f, vaults: f.vaults.append(reviewed) }
pure def alwaysRuntimeSound(f: Fee): bool = R::alwaysPublishedPassedPreflight(f.runtime) and R::alwaysUnpublishedInert(f.runtime)
  and R::alwaysBuybackNeedsLiveConverter(f.runtime) and R::alwaysStagingBuybackOff(f.runtime) and R::alwaysReadyOnlyForEnabledNetworks(f.runtime)
  and R::alwaysStagingNeverSigns(f.runtime)
```

## Story: Know what the wallet received before anything converts

### A token is converted from the wallet's observed balance; native fees only from finalized receipts, and gas top-ups never are

Each wallet token is one holding. A receipt identifier counts once on the
network. A project token, an allowlisted token or the network's USDC is
evaluated from the fee wallet's current token balance (`balanceOf`), which
the chain observation adapter reads at the start of each evaluation; any
increase over the recorded balance is fee income, and a wallet holding no
gas top-ups of that token is never charged one. An open send of the token
blocks its observation, so an observation never falls below the amount an
open send holds. Only the native asset is limited to finalized receipt
accounting: a native top-up adds to the balance and never to fee income, so
a native-asset conversion can never sell gas that was deposited to pay for
sends (`core.ts` `runNetwork`, `nativeFeeBalance`). Vault accrual is the
reviewed vault's current accrued fees for this fee wallet, read at one
pinned block; it falls when anyone claims, and it counts only while the fee
wallet holds and is proposed for none of the vault's roles (owner,
registrar, upgrade authority, identity authority, pending identity or
upgrade authority). An observation of a vault whose token has an open claim
is not used. Only a finalized claim moves accrued fees into the wallet, and
the accrued amount and the open claims of a token together never exceed the
vault's last observed accrual: each run claims at most the `accruedFees` it
read.

```quint
type FinalizedTransfer = { receipt: int, token: int, amount: int, toFeeWallet: bool, sameAsset: bool, finalized: bool }
type VaultAccrual = { vault: int, recipient: int, accrued: int, height: int, finalized: bool, roleFree: bool }
pure val noHolding: Holding = { token: 0, asset: ProjectToken, balance: 0, feeIncome: 0, topUps: 0, sold: 0, usdcOut: 0,
  vault: 0, vaultObserved: 0, accrued: 0, claimed: 0 }
pure def validToken(f: Fee, token: int): bool = token >= 1 and token <= f.holdings.length()
pure def holding(f: Fee, token: int): Holding = f.holdings.nthOr(token - 1, noHolding)
pure def withHolding(token: int, h: Holding, f: Fee): List[Holding] = f.holdings.listMap(x => if (x.token == token) h else x)
pure def canAddToken(f: Fee, asset: HoldingKind, by: R::Sender): bool = by == R::Worker and (asset == ProjectToken or not(f.holdings.some(h => h.asset == asset)))
pure def addToken(f: Fee, asset: HoldingKind, by: R::Sender): Fee =
  { ...f, holdings: f.holdings.append({ ...noHolding, token: f.holdings.length() + 1, asset: asset }) }
pure def canReceiveFee(f: Fee, transfer: FinalizedTransfer, by: R::Sender): bool = by == R::Worker and transfer.receipt > 0 and not(f.receipts.includes(transfer.receipt))
  and validToken(f, transfer.token) and transfer.amount > 0 and transfer.toFeeWallet and transfer.sameAsset and transfer.finalized
pure def receiveFee(f: Fee, transfer: FinalizedTransfer, by: R::Sender): Fee =
  val h = holding(f, transfer.token)
  { ...f, holdings: withHolding(transfer.token, { ...h, balance: h.balance + transfer.amount, feeIncome: h.feeIncome + transfer.amount }, f),
    receipts: f.receipts.append(transfer.receipt) }
pure def canReceiveTopUp(f: Fee, token: int, amount: int, by: R::Sender): bool = by == R::Worker and validToken(f, token) and holding(f, token).asset == NativeAsset and amount > 0
pure def receiveTopUp(f: Fee, token: int, amount: int, by: R::Sender): Fee =
  val h = holding(f, token)
  { ...f, holdings: withHolding(token, { ...h, balance: h.balance + amount, topUps: h.topUps + amount }, f) }
pure def vaultOf(f: Fee, vault: int): ReviewedVault = f.vaults.foldl({ vault: 0, deployment: 0, token: 0 }, (found, v) => if (v.vault == vault) v else found)
pure def canObserveBalance(f: Fee, token: int, balance: int, by: R::Sender): bool =
  by == R::Worker and validToken(f, token) and holding(f, token).asset != NativeAsset and openRows(f, token) == 0
    and balance >= 0 and balance != holding(f, token).balance
pure def observeBalance(f: Fee, token: int, balance: int, by: R::Sender): Fee =
  val h = holding(f, token)
  { ...f, holdings: withHolding(token, { ...h, balance: balance,
      feeIncome: if (balance > h.balance) h.feeIncome + balance - h.balance else h.feeIncome }, f) }
pure def canAccrue(f: Fee, accrual: VaultAccrual, by: R::Sender): bool =
  val v = vaultOf(f, accrual.vault)
  by == R::Worker and v.vault > 0 and accrual.recipient == wallet(f) and accrual.finalized and accrual.height > 0
    and accrual.roleFree and accrual.accrued >= 0 and openClaims(f, v.token) == 0
pure def accrue(f: Fee, accrual: VaultAccrual, by: R::Sender): Fee =
  val v = vaultOf(f, accrual.vault)
  val h = holding(f, v.token)
  { ...f, holdings: withHolding(v.token, { ...h, accrued: accrual.accrued, vaultObserved: accrual.accrued, vault: v.vault }, f) }
pure def perTransactionReserve(f: Fee, h: Holding): int = if (h.asset == NativeAsset) R::transactionCeilingOf(f.network) else 0
pure def spendable(f: Fee, token: int): int =
  val h = holding(f, token)
  val earned = h.feeIncome - h.sold - perTransactionReserve(f, h)
  if (h.asset != NativeAsset) h.balance else if (earned <= 0) 0 else if (earned < h.balance) earned else h.balance
pure def alwaysHoldingsIdentity(f: Fee): bool = f.holdings.every(h => h.token >= 1 and holding(f, h.token) == h)
  and f.rows.every(r => validToken(f, r.token)) and f.vaults.every(v => validToken(f, v.token))
pure def alwaysTopUpsNeverSold(f: Fee): bool = f.holdings.every(h =>
  (if (h.asset == NativeAsset) h.balance == h.feeIncome + h.topUps - h.sold else h.topUps == 0 and h.sold + h.balance <= h.feeIncome)
  and h.sold >= 0 and h.sold + openAmount(f, h.token) <= h.feeIncome and h.balance >= openAmount(f, h.token)
  and h.topUps >= 0 and h.balance >= 0)
pure def alwaysAccrualFromVault(f: Fee): bool = f.holdings.every(h => h.accrued >= 0 and h.claimed >= 0 and h.vaultObserved >= 0
  and h.accrued + openClaims(f, h.token) <= h.vaultObserved)
pure def sometimesBalanceObserved(f: Fee): bool = f.holdings.some(h => h.asset == ProjectToken and h.feeIncome > 0 and f.receipts.length() == 0)
pure def sometimesAccrualFell(f: Fee): bool = f.holdings.some(h => h.vault > 0 and h.vaultObserved < h.claimed)
pure def sometimesTopUpRetained(f: Fee): bool = f.holdings.some(h => h.topUps > 0 and h.feeIncome > 0 and spendable(f, h.token) < h.balance)
pure def sometimesTwoTokens(f: Fee): bool = f.rows.some(r => r.token == 1) and f.rows.some(r => r.token == 2)
```

## Story: Evaluate each wallet token once per run and record why it waits

### Each evaluation records one outcome from the pinned order of checks

A run first reconciles; an open send blocks its token. Robinhood Chain and
the network's own USDC are never evaluated: they stay in the wallet and show
**not converted** or need no conversion. A receipts run skips a token whose
balance equals the latest recorded attempt's starting balance unless that
attempt finalized. The checks run in the pinned order: no route; remaining
network value cap (the run cap and the rolling 24-hour cap shared by every
token of the network); quote above the remaining cap; unsafe integer value;
below 5 USDC or ten times the gas cost (dust, which waits in the wallet);
unknown or high price impact; minimum output outside 1% slippage. A dry run
records the quote, counts it against the run cap and never signs. A
repeated waiting outcome with the same amount, reason and mode adds no row.
A run handles one token's live quote at a time.

```quint
type RouteResult = Found | NoRouteResult
type Quote = { token: int, route: RouteResult, amountIn: int, output: int, minimumOutput: int, gasValue: int, impactBps: int }
type Outcome = { state: RowState, reason: Reason }
pure val runCap = 1000000000
pure val dayCap = 5000000000
pure val maximumSafeValue = 9007199254740991
pure def isOpen(r: Row): bool = r.state == Submitted or r.state == Unknown or (r.state == Quoted and r.live)
pure def openAmount(f: Fee, token: int): int = f.rows.foldl(0, (t, r) => if (isOpen(r) and r.kind == Conversion and r.token == token) t + r.amountIn else t)
pure def openClaims(f: Fee, token: int): int = f.rows.foldl(0, (t, r) => if (isOpen(r) and r.kind == Claim and r.token == token) t + r.amountIn else t)
pure def openRows(f: Fee, token: int): int = f.rows.foldl(0, (t, r) => if (isOpen(r) and r.token == token) t + 1 else t)
pure def dayValue(f: Fee): int = f.rows.foldl(0, (t, r) =>
  if (r.kind == Conversion and r.live and (r.state == Submitted or r.state == Unknown or r.state == Finalized)
    and r.createdAt > f.clock - dayMs) t + r.valueMicro else t)
pure def remaining(f: Fee): int =
  val runLeft = runCap - f.runValue
  val dayLeft = dayCap - dayValue(f)
  if (runLeft < dayLeft) runLeft else dayLeft
pure def evaluated(f: Fee, token: int): bool = holding(f, token).asset != TargetStable and R::converts(f.network)
pure def lastConversion(f: Fee, token: int): Row = f.rows.foldl(noRow, (latest, r) => if (r.kind == Conversion and r.token == token) r else latest)
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
pure def canEvaluate(f: Fee, runId: int, quote: Quote, by: R::Sender): bool =
  val latest = lastConversion(f, quote.token)
  by == R::Worker and leaseHeld(f, runId) and validToken(f, quote.token) and evaluated(f, quote.token) and openRows(f, quote.token) == 0
    and pendingIntent(f, runId).id == 0 and spendable(f, quote.token) > 0
    and quote.amountIn > 0 and quote.amountIn <= spendable(f, quote.token) and quote.output >= 0 and quote.gasValue >= 0
    and (f.trigger == Receipts implies latest.id == 0 or latest.state == Finalized or latest.balanceBefore != spendable(f, quote.token))
pure def evaluationRow(f: Fee, runId: int, quote: Quote): Row =
  val decided = outcomeOf(f, quote)
  { ...noRow, id: f.rows.length() + 1, token: quote.token, kind: Conversion, live: f.runtime.converterMode == R::Live, state: decided.state,
    reason: decided.reason, runId: runId, wallet: wallet(f), amountIn: quote.amountIn,
    valueMicro: if (quote.output > maximumSafeValue) 0 else quote.output, balanceBefore: spendable(f, quote.token),
    minimumOutput: quote.minimumOutput, createdAt: f.clock }
pure def repeatsWaiting(f: Fee, row: Row): bool =
  val latest = lastConversion(f, row.token)
  (row.state == DustPending or row.state == Skipped or row.state == NoRoute)
    and latest.id > 0 and latest.state == row.state and latest.reason == row.reason and latest.amountIn == row.amountIn and latest.live == row.live
pure def evaluate(f: Fee, runId: int, quote: Quote, by: R::Sender): Fee =
  val row = evaluationRow(f, runId, quote)
  if (repeatsWaiting(f, row)) f
  else { ...f, rows: f.rows.append(row), runValue: if (row.state == Quoted and not(row.live)) f.runValue + row.valueMicro else f.runValue }
pure def alwaysNotConvertedRetained(f: Fee): bool = f.holdings.every(h => not(evaluated(f, h.token)) implies
  f.rows.every(r => r.token != h.token or r.kind != Conversion) and h.sold == 0)
pure def alwaysRunValueBounded(f: Fee): bool = f.runValue >= 0 and f.runValue <= runCap and dayValue(f) <= dayCap
pure def sometimesDust(f: Fee): bool = f.rows.some(r => r.state == DustPending)
pure def sometimesSkippedForCap(f: Fee): bool = f.rows.some(r => r.state == Skipped)
pure def sometimesNoRoute(f: Fee): bool = f.rows.some(r => r.state == NoRoute)
pure def sometimesDryQuoted(f: Fee): bool = f.rows.some(r => r.state == Quoted and not(r.live))
pure def sometimesRobinhoodRetained(f: Fee): bool = f.network == R::Robinhood and f.holdings.some(h => h.balance > 0)
pure def sometimesUsdcNotSwapped(f: Fee): bool = R::converts(f.network)
  and f.holdings.some(h => h.asset == TargetStable and h.feeIncome > 0 and h.balance == h.feeIncome)
```

## Story: Sign only a reserved, inspected, same-wallet send

### Native gas is reserved before signing and committed atomically with the signed row

Approvals, claims, conversions and replacements of every token share one
native budget, one nonce sequence and one daily ceiling per network. A
reservation records the worst-case fee: `gasLimit * maxFee` on EVM, plus
the fixed 50,000,000 megawei (0.00005 ETH) data and operator fee allowance
on Base (`additionalFeeReserve`), and the whole per-transaction ceiling on
Solana.
That allowance counts in both the per-transaction and the daily check. Each UTC day's liability is the
actual fees settled that day plus, for each nonce, the largest unsettled
reservation. Settled fees count on their settlement day, and unsettled
reservations count on every day until a receipt settles them. A send that
exceeds its reservation holds every later signature on the network. A lost
lease between reservation and signature leaves an unsigned reservation that
the stepped run abandons. Every token draws nonces from the one network
sequence, and a nonce held by a reservation of another send is never
issued twice; only a nonce whose send expired unlanded, and that no
canonical receipt has settled since, may be reused. A
claim starts only when the run has no other reservation or intent. A Solana signature records the slot of the
blockhash it was signed against; that slot never changes. Every reservation
the journal makes itself stays within the per-transaction ceiling, and while
no send overran, the day's liability of those reservations stays within the
daily ceiling; an imported historical send (below) is charged at its own
worst case with neither check, and it still counts in the liability every
later reservation is checked against.

A swap goes only to the network's pinned router: the KyberSwap router
`0x6131b5fae19ea4f9d964eac0408e4408b66337b5` on Base, Ethereum and
Robinhood Chain (`config.ts`), and the Jupiter program on Solana. On an EVM
network the signer reads the wallet's allowance for that router before
signing: while it is below the input, the send is an approval of exactly
the input to that router (`approve(router, amountIn)`, with no value), and
otherwise the swap itself (`evm.ts` `prepare`, `boundedApproval`). A native
input needs no allowance, and the adapter reports it as the input.

Every signature, a conversion, an approval, a claim or a replacement, is
refused when its final prepared worst-case native fee (the reservation's
maximum, with the Base allowance), priced in USDC, times ten exceeds the
send's value, or when that fee cannot be priced; an approval is measured
against its conversion's value (`evm.ts` `signIntent`). On Solana the
priced cost must also be positive (`solana.ts` "Final Solana native cost
cannot be priced"). The quote's gas value only decides dust.

```quint
type EvmFees = { maxFee: int, priority: int }
type RouteInspection = Inspected | Unresolved
type SignedSend = { kind: SendKind, tx: int, nonce: int, gasLimit: int, fees: EvmFees, inspection: RouteInspection,
  outputToFeeWallet: bool, minimumOutput: int, deadline: int, blockhashSlot: int, toPinnedRouter: bool, approvedAmount: int,
  allowance: int, pricedFeeMicro: int }
pure val noGas: Reservation = { id: 0, runId: 0, nonce: -1, maximum: 0, state: Abandoned, row: 0, tx: 0, settled: true, actual: 0,
  settledDay: 0, blockhashSlot: 0, imported: false }
pure val noRow: Row = { id: 0, token: 0, kind: Conversion, live: false, state: Failed, reason: NoReason, runId: 0, wallet: 0, amountIn: 0,
  valueMicro: 0, balanceBefore: 0, minimumOutput: 0, nonce: -1, gasLimit: 0, deadline: 0, attempts: List(), output: 0, createdAt: 0 }
pure def bucketHolds(gas: List[Reservation], g: Reservation): bool =
  g.state != Abandoned and not(g.settled) and gas.every(o => o.state == Abandoned or o.settled or o.nonce != g.nonce
    or o.maximum < g.maximum or (o.maximum == g.maximum and o.id >= g.id))
pure def liabilityOf(gas: List[Reservation], today: int): int = gas.foldl(0, (t, g) =>
  if (g.state != Abandoned and g.settled and g.settledDay == today) t + g.actual
  else if (bucketHolds(gas, g)) t + g.maximum else t)
pure def liability(f: Fee): int = liabilityOf(f.gas, day(f))
pure def additionalReserve(network: R::Network): int = if (network == R::Base) 50000000 else 0
pure def worstCase(f: Fee, gasLimit: int, fees: EvmFees): int =
  if (f.network == R::Solana) R::transactionCeilingOf(f.network) else gasLimit * fees.maxFee + additionalReserve(f.network)
pure def expiredRow(f: Fee, id: int): bool = f.rows.some(r => r.id == id and r.reason == ExpiredUnlanded)
pure def nonceFloor(f: Fee): int = f.gas.foldl(0, (t, g) =>
  if ((g.state == Reserved or (g.state == Signed and (g.settled or not(expiredRow(f, g.row))))) and g.nonce >= t) g.nonce + 1 else t)
pure def solanaSequence(f: Fee): int = f.gas.foldl(0, (t, g) => if (g.nonce >= t) g.nonce + 1 else t)
pure def ownReservation(f: Fee, runId: int): Reservation =
  f.gas.foldl(noGas, (found, g) => if (g.state == Reserved and g.runId == runId) g else found)
pure def pendingIntent(f: Fee, runId: int): Row =
  f.rows.foldl(noRow, (found, r) => if (r.state == Quoted and r.live and r.runId == runId) r else found)
pure def canReserveGas(f: Fee, runId: int, nonce: int, maximum: int, by: R::Sender): bool =
  val intent = pendingIntent(f, runId)
  by == R::Worker and leaseHeld(f, runId) and intent.id > 0 and ownReservation(f, runId).id == 0 and not(f.overrun)
    and maximum > 0 and maximum <= R::transactionCeilingOf(f.network)
    and (if (f.network == R::Solana) nonce == solanaSequence(f) and maximum == R::transactionCeilingOf(f.network) else nonce >= nonceFloor(f))
    and liabilityOf(f.gas.append({ ...noGas, id: f.gas.length() + 1, nonce: nonce, maximum: maximum, state: Reserved, settled: false }), day(f))
      <= R::dailyCeilingOf(f.network)
pure def reserveGas(f: Fee, runId: int, nonce: int, maximum: int, by: R::Sender): Fee =
  { ...f, gas: f.gas.append({ id: f.gas.length() + 1, runId: runId, nonce: nonce, maximum: maximum, state: Reserved,
    row: 0, tx: 0, settled: false, actual: 0, settledDay: 0, blockhashSlot: 0, imported: false }) }
pure def txUsed(f: Fee, tx: int): bool = f.gas.some(g => g.tx == tx)
pure def pricedWithin(f: Fee, pricedFeeMicro: int, valueMicro: int): bool =
  (if (f.network == R::Solana) pricedFeeMicro > 0 else pricedFeeMicro >= 0) and pricedFeeMicro * 10 <= valueMicro
pure def canSign(f: Fee, runId: int, send: SignedSend, by: R::Sender): bool =
  val intent = pendingIntent(f, runId)
  val held = ownReservation(f, runId)
  by == R::Worker and leaseHeld(f, runId) and R::conversionSigns(f.runtime, f.network) and not(f.overrun) and intent.id > 0 and held.id > 0
    and intent.wallet == wallet(f) and send.tx > 0 and not(txUsed(f, send.tx)) and send.nonce == held.nonce
    and send.gasLimit > 0 and send.fees.maxFee > 0 and send.fees.priority >= 0 and send.fees.priority <= send.fees.maxFee
    and worstCase(f, send.gasLimit, send.fees) == held.maximum
    and send.inspection == Inspected and send.outputToFeeWallet and send.deadline > f.clock
    and (send.kind == Conversion or (send.kind == Approval and f.network != R::Solana))
    and (send.kind == Conversion implies send.minimumOutput >= intent.minimumOutput and send.minimumOutput > 0)
    and send.toPinnedRouter and send.allowance >= 0
    and (send.kind == Approval implies send.approvedAmount == intent.amountIn and send.allowance < intent.amountIn)
    and ((send.kind == Conversion and f.network != R::Solana) implies send.allowance >= intent.amountIn)
    and (if (f.network == R::Solana) send.blockhashSlot > 0 else send.blockhashSlot == 0)
    and intent.valueMicro <= remaining(f) and pricedWithin(f, send.pricedFeeMicro, intent.valueMicro)
pure def sign(f: Fee, runId: int, send: SignedSend, by: R::Sender): Fee =
  val intent = pendingIntent(f, runId)
  val held = ownReservation(f, runId)
  { ...f, rows: f.rows.listMap(r => if (r.id == intent.id) { ...r, kind: send.kind, state: Submitted, nonce: send.nonce,
      gasLimit: send.gasLimit, deadline: send.deadline, minimumOutput: if (send.kind == Approval) 0 else send.minimumOutput,
      attempts: List({ tx: send.tx, maxFee: send.fees.maxFee, priority: send.fees.priority, at: f.clock }) } else r),
    gas: f.gas.listMap(g => if (g.id == held.id) { ...g, state: Signed, row: intent.id, tx: send.tx, blockhashSlot: send.blockhashSlot } else g),
    runValue: if (send.kind == Conversion) f.runValue + intent.valueMicro else f.runValue }
pure def canFailPreparation(f: Fee, runId: int, by: R::Sender): bool = by == R::Worker and leaseHeld(f, runId) and pendingIntent(f, runId).id > 0
pure def failPreparation(f: Fee, runId: int, by: R::Sender): Fee =
  val intent = pendingIntent(f, runId)
  { ...f, rows: f.rows.listMap(r => if (r.id == intent.id) { ...r, state: Failed, reason: PrepareFailed } else r),
    gas: f.gas.listMap(g => if (g.state == Reserved and g.runId == runId) { ...g, state: Abandoned } else g) }
pure def canAbandonIntent(f: Fee, runId: int, id: int, by: R::Sender): bool =
  val row = f.rows.nthOr(id - 1, noRow)
  by == R::Worker and leaseHeld(f, runId) and row.id == id and row.state == Quoted and row.live and row.runId != runId
    and f.clock - row.createdAt > quoteAbandonMs
pure def abandonIntent(f: Fee, runId: int, id: int, by: R::Sender): Fee =
  { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Failed, reason: RunEndedBeforeSigning } else r) }
pure def canBroadcastFail(f: Fee, runId: int, id: int, by: R::Sender): bool =
  by == R::Worker and leaseHeld(f, runId) and f.rows.some(r => r.id == id and r.state == Submitted)
pure def broadcastFail(f: Fee, runId: int, id: int, by: R::Sender): Fee =
  { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Unknown, reason: BroadcastUnknown } else r) }
pure def journaledGas(f: Fee): List[Reservation] = f.gas.select(g => not(g.imported))
pure def alwaysLiabilityWithinDay(f: Fee): bool = not(f.overrun) implies liabilityOf(journaledGas(f), day(f)) <= R::dailyCeilingOf(f.network)
pure def alwaysReservationsWithinTransaction(f: Fee): bool = f.gas.every(g => g.maximum > 0
  and (not(g.imported) implies g.maximum <= R::transactionCeilingOf(f.network)) and (g.imported implies g.state == Signed)
  and g.actual >= 0 and (g.state == Reserved implies g.row == 0 and not(g.settled) and g.blockhashSlot == 0)
  and (g.settled implies g.state == Signed)
  and (g.state == Signed implies (if (f.network == R::Solana) g.blockhashSlot > 0 else g.blockhashSlot == 0)))
pure def alwaysOneOpenSend(f: Fee): bool = f.holdings.every(h => openRows(f, h.token) <= 1)
pure def alwaysOpenSendHeld(f: Fee): bool = f.rows.every(r => (r.state == Submitted or r.state == Unknown) implies
  r.attempts.length() > 0 and r.attempts.every(a => f.gas.some(g => g.row == r.id and g.tx == a.tx and g.state == Signed and not(g.settled))))
pure def alwaysSignedRowsAttributed(f: Fee): bool = f.gas.every(g => g.state == Signed implies
  f.rows.some(r => r.id == g.row and r.nonce == g.nonce and r.attempts.some(a => a.tx == g.tx)))
pure def sometimesAbandonedReservation(f: Fee): bool = f.gas.some(g => g.state == Abandoned and g.row == 0)
pure def sometimesUnknown(f: Fee): bool = f.rows.some(r => r.state == Unknown)
pure def sometimesRunEnded(f: Fee): bool = f.rows.some(r => r.reason == RunEndedBeforeSigning)
pure def sometimesSharedNonceSequence(f: Fee): bool = f.gas.some(g => g.state == Signed and g.nonce == 1)
  and f.rows.some(r => r.token == 1 and r.nonce == 0) and f.rows.some(r => r.token == 2 and r.nonce == 1)
```

### A recorded send without a reservation is imported at its own worst case

A live send an earlier Worker version signed before the native-gas journal
existed has no reservation. Before anything else on an EVM network, each
reconciliation imports every such send under the run's lease, keeping the
recorded row, its nonce and its transaction, with a signed, unsettled
reservation of its own worst case: `gas * maxFeePerGas` plus the Base
allowance, read from the recorded bytes or the node's transaction. The
import checks neither the per-transaction nor the daily ceiling: the
liability already exists (`evm.ts` `reconcileNativeGas`, `native-gas.ts`
`unaccounted`, `importRecorded`). A recorded claim keeps its amount out of
the accrued balance as a new claim would. On Solana a historical send
without a reservation stops signing instead ("Historical Solana sends need
verified native-cost reconciliation before signing"), so nothing is
imported there. Only one transaction of a nonce can land, so a recorded
send is imported only while no unsettled signed send of the journal holds
its nonce. An imported send is then reconciled like any
other. Development also imports the worst case of a recorded send whose row
already settled, to charge its receipt's fee; a settled row is loaded as it
is, and only an open one is imported here. The journal store brings each
such open row in through this event, the row and its reservation together,
so a loaded journal never holds an open send without a reservation.

```quint
type RecordedSend = { token: int, kind: SendKind, tx: int, nonce: int, gasLimit: int, fees: EvmFees, amountIn: int, valueMicro: int,
  minimumOutput: int, deadline: int }
pure def recordedMaximum(f: Fee, recorded: RecordedSend): int = recorded.gasLimit * recorded.fees.maxFee + additionalReserve(f.network)
pure def canImportRecorded(f: Fee, runId: int, recorded: RecordedSend, by: R::Sender): bool =
  val h = holding(f, recorded.token)
  by == R::Worker and leaseHeld(f, runId) and f.network != R::Solana and validToken(f, recorded.token)
    and openRows(f, recorded.token) == 0 and pendingIntent(f, runId).id == 0 and ownReservation(f, runId).id == 0
    and recorded.tx > 0 and not(txUsed(f, recorded.tx)) and not(f.rows.some(r => landedIn(r, recorded.tx)))
    and not(f.gas.some(g => g.state == Signed and not(g.settled) and g.nonce == recorded.nonce)) and recorded.nonce >= 0 and recorded.gasLimit > 0 and recorded.fees.maxFee > 0 and recorded.fees.priority >= 0
    and recorded.fees.priority <= recorded.fees.maxFee and recorded.amountIn > 0 and recorded.valueMicro >= 0
    and (recorded.kind == Conversion implies evaluated(f, recorded.token) and recorded.amountIn <= spendable(f, recorded.token)
      and recorded.minimumOutput > 0 and dayValue(f) + recorded.valueMicro <= dayCap)
    and (recorded.kind == Claim implies h.vault > 0 and recorded.amountIn <= h.accrued)
pure def importRecorded(f: Fee, runId: int, recorded: RecordedSend, by: R::Sender): Fee =
  val id = f.rows.length() + 1
  val h = holding(f, recorded.token)
  { ...f, rows: f.rows.append({ ...noRow, id: id, token: recorded.token, kind: recorded.kind, live: true, state: Submitted, runId: runId,
      wallet: wallet(f), amountIn: recorded.amountIn, valueMicro: recorded.valueMicro,
      minimumOutput: if (recorded.kind == Conversion) recorded.minimumOutput else 0, nonce: recorded.nonce, gasLimit: recorded.gasLimit,
      deadline: recorded.deadline, createdAt: f.clock,
      attempts: List({ tx: recorded.tx, maxFee: recorded.fees.maxFee, priority: recorded.fees.priority, at: f.clock }) }),
    gas: f.gas.append({ id: f.gas.length() + 1, runId: runId, nonce: recorded.nonce, maximum: recordedMaximum(f, recorded),
      state: Signed, row: id, tx: recorded.tx, settled: false, actual: 0, settledDay: 0, blockhashSlot: 0, imported: true }),
    holdings: if (recorded.kind == Claim) withHolding(recorded.token, { ...h, accrued: h.accrued - recorded.amountIn }, f) else f.holdings }
pure def sometimesImportedAboveCeiling(f: Fee): bool = f.gas.some(g => g.imported and g.maximum > R::transactionCeilingOf(f.network))
pure def sometimesImportedSettled(f: Fee): bool = f.gas.some(g => g.imported and g.settled)
pure val recordedValues = Set(
  { token: 1, kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, amountIn: 500000000,
    valueMicro: 450000000, minimumOutput: 445500000, deadline: 9000000000 },
  { token: 1, kind: Conversion, tx: 11, nonce: 0, gasLimit: 100000, fees: { maxFee: 50000, priority: 2000 }, amountIn: 500000000,
    valueMicro: 450000000, minimumOutput: 445500000, deadline: 9000000000 },
  { token: 1, kind: Approval, tx: 12, nonce: 1, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, amountIn: 500000000,
    valueMicro: 450000000, minimumOutput: 0, deadline: 9000000000 },
  { token: 1, kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 60000 }, amountIn: 500000000,
    valueMicro: 450000000, minimumOutput: 445500000, deadline: 9000000000 })
pure val weight_importRecorded = 4
```

## Story: Reconcile every send from finalized evidence before another starts

### Only a finalized receipt of one of the row's own attempts settles it

A finalized receipt settles its whole nonce group in that fee wallet: the landed attempt is
charged its actual fee and every other attempt with that nonce is charged
nothing. A success credits the exact output; the balance before is evidence
only, and an output below the signed minimum is recorded as such. A revert
consumes its actual fee and leaves the token in the wallet. A successful
claim credits the amount of its single `FeesClaimed` event for this fee
wallet, which must be positive (for a token vault it equals the wallet's
net transfer credit and the vault's net debit in the receipt), into fee
income; `claimFees()` pays everything accrued at execution, so it may be
more or less than the amount recorded at signing. Its receipt settles only
while the fee wallet still holds no vault role at the receipt's block
(`claimReceipt`). An approval moves no value and settles only when the
allowance read at its receipt's block equals exactly the approved amount
("Finalized approval allowance differs"). A record from a different fee
wallet stays open and blocks its token: a wallet change is no authority to
reinterpret a retained send.

```quint
type SendReceipt = { tx: int, succeeded: bool, output: int, actualNative: int, finalized: bool, roleFree: bool, allowanceAtBlock: int }
pure def landedIn(r: Row, tx: int): bool = r.attempts.some(a => a.tx == tx)
pure def settleGas(f: Fee, r: Row, tx: int, actualNative: int): List[Reservation] =
  f.gas.listMap(g => if (g.state == Signed and not(g.settled) and g.nonce == r.nonce and f.rows.nthOr(g.row - 1, noRow).wallet == r.wallet)
    { ...g, settled: true, actual: if (g.tx == tx) actualNative else 0, settledDay: day(f) } else g)
pure def overran(f: Fee, tx: int, actualNative: int): bool = f.gas.some(g => g.tx == tx and actualNative > g.maximum)
pure def canFinalizeSend(f: Fee, runId: int, id: int, receipt: SendReceipt, by: R::Sender): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  by == R::Worker and leaseHeld(f, runId) and r.id == id and (r.state == Submitted or r.state == Unknown) and r.wallet == wallet(f)
    and receipt.finalized and landedIn(r, receipt.tx) and receipt.actualNative >= 0 and receipt.output >= 0
    and (r.kind == Approval implies receipt.output == 0)
    and ((r.kind == Approval and receipt.succeeded) implies receipt.allowanceAtBlock == r.amountIn)
    and ((r.kind == Claim and receipt.succeeded) implies receipt.output > 0 and receipt.roleFree)
pure def finalizeSend(f: Fee, runId: int, id: int, receipt: SendReceipt, by: R::Sender): Fee =
  val r = f.rows.nthOr(id - 1, noRow)
  val h = holding(f, r.token)
  val credited = receipt.succeeded
  val converted = credited and r.kind == Conversion
  val claimed = credited and r.kind == Claim
  { ...f, rows: f.rows.listMap(x => if (x.id == id) { ...x, state: if (credited) Finalized else Failed,
      reason: if (not(credited)) Reverted else if (converted and receipt.output < r.minimumOutput) BelowSignedMinimum else NoReason,
      output: if (converted or claimed) receipt.output else 0 } else x),
    gas: settleGas(f, r, receipt.tx, receipt.actualNative),
    overrun: f.overrun or overran(f, receipt.tx, receipt.actualNative),
    holdings: withHolding(r.token, { ...h,
      balance: if (converted) h.balance - r.amountIn else if (claimed) h.balance + receipt.output else h.balance,
      sold: if (converted) h.sold + r.amountIn else h.sold,
      usdcOut: if (converted) h.usdcOut + receipt.output else h.usdcOut,
      feeIncome: if (claimed) h.feeIncome + receipt.output else h.feeIncome,
      claimed: if (claimed) h.claimed + receipt.output else h.claimed,
      accrued: if (r.kind == Claim and not(credited)) h.accrued + r.amountIn else h.accrued }, f) }
pure def finalizedOutput(f: Fee, token: int): int =
  f.rows.foldl(0, (t, r) => if (r.kind == Conversion and r.state == Finalized and r.token == token) t + r.output else t)
pure def alwaysOutputFromReceipts(f: Fee): bool = f.holdings.every(h => h.usdcOut == finalizedOutput(f, h.token)
  and h.sold == f.rows.foldl(0, (t, r) => if (r.kind == Conversion and r.state == Finalized and r.token == h.token) t + r.amountIn else t))
pure def alwaysClaimsFromReceipts(f: Fee): bool = f.holdings.every(h =>
  h.claimed == f.rows.foldl(0, (t, r) => if (r.kind == Claim and r.state == Finalized and r.token == h.token) t + r.output else t)
    and h.claimed <= h.feeIncome)
  and f.rows.every(r => (r.kind == Claim and r.state == Finalized) implies r.output > 0)
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
so a later send may reuse the nonce without a second liability; a later
canonical receipt of the expired attempt itself, necessarily a revert,
settles that nonce at its actual fee and leaves the row failed. That receipt
proves the nonce consumed, so an open send that reused it can never land: it
closes as failed with its nonce consumed, a claim among them returns its
amount to the accrued balance, and no later send may take that nonce.

An expired claim returns its amount to the accrued balance. A Solana send
releases its reservation only with proof from two independent
operators. Each operator records lease-bound, revisioned coverage scans of
finalized block history for the transaction; scans are permanent. The proof
needs each operator's latest scan to be complete, both scans to report the
same coverage (tip slot, tip hash, block count and digest), coverage to start
at or before the blockhash slot recorded at signing and reach at least that
slot, both providers to find the blockhash invalid at finalized commitment,
and neither to find the signature or the transaction. The proof is retained
permanently.

```quint
type DeadlineEvidence = { finalizedTime: int, included: bool }
type Coverage = { fromSlot: int, tipSlot: int, tipHash: int, blocks: int, digest: int }
type ExpiryScan = { tx: int, operator: int, revision: int, coverage: Coverage, complete: bool, blockhashSlot: int, runId: int }
type ProviderFinding = { operator: int, invalidBlockhash: bool, signatureFound: bool, transactionFound: bool }
type ExpiryProof = { tx: int, a: ProviderFinding, b: ProviderFinding, blockhashSlot: int, coverage: Coverage }
pure def latestScan(f: Fee, tx: int, operator: int): ExpiryScan =
  f.scans.foldl({ tx: 0, operator: 0, revision: 0, coverage: { fromSlot: 0, tipSlot: 0, tipHash: 0, blocks: 0, digest: 0 },
    complete: false, blockhashSlot: 0, runId: 0 }, (found, s) => if (s.tx == tx and s.operator == operator and s.revision > found.revision) s else found)
pure def signedSlot(f: Fee, tx: int): int = f.gas.foldl(0, (found, g) => if (g.tx == tx and g.state == Signed) g.blockhashSlot else found)
pure def canRecordScan(f: Fee, runId: int, scan: ExpiryScan, by: R::Sender): bool =
  by == R::Worker and leaseHeld(f, runId) and f.network == R::Solana and scan.runId == runId and scan.operator > 0 and txUsed(f, scan.tx)
    and scan.revision == latestScan(f, scan.tx, scan.operator).revision + 1 and scan.blockhashSlot == signedSlot(f, scan.tx)
    and scan.coverage.fromSlot >= 0 and scan.coverage.tipSlot >= scan.coverage.fromSlot and scan.coverage.blocks >= 0
pure def recordScan(f: Fee, runId: int, scan: ExpiryScan, by: R::Sender): Fee = { ...f, scans: f.scans.append(scan) }
pure def findingClean(finding: ProviderFinding): bool =
  finding.operator > 0 and finding.invalidBlockhash and not(finding.signatureFound) and not(finding.transactionFound)
pure def expiryProvesAbsence(f: Fee, tx: int, proof: ExpiryProof): bool =
  val scanA = latestScan(f, tx, proof.a.operator)
  val scanB = latestScan(f, tx, proof.b.operator)
  val slot = signedSlot(f, tx)
  proof.tx == tx and slot > 0 and proof.blockhashSlot == slot and proof.a.operator != proof.b.operator
    and findingClean(proof.a) and findingClean(proof.b)
    and scanA.complete and scanB.complete and scanA.coverage == scanB.coverage and scanA.coverage == proof.coverage
    and scanA.blockhashSlot == slot and scanB.blockhashSlot == slot
    and proof.coverage.fromSlot <= slot and proof.coverage.tipSlot >= slot
pure def canRebroadcast(f: Fee, runId: int, id: int, accepted: bool, by: R::Sender): bool =
  by == R::Worker and leaseHeld(f, runId) and f.rows.some(r => r.id == id and r.state == Unknown and r.wallet == wallet(f))
pure def rebroadcast(f: Fee, runId: int, id: int, accepted: bool, by: R::Sender): Fee =
  if (accepted) { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Submitted, reason: NoReason } else r) } else f
pure def canExpireEvm(f: Fee, runId: int, id: int, deadline: DeadlineEvidence, by: R::Sender): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  by == R::Worker and leaseHeld(f, runId) and f.network != R::Solana and r.id == id and r.kind == Conversion
    and (r.state == Submitted or r.state == Unknown) and deadline.finalizedTime > r.deadline and not(deadline.included)
pure def expireEvm(f: Fee, runId: int, id: int, deadline: DeadlineEvidence, by: R::Sender): Fee =
  { ...f, rows: f.rows.listMap(r => if (r.id == id) { ...r, state: Failed, reason: ExpiredUnlanded } else r) }
pure def canSettleExpired(f: Fee, runId: int, id: int, receipt: SendReceipt, by: R::Sender): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  by == R::Worker and leaseHeld(f, runId) and f.network != R::Solana and r.id == id and r.state == Failed and r.reason == ExpiredUnlanded
    and receipt.finalized and not(receipt.succeeded) and landedIn(r, receipt.tx) and receipt.actualNative >= 0
    and f.gas.some(g => g.tx == receipt.tx and g.state == Signed and not(g.settled))
pure def reusedNonce(f: Fee, r: Row, x: Row): bool = x.id != r.id and x.wallet == r.wallet and (x.state == Submitted or x.state == Unknown)
  and f.gas.some(g => g.row == x.id and g.state == Signed and not(g.settled) and g.nonce == r.nonce)
pure def nonceLosers(f: Fee, r: Row, token: int): int =
  f.rows.foldl(0, (t, x) => if (reusedNonce(f, r, x) and x.kind == Claim and x.token == token) t + x.amountIn else t)
pure def settleExpired(f: Fee, runId: int, id: int, receipt: SendReceipt, by: R::Sender): Fee =
  val r = f.rows.nthOr(id - 1, noRow)
  { ...f, rows: f.rows.listMap(x => if (reusedNonce(f, r, x)) { ...x, state: Failed, reason: NonceConsumed } else x),
    gas: settleGas(f, r, receipt.tx, receipt.actualNative), overrun: f.overrun or overran(f, receipt.tx, receipt.actualNative),
    holdings: f.holdings.listMap(h => { ...h, accrued: h.accrued + nonceLosers(f, r, h.token) }) }
pure def canExpireSolana(f: Fee, runId: int, id: int, proof: ExpiryProof, by: R::Sender): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  by == R::Worker and leaseHeld(f, runId) and f.network == R::Solana and r.id == id and (r.state == Submitted or r.state == Unknown)
    and r.attempts.length() == 1 and expiryProvesAbsence(f, r.attempts.nthOr(0, { tx: 0, maxFee: 0, priority: 0, at: 0 }).tx, proof)
pure def expireSolana(f: Fee, runId: int, id: int, proof: ExpiryProof, by: R::Sender): Fee =
  val r = f.rows.nthOr(id - 1, noRow)
  val h = holding(f, r.token)
  { ...f, rows: f.rows.listMap(x => if (x.id == id) { ...x, state: Failed, reason: ExpiredUnlanded } else x),
    gas: settleGas(f, r, 0, 0), proofs: f.proofs.append(proof),
    holdings: if (r.kind == Claim) withHolding(r.token, { ...h, accrued: h.accrued + r.amountIn }, f) else f.holdings }
pure def alwaysExpiryProven(f: Fee): bool = f.proofs.every(p => p.a.operator != p.b.operator and findingClean(p.a)
  and findingClean(p.b) and p.blockhashSlot > 0 and p.coverage.fromSlot <= p.blockhashSlot and p.coverage.tipSlot >= p.blockhashSlot)
  and f.rows.every(r => (r.reason == ExpiredUnlanded and f.network == R::Solana) implies f.proofs.some(p => r.attempts.some(a => a.tx == p.tx)))
pure def stepEvidencePermanent(before: Fee, after: Fee): bool =
  after.scans.length() >= before.scans.length() and before.scans.every(s => after.scans.includes(s))
    and after.proofs.length() >= before.proofs.length() and before.proofs.every(p => after.proofs.includes(p))
pure def sometimesExpiredEvmNonceHeld(f: Fee): bool = f.rows.some(r => r.reason == ExpiredUnlanded)
  and f.gas.some(g => g.state == Signed and not(g.settled) and f.rows.some(r => r.id == g.row and r.state == Failed))
pure def sometimesExpiredLateRevertCharged(f: Fee): bool =
  f.gas.some(g => g.settled and g.actual > 0 and f.rows.some(r => r.id == g.row and r.reason == ExpiredUnlanded))
pure def sometimesSolanaExpiryProven(f: Fee): bool = f.proofs.length() > 0
```

### A same-nonce EVM replacement changes only its fees, in bounded steps

Replacement needs its own owner activation, off by default, and a live,
ready network; source approval does not activate it. The latest attempt
must have waited three minutes, and its maximum fee must be below the
network base fee the node reports in a read taken after that wait elapsed
and not later than now (`core.ts` `replaceSend` checks the wait, then
`evm.ts` `replace` reads the latest block). A swap whose router deadline is
within two minutes waits, because a replacement would revert; a claim or
an approval has no such margin. The replacement's worst-case native fee,
priced in USDC, times ten must not exceed the row's recorded value: an
unpriced fee or a row without a recorded value waits (`signIntent`). The
fees of each step come from the shared
[fee replacement](../settlement/feeReplacement.md) step, from the original
and latest attempts, with the per-gas ceiling left after the Base allowance;
a refused step keeps the send waiting. The replacement has the same nonce,
row and content. Its worst case is reserved against the daily ceiling and
journaled before broadcast, and every attempt stays in the journal.

```quint
type NetworkFeeObservation = { maxFeeNeeded: int, observedAt: int, pricedFeeMicro: int }
pure val replacementDeadlineMarginMs = 120000
pure def firstAttempt(r: Row): Attempt = r.attempts.nthOr(0, { tx: 0, maxFee: 0, priority: 0, at: 0 })
pure def latestAttempt(r: Row): Attempt = r.attempts.nthOr(r.attempts.length() - 1, { tx: 0, maxFee: 0, priority: 0, at: 0 })
pure def perGasCeiling(f: Fee, r: Row): int =
  (R::transactionCeilingOf(f.network) - additionalReserve(f.network)) / (if (r.gasLimit > 0) r.gasLimit else 1)
pure def replacementFees(f: Fee, r: Row): FR::Fees = FR::nextReplacementFees(firstAttempt(r).maxFee, firstAttempt(r).priority,
  latestAttempt(r).maxFee, latestAttempt(r).priority, perGasCeiling(f, r))
pure def canReplace(f: Fee, runId: int, id: int, tx: int, networkFee: NetworkFeeObservation, by: R::Sender): bool =
  val r = f.rows.nthOr(id - 1, noRow)
  val latest = latestAttempt(r)
  val stepped = replacementFees(f, r)
  by == R::Worker and leaseHeld(f, runId) and R::replacementSigns(f.runtime, f.network) and not(f.overrun) and r.id == id and r.live
    and (r.state == Submitted or r.state == Unknown) and r.wallet == wallet(f) and r.attempts.length() > 0
    and networkFee.observedAt >= latest.at + replacementWaitMs and networkFee.observedAt <= f.clock
    and f.clock - latest.at >= replacementWaitMs and latest.maxFee < networkFee.maxFeeNeeded
    and (r.kind == Conversion implies f.clock + replacementDeadlineMarginMs < r.deadline)
    and r.valueMicro > 0 and pricedWithin(f, networkFee.pricedFeeMicro, r.valueMicro)
    and tx > 0 and not(txUsed(f, tx)) and stepped.ok
    and liabilityOf(f.gas.append({ ...noGas, id: f.gas.length() + 1, nonce: r.nonce,
      maximum: r.gasLimit * stepped.maxFee + additionalReserve(f.network), state: Signed, settled: false }), day(f)) <= R::dailyCeilingOf(f.network)
pure def replace(f: Fee, runId: int, id: int, tx: int, networkFee: NetworkFeeObservation, by: R::Sender): Fee =
  val r = f.rows.nthOr(id - 1, noRow)
  val stepped = replacementFees(f, r)
  { ...f, rows: f.rows.listMap(x => if (x.id == id) { ...x, state: Submitted, reason: NoReason,
      attempts: x.attempts.append({ tx: tx, maxFee: stepped.maxFee, priority: stepped.priorityFee, at: f.clock }) } else x),
    gas: f.gas.append({ id: f.gas.length() + 1, runId: runId, nonce: r.nonce, maximum: r.gasLimit * stepped.maxFee + additionalReserve(f.network),
      state: Signed, row: id, tx: tx, settled: false, actual: 0, settledDay: 0, blockhashSlot: 0, imported: false }) }
pure def alwaysAttemptsKeepContent(f: Fee): bool = f.rows.every(r => r.attempts.every(a =>
  a.maxFee >= firstAttempt(r).maxFee and a.maxFee <= firstAttempt(r).maxFee * 3 and a.priority <= a.maxFee))
pure def stepReplacementNeedsActivation(before: Fee, via: str, after: Fee): bool =
  via == "replace" implies before.runtime.replacementActive and before.network != R::Solana
pure def sometimesReplaced(f: Fee): bool = f.rows.some(r => r.attempts.length() > 1)
pure def sometimesRetriedThenConverted(f: Fee): bool = f.rows.some(r => r.kind == Conversion and r.state == Finalized and r.attempts.length() > 1)
```

## Story: Claim only accrued fees from reviewed vaults

### A claim delivers the accrued amount to the configured fee wallet and shares the native budget

A claim runs only in a recovery scan of a live network. It names a
registered reviewed vault and its deployment, pays the token that vault
accrues to this network's fee wallet, and needs a value of at least 5 USDC
and ten times its gas cost, and its final priced native fee times ten must
not exceed that value. It claims at most the accrued amount observed
from that vault, and only while the fee wallet holds and is proposed for
none of the vault's roles at the pinned block (`verifiedVault`, which throws
"The fee wallet holds or is proposed for a vault role").
Permissionless claims confer no owner or withdrawal role.
A dry run reports and signs nothing. Sweeps are executed by the owner
outside the Worker.

```quint
type VaultClaim = { vault: int, deployment: int, recipient: int, amount: int, valueMicro: int, gasValue: int,
  tx: int, nonce: int, gasLimit: int, fees: EvmFees, blockhashSlot: int, roleFree: bool, pricedFeeMicro: int }
pure def claimAdmitted(f: Fee, c: VaultClaim): bool =
  val v = vaultOf(f, c.vault)
  v.vault > 0 and v.deployment == c.deployment and c.recipient == wallet(f) and holding(f, v.token).vault == c.vault and c.roleFree
    and c.amount > 0 and c.amount <= holding(f, v.token).accrued and c.valueMicro >= 5000000 and c.valueMicro >= c.gasValue * 10
    and pricedWithin(f, c.pricedFeeMicro, c.valueMicro)
pure def canClaim(f: Fee, runId: int, vaultClaim: VaultClaim, by: R::Sender): bool =
  val maximum = worstCase(f, vaultClaim.gasLimit, vaultClaim.fees)
  val token = vaultOf(f, vaultClaim.vault).token
  by == R::Worker and leaseHeld(f, runId) and f.trigger == Recovery and R::networkSigns(f.runtime, f.network) and f.runtime.converterMode == R::Live
    and (R::converts(f.network) or R::buybackSigns(f.runtime, f.network))
    and not(f.overrun) and claimAdmitted(f, vaultClaim) and openRows(f, token) == 0
    and pendingIntent(f, runId).id == 0 and ownReservation(f, runId).id == 0
    and vaultClaim.tx > 0 and not(txUsed(f, vaultClaim.tx)) and vaultClaim.gasLimit > 0 and vaultClaim.fees.maxFee > 0
    and vaultClaim.fees.priority >= 0 and vaultClaim.fees.priority <= vaultClaim.fees.maxFee
    and (if (f.network == R::Solana) vaultClaim.nonce == solanaSequence(f) and vaultClaim.blockhashSlot > 0
      else vaultClaim.nonce >= nonceFloor(f) and vaultClaim.blockhashSlot == 0)
    and maximum > 0 and maximum <= R::transactionCeilingOf(f.network)
    and liabilityOf(f.gas.append({ ...noGas, id: f.gas.length() + 1, nonce: vaultClaim.nonce, maximum: maximum, state: Signed, settled: false }), day(f))
      <= R::dailyCeilingOf(f.network)
pure def claim(f: Fee, runId: int, vaultClaim: VaultClaim, by: R::Sender): Fee =
  val id = f.rows.length() + 1
  val token = vaultOf(f, vaultClaim.vault).token
  val h = holding(f, token)
  { ...f, holdings: withHolding(token, { ...h, accrued: h.accrued - vaultClaim.amount }, f),
    rows: f.rows.append({ ...noRow, id: id, token: token, kind: Claim, live: true, state: Submitted, runId: runId, wallet: wallet(f),
      amountIn: vaultClaim.amount, valueMicro: vaultClaim.valueMicro, nonce: vaultClaim.nonce, gasLimit: vaultClaim.gasLimit, createdAt: f.clock,
      attempts: List({ tx: vaultClaim.tx, maxFee: vaultClaim.fees.maxFee, priority: vaultClaim.fees.priority, at: f.clock }) }),
    gas: f.gas.append({ id: f.gas.length() + 1, runId: runId, nonce: vaultClaim.nonce, maximum: worstCase(f, vaultClaim.gasLimit, vaultClaim.fees),
      state: Signed, row: id, tx: vaultClaim.tx, settled: false, actual: 0, settledDay: 0, blockhashSlot: vaultClaim.blockhashSlot,
      imported: false }) }
pure def sometimesClaimFinalized(f: Fee): bool = f.holdings.some(h => h.claimed > 0)
```

## Story: Keep every journal record and its evidence

### Rows and reservations are append-only and settled records never change

A row in a terminal or waiting state never changes again. A signed
reservation keeps its nonce, maximum, transaction and blockhash slot, and
its settlement is written once. Signing, replacement and claims happen only
under the live runtime; dry runs only quote and reconcile.

```quint
pure def settledState(s: RowState): bool = s == DustPending or s == Skipped or s == NoRoute or s == Finalized or s == Failed
pure def rowFrozen(r: Row): bool = settledState(r.state) or (r.state == Quoted and not(r.live))
pure def stepJournalAppendOnly(before: Fee, after: Fee): bool =
  after.rows.length() >= before.rows.length() and after.gas.length() >= before.gas.length()
    and before.rows.every(r => after.rows.some(a => a.id == r.id and a.token == r.token and (a.kind == r.kind or r.state == Quoted)))
    and before.rows.every(r => rowFrozen(r) implies after.rows.includes(r))
    and before.gas.every(g => after.gas.some(a => a.id == g.id and a.nonce == g.nonce and a.maximum == g.maximum and a.runId == g.runId
      and (g.state == Signed implies a.tx == g.tx and a.blockhashSlot == g.blockhashSlot)))
    and before.gas.every(g => (g.settled or g.state == Abandoned) implies after.gas.includes(g))
pure def stepSignaturesNeedLive(before: Fee, via: str, after: Fee): bool =
  (via == "sign" or via == "replace" or via == "claim") implies before.runtime.converterMode == R::Live
pure def alwaysRowIdentity(f: Fee): bool = f.rows.every(r => r.id > 0 and f.rows.nthOr(r.id - 1, noRow) == r)
  and f.gas.every(g => g.id > 0 and f.gas.nthOr(g.id - 1, noGas).id == g.id)
pure def alwaysDryRowsNeverSign(f: Fee): bool = f.rows.every(r => not(r.live) implies r.attempts.length() == 0 and r.state != Submitted and r.state != Unknown)
```

Discovered by simulation: a Solana expiry proof needs the instance chosen as
Solana before the first token or run, a live publication that lasts through
signing, and two complete matching scans, so random traces of 20 events
almost never reached it. The samples therefore include a later live
publication after the dry-run one, a second-revision rescan by the second
operator after an incomplete or mismatched scan, and heavier weights for
choosing the instance, recording scans and expiring a Solana send.

```quint
pure val elapsedValues = Set(180000, 3600001, 86400000)
pure val runIdValues = Set(1, 2)
pure val rotationIdValues = Set(1, 2)
pure val idValues = Set(1, 2)
pure val txValues = Set(12, 13)
pure val nonceValues = Set(0, 1)
pure val maximumValues = Set(55000000, 100000000, 5000000)
pure val amountValues = Set(1000000000)
pure val tokenValues = Set(1, 2)
pure val networkFeeValues = Set({ maxFeeNeeded: 1000000, observedAt: 180000, pricedFeeMicro: 1000 },
  { maxFeeNeeded: 1000000, observedAt: 0, pricedFeeMicro: 1000 }, { maxFeeNeeded: 1000000, observedAt: 180000, pricedFeeMicro: -1 })
pure val balanceValues = Set(0, 1000000000)
pure val acceptedValues = Set(true, false)
pure val activeValues = Set(true)
pure val variableValues = Set(true)
pure val networkValues = Set(R::Base, R::Solana, R::Robinhood)
pure val assetValues = Set(ProjectToken, NativeAsset, TargetStable)
pure val byValues = Set(R::ReleaseWorkflow, R::Owner, R::Worker)
pure val configValues = Set(R::liveAll, { ...R::liveAll, source: 2, converterMode: R::DryRun, buybackMode: R::Off },
  { ...R::liveAll, source: 3 })
pure val reviewedValues = Set({ vault: 7, deployment: 70, token: 1 })
pure val accrualValues = Set({ vault: 7, recipient: 1, accrued: 1000000000, height: 5, finalized: true, roleFree: true },
  { vault: 7, recipient: 9, accrued: 1000000000, height: 5, finalized: true, roleFree: true },
  { vault: 7, recipient: 1, accrued: 0, height: 6, finalized: true, roleFree: true },
  { vault: 7, recipient: 1, accrued: 1000000000, height: 5, finalized: true, roleFree: false })
pure val transferValues = Set({ receipt: 1, token: 1, amount: 1000000000, toFeeWallet: true, sameAsset: true, finalized: true },
  { receipt: 3, token: 2, amount: 1000000000, toFeeWallet: true, sameAsset: true, finalized: true },
  { receipt: 2, token: 1, amount: 3000000, toFeeWallet: false, sameAsset: true, finalized: true })
pure val quoteValues = Set(
  { token: 1, route: Found, amountIn: 500000000, output: 450000000, minimumOutput: 445500000, gasValue: 1000, impactBps: 50 },
  { token: 2, route: Found, amountIn: 500000000, output: 450000000, minimumOutput: 445500000, gasValue: 1000, impactBps: 50 },
  { token: 1, route: Found, amountIn: 3000000, output: 3000000, minimumOutput: 2970000, gasValue: 1000, impactBps: 50 },
  { token: 1, route: NoRouteResult, amountIn: 500000000, output: 0, minimumOutput: 0, gasValue: 0, impactBps: 0 },
  { token: 1, route: Found, amountIn: 500000000, output: 450000000, minimumOutput: 445500000, gasValue: 1000, impactBps: -1 },
  { token: 2, route: Found, amountIn: 500000000, output: 2000000000, minimumOutput: 1980000000, gasValue: 1000, impactBps: 50 })
pure val sendValues = Set(
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 100, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 14, nonce: 1, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 40, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 1000 },
  { kind: Approval, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 0, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 500000000, allowance: 0, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Unresolved, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1, fees: { maxFee: 5000000, priority: 2 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 40, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: false, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 0, allowance: 0, pricedFeeMicro: 1000 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: -1 },
  { kind: Conversion, tx: 11, nonce: 0, gasLimit: 1000, fees: { maxFee: 50000, priority: 2000 }, inspection: Inspected, outputToFeeWallet: true, minimumOutput: 445500000, deadline: 9000000000, blockhashSlot: 0, toPinnedRouter: true, approvedAmount: 0, allowance: 500000000, pricedFeeMicro: 50000000 })
pure val receiptValues = Set({ tx: 11, succeeded: true, output: 450000000, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 0 },
  { tx: 11, succeeded: true, output: 0, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 500000000 },
  { tx: 11, succeeded: false, output: 0, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 0 },
  { tx: 11, succeeded: true, output: 450000000, actualNative: 60000000, finalized: true, roleFree: true, allowanceAtBlock: 0 },
  { tx: 11, succeeded: true, output: 400000000, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 0 },
  { tx: 12, succeeded: true, output: 0, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 500000000 },
  { tx: 11, succeeded: true, output: 0, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 500000000 },
  { tx: 11, succeeded: true, output: 450000000, actualNative: 40000000, finalized: false, roleFree: true, allowanceAtBlock: 0 },
  { tx: 12, succeeded: true, output: 1000000000, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 0 },
  { tx: 12, succeeded: true, output: 1000000000, actualNative: 40000000, finalized: true, roleFree: false, allowanceAtBlock: 0 },
  { tx: 11, succeeded: true, output: 0, actualNative: 40000000, finalized: true, roleFree: true, allowanceAtBlock: 499999999 })
pure val deadlineValues = Set({ finalizedTime: 9000000001, included: false }, { finalizedTime: 9000000001, included: true })
pure val scanValues = Set(
  { tx: 11, operator: 1, revision: 1, coverage: { fromSlot: 30, tipSlot: 500, tipHash: 9, blocks: 470, digest: 3 }, complete: true, blockhashSlot: 40, runId: 1 },
  { tx: 11, operator: 2, revision: 1, coverage: { fromSlot: 30, tipSlot: 500, tipHash: 9, blocks: 470, digest: 3 }, complete: true, blockhashSlot: 40, runId: 1 },
  { tx: 11, operator: 2, revision: 1, coverage: { fromSlot: 30, tipSlot: 500, tipHash: 8, blocks: 470, digest: 3 }, complete: true, blockhashSlot: 40, runId: 1 },
  { tx: 11, operator: 2, revision: 1, coverage: { fromSlot: 30, tipSlot: 500, tipHash: 9, blocks: 470, digest: 3 }, complete: false, blockhashSlot: 40, runId: 1 },
  { tx: 11, operator: 2, revision: 2, coverage: { fromSlot: 30, tipSlot: 500, tipHash: 9, blocks: 470, digest: 3 }, complete: true, blockhashSlot: 40, runId: 1 })
pure val proofValues = Set(
  { tx: 11, a: { operator: 1, invalidBlockhash: true, signatureFound: false, transactionFound: false },
    b: { operator: 2, invalidBlockhash: true, signatureFound: false, transactionFound: false }, blockhashSlot: 40,
    coverage: { fromSlot: 30, tipSlot: 500, tipHash: 9, blocks: 470, digest: 3 } },
  { tx: 11, a: { operator: 1, invalidBlockhash: true, signatureFound: false, transactionFound: false },
    b: { operator: 1, invalidBlockhash: true, signatureFound: false, transactionFound: false }, blockhashSlot: 40,
    coverage: { fromSlot: 30, tipSlot: 500, tipHash: 9, blocks: 470, digest: 3 } })
pure val vaultClaimValues = Set(
  { vault: 7, deployment: 70, recipient: 1, amount: 1000000000, valueMicro: 900000000, gasValue: 1000, tx: 12, nonce: 0, gasLimit: 1000,
    fees: { maxFee: 50000, priority: 2000 }, blockhashSlot: 0, roleFree: true, pricedFeeMicro: 1000 },
  { vault: 7, deployment: 71, recipient: 1, amount: 1000000000, valueMicro: 900000000, gasValue: 1000, tx: 12, nonce: 0, gasLimit: 1000,
    fees: { maxFee: 50000, priority: 2000 }, blockhashSlot: 0, roleFree: true, pricedFeeMicro: 1000 },
  { vault: 7, deployment: 70, recipient: 1, amount: 1000000000, valueMicro: 900000000, gasValue: 1000, tx: 12, nonce: 0, gasLimit: 1000,
    fees: { maxFee: 50000, priority: 2000 }, blockhashSlot: 0, roleFree: false, pricedFeeMicro: 1000 },
  { vault: 7, deployment: 70, recipient: 1, amount: 1000000000, valueMicro: 900000000, gasValue: 1000, tx: 12, nonce: 0, gasLimit: 1000,
    fees: { maxFee: 50000, priority: 2000 }, blockhashSlot: 0, roleFree: true, pricedFeeMicro: -1 },
  { vault: 7, deployment: 70, recipient: 1, amount: 1000000000, valueMicro: 900000000, gasValue: 1000, tx: 12, nonce: 0, gasLimit: 1000,
    fees: { maxFee: 50000, priority: 2000 }, blockhashSlot: 0, roleFree: true, pricedFeeMicro: 100000000 })
pure val weight_evaluate = 8
pure val weight_reserveGas = 8
pure val weight_sign = 10
pure val weight_finalizeSend = 8
pure val weight_acquireLease = 8
pure val weight_publishWorker = 6
pure val weight_setReleaseVariable = 6
pure val weight_verifyReadiness = 6
pure val weight_receiveFee = 6
pure val weight_addToken = 4
pure val weight_setReplacement = 3
pure val weight_replace = 6
pure val weight_broadcastFail = 4
pure val weight_expireEvm = 4
pure val weight_settleExpired = 4
pure val weight_recordScan = 24
pure val weight_expireSolana = 24
pure val weight_chooseInstance = 20
pure val weight_claim = 4
pure val weight_accrue = 3
pure val weight_registerVault = 3
```
