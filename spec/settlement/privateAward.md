# Private award settlement and notices

PRD sections 8 and 10 carry an approved private award from the human case
decision to finalized payment: a vault-backed award reserves its bounty vault
in the same step, a direct award is paid only by a current financial
approver, the exact amounts are shown before every authorization, and the
reporter, current maintainers and financial approvers are notified of each
award and payment step. This machine holds the [project bounty
machine](../security/bounty.md), one [vault-backed obligation](./composition.md),
one [direct standard award journal](./directBounty.md) and the
[Inbox](../operations/notifications.md), and supplies every cross-machine fact
from their state. A full award binds neither rail. Restoring these records
from backup is an open owner decision gate, kept with [case
continuity](../security/continuity.md).

## Story: Commit a private award with its funds

### A vault-backed award reserves its bounty vault in the same step

The bounty machine's funds snapshot is read from the finalized vault itself.
When a human approval commits a vault reservation, directly or after an
approved related-party review, the private standard obligation is configured
for that case's gross amount and reserves the vault in the same step. Its
target names the case's reporter as the award actor, the case as the
obligation, this bounty vault and the case's receipt-time asset. Only a
committed standard 75/25 case holds that obligation, and every hold keeps
matching its case. The bounty's reserved total is exactly what the vault
holds in reserve. The vault's free amount, the latest funds snapshot and the
bounty's reserved total are always valid amounts in integer base units. A
confirmed award stays pending without a reservation while vault funds are
short. A case received through a reporter's claim, a technical approver's
attestation or link verification, or the GitHub receipt service settling a
claim enters the award the same way as one Slop received.

