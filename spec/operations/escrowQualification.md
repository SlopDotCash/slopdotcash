# Mainnet escrow qualification

PRD section 11, Activation gates and accepted risks, Limited network
qualification, and Evidence exceptions. This ledger records reviewed
qualification and execution evidence. The registry supplies the exact asset,
vault and immutable identity. The shell must authenticate the owner, inspect
the plan and transaction payload, and verify current network and finalized
receipts. The model contains public evidence identities and native-fee limits.

The lane model below covers the standard one-time qualification sequence.
The durable exact-attempt boundary follows the retained acceptance workflow in
`scripts/escrow-acceptance/evm.ts` and
`formal/models/contracts/evm_upgrade_qualification.qnt`. That contract-upgrade
model also exercises the full deployment topology and slot preservation on
testnet. Those are distinct implementation checks.

The 14 November 2026 operator decision accepts the first finalized October
payout on Solana and Robinhood Chain as qualification evidence for those
recorded activations. The production switch binds this observation to the
exact legacy release and both receipts. The payouts follow ordinary
accounting and recognition.
PRD section 11 (`docs/slop-product-requirements.md#limited-network-qualification`) ·
[Activation PR #2712](https://github.com/SlopDotCash/slopdotcash/pull/2712) ·
[Production switch](../settlement/attesterActivation.md)

The 16 November 2026 receipts are
[Feed on Solana](https://explorer.solana.com/tx/5XRgBiXJqmhcf3w1TuRq4vg5jSvFzMsFfc54M4pWxyiAQVv1WSyCid7kdWFpTK1kgYddNLAFn4CLinNZRxRdyWdC)
and [The Network on Robinhood Chain](https://robinhoodchain.blockscout.com/tx/0x481c164b0e100ef1354195a295c9eaa0cadbab1ce5646c5e916a7186e97a340d).

## Story: Qualify escrow one network at a time with an explicitly approved scope

### Qualification requires launch, exact network and vault evidence, a reviewed plan, and current owner authorization

USDC applies on Base and Solana. USDG applies on Robinhood. Monetary quantities
in the plan are stablecoin micro-units. Gas is integer gwei for EVM networks, with any fractional gwei rounded up by the adapter, and
lamports for Solana. The Base ceiling covers the reviewed upgrade and the
whole sequence across wallets. The evidence reader checks Slop's Base vault
or the first qualifying Solana or Robinhood vault. Testnet, deployment bytes,
asset identity and current signing authority must match the plan. Owner
authorization is state this machine owns: the repository owner, authenticated
as the `by` sender, approves a reviewed plan or activation by its review
identifier, and only an approval recorded here satisfies a plan or an
activation. The remaining evidence fields are the verdicts of the named
evidence reader.

```quint
type Network = Base | Solana | Robinhood | Ethereum
type QualificationPhase = AwaitingPlan | Ready | AwaitingReceipt | Uncertain | Stopped
type StepKind = SupportingWrite | Deposit | Payout
type Plan = { network: Network, vault: str, asset: str, review: str, monthlyCap: int, automatic: bool }
type PlanEvidence = { nonMoneyLive: bool, exactAssetAndVault: bool, currentAuthority: bool, exactDeployment: bool, applicableTestnet: bool }
type Approver = RepositoryOwner | Operator | Agent
type FreshChecks = { currentAuthority: bool, exactPlanAuthorized: bool, eligible: bool, simulationPassed: bool, reconciled: bool }
type Operation = { key: str, transaction: str, kind: StepKind, gasLimit: int, gross: int, net: int, fee: int, actor: int }
type Result = { network: Network, vault: str, transaction: str, finalized: bool, exactOperation: bool, succeeded: bool, actualGas: int }
type RecordedOutcome = { plan: Plan, operation: Operation, result: Result }
type Qualification = { completed: int, activated: int, ethereumActive: bool, phase: QualificationPhase, plan: Plan, qualifiedPlans: List[Plan], spent: int, deposited: bool, paid: bool, pending: Operation, records: Set[str], transactions: List[str], history: List[RecordedOutcome], retransmissions: int, historicalSolana: List[ExistingSolanaStep], ownerApprovals: List[str] }
pure val emptyPlan: Plan = { network: Base, vault: "", asset: "", review: "", monthlyCap: 0, automatic: false }
pure val emptyOperation: Operation = { key: "", transaction: "", kind: SupportingWrite, gasLimit: 0, gross: 0, net: 0, fee: 0, actor: 0 }
pure val initial: Qualification = { completed: 0, activated: 0, ethereumActive: false, phase: AwaitingPlan, plan: emptyPlan, qualifiedPlans: List(), spent: 0, deposited: false, paid: false, pending: emptyOperation, records: Set(), transactions: List(), history: List(), retransmissions: 0, historicalSolana: List(), ownerApprovals: List() }
pure def canApprove(q: Qualification, review: str, by: Approver): bool = by == RepositoryOwner and review != ""
  and not(q.ownerApprovals.includes(review))
pure def approve(q: Qualification, review: str, by: Approver): Qualification = { ...q, ownerApprovals: q.ownerApprovals.append(review) }
pure def stepApprovalsOnlyByOwner(before: Qualification, via: str, after: Qualification): bool =
  after.ownerApprovals != before.ownerApprovals implies via == "approve"
pure def networkFor(position: int): Network =
  if (position == 0) Base else if (position == 1) Solana else if (position == 2) Robinhood else Ethereum
pure def stablecoin(network: Network): str = if (network == Robinhood) "USDG" else "USDC"
pure def gasCeiling(network: Network): int =
  if (network == Solana) 10000000 else if (network == Base or network == Robinhood) 1000000 else 0
pure def validPlan(plan: Plan, position: int): bool = position >= 0 and position < 3 and plan.network == networkFor(position)
  and plan.vault != "" and plan.asset == stablecoin(plan.network) and plan.review != ""
  and plan.monthlyCap == 1000000000 and not(plan.automatic)
pure def completeEvidence(evidence: PlanEvidence): bool = evidence.nonMoneyLive and evidence.exactAssetAndVault
  and evidence.currentAuthority and evidence.exactDeployment and evidence.applicableTestnet
pure def canAdmitPlan(q: Qualification, plan: Plan, evidence: PlanEvidence): bool =
  q.phase == AwaitingPlan and validPlan(plan, q.completed) and completeEvidence(evidence) and q.ownerApprovals.includes(plan.review)
pure def admitPlan(q: Qualification, plan: Plan, evidence: PlanEvidence): Qualification =
  { ...q, phase: Ready, plan: plan }
pure def alwaysOrderedQualification(q: Qualification): bool = q.completed == q.qualifiedPlans.length() and q.completed >= 0 and q.completed <= 3
  and (q.phase != AwaitingPlan implies validPlan(q.plan, q.completed))
pure def stepProgressIsSingleNetwork(before: Qualification, after: Qualification): bool =
  after.completed >= before.completed and after.completed <= before.completed + 1
pure def alwaysAwaitingLaneIsClear(q: Qualification): bool = q.phase == AwaitingPlan implies
  q.plan == emptyPlan and q.spent == 0 and not(q.deposited) and not(q.paid) and q.records.subseteq(Set())
```

### Each new attempt passes current checks, fits the remaining budget, and binds the exact scoped operation

The payment is one gross unit to GitHub actor 18633264. Its exact split is
0.98 recipient and 0.02 fee. The approved deposit is exactly ten units.
Supporting transactions may use gas within the same ceiling. Their reviewed
scope cannot move qualification principal. Every upgrade or funding action
requires its own reviewed execution plan and owner authorization. A signed
attempt's identity and native liability are durable before dispatch. A
retransmission uses the retained transaction and reserves no additional gas.

```quint
pure def fresh(checks: FreshChecks): bool = checks.currentAuthority and checks.exactPlanAuthorized and checks.eligible
  and checks.simulationPassed and checks.reconciled
pure def allowedOperation(q: Qualification, operation: Operation): bool =
  operation.key != "" and operation.transaction != "" and not(q.records.contains(operation.key))
    and operation.gasLimit >= 0 and operation.gasLimit <= gasCeiling(q.plan.network) - q.spent
    and (if (operation.kind == Deposit) not(q.deposited) and operation.gross == 10000000
      and operation.net == 0 and operation.fee == 0 and operation.actor == 0
    else if (operation.kind == Payout) q.deposited and not(q.paid) and operation.gross == 1000000
      and operation.net == 980000 and operation.fee == 20000 and operation.actor == 18633264
    else operation.gross == 0 and operation.net == 0 and operation.fee == 0 and operation.actor == 0)
pure def canRetainAttempt(q: Qualification, operation: Operation, checks: FreshChecks): bool =
  q.phase == Ready and fresh(checks) and allowedOperation(q, operation) and not(q.transactions.includes(operation.transaction))
pure def retainAttempt(q: Qualification, operation: Operation, checks: FreshChecks): Qualification =
  { ...q, phase: AwaitingReceipt, pending: operation, transactions: q.transactions.append(operation.transaction) }
pure def liveAttempt(q: Qualification): bool = q.phase == AwaitingReceipt or q.phase == Uncertain
pure def canRetransmit(q: Qualification, transaction: str): bool = liveAttempt(q) and transaction == q.pending.transaction
pure def retransmit(q: Qualification, transaction: str): Qualification = { ...q, retransmissions: q.retransmissions + 1 }
pure def stepRetransmissionReservesNothing(before: Qualification, via: str, after: Qualification): bool =
  via == "retransmit" implies after.spent == before.spent and after.transactions == before.transactions and after.pending == before.pending
pure def sometimesRetransmitted(q: Qualification): bool = q.retransmissions > 0 and liveAttempt(q)
pure def alwaysPendingBound(q: Qualification): bool =
  if (liveAttempt(q)) allowedOperation(q, q.pending) and q.transactions.includes(q.pending.transaction) else q.pending == emptyOperation
pure def alwaysNativeCeiling(q: Qualification): bool = q.spent >= 0 and q.spent <= gasCeiling(q.plan.network)
pure def alwaysPaymentAfterDeposit(q: Qualification): bool = q.paid implies q.deposited
```

### Missing or mismatched evidence holds the attempt, and finalized failure stops further actions

The outcome must identify the exact transaction, vault, network and operation
before changing progress or charges. A finalized failure consumes the observed
fee and stops the sequence. A failed pre-signature check also stops it. Resume
with a fresh review and reconciliation. Missing evidence never clears a pending
attempt. Reconcile completed historical operations from exact independent
evidence, without creating another signed attempt.

```quint
pure def canMissReceipt(q: Qualification): bool = q.phase == AwaitingReceipt
pure def missReceipt(q: Qualification): Qualification = { ...q, phase: Uncertain }
pure def canStopBeforeAttempt(q: Qualification, checks: FreshChecks): bool = q.phase == Ready and not(fresh(checks))
pure def stopBeforeAttempt(q: Qualification, checks: FreshChecks): Qualification = { ...q, phase: Stopped }
pure def canResume(q: Qualification, checks: FreshChecks): bool = q.phase == Stopped and fresh(checks)
pure def resume(q: Qualification, checks: FreshChecks): Qualification = { ...q, phase: Ready }
pure def matchesResult(q: Qualification, operation: Operation, result: Result): bool =
  result.network == q.plan.network and result.vault == q.plan.vault and result.transaction == operation.transaction
    and result.finalized and result.exactOperation and result.actualGas >= 0 and result.actualGas <= operation.gasLimit
pure def receiptState(operation: Operation, result: Result, q: Qualification): Qualification =
  { ...q, phase: if (result.succeeded) Ready else Stopped, spent: q.spent + result.actualGas, pending: emptyOperation,
    history: q.history.append({ plan: q.plan, operation: operation, result: result }),
    records: if (result.succeeded) q.records.union(Set(operation.key)) else q.records,
    deposited: q.deposited or (result.succeeded and operation.kind == Deposit),
    paid: q.paid or (result.succeeded and operation.kind == Payout) }
pure def canReconcileAttempt(q: Qualification, result: Result): bool =
  liveAttempt(q) and matchesResult(q, q.pending, result)
pure def reconcileAttempt(q: Qualification, result: Result): Qualification = receiptState(q.pending, result, q)
pure def canRetainHistorical(q: Qualification, operation: Operation, result: Result): bool =
  q.phase == Ready and allowedOperation(q, operation) and not(q.transactions.includes(operation.transaction))
    and result.succeeded and matchesResult(q, operation, result)
pure def retainHistorical(q: Qualification, operation: Operation, result: Result): Qualification =
  { ...receiptState(operation, result, q), transactions: q.transactions.append(operation.transaction) }
pure def stepPendingClearedByExactReceipt(before: Qualification, via: str, after: Qualification): bool =
  liveAttempt(before) and not(liveAttempt(after)) implies via == "reconcileAttempt"
pure def stepPaidNeedsAReceipt(before: Qualification, via: str, after: Qualification): bool =
  after.paid and not(before.paid) implies via == "reconcileAttempt" or via == "retainHistorical"
pure def stepAttemptIdentityPersists(before: Qualification, after: Qualification): bool = after.transactions == before.transactions or
  (after.transactions.length() == before.transactions.length() + 1
    and after.transactions == before.transactions.append(after.transactions.nth(before.transactions.length())))
pure def stepReceiptHistoryPersists(before: Qualification, after: Qualification): bool =
  after.history == before.history or (after.history.length() == before.history.length() + 1 and
    after.history == before.history.append(after.history.nth(before.history.length())))
pure def sometimesHeld(q: Qualification): bool = q.phase == Uncertain
pure def sometimesStopped(q: Qualification): bool = q.phase == Stopped
```

### Completed lanes do not repeat, and Ethereum requires both shared EVM qualifications and its own evidence

A lane advances only after completed payment and independent reconciliation of
its retained evidence. Finalized attempts and their receipts remain in the
journal when the next lane starts. The separate production activation consumes
qualified lanes in order and requires current evidence for the network. Qualification transactions are excluded from earned
cycles, evaluations and payout recognition: `excludedTransactions` is the
list the points and settlement ledgers must refuse (a composition
obligation). Ethereum's first-vault waiver is derived from the retained
ledger: both Base and Robinhood lanes qualified and all three lanes
activated. Ethereum still
requires current authority, exact deployment and asset checks, finalized
evidence, and its own explicit activation. It uses no qualification vault.

```quint
type ActivationEvidence = { network: Network, vault: str, review: str, currentAuthority: bool, exactDeployment: bool, exactAsset: bool, finalized: bool }
pure def canCompleteLane(q: Qualification, reconciled: bool): bool = q.phase == Ready and q.paid and reconciled
pure def completeLane(q: Qualification, reconciled: bool): Qualification = { ...q, completed: q.completed + 1, phase: AwaitingPlan, plan: emptyPlan, qualifiedPlans: q.qualifiedPlans.append(q.plan), spent: 0, deposited: false, paid: false, records: Set() }
pure def validActivation(q: Qualification, activation: ActivationEvidence): bool = activation.currentAuthority and activation.exactDeployment
  and activation.exactAsset and activation.finalized and q.ownerApprovals.includes(activation.review)
pure def canActivateLane(q: Qualification, activation: ActivationEvidence): bool =
  val retained = q.qualifiedPlans.nthOr(q.activated, emptyPlan)
  q.activated >= 0 and q.activated < q.completed and q.activated < q.qualifiedPlans.length()
    and activation.network == networkFor(q.activated) and activation.network == retained.network
    and activation.vault == retained.vault and activation.review == retained.review and validActivation(q, activation)
pure def activateLane(q: Qualification, activation: ActivationEvidence): Qualification = { ...q, activated: q.activated + 1 }
pure def alwaysActivationWithinQualification(q: Qualification): bool = q.activated >= 0 and q.activated <= q.completed
pure def stepActivationIsSingleNetwork(before: Qualification, after: Qualification): bool =
  after.activated >= before.activated and after.activated <= before.activated + 1
pure def sharedEvmQualified(q: Qualification): bool = q.qualifiedPlans.some(p => p.network == Base)
  and q.qualifiedPlans.some(p => p.network == Robinhood) and q.activated == 3
pure def canActivateEthereum(q: Qualification, activation: ActivationEvidence): bool =
  q.completed == 3 and q.phase == AwaitingPlan and not(q.ethereumActive) and sharedEvmQualified(q)
    and activation.network == Ethereum and activation.vault == "" and validActivation(q, activation)
pure def activateEthereum(q: Qualification, activation: ActivationEvidence): Qualification = { ...q, ethereumActive: true }
pure def alwaysEthereumAfterSequence(q: Qualification): bool = q.ethereumActive implies q.completed == 3 and q.phase == AwaitingPlan
  and sharedEvmQualified(q)
pure def stepEthereumActivePersists(before: Qualification, after: Qualification): bool = before.ethereumActive implies after.ethereumActive
pure def excludedTransactions(q: Qualification): List[str] = q.transactions
pure def alwaysEveryOutcomeExcluded(q: Qualification): bool = q.history.every(h => excludedTransactions(q).includes(h.result.transaction))
pure def sometimesPaid(q: Qualification): bool = q.paid
pure def sometimesThreeLanesQualified(q: Qualification): bool = q.completed == 3
pure def sometimesThreeLanesActivated(q: Qualification): bool = q.activated == 3
pure def sometimesEthereumActive(q: Qualification): bool = q.ethereumActive
```

## Story: Keep previously approved scope and evidence exceptions attached to their specific controls

### Native and Token-2022 qualification requires the whole asset flow and a reviewed authorization for the particular action

Scope approval permits implementation and local testing. Record creation,
deposits, refunds, reservations, payouts, claims and accounting before
qualifying these assets. A Token-2022 mint qualifies only when it passes the
[money](../settlement/money.md) admission rule `token2022Admissible` (only
metadata extensions, disabled authorities, immutable-owner accounts), and it
requires an independently present record of inspection of the complete
conversion path. The evidence reader supplies the inspected mint and account
facts.

```quint
import money as M from "../settlement/money"
type TokenFacts = { kind: M::AssetKind, mintBytes: int, mintAuthority: bool, freezeAuthority: bool, pointerAuthority: bool,
  updateAuthority: bool, selfHosted: bool, mintExtensions: List[str], accountExtensions: List[str] }
type AssetChecks = { created: bool, deposited: bool, refunded: bool, reserved: bool, paid: bool, claimed: bool, accounted: bool, conversionInspected: bool }
pure def tokenAdmitted(token: TokenFacts): bool = token.kind != M::Token2022 or M::token2022Admissible(token.mintBytes,
  token.mintAuthority, token.freezeAuthority, token.pointerAuthority, token.updateAuthority, token.selfHosted,
  token.mintExtensions, token.accountExtensions)
pure def assetFlowQualified(token: TokenFacts, flow: AssetChecks): bool = tokenAdmitted(token)
  and flow.created and flow.deposited and flow.refunded and flow.reserved and flow.paid and flow.claimed and flow.accounted
    and (token.kind != M::Token2022 or flow.conversionInspected)
pure def assetActionAuthorized(token: TokenFacts, flow: AssetChecks, reviewedAction: bool, ownerAuthorizedAction: bool): bool =
  assetFlowQualified(token, flow) and reviewedAction and ownerAuthorizedAction
pure def lawToken2022StricterThanNative(token: TokenFacts, flow: AssetChecks): bool =
  not(flow.conversionInspected) implies not(assetFlowQualified({ ...token, kind: M::Token2022 }, flow))
pure def lawToken2022NeedsAdmission(token: TokenFacts, flow: AssetChecks): bool =
  (token.kind == M::Token2022 and not(tokenAdmitted(token))) implies not(assetFlowQualified(token, flow))
pure def lawImplementationApprovalIsNotAction(token: TokenFacts, flow: AssetChecks): bool =
  not(assetActionAuthorized(token, flow, false, true)) and not(assetActionAuthorized(token, flow, true, false))
```

### Solana upgrade evidence still includes deterministic build, exact on-chain bytes, public testnet and owner authorization

The recorded second-operator and different-machine build waiver leaves these
checks in effect. The completed controls release, program upgrade and 0.05 SOL
gas top-up are historical records. Check those executions before any later
operation.

```quint
type SolanaUpgradeEvidence = { deterministicPinnedBuild: bool, exactOnChainBytes: bool, publicTestnet: bool, ownerAuthorized: bool }
type ExistingSolanaStep = ControlsRelease | ProgramUpgrade | GasTopUp
pure def solanaUpgradeQualified(upgrade: SolanaUpgradeEvidence): bool =
  upgrade.deterministicPinnedBuild and upgrade.exactOnChainBytes and upgrade.publicTestnet and upgrade.ownerAuthorized
pure def lawSecondOperatorWaiverKeepsBytesAndTestnet(upgrade: SolanaUpgradeEvidence): bool =
  (not(upgrade.exactOnChainBytes) or not(upgrade.publicTestnet)) implies not(solanaUpgradeQualified(upgrade))
pure def canRecordHistoricalSolana(q: Qualification, prior: ExistingSolanaStep, upgrade: SolanaUpgradeEvidence): bool =
  not(q.historicalSolana.includes(prior)) and (prior != ProgramUpgrade or solanaUpgradeQualified(upgrade))
pure def recordHistoricalSolana(q: Qualification, prior: ExistingSolanaStep, upgrade: SolanaUpgradeEvidence): Qualification =
  { ...q, historicalSolana: q.historicalSolana.append(prior) }
pure def stepHistoricalEvidenceSignsNothing(before: Qualification, via: str, after: Qualification): bool =
  via == "recordHistoricalSolana" implies after.transactions == before.transactions and after.spent == before.spent
    and after.phase == before.phase and after.pending == before.pending
pure def stepHistoricalStepsOnce(before: Qualification, after: Qualification): bool = after.historicalSolana == before.historicalSolana
  or (after.historicalSolana.length() == before.historicalSolana.length() + 1
    and not(before.historicalSolana.includes(after.historicalSolana.nthOr(before.historicalSolana.length(), GasTopUp))))
pure def sometimesHistoricalRecorded(q: Qualification): bool = q.historicalSolana.length() == 3
```

### Sample plans, receipts and checks cover the allowed progression and conflicting evidence

```quint
pure val planValues = Set(Base, Solana, Robinhood, Ethereum).map(network =>
  { network: network, vault: "vault", asset: stablecoin(network), review: "plan", monthlyCap: 1000000000, automatic: false })
pure val evidenceValues = Set(
  { nonMoneyLive: true, exactAssetAndVault: true, currentAuthority: true, exactDeployment: true, applicableTestnet: true },
  { nonMoneyLive: true, exactAssetAndVault: true, currentAuthority: true, exactDeployment: true, applicableTestnet: false })
pure val reviewValues = Set("plan", "ethereum-activation", "")
pure val byValues = Set(RepositoryOwner, Agent)
pure val weight_approve = 3
pure val checksValues = Set(
  { currentAuthority: true, exactPlanAuthorized: true, eligible: true, simulationPassed: true, reconciled: true },
  { currentAuthority: true, exactPlanAuthorized: true, eligible: true, simulationPassed: false, reconciled: true })
pure def sampleTransaction(network: Network, kind: StepKind): str =
  if (network == Base) (if (kind == Deposit) "base-deposit" else if (kind == Payout) "base-payout" else "base-setup")
  else if (network == Solana) (if (kind == Deposit) "solana-deposit" else if (kind == Payout) "solana-payout" else "solana-setup")
  else (if (kind == Deposit) "robinhood-deposit" else if (kind == Payout) "robinhood-payout" else "robinhood-setup")
pure val sampleNetworks = Set(Base, Solana, Robinhood)
pure val operationValues = sampleNetworks.fold(Set(), (operations, network) => operations.union(Set(
  { key: "setup", transaction: sampleTransaction(network, SupportingWrite), kind: SupportingWrite, gasLimit: 1, gross: 0, net: 0, fee: 0, actor: 0 },
  { key: "deposit", transaction: sampleTransaction(network, Deposit), kind: Deposit, gasLimit: 1, gross: 10000000, net: 0, fee: 0, actor: 0 },
  { key: "payout", transaction: sampleTransaction(network, Payout), kind: Payout, gasLimit: 1, gross: 1000000, net: 980000, fee: 20000, actor: 18633264 })))
pure val resultValues = sampleNetworks.fold(Set(), (results, network) =>
  results.union(Set(SupportingWrite, Deposit, Payout).fold(Set(), (byTransaction, kind) =>
    byTransaction.union(Set(true, false).map(succeeded => { network: network, vault: "vault", transaction: sampleTransaction(network, kind),
      finalized: true, exactOperation: true, succeeded: succeeded, actualGas: 1 })))))
pure val activationValues = Set(Base, Solana, Robinhood, Ethereum).map(network =>
  { network: network, vault: if (network == Ethereum) "" else "vault", review: if (network == Ethereum) "ethereum-activation" else "plan",
    currentAuthority: true, exactDeployment: true, exactAsset: true, finalized: true })
pure val flowValues = Set(
  { created: true, deposited: true, refunded: true, reserved: true, paid: true, claimed: true, accounted: true, conversionInspected: true },
  { created: true, deposited: true, refunded: true, reserved: true, paid: true, claimed: true, accounted: true, conversionInspected: false })
pure val admittedMint: TokenFacts = { kind: M::Token2022, mintBytes: 512, mintAuthority: false, freezeAuthority: false,
  pointerAuthority: false, updateAuthority: false, selfHosted: true, mintExtensions: List("MetadataPointer", "TokenMetadata"),
  accountExtensions: List("ImmutableOwner") }
pure val tokenValues = Set(admittedMint, { ...admittedMint, kind: M::Classic }, { ...admittedMint, kind: M::Native },
  { ...admittedMint, mintExtensions: List("TransferHook") }, { ...admittedMint, freezeAuthority: true },
  { ...admittedMint, mintBytes: 1025 })
pure val upgradeValues = Set(
  { deterministicPinnedBuild: true, exactOnChainBytes: true, publicTestnet: true, ownerAuthorized: true },
  { deterministicPinnedBuild: true, exactOnChainBytes: false, publicTestnet: false, ownerAuthorized: true })
pure val weight_admitPlan = 3
pure val weight_completeLane = 2
pure val weight_stopBeforeAttempt = 1
pure val weight_resume = 4
pure val weight_retainHistorical = 9
pure val weight_retainAttempt = 2
pure val weight_reconcileAttempt = 7
pure val weight_missReceipt = 2
pure val weight_activateLane = 6
pure val weight_activateEthereum = 4
pure val priorValues = Set(ControlsRelease, ProgramUpgrade, GasTopUp)
pure val transactionValues = Set("base-deposit", "solana-payout", "other")
pure val eval_witness_sometimesRetransmitted = (
  ("approve", "plan", RepositoryOwner),
  ("admitPlan", { network: Base, vault: "vault", asset: "USDC", review: "plan", monthlyCap: 1000000000, automatic: false },
    { nonMoneyLive: true, exactAssetAndVault: true, currentAuthority: true, exactDeployment: true, applicableTestnet: true }, RepositoryOwner),
  ("retainAttempt", { key: "deposit", transaction: "base-deposit", kind: Deposit, gasLimit: 1, gross: 10000000, net: 0, fee: 0, actor: 0 },
    { currentAuthority: true, exactPlanAuthorized: true, eligible: true, simulationPassed: true, reconciled: true }, RepositoryOwner),
  ("retransmit", "base-deposit", RepositoryOwner))
pure val eval_witness_sometimesEthereumActive = (
  ("approve", "plan", RepositoryOwner),
  ("approve", "ethereum-activation", RepositoryOwner),
  ("admitPlan", { network: Base, vault: "vault", asset: "USDC", review: "plan", monthlyCap: 1000000000, automatic: false },
    { nonMoneyLive: true, exactAssetAndVault: true, currentAuthority: true, exactDeployment: true, applicableTestnet: true }, RepositoryOwner),
  ("retainHistorical", { key: "deposit", transaction: "base-deposit", kind: Deposit, gasLimit: 1, gross: 10000000, net: 0, fee: 0, actor: 0 },
    { network: Base, vault: "vault", transaction: "base-deposit", finalized: true, exactOperation: true, succeeded: true, actualGas: 1 }, RepositoryOwner),
  ("retainHistorical", { key: "payout", transaction: "base-payout", kind: Payout, gasLimit: 1, gross: 1000000, net: 980000, fee: 20000, actor: 18633264 },
    { network: Base, vault: "vault", transaction: "base-payout", finalized: true, exactOperation: true, succeeded: true, actualGas: 1 }, RepositoryOwner),
  ("completeLane", true, RepositoryOwner),
  ("admitPlan", { network: Solana, vault: "vault", asset: "USDC", review: "plan", monthlyCap: 1000000000, automatic: false },
    { nonMoneyLive: true, exactAssetAndVault: true, currentAuthority: true, exactDeployment: true, applicableTestnet: true }, RepositoryOwner),
  ("retainHistorical", { key: "deposit", transaction: "solana-deposit", kind: Deposit, gasLimit: 1, gross: 10000000, net: 0, fee: 0, actor: 0 },
    { network: Solana, vault: "vault", transaction: "solana-deposit", finalized: true, exactOperation: true, succeeded: true, actualGas: 1 }, RepositoryOwner),
  ("retainHistorical", { key: "payout", transaction: "solana-payout", kind: Payout, gasLimit: 1, gross: 1000000, net: 980000, fee: 20000, actor: 18633264 },
    { network: Solana, vault: "vault", transaction: "solana-payout", finalized: true, exactOperation: true, succeeded: true, actualGas: 1 }, RepositoryOwner),
  ("completeLane", true, RepositoryOwner),
  ("admitPlan", { network: Robinhood, vault: "vault", asset: "USDG", review: "plan", monthlyCap: 1000000000, automatic: false },
    { nonMoneyLive: true, exactAssetAndVault: true, currentAuthority: true, exactDeployment: true, applicableTestnet: true }, RepositoryOwner),
  ("retainHistorical", { key: "deposit", transaction: "robinhood-deposit", kind: Deposit, gasLimit: 1, gross: 10000000, net: 0, fee: 0, actor: 0 },
    { network: Robinhood, vault: "vault", transaction: "robinhood-deposit", finalized: true, exactOperation: true, succeeded: true, actualGas: 1 }, RepositoryOwner),
  ("retainHistorical", { key: "payout", transaction: "robinhood-payout", kind: Payout, gasLimit: 1, gross: 1000000, net: 980000, fee: 20000, actor: 18633264 },
    { network: Robinhood, vault: "vault", transaction: "robinhood-payout", finalized: true, exactOperation: true, succeeded: true, actualGas: 1 }, RepositoryOwner),
  ("completeLane", true, RepositoryOwner),
  ("activateLane", { network: Base, vault: "vault", review: "plan", currentAuthority: true, exactDeployment: true, exactAsset: true, finalized: true }, RepositoryOwner),
  ("activateLane", { network: Solana, vault: "vault", review: "plan", currentAuthority: true, exactDeployment: true, exactAsset: true, finalized: true }, RepositoryOwner),
  ("activateLane", { network: Robinhood, vault: "vault", review: "plan", currentAuthority: true, exactDeployment: true, exactAsset: true, finalized: true }, RepositoryOwner),
  ("activateEthereum", { network: Ethereum, vault: "", review: "ethereum-activation", currentAuthority: true, exactDeployment: true, exactAsset: true, finalized: true }, RepositoryOwner))
```
