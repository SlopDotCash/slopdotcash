# Direct standard private award journal

PRD sections 3 and 8 require exact direct payment evidence per leg and preserve
paid legs across recovery. This journal owns the durable requests and receipts
for an already approved standard 75/25 direct award. Source is Slop development
`cde1f719cda7fc52a0f26dcbbcd524cd2cd7c138`,
`backend/security/direct-payments.ts:184–389,596–884,1168–1495` and migrations
`0108_private_direct_payments.sql`, `0109_direct_payment_transfer_receipts.sql`,
`0112_direct_payment_recovery.sql` and `0113_direct_unpaid_leg_recovery.sql`.
The exact immutable approval and root-cause exclusion come from private case
admission. The same atomic receipt store supplies canonical transaction uses by
other obligations and by ordinary payment history. The adapter authenticates
wallet reads, operator authority, transaction decoding and chain observations.
The external payer signs and sends. This journal exposes only a read-only
projection and emits no signing or broadcasting effects.

## Story: Authorize and retain each exact transfer of an approved direct award

### A standard award freezes its network, asset and two split amounts

The [private case](../security/cases.md) supplies the approval through
`caseApproval`: a committed `DirectAward` of a standard split, its exact gross
amount, asset and immutable case revision. Exclusivity from the separate
bounty vault and from every other report of the same root cause is the
`DirectHold` of the [project bounty machine](../security/bounty.md). A
full-award case never commits a direct standard award, so this journal can
never pay it as 75/25. The reviewed route record (from the settlement route
registry) fixes the network, asset and fee wallet. The case has no payment request until the current
authorized reporter and payer, reporter consent and source proof are captured.
A protocol-v2 EVM intent reserves adjacent nonces atomically, with the fee
first. The cryptographic read proves the pending nonce and the durable store
owns nonce uniqueness across cases for this network and payer. Solana prepares
one exact message containing both transfers.