```quint
import money as M from "./money"
import terms as T from "../security/terms"
import cases as C from "../security/cases"
import bounty as B from "../security/bounty"
import paymentDispatch as D from "./paymentDispatch"
import payment as P from "./payment"
import vault as V from "./vault"
import composition as SC from "./composition"
import directBounty as DB from "./directBounty"
import notifications as N from "../operations/notifications"
import email as E from "../backend/email"
import runtime as FR from "../fees/runtime"
type AmountsShown = { by: int, caseId: int, caseRevision: int, gross: M::Amount, researcher: M::Amount, slop: M::Amount }
type PrivateAward = { bounty: B::Bounty, settlement: SC::Settlement, direct: DB::DirectBounty, inbox: N::Inbox,
  vaultCase: int, directCase: int, shown: AmountsShown, authorizedEpoch: int }
pure val noAmounts: AmountsShown = { by: 0, caseId: 0, caseRevision: 0, gross: M::zero, researcher: M::zero, slop: M::zero }
pure def startingAward(bounty: B::Bounty, ledger: SC::Settlement, direct: DB::DirectBounty, inbox: N::Inbox): PrivateAward =
  { bounty: bounty, settlement: ledger, direct: direct, inbox: inbox, vaultCase: 0, directCase: 0, shown: noAmounts, authorizedEpoch: 0 }
pure val initial: PrivateAward = startingAward(B::initial, SC::initial, DB::initial, N::initial)
pure def caseOf(s: PrivateAward, id: int): C::PrivateCase = B::caseOf(s.bounty, id)
pure def withBounty(b: B::Bounty, s: PrivateAward): PrivateAward = { ...s, bounty: b }
pure def withSettlement(ledger: SC::Settlement, s: PrivateAward): PrivateAward = { ...s, settlement: ledger }
pure def withDirect(d: DB::DirectBounty, s: PrivateAward): PrivateAward = { ...s, direct: d }
pure def withInbox(i: N::Inbox, s: PrivateAward): PrivateAward = { ...s, inbox: i }
pure def vaultHold(b: B::Bounty, id: int): bool = b.holds.some(h => h.caseId == id and h.kind == B::VaultHold)
pure def directHold(b: B::Bounty, id: int): bool = b.holds.some(h => h.caseId == id and h.kind == B::DirectHold)
pure def canDeposit(s: PrivateAward, amount: M::Amount, asset: str, receipt: int, finalized: bool): bool =
  SC::canDeposit(s.settlement, amount, asset, receipt, finalized)
pure def deposit(s: PrivateAward, amount: M::Amount, asset: str, receipt: int, finalized: bool): PrivateAward =
  withSettlement(SC::deposit(s.settlement, amount, asset, receipt, finalized), s)
pure def vaultFunds(s: PrivateAward, observedAt: int): B::FundsSnapshot =
  { finalized: true, observedAt: observedAt, asset: s.settlement.vault.asset, free: M::addAmounts(s.settlement.vault.free, s.settlement.vault.reserved) }
pure def canObserveFunds(s: PrivateAward, observedAt: int): bool = B::canObserveFunds(s.bounty, vaultFunds(s, observedAt))
pure def observeFunds(s: PrivateAward, observedAt: int): PrivateAward = withBounty(B::observeFunds(s.bounty, vaultFunds(s, observedAt)), s)
pure def canAdvanceClock(s: PrivateAward, nowMs: int): bool = B::canAdvanceClock(s.bounty, nowMs)
pure def advanceClock(s: PrivateAward, nowMs: int): PrivateAward = withBounty(B::advanceClock(s.bounty, nowMs), s)
pure def canObserveRoute(s: PrivateAward, route: B::RouteObservation): bool = B::canObserveRoute(s.bounty, route)
pure def observeRoute(s: PrivateAward, route: B::RouteObservation): PrivateAward = withBounty(B::observeRoute(s.bounty, route), s)
pure def canReceive(s: PrivateAward, id: int, source: C::ReceiptSource, terms: T::ReceiptTerms, reportVersion: int): bool =
  B::canReceive(s.bounty, id, source, terms, reportVersion)
pure def receive(s: PrivateAward, id: int, source: C::ReceiptSource, terms: T::ReceiptTerms, reportVersion: int): PrivateAward =
  withBounty(B::receive(s.bounty, id, source, terms, reportVersion), s)
pure def canClaim(s: PrivateAward, id: int, by: int): bool = B::canClaim(s.bounty, id, by)
pure def claim(s: PrivateAward, id: int, by: int): PrivateAward = withBounty(B::claim(s.bounty, id, by), s)
pure def canVerifyLink(s: PrivateAward, id: int, by: int, checkedEpoch: int, terms: T::ReceiptTerms): bool =
  B::canVerifyLink(s.bounty, id, by, checkedEpoch, terms)
pure def verifyLink(s: PrivateAward, id: int, by: int, checkedEpoch: int, terms: T::ReceiptTerms): PrivateAward =
  withBounty(B::verifyLink(s.bounty, id, by, checkedEpoch, terms), s)
pure def canRejectLink(s: PrivateAward, id: int, by: int, checkedEpoch: int): bool = B::canRejectLink(s.bounty, id, by, checkedEpoch)
pure def rejectLink(s: PrivateAward, id: int, by: int, checkedEpoch: int): PrivateAward =
  withBounty(B::rejectLink(s.bounty, id, by, checkedEpoch), s)
pure def canRecordAttested(s: PrivateAward, id: int, by: int, checkedEpoch: int, terms: T::ReceiptTerms, confirmed: bool): bool =
  B::canRecordAttested(s.bounty, id, by, checkedEpoch, terms, confirmed)
pure def recordAttested(s: PrivateAward, id: int, by: int, checkedEpoch: int, terms: T::ReceiptTerms, confirmed: bool): PrivateAward =
  withBounty(B::recordAttested(s.bounty, id, by, checkedEpoch, terms, confirmed), s)
pure def canSettleClaim(s: PrivateAward, id: int, by: int, listed: bool, terms: T::ReceiptTerms): bool =
  B::canSettleClaim(s.bounty, id, by, listed, terms)
pure def settleClaim(s: PrivateAward, id: int, by: int, listed: bool, terms: T::ReceiptTerms): PrivateAward =
  withBounty(B::settleClaim(s.bounty, id, by, listed, terms), s)
pure def canObserveAuthority(s: PrivateAward, snapshot: C::Authority): bool = B::canObserveAuthority(s.bounty, snapshot)
pure def observeAuthority(s: PrivateAward, snapshot: C::Authority): PrivateAward = withBounty(B::observeAuthority(s.bounty, snapshot), s)
pure def canDecide(s: PrivateAward, id: int, by: int, checkedEpoch: int, version: int, decision: C::Decision): bool =
  B::canDecide(s.bounty, id, by, checkedEpoch, version, decision)
pure def decide(s: PrivateAward, id: int, by: int, checkedEpoch: int, version: int, decision: C::Decision): PrivateAward =
  withBounty(B::decide(s.bounty, id, by, checkedEpoch, version, decision), s)
pure def awardTarget(s: PrivateAward, id: int): D::Target = { ...s.settlement.payment.target, actor: caseOf(s, id).reporter,
  obligation: id, vault: s.settlement.vault.id, asset: caseOf(s, id).terms.asset }
pure def vaultObligation(s: PrivateAward, id: int, gross: M::Amount): SC::Settlement =
  SC::configure(s.settlement, P::PrivateStandard, P::StandardBountyVault, gross, awardTarget(s, id))
pure def vaultCommitmentReady(s: PrivateAward, id: int, gross: M::Amount): bool = s.vaultCase == 0
  and SC::canConfigure(s.settlement, P::PrivateStandard, P::StandardBountyVault, gross, awardTarget(s, id))
  and SC::canReserve(vaultObligation(s, id, gross))
pure def caseRecipients(c: C::PrivateCase): List[int] = List(c.reporter).concat(c.authority.technical).concat(c.authority.financial)
pure def notifyCase(inbox: N::Inbox, key: int, c: C::PrivateCase): N::Inbox =
  caseRecipients(c).foldl(inbox, (i, t) => N::save(i, key, N::SecurityCase, t))
pure def recipientsValid(inbox: N::Inbox, key: int, c: C::PrivateCase): bool =
  caseRecipients(c).every(t => N::canSave(inbox, key, N::SecurityCase, t))
pure def withCommitment(id: int, s: PrivateAward, bounty: B::Bounty, gross: M::Amount): PrivateAward =
  val after = B::caseOf(bounty, id)
  val reserves = after.commitment == C::VaultReservation and not(C::committed(caseOf(s, id)))
  val notified = if (C::committed(after) and not(C::committed(caseOf(s, id)))) notifyCase(s.inbox, noticeKey(AwardCommitted, id), after) else s.inbox
  withInbox(notified, withSettlement(if (reserves) SC::reserve(vaultObligation(s, id, gross)) else s.settlement,
    { ...withBounty(bounty, s), vaultCase: if (reserves) id else s.vaultCase }))
pure def canDecideAward(s: PrivateAward, id: int, by: int, checkedEpoch: int, amount: M::Amount): bool =
  val after = B::caseOf(B::decideAward(s.bounty, id, by, checkedEpoch, amount), id)
  B::canDecideAward(s.bounty, id, by, checkedEpoch, amount) and amountsShownFor(s, by, id, amount)
    and recipientsValid(s.inbox, noticeKey(AwardCommitted, id), after)
    and (after.commitment == C::VaultReservation implies vaultCommitmentReady(s, id, amount))
pure def decideAward(s: PrivateAward, id: int, by: int, checkedEpoch: int, amount: M::Amount): PrivateAward =
  withCommitment(id, s, B::decideAward(s.bounty, id, by, checkedEpoch, amount), amount)
pure def canReviewRelated(s: PrivateAward, id: int, by: int, checkedEpoch: int, approve: bool): bool =
  val gross = caseOf(s, id).grossChosen
  val after = B::caseOf(B::reviewRelated(s.bounty, id, by, checkedEpoch, approve), id)
  B::canReviewRelated(s.bounty, id, by, checkedEpoch, approve) and (approve implies amountsShownFor(s, by, id, gross))
    and recipientsValid(s.inbox, noticeKey(AwardCommitted, id), after)
    and (after.commitment == C::VaultReservation implies vaultCommitmentReady(s, id, gross))
pure def reviewRelated(s: PrivateAward, id: int, by: int, checkedEpoch: int, approve: bool): PrivateAward =
  withCommitment(id, s, B::reviewRelated(s.bounty, id, by, checkedEpoch, approve), caseOf(s, id).grossChosen)
pure def alwaysVaultAwardReserved(s: PrivateAward): bool =
  val p = s.settlement.payment
  B::caseIds.every(id => vaultHold(s.bounty, id) iff (id == s.vaultCase))
  and (s.vaultCase > 0 iff p.configured)
  and (s.vaultCase > 0 implies p.purpose == P::PrivateStandard and p.rail == P::StandardBountyVault
    and C::committed(caseOf(s, s.vaultCase)) and caseOf(s, s.vaultCase).commitment == C::VaultReservation
    and caseOf(s, s.vaultCase).terms.split == T::StandardSplit
    and M::equalAmounts(p.gross, caseOf(s, s.vaultCase).grossChosen) and (SC::hasReserve(s.settlement) or p.phase == P::Paid))
pure def alwaysHoldsKeepCaseRules(s: PrivateAward): bool = B::alwaysHoldsMatchCases(s.bounty) and B::alwaysCasesKeepAwardRules(s.bounty)
  and B::alwaysReservedIsOpenVaultHolds(s.bounty)
pure def alwaysVaultTargetMatchesAward(s: PrivateAward): bool = s.vaultCase > 0 implies
  s.settlement.payment.target == { ...awardTarget(s, s.vaultCase), scope: D::PrivateBounty } and s.settlement.payment.obligation == s.vaultCase
pure def alwaysBountyReserveIsVaultReserve(s: PrivateAward): bool = M::equalAmounts(s.settlement.vault.reserved, s.bounty.reserved)
pure def alwaysBountyCoverIsVaultFree(s: PrivateAward): bool = s.bounty.funds.asset == "" or (s.bounty.funds.asset == s.settlement.vault.asset
  and (M::compareAmounts(s.bounty.reserved, s.bounty.funds.free) > 0
    or M::compareAmounts(M::subtractAmounts(s.bounty.funds.free, s.bounty.reserved), s.settlement.vault.free) <= 0))
pure def alwaysCoverAmountsValid(s: PrivateAward): bool = M::validAmount(s.settlement.vault.free)
  and M::validAmount(s.bounty.funds.free) and M::validAmount(s.bounty.reserved)
pure def stepVaultReservationNeedsCommitment(before: PrivateAward, via: str, after: PrivateAward): bool =
  (after.settlement.payment.phase == P::VaultReserved and before.settlement.payment.phase != P::VaultReserved) implies
    (via == "decideAward" or via == "reviewRelated") and caseOf(after, after.vaultCase).commitment == C::VaultReservation
      and not(C::committed(caseOf(before, after.vaultCase)))
pure def sometimesVaultAwardPaid(s: PrivateAward): bool = s.settlement.payment.phase == P::Paid and vaultHold(s.bounty, s.vaultCase)
  and s.settlement.payment.vaultReceipt.target.scope == D::PrivateBounty
pure def sometimesPendingWhileShort(s: PrivateAward): bool = B::caseIds.some(id => B::confirmedEligible(caseOf(s, id))
  and caseOf(s, id).award == C::Pending and not(B::hasHold(s.bounty, id))
  and M::compareAmounts(s.settlement.vault.free, caseOf(s, id).terms.offeredGross) < 0)
```

