# Payment evidence and recovery

PRD sections 3, 6, 8 and 10 require exact reconciliation before paid. One instance tracks an obligation and its retained transaction attempts. Source models include `chain_evidence`, `payment_dispatch`, `signed_send`, `direct_payment_recovery`, `direct_bounty_journal`, `security_rail_exclusivity` and `payment_history`. Finalized observations are supplied by a chain adapter whose RPC quorum and decoding require independent conformance evidence.

## Story: Pay one obligation exactly once

### An approved obligation retains its immutable amount and purpose

The sponsor approval that creates an obligation is modeled in private-case specifications. A purpose binds its permitted payment rail. Full-award cases use DirectFull and cannot use a standard bounty vault. Discovered by the proof: before admission, its empty state contains no amount, destination or signed attempt, so it cannot be held or resumed as an approved obligation. Configuring the obligation supplies the approved amount and purpose. Ordinary amounts use the fixed 2% fee. Private standard awards use the exact 75/25 split. The standard bounty vault is the private-standard rail owned here. The [direct standard award journal](./directBounty.md) owns independent EVM payment legs and the atomic Solana transfer. An approved full-award case requires its separately released payment rail. No full-award payment path exists yet (Slop AGENTS, 28 October 2026). Only the platform owner releases it, with a recorded owner decision, the reviewed revision that implements it and its qualification run; a project owner cannot. Until then the full-award obligation stays held.

```quint
import money as M from "./money"
import paymentDispatch as D from "./paymentDispatch"
type Purpose = Ordinary | PrivateStandard | PrivateFull
type PaymentRail = OrdinaryVault | StandardBountyVault | DirectStandard | DirectFull
type PaymentEvidence = { attempt: int, obligation: int, source: str, asset: str, recipient: str,
  feeRecipient: str, principal: M::Amount, fee: M::Amount, height: int, finalized: bool, succeeded: bool }
type VaultPaymentEvidence = { obligation: int, gross: M::Amount, principal: M::Amount,
  fee: M::Amount, feeRecipient: str, height: int }
type PaymentPhase = VaultReserved | AwaitingWallet | Ready | Journaled | Submitted | Uncertain | Paid | Held
type Payment = { configured: bool, phase: PaymentPhase, purpose: Purpose, rail: PaymentRail, feeRecipient: str, obligation: int, vault: str, asset: str,
  target: D::Target, vaultReceipt: D::Receipt,
  recipient: str, gross: M::Amount, principal: M::Amount, fee: M::Amount, consent: int, request: int,
  attempt: int, attempts: List[int], failedAttempts: List[int], canonical: int, finalizedHeight: int, observedPrincipal: M::Amount,
  observedFee: M::Amount, fullRailReleased: bool }
pure val initial: Payment = { configured: false, phase: AwaitingWallet, purpose: Ordinary, rail: OrdinaryVault, feeRecipient: "fees", obligation: 1, vault: "vault", asset: "asset",
  target: { ...D::ordinaryTarget, asset: "asset" }, vaultReceipt: D::noReceipt, recipient: "", gross: M::zero, principal: M::zero, fee: M::zero, consent: 0, request: 1,
  attempt: 0, attempts: List(), failedAttempts: List(), canonical: 0, finalizedHeight: 0,
  observedPrincipal: M::zero, observedFee: M::zero, fullRailReleased: false }
pure val grossValues = Set(List(1), List(4), List(100), List(0, 1))
pure def canConfigure(p: Payment, purpose: Purpose, rail: PaymentRail, gross: M::Amount): bool =
  p.phase == AwaitingWallet and not(p.configured) and M::validAmount(gross) and M::positiveAmount(gross)
    and rail != DirectStandard and (purpose != PrivateStandard or M::privateSplitPossible(gross)) and railMatchesPurpose(purpose, rail)
pure def configure(p: Payment, purpose: Purpose, rail: PaymentRail, gross: M::Amount): Payment =
  val fee = if (purpose == Ordinary) M::ordinaryFeeAmount(gross) else if (purpose == PrivateStandard) M::privateFeeAmount(gross) else M::zero
  val principal = if (purpose == Ordinary) M::ordinaryNetAmount(gross) else if (purpose == PrivateStandard) M::privateResearcherAmount(gross) else gross
  { ...p, configured: true, purpose: purpose, rail: rail,
    target: { ...p.target, scope: if (rail == StandardBountyVault) D::PrivateBounty else D::Ordinary }, feeRecipient: if (purpose == PrivateFull) "" else "fees", gross: gross, fee: fee, principal: principal }
type RailRelease = { rail: PaymentRail, decision: str, reviewedRevision: int, qualificationRun: str }
pure def canReleaseFullRail(p: Payment, release: RailRelease, by: str): bool =
  p.phase != Paid and p.configured and p.purpose == PrivateFull and not(p.fullRailReleased)
    and release.rail == DirectFull and release.decision != "" and release.reviewedRevision > 0
    and release.qualificationRun != "" and by == "platform-owner"
pure def releaseFullRail(p: Payment, release: RailRelease, by: str): Payment =
  { ...p, fullRailReleased: true }
pure val byValues = Set("recipient", "owner", "platform-owner", "wrong")
pure val releaseValues = Set({ rail: DirectFull, decision: "owner-decision", reviewedRevision: 1, qualificationRun: "run" },
  { rail: DirectFull, decision: "", reviewedRevision: 1, qualificationRun: "run" },
  { rail: StandardBountyVault, decision: "owner-decision", reviewedRevision: 1, qualificationRun: "run" })
pure val recipientValues = Set("wallet", "wrong")
pure val principalValues = Set(List(0), List(1), List(3), List(4), List(98), List(99), List(100))
pure val feeValues = Set(List(0), List(1), List(2), List(3), List(25))
```

