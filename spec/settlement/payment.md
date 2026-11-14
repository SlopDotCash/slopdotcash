# Payment evidence and recovery

PRD sections 3, 6, 8 and 10 require exact reconciliation before paid. One instance tracks an obligation and its retained transaction attempts. Source models include `chain_evidence`, `payment_dispatch`, `signed_send`, `direct_payment_recovery`, `direct_bounty_journal`, `security_rail_exclusivity` and `payment_history`. Finalized observations are supplied by a chain adapter whose RPC quorum and decoding require independent conformance evidence.

## Story: Pay one obligation exactly once

### An approved obligation retains its immutable amount and purpose

The sponsor approval that creates an obligation is modeled in private-case specifications. A purpose binds its permitted payment rail. Full-award cases use DirectFull and cannot use a standard bounty vault. Discovered by the proof: before admission, its empty state contains no amount, destination or signed attempt, so it cannot be held or resumed as an approved obligation. Configuring the obligation supplies the approved amount and purpose. Ordinary amounts use the fixed 2% fee. Private standard awards use the exact 75/25 split. An approved full-award case requires its separately released payment rail.

```quint
import money as M from "./money"
type Purpose = Ordinary | PrivateStandard | PrivateFull
type PaymentRail = OrdinaryVault | StandardBountyVault | DirectStandard | DirectFull
type PaymentEvidence = { attempt: int, obligation: int, source: str, asset: str, recipient: str,
  feeRecipient: str, principal: M::Amount, fee: M::Amount, height: int, finalized: bool, succeeded: bool }
type PaymentPhase = AwaitingWallet | Ready | Journaled | Submitted | Uncertain | Paid | Held
type Payment = { configured: bool, phase: PaymentPhase, purpose: Purpose, rail: PaymentRail, feeRecipient: str, obligation: int, vault: str, asset: str,
  recipient: str, gross: M::Amount, principal: M::Amount, fee: M::Amount, consent: int, request: int,
  attempt: int, attempts: List[int], failedAttempts: List[int], canonical: int, finalizedHeight: int, observedPrincipal: M::Amount,
  observedFee: M::Amount, fullRailReleased: bool }
pure val initial: Payment = { configured: false, phase: AwaitingWallet, purpose: Ordinary, rail: OrdinaryVault, feeRecipient: "fees", obligation: 1, vault: "vault", asset: "asset",
  recipient: "", gross: M::zero, principal: M::zero, fee: M::zero, consent: 0, request: 1,
  attempt: 0, attempts: List(), failedAttempts: List(), canonical: 0, finalizedHeight: 0,
  observedPrincipal: M::zero, observedFee: M::zero, fullRailReleased: false }
pure val grossValues = Set(List(1), List(4), List(100), List(0, 1))
pure def canConfigure(p: Payment, purpose: Purpose, rail: PaymentRail, gross: M::Amount): bool =
  p.phase == AwaitingWallet and not(p.configured) and M::validAmount(gross) and M::positiveAmount(gross)
    and (purpose != PrivateStandard or M::privateSplitPossible(gross)) and railMatchesPurpose(purpose, rail)
pure def configure(p: Payment, purpose: Purpose, rail: PaymentRail, gross: M::Amount): Payment =
  val fee = if (purpose == Ordinary) M::ordinaryFeeAmount(gross) else if (purpose == PrivateStandard) M::privateFeeAmount(gross) else M::zero
  { ...p, configured: true, purpose: purpose, rail: rail, feeRecipient: if (purpose == PrivateFull) "" else "fees", gross: gross, fee: fee, principal: M::subtractAmounts(gross, fee) }
pure def canReleaseFullRail(p: Payment, approved: bool, released: bool, qualified: bool, by: str): bool =
  p.phase != Paid and p.configured and p.purpose == PrivateFull and not(p.fullRailReleased)
    and approved and released and qualified and by == "owner"
pure def releaseFullRail(p: Payment, approved: bool, released: bool, qualified: bool, by: str): Payment =
  { ...p, fullRailReleased: true }
pure val byValues = Set("recipient", "owner", "wrong")
pure val recipientValues = Set("wallet", "wrong")
pure val principalValues = Set(List(0), List(1), List(3), List(4), List(98), List(99), List(100))
pure val feeValues = Set(List(0), List(1), List(2), List(3), List(25))
```

### A destination requires the current account and wallet consent

```quint
pure def canBind(p: Payment, recipient: str, consent: int, by: str): bool =
  p.phase == AwaitingWallet and p.configured and by == "recipient" and recipient != "" and consent > p.consent
pure def bind(p: Payment, recipient: str, consent: int, by: str): Payment =
  { ...p, recipient: recipient, consent: consent, phase: Ready }
```

### Journal before submission and retain every uncertain attempt

An attempt identifier is a durable journal identity bound to signed bytes outside this machine. Reusing an existing attempt is a retransmission of those same bytes. Replacement authorization is covered by the signer machine. No transition releases an uncertain obligation.