### A finalized vault payout records the obligation paid, settles its hold and notifies the case

The reporter's wallet authorization and recovery go through the bounty-vault
dispatch; the reservation and the award actor stay unchanged. The finalized
payout that marks the obligation paid settles the bounty's vault hold in the
same step.

```quint
pure def canUpdateDelivery(s: PrivateAward, update: SC::DeliveryUpdate): bool = SC::canUpdateDelivery(s.settlement, update)
pure def updateDelivery(s: PrivateAward, update: SC::DeliveryUpdate): PrivateAward = withSettlement(SC::updateDelivery(s.settlement, update), s)
pure def vaultPayout(evidence: SC::FinalizedPayment): B::VaultPayout =
  { receipt: evidence.receipt, gross: evidence.amounts.gross, finalized: evidence.scanner.finalized }
pure def canReconcile(s: PrivateAward, evidence: SC::FinalizedPayment): bool = s.vaultCase > 0
  and SC::canReconcile(s.settlement, evidence) and B::canSettleVaultHold(s.bounty, s.vaultCase, vaultPayout(evidence))
  and recipientsValid(s.inbox, noticeKey(AwardPaid, s.vaultCase), caseOf(s, s.vaultCase))
pure def reconcile(s: PrivateAward, evidence: SC::FinalizedPayment): PrivateAward =
  withInbox(notifyCase(s.inbox, noticeKey(AwardPaid, s.vaultCase), caseOf(s, s.vaultCase)),
    withBounty(B::settleVaultHold(s.bounty, s.vaultCase, vaultPayout(evidence)), withSettlement(SC::reconcile(s.settlement, evidence), s)))
```