### A destination requires the current account and wallet consent

```quint
pure def canBind(p: Payment, recipient: str, consent: int, by: str): bool =
  p.phase == AwaitingWallet and p.configured and directRail(p.rail) and by == "recipient" and recipient != "" and consent > p.consent
pure def bind(p: Payment, recipient: str, consent: int, by: str): Payment =
  { ...p, recipient: recipient, consent: consent, phase: Ready }
```

### The released direct full-award rail journals before submission and retain every uncertain attempt

An attempt identifier is a durable journal identity bound to signed bytes outside this machine. Reusing an existing attempt is a retransmission of those same bytes. Replacement authorization is covered by the signer machine. No transition releases an uncertain obligation. Only the chain adapter's finalized receipt showing that the exact retained attempt reverted (`FailedAttemptEvidence` with status `FinalizedReverted`) makes the obligation ready again; a missing, pending or successful receipt never does, so a lost receipt cannot cause a second payment.

```quint
pure def canJournal(p: Payment, attempt: int): bool = p.phase == Ready and directRail(p.rail) and attempt > 0
  and not(p.attempts.includes(attempt)) and (p.purpose != PrivateFull or p.fullRailReleased)
pure def journal(p: Payment, attempt: int): Payment =
  { ...p, phase: Journaled, attempt: attempt, attempts: p.attempts.append(attempt) }
pure def canSubmit(p: Payment): bool = p.phase == Journaled
pure def submit(p: Payment): Payment = { ...p, phase: Submitted }
pure def canLoseReceipt(p: Payment): bool = p.phase == Submitted
pure def loseReceipt(p: Payment): Payment = { ...p, phase: Uncertain }
pure def canRetransmit(p: Payment): bool = p.phase == Uncertain
pure def retransmit(p: Payment): Payment = { ...p, phase: Submitted }
pure def canHold(p: Payment): bool = p.configured and directRail(p.rail) and p.phase != Paid and p.phase != Held
pure def hold(p: Payment): Payment = { ...p, phase: Held }
pure def canResume(p: Payment, by: str): bool = p.phase == Held and directRail(p.rail) and by == "owner"
pure def resume(p: Payment, by: str): Payment =
  { ...p, phase: if (p.recipient == "") AwaitingWallet else
    if (p.attempt == 0 or p.failedAttempts.includes(p.attempt)) Ready else Uncertain }
type ReceiptStatus = FinalizedReverted | FinalizedSucceeded | NotFinal | ReceiptMissing
type FailedAttemptEvidence = { attempt: int, height: int, status: ReceiptStatus }
pure def canRecordFailure(p: Payment, failure: FailedAttemptEvidence): bool =
  (p.phase == Submitted or p.phase == Uncertain or p.phase == Held) and failure.attempt > 0 and failure.attempt == p.attempt
    and p.attempts.includes(failure.attempt) and not(p.failedAttempts.includes(failure.attempt)) and failure.height > 0
    and failure.status == FinalizedReverted
pure def recordFailure(p: Payment, failure: FailedAttemptEvidence): Payment =
  { ...p, phase: Ready, failedAttempts: p.failedAttempts.append(failure.attempt) }

```