```quint
import money as M from "./money"
import terms as T from "../security/terms"
import cases as C from "../security/cases"
type Network = Base | Ethereum | Robinhood | Solana
type Lane = Researcher | Fee | Both
type Wallet = { claim: int, address: str, digest: str }
type Terms = { caseId: int, project: int, finding: int, payerActor: int, reporterActor: int, network: Network, asset: str,
  feeWallet: str, gross: M::Amount, split: T::AwardSplit }
type CaseApproval = { caseId: int, caseRevision: int, direct: bool, split: T::AwardSplit, gross: M::Amount, asset: str, rootCause: int }
type QualifiedRoute = { network: Network, asset: str, feeWallet: str }
pure def caseApproval(caseId: int, c: C::PrivateCase): CaseApproval = { caseId: caseId, caseRevision: c.revision,
  direct: c.award == C::Approved and c.commitment == C::DirectAward, split: c.terms.split, gross: c.grossChosen,
  asset: c.terms.asset, rootCause: c.rootCause }
type Intent = { active: bool, generation: int, payer: Wallet, reporter: Wallet, researcherNonce: int, feeNonce: int,
  researcherAnchor: int, feeAnchor: int, message: str, earlierMessages: List[str] }
type Transfer = { lane: Lane, network: Network, asset: str, payerAddress: str, researcherAddress: str, feeAddress: str,
  principal: M::Amount, fee: M::Amount, transaction: str, nonce: int, message: str, height: int, finalized: bool, succeeded: bool, exact: bool }
type ReceiptPair = { researcher: Transfer, fee: Transfer }
type EndKind = Unverified | EvmRetired | SolanaRetired | SameRequest
type Retirement = { kind: EndKind, generation: int, lane: Lane, nonce: int, message: str, coveredMessages: List[str],
  height: int, observation: str, certified: bool, lowerSettled: bool }
type ArchivedIntent = { intent: Intent, retirement: Retirement }
type TxUse = { network: Network, transaction: str }
type DirectBounty = { admitted: bool, terms: Terms, caseRevision: int, payerWallet: Wallet, reporterWallet: Wallet,
  consent: Wallet, visibleConsent: bool, intent: Intent, priorIntents: List[ArchivedIntent], researcherReceipt: Transfer,
  feeReceipt: Transfer, otherUses: List[TxUse] }
pure val noWallet: Wallet = { claim: 0, address: "", digest: "" }
pure val noIntent: Intent = { active: false, generation: 0, payer: noWallet, reporter: noWallet,
  researcherNonce: -1, feeNonce: -1, researcherAnchor: 0, feeAnchor: 0, message: "", earlierMessages: List() }
pure val noTerms: Terms = { caseId: 0, project: 0, finding: 0, payerActor: 0, reporterActor: 0, network: Base,
  asset: "", feeWallet: "", gross: M::zero, split: T::StandardSplit }
pure val noRetirement: Retirement = { kind: Unverified, generation: 0, lane: Researcher, nonce: -1, message: "",
  coveredMessages: List(), height: 0, observation: "", certified: false, lowerSettled: false }
pure val noTransfer: Transfer = { lane: Researcher, network: Base, asset: "", payerAddress: "", researcherAddress: "",
  feeAddress: "", principal: M::zero, fee: M::zero, transaction: "", nonce: -1, message: "", height: 0,
  finalized: false, succeeded: false, exact: false }
pure val initial: DirectBounty = { admitted: false, terms: noTerms, caseRevision: 0, payerWallet: noWallet, reporterWallet: noWallet,
  consent: noWallet, visibleConsent: false, intent: noIntent, priorIntents: List(),
  researcherReceipt: noTransfer, feeReceipt: noTransfer, otherUses: List() }
pure def validWallet(wallet: Wallet): bool = wallet.claim > 0 and wallet.address != "" and wallet.digest != ""
pure def validTerms(terms: Terms): bool = terms.caseId > 0 and terms.project > 0 and terms.finding > 0
  and terms.payerActor > 0 and terms.reporterActor > 0 and terms.payerActor != terms.reporterActor and terms.asset != ""
  and terms.feeWallet != "" and M::validAmount(terms.gross) and M::positiveAmount(terms.gross) and M::privateSplitPossible(terms.gross)
  and terms.split == T::StandardSplit
pure def approvalMatches(terms: Terms, caseVersion: int, approval: CaseApproval, route: QualifiedRoute): bool =
  approval.direct and approval.split == T::StandardSplit and approval.caseId == terms.caseId and approval.caseRevision == caseVersion
    and approval.rootCause == terms.finding and approval.asset == terms.asset and M::equalAmounts(approval.gross, terms.gross)
    and route.network == terms.network and route.asset == terms.asset and route.feeWallet == terms.feeWallet
pure def canAdmit(b: DirectBounty, terms: Terms, caseVersion: int, approval: CaseApproval, route: QualifiedRoute): bool =
  not(b.admitted) and validTerms(terms) and caseVersion > 0 and approvalMatches(terms, caseVersion, approval, route)
pure def admit(b: DirectBounty, terms: Terms, caseVersion: int, approval: CaseApproval, route: QualifiedRoute): DirectBounty =
  { ...b, admitted: true, terms: terms, caseRevision: caseVersion }
pure def lawFullAwardNeverAdmitted(terms: Terms, caseVersion: int, approval: CaseApproval, route: QualifiedRoute): bool =
  (approval.split == T::FullAward or terms.split == T::FullAward) implies
    not(validTerms(terms) and approvalMatches(terms, caseVersion, approval, route))
pure def lawOnlyDirectCommitmentAdmitted(terms: Terms, caseVersion: int, c: C::PrivateCase, route: QualifiedRoute): bool =
  approvalMatches(terms, caseVersion, caseApproval(terms.caseId, c), route) implies
    c.award == C::Approved and c.commitment == C::DirectAward and c.terms.split == T::StandardSplit
pure def canObserveCaseRevision(b: DirectBounty, caseVersion: int): bool = b.admitted and caseVersion > b.caseRevision
pure def observeCaseRevision(b: DirectBounty, caseVersion: int): DirectBounty = { ...b, caseRevision: caseVersion }
pure def canObserveWallets(b: DirectBounty, payerWallet: Wallet, reporterWallet: Wallet, authorizedRead: bool): bool =
  b.admitted and authorizedRead and (payerWallet == noWallet or validWallet(payerWallet))
    and (reporterWallet == noWallet or validWallet(reporterWallet))
    and (payerWallet != b.payerWallet or reporterWallet != b.reporterWallet)
pure def observeWallets(b: DirectBounty, payerWallet: Wallet, reporterWallet: Wallet, authorizedRead: bool): DirectBounty =
  { ...b, payerWallet: payerWallet, reporterWallet: reporterWallet }
pure def canConsent(b: DirectBounty, wallet: Wallet, observedRevision: int, chainVisibility: bool, by: int): bool = b.admitted
  and observedRevision == b.caseRevision
  and by == b.terms.reporterActor and b.researcherReceipt.transaction == ""
  and validWallet(wallet) and wallet == b.reporterWallet and chainVisibility
  and (not(b.intent.active) or (wallet.address != b.intent.payer.address and wallet.address != b.terms.feeWallet))
  and (not(b.visibleConsent) or b.consent != wallet)
pure def consent(b: DirectBounty, wallet: Wallet, observedRevision: int, chainVisibility: bool, by: int): DirectBounty =
  { ...b, consent: wallet, visibleConsent: true, caseRevision: b.caseRevision + 1 }
pure def scopedWallets(terms: Terms, payer: Wallet, reporter: Wallet): bool = validWallet(payer) and validWallet(reporter)
  and payer.address != reporter.address and payer.address != terms.feeWallet and reporter.address != terms.feeWallet
pure def authorizedWallets(b: DirectBounty, intent: Intent): bool = b.visibleConsent
  and b.consent == intent.reporter and b.reporterWallet == intent.reporter and b.payerWallet == intent.payer
  and scopedWallets(b.terms, intent.payer, intent.reporter)
pure def wellFormedIntent(terms: Terms, intent: Intent): bool = intent.active and intent.generation >= 0
  and scopedWallets(terms, intent.payer, intent.reporter) and intent.researcherAnchor >= 0 and intent.feeAnchor >= 0
  and (if (terms.network == Solana) intent.message != "" and intent.feeNonce == -1 and intent.researcherNonce == -1
      and intent.researcherAnchor == intent.feeAnchor
      and intent.earlierMessages.every(retainedMessage => retainedMessage != "" and retainedMessage != intent.message)
    else intent.message == "" and intent.earlierMessages.length() == 0 and intent.feeNonce >= 0 and intent.researcherNonce >= 0 and intent.researcherNonce != intent.feeNonce)
pure def canPrepare(b: DirectBounty, intent: Intent, observedRevision: int, proofAvailable: bool, nonceReserved: bool, by: int): bool =
  b.admitted and not(b.intent.active) and by == b.terms.payerActor and observedRevision == b.caseRevision and proofAvailable
    and wellFormedIntent(b.terms, intent) and authorizedWallets(b, intent) and intent.generation == 0
    and (b.terms.network == Solana or (nonceReserved and intent.researcherNonce - intent.feeNonce == 1))
pure def prepare(b: DirectBounty, intent: Intent, observedRevision: int, proofAvailable: bool, nonceReserved: bool, by: int): DirectBounty =
  { ...b, intent: intent, caseRevision: b.caseRevision + 1 }
```