## Story: Pay a direct award only under current financial authority

### Direct payment actions require a current financial approver

The direct journal admits only a committed direct award of this project's
case, to the case's reporter, with a payer who holds the financial role at
that moment. Preparing or recovering a payment request needs the payer's
financial role in the current authority snapshot, never the reporter's own
and never a banned actor's, and records the epoch it was authorized under.
Recording a finalized leg authorizes nothing: an exact finalized transfer
of the active request is credited even after its payer lost the role, so
the obligation still reaches paid.

Decision gate: the journal fixes its payer, and the PRD does not yet say who
may prepare or recover the request of an admitted direct award once that
payer has lost the financial role. No successor-payer transition is
modelled. Until the owner decides, such an award keeps its hold, amount and
paid legs and waits for that decision.

```quint
pure def financialNow(c: C::PrivateCase, by: int, checkedEpoch: int): bool = checkedEpoch == c.authority.epoch and checkedEpoch > 0
  and c.authority.financial.includes(by) and by != c.reporter and not(c.authority.banned.includes(by))
pure def directCaseOf(s: PrivateAward): C::PrivateCase = caseOf(s, s.directCase)
pure def verifiedApprover(s: PrivateAward): bool = s.direct.intent.active and s.authorizedEpoch > 0
pure def canAdmitDirect(s: PrivateAward, id: int, by: int, checkedEpoch: int, journalTerms: DB::Terms, qualifiedRoute: DB::QualifiedRoute): bool =
  val c = caseOf(s, id)
  s.directCase == 0 and B::known(id) and directHold(s.bounty, id) and by == journalTerms.payerActor and financialNow(c, by, checkedEpoch)
    and journalTerms.caseId == id and journalTerms.reporterActor == c.reporter
    and DB::canAdmit(s.direct, journalTerms, c.revision, DB::caseApproval(id, c), qualifiedRoute)
pure def admitDirect(s: PrivateAward, id: int, by: int, checkedEpoch: int, journalTerms: DB::Terms, qualifiedRoute: DB::QualifiedRoute): PrivateAward =
  { ...withDirect(DB::admit(s.direct, journalTerms, caseOf(s, id).revision, DB::caseApproval(id, caseOf(s, id)), qualifiedRoute), s), directCase: id }
pure def canObserveWallets(s: PrivateAward, payerWallet: DB::Wallet, reporterWallet: DB::Wallet, authorizedRead: bool): bool =
  DB::canObserveWallets(s.direct, payerWallet, reporterWallet, authorizedRead)
pure def observeWallets(s: PrivateAward, payerWallet: DB::Wallet, reporterWallet: DB::Wallet, authorizedRead: bool): PrivateAward =
  withDirect(DB::observeWallets(s.direct, payerWallet, reporterWallet, authorizedRead), s)
pure def canConsent(s: PrivateAward, wallet: DB::Wallet, observedRevision: int, chainVisibility: bool, by: int): bool =
  DB::canConsent(s.direct, wallet, observedRevision, chainVisibility, by)
pure def consent(s: PrivateAward, wallet: DB::Wallet, observedRevision: int, chainVisibility: bool, by: int): PrivateAward =
  withDirect(DB::consent(s.direct, wallet, observedRevision, chainVisibility, by), s)
pure def canPrepareDirect(s: PrivateAward, by: int, checkedEpoch: int, intent: DB::Intent, observedRevision: int, proofAvailable: bool, nonceReserved: bool): bool =
  s.directCase > 0 and financialNow(directCaseOf(s), by, checkedEpoch) and amountsShownFor(s, by, s.directCase, s.direct.terms.gross)
    and DB::canPrepare(s.direct, intent, observedRevision, proofAvailable, nonceReserved, by)
pure def prepareDirect(s: PrivateAward, by: int, checkedEpoch: int, intent: DB::Intent, observedRevision: int, proofAvailable: bool, nonceReserved: bool): PrivateAward =
  { ...withDirect(DB::prepare(s.direct, intent, observedRevision, proofAvailable, nonceReserved, by), s), authorizedEpoch: checkedEpoch }
pure def canRecoverDirect(s: PrivateAward, by: int, checkedEpoch: int, successor: DB::Intent, retirement: DB::Retirement, observedRevision: int, nonceReserved: bool): bool =
  s.directCase > 0 and financialNow(directCaseOf(s), by, checkedEpoch)
    and DB::canRecover(s.direct, successor, retirement, observedRevision, nonceReserved, by)
pure def recoverDirect(s: PrivateAward, by: int, checkedEpoch: int, successor: DB::Intent, retirement: DB::Retirement, observedRevision: int, nonceReserved: bool): PrivateAward =
  { ...withDirect(DB::recover(s.direct, successor, retirement, observedRevision, nonceReserved, by), s), authorizedEpoch: checkedEpoch }
pure def alwaysDirectJournalBound(s: PrivateAward): bool = (s.direct.admitted iff s.directCase > 0)
  and (s.directCase > 0 implies directHold(s.bounty, s.directCase) and s.direct.terms.caseId == s.directCase
    and C::committed(directCaseOf(s)) and directCaseOf(s).commitment == C::DirectAward
    and s.direct.terms.reporterActor == directCaseOf(s).reporter and M::equalAmounts(s.direct.terms.gross, directCaseOf(s).grossChosen))
  and (s.direct.intent.active iff s.authorizedEpoch > 0) and s.authorizedEpoch <= directCaseOf(s).authority.epoch
pure def stepDirectPaymentNeedsFinancialApprover(before: PrivateAward, via: str, after: PrivateAward): bool =
  (via == "prepareDirect" or via == "recoverDirect") implies
    financialNow(directCaseOf(before), before.direct.terms.payerActor, directCaseOf(before).authority.epoch)
      and after.authorizedEpoch == directCaseOf(before).authority.epoch
pure def sometimesPaidAfterPayerRevoked(s: PrivateAward): bool = DB::paid(s.direct)
  and not(financialNow(directCaseOf(s), s.direct.terms.payerActor, directCaseOf(s).authority.epoch))
```