### Direct reconciliation requires a retained exact attempt

The observation names the obligation, source, asset, recipient, fee recipient, principal and fee. A confirmed transaction must have succeeded at the required finalized height and use a retained attempt. Discovered by the proof: retained attempts cannot substitute for releasing the full-award payment rail; reconciliation checks that release independently. This transition reconciles a direct full-award receipt. The standard direct journal reconciles its own receipts.

```quint
pure def canReconcile(p: Payment, evidence: PaymentEvidence): bool =
  p.rail == DirectFull and p.phase != Paid and p.fullRailReleased and evidence.attempt > 0 and p.attempts.includes(evidence.attempt) and not(p.failedAttempts.includes(evidence.attempt)) and evidence.obligation == p.obligation
    and evidence.source == p.vault and evidence.asset == p.asset and evidence.recipient == p.recipient and evidence.feeRecipient == p.feeRecipient
    and M::validAmount(evidence.principal) and M::validAmount(evidence.fee)
    and M::equalAmounts(evidence.principal, p.principal) and M::equalAmounts(evidence.fee, p.fee)
    and evidence.height > 0 and evidence.finalized and evidence.succeeded
pure def reconcile(p: Payment, evidence: PaymentEvidence): Payment =
  { ...p, phase: Paid, canonical: evidence.attempt, finalizedHeight: evidence.height,
    observedPrincipal: evidence.principal, observedFee: evidence.fee }
```

### A reserved vault accepts an exact canonical scanner event

Vault authorization stays with the actor and scanner. A callback or a local
dispatch attempt does not constitute finalized settlement evidence.
The reserve consumes the immutable contributor and award identity. After
independent chain verification, settlement records the actual destination and
transaction from the canonical event. The dispatch machine supplies historical
authorization and the finalized vault asset in the atomic composition. The
recording function is used only after both owner guards pass. The financial owner independently
matches the award amount, asset, principal, fee and fee recipient.

