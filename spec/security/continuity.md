# Private case continuity

PRD sections 3, 8 and 10 keep a private case, its award and its payment through
the reporter's account closure, a project transfer and the loss of a
maintainer's or financial approver's role. This machine holds the
[private award settlement](../settlement/privateAward.md) and the [account
service](../backend/accounts.md), with the reporter's account bound to the
case's reporter in its state, and supplies every cross-machine fact from
their state.
Destination recovery is already composed in the private award settlement and
the bounty-vault [dispatch](../settlement/paymentDispatch.md). Participation
bans belong to the access composition.

Two owner decision gates stay open and are not modelled. PRD section 10
("Continuity") requires restoring backups, but no restore scope, authority
or reconciliation of a restored case, hold or obligation against later
finalized steps is decided. Who prepares or recovers the request of an
admitted direct award after its payer lost the financial role is the
[private award settlement's](../settlement/privateAward.md) open gate.

## Story: Keep every private case and obligation through account and role changes

### Account closure withdraws email consent and keeps the case and its obligations

The reporter closes their own account from a live session with the typed
login. The reporter's Inbox consents never exceed the consents of the
account's email enrollment, so the same step withdraws both consents of the
reporter's Inbox. Closure never changes the cases, holds, award, vault
obligation or direct journal, and never removes a notice; that frame
condition guards against later edits of the closure step. A reserved award
is still paid after closure.

```quint
import money as M from "../settlement/money"
import terms as T from "./terms"
import cases as C from "./cases"
import bounty as B from "./bounty"
import paymentDispatch as D from "../settlement/paymentDispatch"
import payment as P from "../settlement/payment"
import vault as V from "../settlement/vault"
import composition as SC from "../settlement/composition"
import directBounty as DB from "../settlement/directBounty"
import notifications as N from "../operations/notifications"
import identity as I from "../backend/identity"
import email as E from "../backend/email"
import xConnection as X from "../backend/xConnection"
import accounts as A from "../backend/accounts"
import privateAward as PA from "../settlement/privateAward"
type Continuity = { award: PA::PrivateAward, accounts: A::Accounts, reporterAccount: int, changedAfterCommit: bool,
  closedBeforePaid: bool }
pure def startingContinuity(award: PA::PrivateAward, accounts: A::Accounts, reporterAccount: int): Continuity =
  { award: award, accounts: accounts, reporterAccount: reporterAccount, changedAfterCommit: false, closedBeforePaid: false }
pure def caseReporter(s: Continuity): int = PA::caseOf(s.award, 1).reporter
pure def reporterMember(s: Continuity): A::Member = A::memberByActor(s.accounts, s.reporterAccount)
pure def withAward(a: PA::PrivateAward, s: Continuity): Continuity = { ...s, award: a }
pure def withAccounts(a: A::Accounts, s: Continuity): Continuity = { ...s, accounts: a }
// The Inbox knows the reporter by the case's actor, as the starting state records it.
pure def reporterClosure(s: Continuity): E::Enrollment = { ...E::closeEnrollment(reporterMember(s).email), actor: caseReporter(s) }
pure def reporterClosed(s: Continuity): bool = reporterMember(s).membership == A::Closed
pure def canCloseReporter(s: Continuity, by: int, session: int, confirmation: str): bool = by == caseReporter(s)
  and A::senderActor(s.accounts, session) == s.reporterAccount and A::canClose(s.accounts, session, confirmation)
  and N::canCloseAccount(s.award.inbox, N::accountService, reporterClosure(s))
pure def closeReporter(s: Continuity, by: int, session: int, confirmation: str): Continuity =
  { ...withAccounts(A::close(s.accounts, session, confirmation), withAward(PA::withInbox(N::closeAccount(s.award.inbox, N::accountService, reporterClosure(s)), s.award), s)),
    closedBeforePaid: s.award.settlement.payment.phase != P::Paid }
pure def alwaysInboxConsentFollowsEnrollment(s: Continuity): bool =
  (N::enrollmentOf(s.award.inbox, caseReporter(s)).preference.activity implies reporterMember(s).email.preference.activity)
  and (N::enrollmentOf(s.award.inbox, caseReporter(s)).preference.security implies reporterMember(s).email.preference.security)
pure def alwaysClosedReporterWithdrawsConsent(s: Continuity): bool = reporterClosed(s) implies
  not(N::enrollmentOf(s.award.inbox, caseReporter(s)).preference.activity) and not(N::enrollmentOf(s.award.inbox, caseReporter(s)).preference.security)
pure def alwaysAccountRules(s: Continuity): bool = A::alwaysClosedPrivate(s.accounts) and A::alwaysSessionsBelongToOpenMembers(s.accounts)
pure def stepClosureKeepsObligations(before: Continuity, via: str, after: Continuity): bool = via == "closeReporter" implies
  after.award.bounty == before.award.bounty and after.award.settlement == before.award.settlement
    and after.award.direct == before.award.direct and after.award.shown == before.award.shown
pure def stepNoticesPermanent(before: Continuity, after: Continuity): bool = N::stepNoticesPermanent(before.award.inbox, after.award.inbox)
pure def sometimesClosedWhileReserved(s: Continuity): bool = reporterClosed(s) and s.award.settlement.payment.phase == P::VaultReserved
pure def sometimesPaidAfterClosure(s: Continuity): bool = reporterClosed(s) and s.closedBeforePaid
  and s.award.settlement.payment.phase == P::Paid
```

### A transfer or role loss replaces the roles and keeps every commitment

A project transfer or a maintainer's or financial approver's role loss
arrives as a newer verified authority snapshot for every case of the
project, naming only real actors. It changes no hold, chosen amount,
commitment, vault obligation or direct journal term; that frame condition
guards against later edits of the role step. With the settlement unchanged,
the payout of a reserved award stays possible: its paid notice can always be
saved for the reporter and every current approver. A committed vault-backed
award is still paid after the whole role set changed. A direct award's
request prepared before the change is still credited. A replaced technical
reviewer, or a triager assigned before the change, reads the report body
afterwards only under a role of the new snapshot: the change revokes every
triager ([case](./cases.md)), and a current technical approver may assign
one again.

```quint
pure def realActors(snapshot: C::Authority): bool = snapshot.technical.every(a => a > 0) and snapshot.financial.every(a => a > 0)
pure def canReplaceRoles(s: Continuity, snapshot: C::Authority): bool = PA::canObserveAuthority(s.award, snapshot) and realActors(snapshot)
pure def replaceRoles(s: Continuity, snapshot: C::Authority): Continuity =
  { ...withAward(PA::observeAuthority(s.award, snapshot), s),
    changedAfterCommit: s.changedAfterCommit or C::committed(PA::caseOf(s.award, 1)) or C::committed(PA::caseOf(s.award, 2)) }
pure def alwaysReservedAwardCanNotifyPaid(s: Continuity): bool = s.award.vaultCase > 0 implies B::known(s.award.vaultCase)
  and realActors(PA::caseOf(s.award, s.award.vaultCase).authority)
  and PA::recipientsValid(s.award.inbox, PA::noticeKey(PA::AwardPaid, s.award.vaultCase), PA::caseOf(s.award, s.award.vaultCase))
pure def stepRolesKeepCommitments(before: Continuity, via: str, after: Continuity): bool = via == "replaceRoles" implies
  after.award.bounty.holds == before.award.bounty.holds and after.award.bounty.reserved == before.award.bounty.reserved
    and after.award.settlement == before.award.settlement and after.award.direct.terms == before.award.direct.terms
    and B::caseIds.every(id => PA::caseOf(after.award, id).grossChosen == PA::caseOf(before.award, id).grossChosen
      and PA::caseOf(after.award, id).commitment == PA::caseOf(before.award, id).commitment
      and PA::caseOf(after.award, id).award == PA::caseOf(before.award, id).award)
pure def canAssignTriager(s: Continuity, id: int, by: int, checkedEpoch: int, actor: int): bool =
  B::known(id) and C::canAssignTriager(PA::caseOf(s.award, id), by, checkedEpoch, actor)
pure def assignTriager(s: Continuity, id: int, by: int, checkedEpoch: int, actor: int): Continuity =
  withAward(PA::withBounty(B::putCase(id, C::assignTriager(PA::caseOf(s.award, id), by, checkedEpoch, actor), s.award.bounty), s.award), s)
pure def reviewersOf(s: Continuity, id: int): List[int] = PA::caseOf(s.award, id).authority.technical
  .concat(PA::caseOf(s.award, id).authority.financial).concat(PA::caseOf(s.award, id).authority.moderators).concat(PA::caseOf(s.award, id).triagers)
pure def readsUnderCurrentRole(s: Continuity, id: int, a: int): bool =
  C::mayReadBody(PA::caseOf(s.award, id), a, PA::caseOf(s.award, id).authority.epoch) implies (a == PA::caseOf(s.award, id).reporter
    or PA::caseOf(s.award, id).authority.technical.includes(a) or PA::caseOf(s.award, id).authority.moderators.includes(a))
pure def stepReplacedReviewerReadsOnlyUnderCurrentRole(before: Continuity, via: str, after: Continuity): bool = via == "replaceRoles" implies
  B::caseIds.every(id => reviewersOf(before, id).every(a => readsUnderCurrentRole(after, id, a)))
pure def sometimesTriagerRevokedByRoleChange(s: Continuity): bool = PA::caseOf(s.award, 1).revokedTriagers.length() > 0
  and PA::caseOf(s.award, 1).authority.epoch > 1
pure def sometimesPaidAfterRoleSetChanged(s: Continuity): bool = s.changedAfterCommit and s.award.settlement.payment.phase == P::Paid
  and PA::caseOf(s.award, 1).authority.epoch > 1
```

### The award settles through the same composed steps

```quint
pure def canDeposit(s: Continuity, amount: M::Amount, asset: str, receipt: int, finalized: bool): bool =
  PA::canDeposit(s.award, amount, asset, receipt, finalized)
pure def deposit(s: Continuity, amount: M::Amount, asset: str, receipt: int, finalized: bool): Continuity =
  withAward(PA::deposit(s.award, amount, asset, receipt, finalized), s)
pure def canObserveFunds(s: Continuity, observedAt: int): bool = PA::canObserveFunds(s.award, observedAt)
pure def observeFunds(s: Continuity, observedAt: int): Continuity = withAward(PA::observeFunds(s.award, observedAt), s)
pure def canReceive(s: Continuity, id: int, source: C::ReceiptSource, terms: T::ReceiptTerms, reportVersion: int): bool =
  PA::canReceive(s.award, id, source, terms, reportVersion)
pure def receive(s: Continuity, id: int, source: C::ReceiptSource, terms: T::ReceiptTerms, reportVersion: int): Continuity =
  withAward(PA::receive(s.award, id, source, terms, reportVersion), s)
pure def canDecide(s: Continuity, id: int, by: int, checkedEpoch: int, version: int, decision: C::Decision): bool =
  PA::canDecide(s.award, id, by, checkedEpoch, version, decision)
pure def decide(s: Continuity, id: int, by: int, checkedEpoch: int, version: int, decision: C::Decision): Continuity =
  withAward(PA::decide(s.award, id, by, checkedEpoch, version, decision), s)
pure def canShowAmounts(s: Continuity, id: int, by: int, checkedEpoch: int, gross: M::Amount): bool =
  PA::canShowAmounts(s.award, id, by, checkedEpoch, gross)
pure def showAmounts(s: Continuity, id: int, by: int, checkedEpoch: int, gross: M::Amount): Continuity =
  withAward(PA::showAmounts(s.award, id, by, checkedEpoch, gross), s)
pure def canDecideAward(s: Continuity, id: int, by: int, checkedEpoch: int, amount: M::Amount): bool =
  PA::canDecideAward(s.award, id, by, checkedEpoch, amount)
pure def decideAward(s: Continuity, id: int, by: int, checkedEpoch: int, amount: M::Amount): Continuity =
  withAward(PA::decideAward(s.award, id, by, checkedEpoch, amount), s)
pure def canUpdateDelivery(s: Continuity, update: SC::DeliveryUpdate): bool = PA::canUpdateDelivery(s.award, update)
pure def updateDelivery(s: Continuity, update: SC::DeliveryUpdate): Continuity = withAward(PA::updateDelivery(s.award, update), s)
pure def canReconcile(s: Continuity, evidence: SC::FinalizedPayment): bool = PA::canReconcile(s.award, evidence)
pure def reconcile(s: Continuity, evidence: SC::FinalizedPayment): Continuity = withAward(PA::reconcile(s.award, evidence), s)
pure def alwaysAwardRules(s: Continuity): bool = PA::alwaysVaultAwardReserved(s.award) and PA::alwaysPaidNotified(s.award)
```

### Simulation samples

The reporter's account is the sampled legacy member with a live session,
whose verified email destination and Inbox carry both consents. Actors 2 and
3 are technical and 5 financial; the second snapshot replaces every one of
them.

```quint
pure val sampleAccount: A::Member = A::memberByActor(A::signedOld, 1101)
pure val consentedEmail: E::Enrollment = { ...sampleAccount.email, destination: { address: "octo-mail", version: 1, verifiedAt: 1 },
  preference: { stored: true, activity: true, security: true, version: 1, revision: 0 } }
pure val consentedAccounts: A::Accounts = { ...A::signedOld, members: A::withEmail(A::signedOld, sampleAccount, consentedEmail) }
pure val consentedInbox: N::Inbox = N::observeEnrollment(N::initial, N::accountService, { ...consentedEmail, actor: 1 })
pure val initial: Continuity = startingContinuity(PA::withInbox(consentedInbox, PA::initial), consentedAccounts, 1101)
pure val idValues = Set(1)
pure val sourceValues = Set(C::SlopReceived)
pure val termsValues = Set(PA::awardTerms)
pure val reportVersionValues = Set(1)
pure val versionValues = Set(1)
pure val snapshotValues = Set(C::staff, { ...C::staff, epoch: 2, technical: List(8), financial: List(6), moderators: List(9) })
pure val decisionValues = Set(
  { finding: C::Confirmed, severity: T::Critical, loss: T::VerifiedPotential, inScope: true, rootCause: 1, duplicateOf: 0, declareRelated: false,
    spam: false })
pure val byValues = Set(1, 2)
pure val actorValues = Set(2, 10)
pure val checkedEpochValues = Set(1)
pure val amountValues = Set(List(4))
pure val grossValues = Set(List(4))
pure val assetValues = Set("asset")
pure val receiptValues = Set(1, 2)
pure val finalizedValues = Set(true)
pure val observedAtValues = Set(2, 3)
pure val evidenceValues = Set(PA::awardReceipt(1))
pure val updateValues = Set(SC::SetWallet({ claim: D::walletOne.claim, digest: D::walletOne.digest, address: D::walletOne.address }))
pure val sessionValues = Set(1)
pure val confirmationValues = Set("octo")
pure val weight_closeReporter = 4
pure val weight_replaceRoles = 4
pure val weight_decideAward = 10
pure val weight_showAmounts = 10
pure val weight_reconcile = 8
pure val eval_witness_sometimesClosedWhileReserved = (
  ("deposit", List(4), "asset", 1, true, 1),
  ("observeFunds", 2, 1),
  ("replaceRoles", C::staff, 1),
  ("receive", 1, C::SlopReceived, PA::awardTerms, 1, 1),
  ("decide", 1, 2, 1, 1, { finding: C::Confirmed, severity: T::Critical, loss: T::VerifiedPotential, inScope: true, rootCause: 1, duplicateOf: 0, declareRelated: false, spam: false }),
  ("showAmounts", 1, 2, 1, List(4)),
  ("decideAward", 1, 2, 1, List(4)),
  ("closeReporter", 1, 1, "octo"))
```