### Each recorded direct leg and the paid award notify the case

```quint
pure def withDirectLegs(s: PrivateAward, after: DB::DirectBounty): N::Inbox =
  val c = directCaseOf(s)
  val researcherNew = s.direct.researcherReceipt.transaction == "" and after.researcherReceipt.transaction != ""
  val feeNew = s.direct.feeReceipt.transaction == "" and after.feeReceipt.transaction != ""
  val withResearcher = if (researcherNew) notifyCase(s.inbox, noticeKey(ResearcherLegRecorded, s.directCase), c) else s.inbox
  val withFee = if (feeNew) notifyCase(withResearcher, noticeKey(FeeLegRecorded, s.directCase), c) else withResearcher
  if (DB::paid(after) and not(DB::paid(s.direct))) notifyCase(withFee, noticeKey(AwardPaid, s.directCase), c) else withFee
pure def legKeysValid(s: PrivateAward): bool = recipientsValid(s.inbox, noticeKey(ResearcherLegRecorded, s.directCase), directCaseOf(s))
  and recipientsValid(s.inbox, noticeKey(FeeLegRecorded, s.directCase), directCaseOf(s))
  and recipientsValid(s.inbox, noticeKey(AwardPaid, s.directCase), directCaseOf(s))
pure def canRecordTransfer(s: PrivateAward, transfer: DB::Transfer, observedRevision: int, generation: int): bool =
  s.directCase > 0 and legKeysValid(s) and DB::canRecordTransfer(s.direct, transfer, observedRevision, generation, verifiedApprover(s))
pure def recordTransfer(s: PrivateAward, transfer: DB::Transfer, observedRevision: int, generation: int): PrivateAward =
  val after = DB::recordTransfer(s.direct, transfer, observedRevision, generation, verifiedApprover(s))
  withInbox(withDirectLegs(s, after), withDirect(after, s))
pure def canRecordPair(s: PrivateAward, pair: DB::ReceiptPair, observedRevision: int, generation: int): bool =
  s.directCase > 0 and legKeysValid(s) and DB::canRecordPair(s.direct, pair, observedRevision, generation, verifiedApprover(s))
pure def recordPair(s: PrivateAward, pair: DB::ReceiptPair, observedRevision: int, generation: int): PrivateAward =
  val after = DB::recordPair(s.direct, pair, observedRevision, generation, verifiedApprover(s))
  withInbox(withDirectLegs(s, after), withDirect(after, s))
```