```quint
pure def directRail(rail: PaymentRail): bool = rail == DirectStandard or rail == DirectFull
pure def canReserveVault(p: Payment): bool = p.configured and not(directRail(p.rail)) and p.phase == AwaitingWallet
pure def reserveVault(p: Payment): Payment = { ...p, phase: VaultReserved }
pure def vaultPayoutMatches(p: Payment, r: D::Receipt, vaultEvidence: VaultPaymentEvidence): bool =
  p.phase == VaultReserved and not(directRail(p.rail))
    and r.target == p.target and r.target.vault == p.vault and r.target.asset == p.asset
    and r.tx != "" and r.destination != "" and vaultEvidence.obligation == p.obligation
    and r.finalized and r.succeeded and r.observedAsset and vaultEvidence.height > 0 and vaultEvidence.feeRecipient == p.feeRecipient
    and M::validAmount(vaultEvidence.gross) and M::validAmount(vaultEvidence.principal) and M::validAmount(vaultEvidence.fee)
    and M::equalAmounts(vaultEvidence.gross, p.gross) and M::equalAmounts(vaultEvidence.principal, p.principal)
    and M::equalAmounts(vaultEvidence.fee, p.fee)
pure def recordVaultPayment(r: D::Receipt, vaultEvidence: VaultPaymentEvidence, p: Payment): Payment =
  { ...p, phase: Paid, vaultReceipt: r, finalizedHeight: vaultEvidence.height,
    observedPrincipal: vaultEvidence.principal, observedFee: vaultEvidence.fee }
pure def alwaysConserved(p: Payment): bool = M::equalAmounts(p.gross, M::addAmounts(p.principal, p.fee))
  and M::validAmount(p.gross) and M::validAmount(p.principal) and M::validAmount(p.fee)
pure def alwaysPaidEvidence(p: Payment): bool = p.phase == Paid implies
  (if (directRail(p.rail)) p.canonical > 0 and p.attempts.includes(p.canonical)
    else p.vaultReceipt.tx != "" and p.vaultReceipt.destination != "" and p.vaultReceipt.target == p.target
      and p.vaultReceipt.finalized and p.vaultReceipt.succeeded and p.vaultReceipt.observedAsset)
  and (p.purpose != PrivateFull or p.fullRailReleased) and p.finalizedHeight > 0
  and M::equalAmounts(p.observedPrincipal, p.principal) and M::equalAmounts(p.observedFee, p.fee)
pure def stepPaidPermanent(before: Payment, after: Payment): bool = before.phase == Paid implies after == before
pure def stepObligationPermanent(before: Payment, after: Payment): bool = before.configured implies before.obligation == after.obligation
  and before.gross == after.gross and before.principal == after.principal and before.fee == after.fee
  and before.target == after.target and before.vault == after.vault and before.asset == after.asset and before.rail == after.rail and before.feeRecipient == after.feeRecipient
pure def alwaysCorrectFee(p: Payment): bool = p.configured implies validSplit(p.purpose, p.gross, p.principal, p.fee)
pure def alwaysUnconfiguredEmpty(p: Payment): bool = not(p.configured) implies
  p.phase == AwaitingWallet and p.recipient == "" and p.attempts.length() == 0 and p.failedAttempts.length() == 0
    and p.attempt == 0 and M::equalAmounts(p.gross, M::zero) and M::equalAmounts(p.principal, M::zero) and M::equalAmounts(p.fee, M::zero)
pure def alwaysAdmittedAttempts(p: Payment): bool = p.attempts.length() > 0 implies p.configured
pure def alwaysCorrectRail(p: Payment): bool = p.rail != DirectStandard and railMatchesPurpose(p.purpose, p.rail)
pure def alwaysVaultPhase(p: Payment): bool = p.phase == VaultReserved implies p.configured and not(directRail(p.rail))
pure def sometimesVaultReserved(p: Payment): bool = p.phase == VaultReserved
pure def sometimesUncertain(p: Payment): bool = p.phase == Uncertain
pure def sometimesPaid(p: Payment): bool = p.phase == Paid
pure def sometimesPrivate(p: Payment): bool = p.configured and p.purpose == PrivateStandard
pure def sometimesFullHeld(p: Payment): bool = p.configured and p.purpose == PrivateFull and not(p.fullRailReleased)
pure def sometimesHeld(p: Payment): bool = p.phase == Held
```

### A Solana pay pre-check may read confirmed chain time only to avoid an early send, never as evidence

Owner decision pending (STATE owner queue "settlement D9"); this rule models
the default, which keeps production behaviour. Before sending a permissionless
pay of a bound Solana award, the sender may read the cluster's confirmed
block time and skip the send while that time is earlier than the award's
payable time: its commit time plus the project's award delay, read from the
award account. The program enforces the delay itself, and the delay is zero
today, so the read only saves a transaction that would fail. The confirmed
time is never stored, never forms an event of this machine and never marks
anything paid, held or failed; every recorded fact stays finalized. The
alternative the owner may choose is to read only finalized time, which can
delay a send by the finality lag. Development
`workers/payment-executor/solana.ts` (`confirmedChainTime`, `payBoundAward`).