### Each finalized transaction belongs to one ledger and one exact request

A receipt keeps the transaction identity, chain, asset, payer, finalized height,
success and exact transfers. EVM records the receiving leg separately, using
its retained nonce and minimum height. A Solana signature matches the exact
retained message and proves the complete transfer bundle. An exact transfer to
the original reporter remains verifiable after that reporter changes wallet.
The storage operation checks the current case revision and journal generation
and consumes an unused canonical transaction identity in the same commit. EVM
may verify both untouched legs in one case write. Every successful case write
advances the revision so a late concurrent write must reread it. An
ordinary transfer or receipt already owned by another case cannot be credited
again. Receipt identifiers are normalized by the chain adapter before ingestion.

```quint
pure def matchesIntent(terms: Terms, intent: Intent, transfer: Transfer): bool = intent.active
  and transfer.network == terms.network and transfer.asset == terms.asset and transfer.payerAddress == intent.payer.address
  and transfer.transaction != "" and transfer.finalized and transfer.succeeded and transfer.exact
  and (if (terms.network == Solana) transfer.lane == Both and (transfer.message == intent.message or intent.earlierMessages.includes(transfer.message))
    and transfer.nonce == -1 and transfer.height > intent.researcherAnchor and transfer.height > intent.feeAnchor
    and transfer.researcherAddress == intent.reporter.address and transfer.feeAddress == terms.feeWallet
    and M::equalAmounts(transfer.principal, M::privateResearcherAmount(terms.gross))
    and M::equalAmounts(transfer.fee, M::privateFeeAmount(terms.gross))
  else if (transfer.lane == Researcher) transfer.message == "" and transfer.nonce == intent.researcherNonce
    and transfer.height > intent.researcherAnchor and transfer.researcherAddress == intent.reporter.address and transfer.feeAddress == ""
    and M::equalAmounts(transfer.principal, M::privateResearcherAmount(terms.gross)) and M::equalAmounts(transfer.fee, M::zero)
  else transfer.lane == Fee and transfer.message == "" and transfer.nonce == intent.feeNonce
    and transfer.height > intent.feeAnchor and transfer.researcherAddress == "" and transfer.feeAddress == terms.feeWallet
    and M::equalAmounts(transfer.principal, M::zero) and M::equalAmounts(transfer.fee, M::privateFeeAmount(terms.gross)))
pure def used(b: DirectBounty, network: Network, transaction: str): bool =
  (b.terms.network == network and (b.researcherReceipt.transaction == transaction or b.feeReceipt.transaction == transaction))
    or b.otherUses.some(entry => entry.network == network and entry.transaction == transaction)
pure def canRecordOtherUse(b: DirectBounty, use: TxUse, authenticatedUse: bool): bool = authenticatedUse
  and use.transaction != "" and not(used(b, use.network, use.transaction))
pure def recordOtherUse(b: DirectBounty, use: TxUse, authenticatedUse: bool): DirectBounty =
  { ...b, otherUses: b.otherUses.append(use) }
pure def canRecordTransfer(b: DirectBounty, transfer: Transfer, observedRevision: int, generation: int, verifiedApprover: bool): bool =
  b.admitted and b.intent.active and observedRevision == b.caseRevision and generation == b.intent.generation and verifiedApprover
    and M::validAmount(transfer.principal) and M::validAmount(transfer.fee) and matchesIntent(b.terms, b.intent, transfer)
    and not(used(b, transfer.network, transfer.transaction))
    and (transfer.lane == Fee or b.researcherReceipt.transaction == "") and (transfer.lane == Researcher or b.feeReceipt.transaction == "")
pure def recordTransfer(b: DirectBounty, transfer: Transfer, observedRevision: int, generation: int, verifiedApprover: bool): DirectBounty =
  { ...b, caseRevision: b.caseRevision + 1, researcherReceipt: if (transfer.lane == Fee) b.researcherReceipt else transfer,
    feeReceipt: if (transfer.lane == Researcher) b.feeReceipt else transfer }
pure def canRecordPair(b: DirectBounty, pair: ReceiptPair, observedRevision: int, generation: int, verifiedApprover: bool): bool =
  b.terms.network != Solana and pair.researcher.lane == Researcher and pair.fee.lane == Fee
    and pair.researcher.transaction != pair.fee.transaction
    and canRecordTransfer(b, pair.researcher, observedRevision, generation, verifiedApprover)
    and canRecordTransfer(b, pair.fee, observedRevision, generation, verifiedApprover)
pure def recordPair(b: DirectBounty, pair: ReceiptPair, observedRevision: int, generation: int, verifiedApprover: bool): DirectBounty =
  { ...b, caseRevision: b.caseRevision + 1, researcherReceipt: pair.researcher, feeReceipt: pair.fee }
pure def paid(b: DirectBounty): bool = b.researcherReceipt.transaction != "" and b.feeReceipt.transaction != ""
pure def heldResearcher(b: DirectBounty): bool = b.intent.active and b.researcherReceipt.transaction == "" and b.reporterWallet != b.intent.reporter
pure def pendingResearcherRequest(b: DirectBounty): bool = b.intent.active and b.terms.network != Solana and b.researcherReceipt.transaction == ""
  and not(heldResearcher(b)) and validWallet(b.payerWallet) and b.payerWallet.address == b.intent.payer.address
pure def pendingFeeRequest(b: DirectBounty): bool = b.intent.active and b.terms.network != Solana and b.feeReceipt.transaction == ""
  and validWallet(b.payerWallet) and b.payerWallet.address == b.intent.payer.address
pure def pendingBundleRequest(b: DirectBounty): bool = b.intent.active and b.terms.network == Solana
  and b.researcherReceipt.transaction == "" and b.feeReceipt.transaction == "" and not(heldResearcher(b))
  and validWallet(b.payerWallet) and b.payerWallet.address == b.intent.payer.address
pure def receivedFee(b: DirectBounty): M::Amount = if (b.feeReceipt.transaction == "") M::zero else b.feeReceipt.fee
```