## Story: Show exact amounts and notify every party

### Exact amounts are shown before authorization

The deciding maintainer, the reviewing moderator or the paying financial
approver first sees the exact gross amount, the researcher's amount and
Slop's amount for the current case revision. A standard award splits 75/25
exactly; a full award goes wholly to the researcher. An award decision and a
direct payment request each need the matching display by the same person.

```quint
pure def amountsFor(by: int, id: int, c: C::PrivateCase, gross: M::Amount): AmountsShown =
  { by: by, caseId: id, caseRevision: c.revision, gross: gross,
    researcher: if (c.terms.split == T::FullAward) gross else M::privateResearcherAmount(gross),
    slop: if (c.terms.split == T::FullAward) M::zero else M::privateFeeAmount(gross) }
pure def amountsShownFor(s: PrivateAward, by: int, id: int, gross: M::Amount): bool =
  B::known(id) and s.shown == amountsFor(by, id, caseOf(s, id), gross)
pure def canShowAmounts(s: PrivateAward, id: int, by: int, checkedEpoch: int, gross: M::Amount): bool =
  val c = caseOf(s, id)
  B::known(id) and (C::technicalNow(c, by, checkedEpoch) or C::moderatorNow(c, by, checkedEpoch) or financialNow(c, by, checkedEpoch))
    and (T::amountAllowed(c.terms, gross) or (C::committed(c) and c.grossChosen == gross))
pure def showAmounts(s: PrivateAward, id: int, by: int, checkedEpoch: int, gross: M::Amount): PrivateAward =
  { ...s, shown: amountsFor(by, id, caseOf(s, id), gross) }
pure def alwaysShownAmountsExact(s: PrivateAward): bool =
  M::equalAmounts(s.shown.gross, M::addAmounts(s.shown.researcher, s.shown.slop))
  and (s.shown.caseId > 0 implies B::known(s.shown.caseId) and M::positiveAmount(s.shown.gross)
    and (caseOf(s, s.shown.caseId).terms.split == T::StandardSplit implies
      M::equalAmounts(s.shown.researcher, M::privateResearcherAmount(s.shown.gross))
      and M::equalAmounts(s.shown.slop, M::privateFeeAmount(s.shown.gross))))
pure def lastDecider(c: C::PrivateCase): int = c.deciders.nthOr(c.deciders.length() - 1, 0)
pure def stepAuthorizationFollowsDisplay(before: PrivateAward, via: str, after: PrivateAward): bool =
  B::caseIds.every(id => ((via == "decideAward" or via == "reviewRelated")
    and C::committed(caseOf(after, id)) and not(C::committed(caseOf(before, id)))) implies
      before.shown.caseId == id and before.shown.caseRevision == caseOf(before, id).revision
      and M::equalAmounts(before.shown.gross, caseOf(after, id).grossChosen) and before.shown.by == lastDecider(caseOf(after, id)))
  and (via == "prepareDirect" implies before.shown.caseId == before.directCase and before.shown.by == before.direct.terms.payerActor
    and M::equalAmounts(before.shown.gross, before.direct.terms.gross))
pure def sometimesShownToPayer(s: PrivateAward): bool = s.shown.caseId > 0 and s.shown.caseId == s.directCase
  and s.shown.by == s.direct.terms.payerActor
```