```quint
pure def solanaPayMayAttempt(confirmedChainTime: int, committedAt: int, delaySeconds: int): bool =
  committedAt > 0 and delaySeconds >= 0 and confirmedChainTime >= committedAt + delaySeconds
```

## Story: Preserve policy-specific private awards

### Private fee schedules are exact and purpose-bound

These library predicates are used by the case-to-obligation admission boundary. Full-award approval never reserves a 75/25 vault. A full-award payment rail must be released by the platform owner's recorded decision, implemented by a reviewed revision and qualified by a recorded run.

```quint
pure def validSplit(purpose: Purpose, gross: M::Amount, principal: M::Amount, fee: M::Amount): bool =
  M::validAmount(gross) and M::validAmount(principal) and M::validAmount(fee) and M::positiveAmount(gross)
    and M::equalAmounts(gross, M::addAmounts(principal, fee)) and
    (if (purpose == Ordinary) M::equalAmounts(fee, M::ordinaryFeeAmount(gross))
     else if (purpose == PrivateStandard) M::privateSplitPossible(gross)
       and M::equalAmounts(principal, M::privateResearcherAmount(gross)) and M::equalAmounts(fee, M::privateFeeAmount(gross))
     else M::equalAmounts(principal, gross) and M::equalAmounts(fee, M::zero))

pure def railMatchesPurpose(purpose: Purpose, rail: PaymentRail): bool =
  if (purpose == Ordinary) rail == OrdinaryVault
  else if (purpose == PrivateStandard) rail == StandardBountyVault or rail == DirectStandard
  else rail == DirectFull
pure def railReleased(release: RailRelease): bool = release.rail == DirectFull and release.decision != ""
  and release.reviewedRevision > 0 and release.qualificationRun != ""
pure def fullRailAdmission(purpose: Purpose, rail: PaymentRail, release: RailRelease): bool =
  if (purpose == PrivateFull) rail == DirectFull and railReleased(release) else true
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val receiptSample: D::Receipt = { ...D::paidReceipt, target: initial.target }
pure val rValues = Set(receiptSample)
pure val vaultEvidenceSample: VaultPaymentEvidence = { obligation: 1, gross: List(100),
  principal: List(98), fee: List(2), feeRecipient: "fees", height: 1 }
pure val vaultEvidenceValues = Set(vaultEvidenceSample, { ...vaultEvidenceSample, fee: List(3) })
pure val attemptValues = Set(0, 1, 2)
pure val consentValues = Set(0, 1, 2)
pure val failureValues = Set({ attempt: 1, height: 2, status: FinalizedReverted }, { attempt: 1, height: 2, status: ReceiptMissing },
  { attempt: 1, height: 2, status: NotFinal }, { attempt: 2, height: 2, status: FinalizedReverted }, { attempt: 1, height: 0, status: FinalizedReverted })
pure val evidenceValues = Set(
  { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(98), fee: List(2), height: 1, finalized: true, succeeded: true },
  { attempt: 2, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(98), fee: List(2), height: 2, finalized: true, succeeded: true },
  { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(3), fee: List(1), height: 1, finalized: true, succeeded: true },
  { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(75), fee: List(25), height: 1, finalized: true, succeeded: true },
  { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "", principal: List(100), fee: List(0), height: 1, finalized: true, succeeded: true },
  { attempt: 1, obligation: 1, source: "vault", asset: "wrong", recipient: "wallet", feeRecipient: "fees", principal: List(98), fee: List(2), height: 1, finalized: true, succeeded: true },
  { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "wrong", principal: List(98), fee: List(2), height: 1, finalized: true, succeeded: true },
  { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(97), fee: List(2), height: 1, finalized: true, succeeded: true },
  { attempt: 1, obligation: 1, source: "vault", asset: "asset", recipient: "wallet", feeRecipient: "fees", principal: List(98), fee: List(2), height: 1, finalized: false, succeeded: true })
```