### A recovered request changes only an unpaid leg after exact retirement

An EVM replacement changes the selected unpaid nonce and keeps the other
leg's bytes and anchor. The original payer must still be authorized on the
same address. The current reporter must authorize the successor destination
if the researcher transfer changes. A fee-only replacement does not require
the reporter's current wallet. A finalized same-nonce cancellation or reverted
transaction must prove retirement, after lower transactions no longer block
that nonce. A renewed claim for the same address can retain the exact EVM
request when the source decides that no retirement is required. Older wallet
claims do not authorize presenting a new send. A Solana replacement retires
all issued messages of the old generation. Finalized absence requires both
trusted histories and the old payer's exact-message signatures. Missing
evidence, an unexpired message or a discovered payment cannot retire an old
request. Retirement attached to a different generation is refused.

```quint
pure def sameResearcherLeg(a: Intent, b: Intent): bool = a.reporter == b.reporter
  and a.researcherNonce == b.researcherNonce and a.researcherAnchor == b.researcherAnchor
pure def sameFeeLeg(a: Intent, b: Intent): bool = a.feeNonce == b.feeNonce and a.feeAnchor == b.feeAnchor
pure def freshNonce(b: DirectBounty, nonce: int): bool = nonce > b.intent.feeNonce and nonce > b.intent.researcherNonce
  and b.priorIntents.every(prior => nonce > prior.intent.feeNonce and nonce > prior.intent.researcherNonce)
pure def freshMessage(b: DirectBounty, message: str): bool = message != b.intent.message and not(b.intent.earlierMessages.includes(message))
  and b.priorIntents.every(prior => message != prior.intent.message and not(prior.intent.earlierMessages.includes(message)))
pure def canRecover(b: DirectBounty, successor: Intent, retirement: Retirement, observedRevision: int, nonceReserved: bool, by: int): bool =
  b.admitted and b.intent.active and by == b.terms.payerActor and observedRevision == b.caseRevision
    and retirement.generation == b.intent.generation and successor.generation == b.intent.generation + 1
    and wellFormedIntent(b.terms, successor) and successor.payer == b.intent.payer
    and validWallet(b.payerWallet) and b.payerWallet.address == b.intent.payer.address and retirement.certified
    and (if (b.terms.network == Solana) retirement.lane == Both and retirement.kind == SolanaRetired
      and b.researcherReceipt.transaction == "" and b.feeReceipt.transaction == ""
      and retirement.message == b.intent.message and retirement.coveredMessages == b.intent.earlierMessages.append(b.intent.message)
      and freshMessage(b, successor.message) and successor.earlierMessages.length() == 0
      and retirement.observation != "" and retirement.height > b.intent.researcherAnchor
      and successor.researcherAnchor >= retirement.height and b.visibleConsent and b.consent == successor.reporter and b.reporterWallet == successor.reporter
    else if (retirement.lane == Fee) b.feeReceipt.transaction == "" and retirement.kind == EvmRetired
      and retirement.nonce == b.intent.feeNonce and retirement.height > b.intent.feeAnchor
      and retirement.observation != "" and retirement.lowerSettled and nonceReserved
      and freshNonce(b, successor.feeNonce) and successor.feeAnchor >= retirement.height and sameResearcherLeg(successor, b.intent)
    else retirement.lane == Researcher and b.researcherReceipt.transaction == ""
      and b.visibleConsent and b.consent == successor.reporter and b.reporterWallet == successor.reporter
      and sameFeeLeg(successor, b.intent)
      and (if (retirement.kind == SameRequest) successor.reporter != b.intent.reporter
        and successor.reporter.address == b.intent.reporter.address and successor.researcherNonce == b.intent.researcherNonce
        and successor.researcherAnchor == b.intent.researcherAnchor
      else retirement.kind == EvmRetired and retirement.nonce == b.intent.researcherNonce and retirement.lowerSettled
        and retirement.height > b.intent.researcherAnchor and retirement.observation != "" and nonceReserved
        and freshNonce(b, successor.researcherNonce) and successor.researcherAnchor >= retirement.height))
pure def recover(b: DirectBounty, successor: Intent, retirement: Retirement, observedRevision: int, nonceReserved: bool, by: int): DirectBounty =
  { ...b, intent: successor, caseRevision: b.caseRevision + 1, priorIntents: b.priorIntents.append({ intent: b.intent, retirement: retirement }) }
```