### Award and payment progress notify the reporter, current maintainers and financial approvers

A new commitment, each newly recorded direct leg and a newly paid obligation
save one private case notice for the reporter and every current technical
and financial approver. Each is a case notice on the security outbox; a
notice carries no report text and no amount. A notice's key is its source
change: the kind of change and the case, so two changes never share a key.
The keys of report receipts and owner routing (codes 1 to 3, [report
notices](../security/reportNotices.md)) never meet these (codes 4 to 7).

```quint
type AwardNotice = AwardCommitted | ResearcherLegRecorded | FeeLegRecorded | AwardPaid
pure def noticeCode(notice: AwardNotice): int =
  if (notice == AwardCommitted) 4 else if (notice == ResearcherLegRecorded) 5 else if (notice == FeeLegRecorded) 6 else 7
pure def noticeKey(notice: AwardNotice, id: int): int = 10 * id + noticeCode(notice)
pure def lawNoticeKeysDistinct(notice: AwardNotice, other: AwardNotice, id: int, otherId: int): bool =
  (notice != other or id != otherId) implies noticeKey(notice, id) != noticeKey(other, otherId)
pure def alwaysAwardNoticesArePrivateCaseNotices(s: PrivateAward): bool = N::alwaysChannelByKind(s.inbox)
  and s.inbox.notices.every(n => n.kind == N::SecurityCase and n.template == N::CaseTemplate)
pure def alwaysCommitmentNotified(s: PrivateAward): bool = B::caseIds.every(id =>
  C::committed(caseOf(s, id)) iff N::noticeExists(s.inbox, noticeKey(AwardCommitted, id), caseOf(s, id).reporter))
pure def alwaysPaidNotified(s: PrivateAward): bool =
  (s.vaultCase > 0 implies ((s.settlement.payment.phase == P::Paid) iff N::noticeExists(s.inbox, noticeKey(AwardPaid, s.vaultCase), caseOf(s, s.vaultCase).reporter)))
  and (s.directCase > 0 implies (DB::paid(s.direct) iff N::noticeExists(s.inbox, noticeKey(AwardPaid, s.directCase), directCaseOf(s).reporter)))
pure def stepNoticesPermanent(before: PrivateAward, after: PrivateAward): bool = N::stepNoticesPermanent(before.inbox, after.inbox)
pure def sometimesPaidNoticeToReporterAndPayer(s: PrivateAward): bool = B::caseIds.some(id =>
  N::noticeExists(s.inbox, noticeKey(AwardPaid, id), caseOf(s, id).reporter)
  and caseOf(s, id).authority.financial.some(f => N::noticeExists(s.inbox, noticeKey(AwardPaid, id), f)))
pure def sometimesDirectAwardPaid(s: PrivateAward): bool = DB::paid(s.direct)
```

### Simulation samples

Actors follow the case samples: 1 is the reporter, 2 and 3 are technical, 4
and 7 moderators and 5 the financial approver. The later snapshots revoke
or ban the financial approver.

Discovered by simulation: with no related reporter and no moderator among
the deciding actors, the guard probe for a related-party review found no
reachable state in which a moderator could review a proposal. The snapshot
that revokes the financial approver therefore also names the reporter a
related party and makes actor 5 a moderator. A separate related-party
snapshot and moderator 4 among the actors diluted every other observation
and actor choice until the search for a direct award paid after its payer
lost the role found no witness. An award decided after the revoke snapshot
can never be admitted as a direct award, since no later snapshot restores a
financial approver, so correlating these observations costs that search
nothing.

Discovered by simulation: the guard probes for a single direct-award
transfer and for a direct-award recovery found no state that allowed them in
200000 traces of 20 events, and each search ran past its time limit. Only a
direct award to a payer who still holds the financial role reaches those
events. With only the staff snapshot in the first epoch, two of the three
sampled authority snapshots were later epochs, which cannot be followed by
the first, so a trace that observed one first never had a payer. Two more
first-epoch snapshots therefore name a technical member, 6 or 8, whom no
sampled actor plays, so three of the five snapshots are first-epoch. That
member takes no action, but caseRecipients includes every technical member,
so a case observed under one of these snapshots also saves its case notices
for actor 6 or 8, and recipientsValid checks that recipient as well. A case could also record a root cause that no
sampled journal finding matched, so the journal samples pair each case with
each finding. An observed vault that covers the award sends it to a vault
reservation instead of the direct rail, so deposits and fund observations
are rarer, authority snapshots are observed less often, and the direct
admission, wallet, consent, preparation, recording and recovery events are
weighted above the events that are open in most states. A recovery is
weighted with admission and preparation, the heaviest, because few of its
sampled arguments match the prepared request.