```quint
pure def canJournal(p: Payment, attempt: int): bool = p.phase == Ready and attempt > 0
  and not(p.attempts.includes(attempt)) and (p.purpose != PrivateFull or p.fullRailReleased)
pure def journal(p: Payment, attempt: int): Payment =
  { ...p, phase: Journaled, attempt: attempt, attempts: p.attempts.append(attempt) }
pure def canSubmit(p: Payment): bool = p.phase == Journaled
pure def submit(p: Payment): Payment = { ...p, phase: Submitted }
pure def canLoseReceipt(p: Payment): bool = p.phase == Submitted
pure def loseReceipt(p: Payment): Payment = { ...p, phase: Uncertain }
pure def canRetransmit(p: Payment): bool = p.phase == Uncertain
pure def retransmit(p: Payment): Payment = { ...p, phase: Submitted }
pure def canHold(p: Payment): bool = p.configured and p.phase != Paid and p.phase != Held
pure def hold(p: Payment): Payment = { ...p, phase: Held }
pure def canResume(p: Payment, by: str): bool = p.phase == Held and by == "owner"
pure def resume(p: Payment, by: str): Payment =
  { ...p, phase: if (p.recipient == "") AwaitingWallet else
    if (p.attempt == 0 or p.failedAttempts.includes(p.attempt)) Ready else Uncertain }
pure def canRecordFailure(p: Payment, attempt: int, height: int, finalized: bool, succeeded: bool): bool =
  (p.phase == Submitted or p.phase == Uncertain or p.phase == Held) and attempt > 0 and attempt == p.attempt
    and p.attempts.includes(attempt) and not(p.failedAttempts.includes(attempt)) and height > 0 and finalized and not(succeeded)
pure def recordFailure(p: Payment, attempt: int, height: int, finalized: bool, succeeded: bool): Payment =
  { ...p, phase: Ready, failedAttempts: p.failedAttempts.append(attempt) }

```

### Exact finalized evidence is the only transition to paid

The observation names the obligation, source, asset, recipient, fee recipient, principal and fee. A confirmed transaction must have succeeded at the required finalized height and use a retained attempt. Discovered by the proof: retained attempts cannot substitute for releasing the full-award payment rail; reconciliation checks that release independently. A partial leg remains recoverable in the external journal and does not satisfy this aggregate transition. Direct private awards additionally retain each paid leg and refuse a duplicate leg through the journal.

```quint
pure def canReconcile(p: Payment, evidence: PaymentEvidence): bool =
  p.phase != Paid and (p.purpose != PrivateFull or p.fullRailReleased) and evidence.attempt > 0 and p.attempts.includes(evidence.attempt) and not(p.failedAttempts.includes(evidence.attempt)) and evidence.obligation == p.obligation
    and evidence.source == p.vault and evidence.asset == p.asset and evidence.recipient == p.recipient and evidence.feeRecipient == p.feeRecipient
    and M::validAmount(evidence.principal) and M::validAmount(evidence.fee)
    and M::equalAmounts(evidence.principal, p.principal) and M::equalAmounts(evidence.fee, p.fee)
    and evidence.height > 0 and evidence.finalized and evidence.succeeded
pure def reconcile(p: Payment, evidence: PaymentEvidence): Payment =
  { ...p, phase: Paid, canonical: evidence.attempt, finalizedHeight: evidence.height,
    observedPrincipal: evidence.principal, observedFee: evidence.fee }
pure def alwaysConserved(p: Payment): bool = M::equalAmounts(p.gross, M::addAmounts(p.principal, p.fee))
  and M::validAmount(p.gross) and M::validAmount(p.principal) and M::validAmount(p.fee)
pure def alwaysPaidEvidence(p: Payment): bool = p.phase == Paid implies p.canonical > 0
  and (p.purpose != PrivateFull or p.fullRailReleased)
  and p.attempts.includes(p.canonical) and p.finalizedHeight > 0
  and M::equalAmounts(p.observedPrincipal, p.principal) and M::equalAmounts(p.observedFee, p.fee)
pure def stepPaidPermanent(before: Payment, after: Payment): bool = before.phase == Paid implies after == before
pure def stepObligationPermanent(before: Payment, after: Payment): bool = before.configured implies before.obligation == after.obligation
  and before.gross == after.gross and before.principal == after.principal and before.fee == after.fee
  and before.vault == after.vault and before.asset == after.asset and before.rail == after.rail and before.feeRecipient == after.feeRecipient
pure def alwaysCorrectFee(p: Payment): bool = p.configured implies validSplit(p.purpose, p.gross, p.principal, p.fee)
pure def alwaysUnconfiguredEmpty(p: Payment): bool = not(p.configured) implies
  p.phase == AwaitingWallet and p.recipient == "" and p.attempts.length() == 0 and p.failedAttempts.length() == 0
    and p.attempt == 0 and M::equalAmounts(p.gross, M::zero) and M::equalAmounts(p.principal, M::zero) and M::equalAmounts(p.fee, M::zero)
pure def alwaysAdmittedAttempts(p: Payment): bool = p.attempts.length() > 0 implies p.configured
pure def alwaysCorrectRail(p: Payment): bool = railMatchesPurpose(p.purpose, p.rail)
pure def sometimesUncertain(p: Payment): bool = p.phase == Uncertain
pure def sometimesPaid(p: Payment): bool = p.phase == Paid
pure def sometimesPrivate(p: Payment): bool = p.configured and p.purpose == PrivateStandard
pure def sometimesFullHeld(p: Payment): bool = p.configured and p.purpose == PrivateFull and not(p.fullRailReleased)
pure def sometimesHeld(p: Payment): bool = p.phase == Held
```

## Story: Preserve policy-specific private awards

### Private fee schedules are exact and purpose-bound

These library predicates are used by the case-to-obligation admission boundary. Full-award approval never reserves a 75/25 vault. A payment rail must be approved, released and qualified separately.

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
pure def fullRailAdmission(purpose: Purpose, usesSplitVault: bool, approved: bool, released: bool, qualified: bool): bool =
  if (purpose == PrivateFull) not(usesSplitVault) and approved and released and qualified else true
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val attemptValues = Set(0, 1, 2)
pure val consentValues = Set(0, 1, 2)
pure val heightValues = Set(0, 1, 2)
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