### Paid legs and prior intent generations remain permanent

Settled amounts and transaction identities come from the journal. Show only
unpaid payment actions; an old reporter wallet holds the researcher action but
does not hide an independently actionable EVM fee. Wallet prompts additionally
check current chain and exact pending nonce. The unsigned request remains
visible while an earlier nonce is pending, but the wallet prompt cannot start. Only both settled amounts produce
paid. The fee amount is available to received-fee accounting once its exact
leg has been recorded. It never authorizes fees or sends by the application.

```quint
pure def alwaysUnadmittedEmpty(b: DirectBounty): bool = not(b.admitted) implies not(b.intent.active)
  and b.researcherReceipt == noTransfer and b.feeReceipt == noTransfer
pure def alwaysAdmittedTerms(b: DirectBounty): bool = b.admitted implies validTerms(b.terms) and b.caseRevision > 0
pure def alwaysIntentBound(b: DirectBounty): bool = b.intent.active implies b.admitted and wellFormedIntent(b.terms, b.intent)
pure def alwaysResearcherReceipt(b: DirectBounty): bool = b.researcherReceipt.transaction != "" implies
  b.intent.active and b.researcherReceipt.lane != Fee and M::validAmount(b.researcherReceipt.principal)
  and M::validAmount(b.researcherReceipt.fee) and matchesIntent(b.terms, b.intent, b.researcherReceipt)
pure def alwaysFeeReceipt(b: DirectBounty): bool = b.feeReceipt.transaction != "" implies
  b.intent.active and b.feeReceipt.lane != Researcher and M::validAmount(b.feeReceipt.principal)
  and M::validAmount(b.feeReceipt.fee) and matchesIntent(b.terms, b.intent, b.feeReceipt)
pure def alwaysSolanaReceiptAtomic(b: DirectBounty): bool = b.terms.network == Solana implies b.researcherReceipt == b.feeReceipt
pure def alwaysIndependentReceiptIds(b: DirectBounty): bool = b.terms.network != Solana and paid(b) implies
  b.researcherReceipt.transaction != b.feeReceipt.transaction
pure def alwaysNoOtherTransactionReuse(b: DirectBounty): bool = b.otherUses.every(entry => entry.transaction != ""
  and (entry.network != b.terms.network or
    (entry.transaction != b.researcherReceipt.transaction and entry.transaction != b.feeReceipt.transaction)))
pure def stepTermsUnchanged(before: DirectBounty, after: DirectBounty): bool = before.admitted implies
  after.admitted and after.terms == before.terms and after.caseRevision >= before.caseRevision
pure def stepPaidLegsUnchanged(before: DirectBounty, after: DirectBounty): bool =
  (before.researcherReceipt.transaction != "" implies after.researcherReceipt == before.researcherReceipt)
  and (before.feeReceipt.transaction != "" implies after.feeReceipt == before.feeReceipt)
pure def stepIntentHistory(before: DirectBounty, via: str, after: DirectBounty): bool =
  val archive = after.priorIntents.nthOr(before.priorIntents.length(), { intent: after.intent, retirement: noRetirement })
  if (via == "recover") after.priorIntents == before.priorIntents.append(archive) and archive.intent == before.intent
    and archive.retirement.certified and archive.retirement.generation == before.intent.generation
    and after.intent.generation == before.intent.generation + 1
  else after.priorIntents == before.priorIntents and (before.intent.active implies after.intent == before.intent)
pure def sometimesPartialFee(b: DirectBounty): bool = b.feeReceipt.transaction != "" and b.researcherReceipt.transaction == ""
pure def sometimesPartialResearcher(b: DirectBounty): bool = b.researcherReceipt.transaction != "" and b.feeReceipt.transaction == ""
pure def sometimesPaidEvm(b: DirectBounty): bool = paid(b) and b.terms.network != Solana
pure def sometimesPaidSolana(b: DirectBounty): bool = paid(b) and b.terms.network == Solana
pure def sometimesHeld(b: DirectBounty): bool = heldResearcher(b)
pure def sometimesRecovered(b: DirectBounty): bool = b.intent.generation > 0
```