```quint
pure val awardTerms: T::ReceiptTerms = { ...T::standardTerms, offeredGross: List(4), asset: "asset" }
pure val idValues = Set(1, 2)
pure val cValues = Set(C::initial)
pure val sourceValues = Set(C::SlopReceived)
pure val termsValues = Set(awardTerms, { ...awardTerms, receivedAt: 5 })
pure val reportVersionValues = Set(1)
pure val versionValues = Set(1)
pure val snapshotValues = Set(C::staff, { ...C::staff, technical: List(2, 3, 6) }, { ...C::staff, technical: List(2, 3, 8) },
  { ...C::staff, epoch: 2, financial: List(), moderators: List(4, 5, 7), relatedParties: List(1) },
  { ...C::staff, epoch: 2, banned: List(5) })
pure val decisionValues = Set(
  { finding: C::Confirmed, severity: T::Critical, loss: T::VerifiedPotential, inScope: true, rootCause: 1, duplicateOf: 0, declareRelated: false, spam: false },
  { finding: C::Confirmed, severity: T::Critical, loss: T::VerifiedPotential, inScope: true, rootCause: 2, duplicateOf: 0, declareRelated: false, spam: false })
pure val byValues = Set(-1, 1, 2, 5)
pure val checkedEpochValues = Set(1, 2)
pure val amountValues = Set(List(4))
pure val grossValues = Set(List(4))
pure val assetValues = Set("asset")
pure val receiptValues = Set(1, 2)
pure val finalizedValues = Set(true)
pure val observedAtValues = Set(2, 3)
pure val nowMsValues = Set(4)
pure val routeValues = Set({ asset: "asset", qualified: true, observedAt: 2 })
pure val approveValues = Set(true)
pure def awardReceipt(id: int): SC::FinalizedPayment = { ...SC::bountyReceipt,
  scanner: { ...SC::bountyReceipt.scanner, target: { ...SC::bountyReceipt.scanner.target, actor: 1, obligation: id } },
  amounts: { ...SC::bountyReceipt.amounts, obligation: id } }
pure val evidenceValues = Set(awardReceipt(1), awardReceipt(2), SC::bountyReceipt, SC::ordinaryReceipt)
pure val updateValues = Set(SC::SetWallet({ claim: D::walletOne.claim, digest: D::walletOne.digest, address: D::walletOne.address }))
pure val journalTerms: DB::Terms = { caseId: 2, project: 1, finding: 2, payerActor: 5, reporterActor: 1,
  network: FR::Base, asset: "asset", feeWallet: "fees", gross: List(4), split: T::StandardSplit }
pure val journalTermsValues = Set(journalTerms, { ...journalTerms, finding: 1 }, { ...journalTerms, caseId: 1, finding: 1 },
  { ...journalTerms, caseId: 1 })
pure val qualifiedRouteValues = Set({ network: FR::Base, asset: "asset", feeWallet: "fees" })
pure val payerWalletValues = Set(DB::payerOne)
pure val reporterWalletValues = Set(DB::reporterOne)
pure val authorizedReadValues = Set(true)
pure val walletValues = Set(DB::reporterOne)
pure val chainVisibilityValues = Set(true)
pure val intentValues = Set(DB::evmIntent)
pure val proofAvailableValues = Set(true)
pure val nonceReservedValues = Set(true)
pure val observedRevisionValues = Set(1, 2, 3, 4, 5)
pure val generationValues = Set(0)
pure val successorValues = Set(DB::nextFeeIntent)
pure val retirementValues = Set(DB::feeRetirement)
pure val awardResearcher: DB::Transfer = { ...DB::researcherTransfer, principal: List(3) }
pure val awardFee: DB::Transfer = { ...DB::feeTransfer, fee: List(1) }
pure val transferValues = Set(awardResearcher, awardFee)
pure val pairValues = Set({ researcher: awardResearcher, fee: awardFee })
pure val weight_deposit = 1
pure val weight_observeFunds = 1
pure val weight_receive = 8
pure val weight_observeRoute = 8
pure val weight_observeAuthority = 1
pure val weight_decide = 10
pure val weight_showAmounts = 15
pure val weight_decideAward = 15
pure val weight_reconcile = 10
pure val weight_admitDirect = 100
pure val weight_observeWallets = 60
pure val weight_consent = 60
pure val weight_prepareDirect = 100
pure val weight_recordPair = 40
pure val weight_recordTransfer = 40
pure val weight_recoverDirect = 100
```