### Simulation covers both payment shapes and conflicting evidence

The sampled input records exercise same-address claim changes, old-wallet
finalized evidence and both orders of receipt arrival.

```quint
pure val payerOne: Wallet = { claim: 1, address: "payer", digest: "payer-proof" }
pure val reporterOne: Wallet = { claim: 1, address: "reporter", digest: "reporter-proof" }
pure val reporterTwo: Wallet = { claim: 2, address: "new-reporter", digest: "new-proof" }
pure val termsEvm: Terms = { caseId: 1, project: 1, finding: 1, payerActor: 1, reporterActor: 2,
  network: Base, asset: "asset", feeWallet: "fees", gross: List(100), split: T::StandardSplit }
pure val termsSolana: Terms = { ...termsEvm, network: Solana }
pure val evmIntent: Intent = { active: true, generation: 0, payer: payerOne, reporter: reporterOne,
  researcherNonce: 1, feeNonce: 0, researcherAnchor: 1, feeAnchor: 1, message: "", earlierMessages: List() }
pure val solanaIntent: Intent = { ...evmIntent, researcherNonce: -1, feeNonce: -1, message: "message" }
pure val researcherTransfer: Transfer = { ...noTransfer, asset: "asset", payerAddress: "payer", researcherAddress: "reporter",
  principal: List(75), transaction: "researcher-tx", nonce: 1, height: 2, finalized: true, succeeded: true, exact: true }
pure val feeTransfer: Transfer = { ...researcherTransfer, lane: Fee, researcherAddress: "", feeAddress: "fees", principal: List(0),
  fee: List(25), transaction: "fee-tx", nonce: 0 }
pure val bundledTransfer: Transfer = { ...researcherTransfer, lane: Both, network: Solana, feeAddress: "fees",
  fee: List(25), message: "message", transaction: "bundle-tx", nonce: -1 }
pure val nextResearcherIntent: Intent = { ...evmIntent, generation: 1, reporter: reporterTwo, researcherNonce: 2, researcherAnchor: 2 }
pure val nextFeeIntent: Intent = { ...evmIntent, generation: 1, feeNonce: 2, feeAnchor: 2 }
pure val nextSolanaIntent: Intent = { ...solanaIntent, generation: 1, reporter: reporterTwo, researcherAnchor: 2, feeAnchor: 2, message: "new-message" }
pure val researcherRetirement: Retirement = { kind: EvmRetired, generation: 0, lane: Researcher, nonce: 1, message: "", height: 2,
  observation: "retirement", certified: true, lowerSettled: true, coveredMessages: List() }
pure val feeRetirement: Retirement = { ...researcherRetirement, lane: Fee, nonce: 0 }
pure val solanaRetirement: Retirement = { ...researcherRetirement, kind: SolanaRetired, lane: Both, nonce: -1, message: "message", coveredMessages: List("message") }
pure val termsValues = Set(termsEvm).union(Set(termsSolana)).union(Set(noTerms))
pure val walletValues = Set(reporterOne).union(Set(reporterTwo))
pure val payerWalletValues = Set(payerOne).union(Set(noWallet))
pure val reporterWalletValues = Set(reporterOne).union(Set(reporterTwo)).union(Set(noWallet))
pure val intentValues = Set(evmIntent).union(Set(solanaIntent)).union(Set(noIntent))
pure val successorValues = Set(nextResearcherIntent).union(Set(nextFeeIntent)).union(Set(nextSolanaIntent))
pure val retirementValues = Set(researcherRetirement).union(Set(feeRetirement)).union(Set(solanaRetirement))
pure val transferValues = Set(researcherTransfer).union(Set(feeTransfer)).union(Set(bundledTransfer)).union(Set({ ...researcherTransfer, finalized: false }))
pure val useValues = Set({ network: Base, transaction: "other-tx" }, { network: Base, transaction: "fee-tx" })
pure val pairValues = Set({ researcher: researcherTransfer, fee: feeTransfer }, { researcher: researcherTransfer, fee: researcherTransfer })
pure val caseVersionValues = Set(1, 2)
pure val directCase: C::PrivateCase = { ...C::initial, submission: C::Verified, terms: T::standardTerms, revision: 1, award: C::Approved,
  commitment: C::DirectAward, grossChosen: List(100), rootCause: 1 }
pure val cValues = Set(C::initial, directCase, { ...directCase, terms: T::fullTerms, commitment: C::FullAwardHeld })
pure val directApproval: CaseApproval = { caseId: 1, caseRevision: 1, direct: true, split: T::StandardSplit, gross: List(100), asset: "asset", rootCause: 1 }
pure val approvalValues = Set(directApproval, { ...directApproval, caseRevision: 2 }, { ...directApproval, split: T::FullAward })
pure val routeValues = Set({ network: Base, asset: "asset", feeWallet: "fees" }, { network: Solana, asset: "asset", feeWallet: "fees" })
pure val observedRevisionValues = Set(1, 2, 3, 4, 5, 6, 7)
pure val generationValues = Set(0, 1)
pure val byValues = Set(1, 2)
pure val weight_admit = 10
pure val weight_observeWallets = 9
pure val weight_consent = 12
pure val weight_prepare = 15
pure val weight_recordTransfer = 22
pure val weight_recordPair = 12
pure val weight_recover = 14
```
