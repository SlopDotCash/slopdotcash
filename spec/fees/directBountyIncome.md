# Direct private award income recognition

PRD section 8 requires the exact fee of a standard direct award to reach
received-fee accounting. Section 6 BUY-01 includes completed direct-award
fees in cumulative qualifying income from the activation instant. The
[direct award journal](../settlement/directBounty.md) owns both exact receipts
and whether the award is complete. This handoff owns recognition of
the fee. It does not own payment completion, token conversion, or a spend.

At Slop development `d6c44489cd5a4ff687f1ef406991aaf9b28b7b64`,
`backend/security/direct-payments.ts:799–884` records each finalized EVM leg
before aggregate completion. For Solana the exact bundle is one receipt.
`workers/fee-converter/store.ts:419–449,569–575` uses completed awards in fee
balance and historical asset discovery. `workers/fee-converter/buyback-store.ts:59–91`
also requires completion, then compares the initial `prepared_at` with the
cutover. Preparation proves when the intent was written. The operational
`verified_at` proves when evidence was recorded. To enforce the PRD exclusion
of earlier income, this handoff requires independently verified canonical
chain timestamps for the actual receipt or bundle. The two historical clock
fields remain individually visible for conformance review. In particular, a
pre-cutover intent with post-cutover receipts can pass the PRD rule while the
pinned worker's preparation filter would omit it. No production policy or
activation change follows from this specification.

## Story: Distinguish funds received from income booked for a completed direct award

### Only an exact durable journal receipt identifies received cash

The fee transfer or Solana bundle names the final transaction, exact network,
asset, wallet and full-width amount. It can identify cash while the EVM
researcher leg is outstanding. Unavailable or unauthenticated journal data
leaves the cash evidence unknown. Historical amounts come from retained award
terms and receipts instead of the mutable public offer. A zero-valued or
unrelated transfer supplies no direct fee income.

```quint
import money as M from "../settlement/money"
import directBounty as D from "../settlement/directBounty"
type CashStatus = UnknownCash | NoFeeReceipt | FeeReceived
type BookingStatus = UnknownBooking | AwaitingCompletion | CompletedBeforeCutover | CompletedEligible
type TimedReceipt = { network: D::Network, transaction: str, height: int, chainTime: int, authenticated: bool }
type AwardTimes = { originalPreparedAt: int, aggregateVerifiedAt: int, feeTime: TimedReceipt, researcherTime: TimedReceipt }
type FeeFact = { status: CashStatus, sourceKey: D::TxUse, caseId: int, asset: str, wallet: str, amount: M::Amount, height: int }
type Recognition = { sourceKey: D::TxUse, caseId: int, asset: str, wallet: str, amount: M::Amount,
  researcherTx: str, feeHeight: int, feeChainTime: int, researcherChainTime: int, completeAt: int,
  originalPreparedAt: int, aggregateVerifiedAt: int }
type FeeJournal = { received: List[FeeFact], entries: List[Recognition] }
pure val initial: FeeJournal = { received: List(), entries: List() }
pure val buybackCutover: int = 1794441600000
pure val noKey: D::TxUse = { network: D::Base, transaction: "" }
pure val noFee: FeeFact = { status: NoFeeReceipt, sourceKey: noKey, caseId: 0, asset: "", wallet: "", amount: M::zero, height: 0 }
pure def exactPositiveFee(bounty: D::DirectBounty): bool = bounty.admitted and bounty.intent.active
  and D::validTerms(bounty.terms) and D::wellFormedIntent(bounty.terms, bounty.intent)
  and bounty.feeReceipt.transaction != "" and D::alwaysFeeReceipt(bounty) and D::alwaysSolanaReceiptAtomic(bounty)
  and D::alwaysIndependentReceiptIds(bounty) and D::alwaysNoOtherTransactionReuse(bounty)
  and M::positiveAmount(bounty.feeReceipt.fee)
pure def cashFact(bounty: D::DirectBounty, authenticatedJournal: bool): FeeFact =
  if (not(authenticatedJournal)) { ...noFee, status: UnknownCash }
  else if (exactPositiveFee(bounty))
    { status: FeeReceived, sourceKey: { network: bounty.terms.network, transaction: bounty.feeReceipt.transaction },
      caseId: bounty.terms.caseId, asset: bounty.terms.asset, wallet: bounty.terms.feeWallet, amount: bounty.feeReceipt.fee,
      height: bounty.feeReceipt.height }
  else if (bounty.feeReceipt.transaction == "") noFee
  else { ...noFee, status: UnknownCash }
```

### Booking uses the exact completed journal and both canonical timestamps

A current authorized journal read must prove both complete legs. EVM uses two
independent canonical receipts. Solana repeats the same bundle evidence for
the two legs and counts it once. Chain evidence binds each observed time to
its exact verified transaction and finalized height. Both the fee receipt and
completion must belong to the activation interval. An older fee is excluded
even if its case completes or is recorded after activation. An authenticated
preparation time and aggregate verification time remain historical comparison
fields. Neither can make an earlier transfer eligible or substitute for
missing chain-time evidence. The model clock uses integer UTC epoch milliseconds.

```quint
pure def exactAwardComplete(bounty: D::DirectBounty): bool = exactPositiveFee(bounty)
  and D::paid(bounty) and D::alwaysResearcherReceipt(bounty)
pure def matchesTime(transfer: D::Transfer, observed: TimedReceipt): bool = observed.authenticated
  and transfer.network == observed.network and transfer.transaction == observed.transaction and transfer.height == observed.height
  and observed.chainTime > 0
pure def completionTime(timing: AwardTimes): int =
  if (timing.feeTime.chainTime >= timing.researcherTime.chainTime) timing.feeTime.chainTime else timing.researcherTime.chainTime
pure def completeTimeEvidence(bounty: D::DirectBounty, timing: AwardTimes): bool =
  matchesTime(bounty.feeReceipt, timing.feeTime) and matchesTime(bounty.researcherReceipt, timing.researcherTime)
    and (bounty.terms.network != D::Solana or timing.feeTime == timing.researcherTime)
    and timing.originalPreparedAt > 0 and timing.aggregateVerifiedAt >= timing.originalPreparedAt
pure def eligibleTime(timing: AwardTimes): bool = timing.feeTime.chainTime >= buybackCutover and completionTime(timing) >= buybackCutover
pure def bookingStatus(bounty: D::DirectBounty, timing: AwardTimes, authenticatedJournal: bool): BookingStatus =
  if (not(authenticatedJournal)) UnknownBooking
  else if (not(D::paid(bounty))) AwaitingCompletion
  else if (not(exactAwardComplete(bounty)) or not(completeTimeEvidence(bounty, timing))) UnknownBooking
  else if (eligibleTime(timing)) CompletedEligible else CompletedBeforeCutover
pure def pinnedPreparedFilter(bounty: D::DirectBounty, timing: AwardTimes, authenticatedJournal: bool): bool =
  authenticatedJournal and exactAwardComplete(bounty) and timing.originalPreparedAt >= buybackCutover
```

### One immutable receipt contributes its full amount to only its original asset and wallet

The fee journal records an exact cash receipt once, even before the award is
complete, and books that same receipt separately when the whole case and
cutover evidence qualify. `receivedFor` is an observation of cash received.
`incomeFor` supplies the completed post-cutover view. Never add the views.
Each journal accepts a canonical transaction once per network and one fee
per case. The same transaction identity can appear on different networks.
Exact chain and wallet canonicalization belongs to the observation adapter.
Query by network, asset and wallet. Never sum unlike assets, add gas top-ups,
or admit researcher principal. Assets eligible for buyback use the existing
buyback rules after this projection. An asset requiring conversion contributes
only its later verified conversion output to that buyback calculation. A
duplicate observation after acknowledgement loss is a readback of the original
record. It cannot repeat the credit or rewrite its evidence.

```quint
pure def candidateRecognition(bounty: D::DirectBounty, timing: AwardTimes): Recognition =
  { sourceKey: { network: bounty.terms.network, transaction: bounty.feeReceipt.transaction },
    caseId: bounty.terms.caseId, asset: bounty.terms.asset, wallet: bounty.terms.feeWallet, amount: bounty.feeReceipt.fee,
    researcherTx: bounty.researcherReceipt.transaction, feeHeight: bounty.feeReceipt.height, feeChainTime: timing.feeTime.chainTime,
    researcherChainTime: timing.researcherTime.chainTime, completeAt: completionTime(timing),
    originalPreparedAt: timing.originalPreparedAt, aggregateVerifiedAt: timing.aggregateVerifiedAt }
pure def sameCash(a: FeeFact, b: FeeFact): bool = a.status == FeeReceived and b.status == FeeReceived
  and a.sourceKey == b.sourceKey and a.caseId == b.caseId and a.asset == b.asset and a.wallet == b.wallet
  and M::equalAmounts(a.amount, b.amount) and a.height == b.height
pure def cashFromRecognition(row: Recognition): FeeFact = { status: FeeReceived, sourceKey: row.sourceKey,
  caseId: row.caseId, asset: row.asset, wallet: row.wallet, amount: row.amount, height: row.feeHeight }
pure def canRecordCash(j: FeeJournal, bounty: D::DirectBounty, authenticatedJournal: bool): bool =
  val fact = cashFact(bounty, authenticatedJournal)
  fact.status == FeeReceived and j.received.every(row => row.caseId != fact.caseId and row.sourceKey != fact.sourceKey)
pure def recordCash(j: FeeJournal, bounty: D::DirectBounty, authenticatedJournal: bool): FeeJournal =
  { ...j, received: j.received.append(cashFact(bounty, authenticatedJournal)) }
pure def canBook(j: FeeJournal, bounty: D::DirectBounty, timing: AwardTimes, authenticatedJournal: bool): bool =
  val wanted = candidateRecognition(bounty, timing)
  bookingStatus(bounty, timing, authenticatedJournal) == CompletedEligible
    and j.received.some(row => sameCash(row, cashFromRecognition(wanted)))
    and j.entries.every(row => row.caseId != wanted.caseId and row.sourceKey != wanted.sourceKey)
pure def book(j: FeeJournal, bounty: D::DirectBounty, timing: AwardTimes, authenticatedJournal: bool): FeeJournal =
  { ...j, entries: j.entries.append(candidateRecognition(bounty, timing)) }
pure def readback(j: FeeJournal, bounty: D::DirectBounty, timing: AwardTimes, authenticatedJournal: bool): bool =
  val wanted = candidateRecognition(bounty, timing)
  bookingStatus(bounty, timing, authenticatedJournal) == CompletedEligible
    and j.entries.some(row => row.sourceKey == wanted.sourceKey and row.caseId == wanted.caseId
      and row.asset == wanted.asset and row.wallet == wanted.wallet and M::equalAmounts(row.amount, wanted.amount)
      and row.researcherTx == wanted.researcherTx and row.feeHeight == wanted.feeHeight and row.feeChainTime == wanted.feeChainTime
      and row.researcherChainTime == wanted.researcherChainTime and row.completeAt == wanted.completeAt
      and row.originalPreparedAt == wanted.originalPreparedAt and row.aggregateVerifiedAt == wanted.aggregateVerifiedAt)
pure def receivedFor(j: FeeJournal, network: D::Network, asset: str, wallet: str): M::Amount =
  j.received.foldl(M::zero, (total, row) => if (row.sourceKey.network == network and row.asset == asset and row.wallet == wallet)
    M::addAmounts(total, row.amount) else total)
pure def incomeFor(j: FeeJournal, network: D::Network, asset: str, wallet: str): M::Amount =
  j.entries.foldl(M::zero, (total, row) => if (row.sourceKey.network == network and row.asset == asset and row.wallet == wallet)
    M::addAmounts(total, row.amount) else total)
pure def validRecognition(row: Recognition): bool = row.caseId > 0 and row.asset != "" and row.wallet != ""
  and row.sourceKey.transaction != "" and row.researcherTx != "" and row.feeHeight > 0 and M::validAmount(row.amount) and M::positiveAmount(row.amount)
  and row.feeChainTime >= buybackCutover and row.researcherChainTime > 0 and row.completeAt >= buybackCutover
  and row.completeAt == (if (row.feeChainTime >= row.researcherChainTime) row.feeChainTime else row.researcherChainTime)
  and ((row.sourceKey.network == D::Solana) == (row.sourceKey.transaction == row.researcherTx))
  and row.originalPreparedAt > 0 and row.aggregateVerifiedAt >= row.originalPreparedAt
pure def validCash(row: FeeFact): bool = row.status == FeeReceived and row.caseId > 0 and row.sourceKey.transaction != ""
  and row.asset != "" and row.wallet != "" and row.height > 0 and M::validAmount(row.amount) and M::positiveAmount(row.amount)
pure def alwaysReceivedVerifiable(j: FeeJournal): bool = j.received.every(row => validCash(row))
pure def alwaysQualifiedRecords(j: FeeJournal): bool = j.entries.every(row => validRecognition(row))
pure def alwaysBookingBackedByCash(j: FeeJournal): bool =
  j.entries.every(row => j.received.some(receipt => sameCash(receipt, cashFromRecognition(row))))
pure def stepEveryCashReceiptRetained(before: FeeJournal, after: FeeJournal): bool =
  before.received.every(row => after.received.includes(row))
pure def stepEveryRecognitionRetained(before: FeeJournal, after: FeeJournal): bool =
  before.entries.every(row => after.entries.includes(row))
pure def stepNewIdentity(before: FeeJournal, via: str, after: FeeJournal): bool =
  val added = after.entries.nthOr(before.entries.length(), noRecognition)
  val received = after.received.nthOr(before.received.length(), noFee)
  if (via == "book") after.received == before.received and after.entries == before.entries.append(added)
    and before.entries.every(row => row.caseId != added.caseId and row.sourceKey != added.sourceKey)
  else after.entries == before.entries and after.received == before.received.append(received)
    and before.received.every(row => row.caseId != received.caseId and row.sourceKey != received.sourceKey)
pure val noRecognition: Recognition = { sourceKey: noKey, caseId: 0, asset: "", wallet: "", amount: M::zero,
  researcherTx: "", feeHeight: 0, feeChainTime: 0, researcherChainTime: 0, completeAt: 0, originalPreparedAt: 0, aggregateVerifiedAt: 0 }
pure def sometimesReceivedOnly(j: FeeJournal): bool = j.received.length() > 0 and j.entries.length() == 0
pure def sometimesSeparateReceiptsBooked(j: FeeJournal): bool = j.entries.some(row => row.sourceKey.network != D::Solana)
pure def sometimesBundleBooked(j: FeeJournal): bool = j.entries.some(row => row.sourceKey.network == D::Solana)
pure def sometimesCrossCutoverPreparation(j: FeeJournal): bool = j.entries.some(row => row.originalPreparedAt < buybackCutover)
```

### Simulation covers both rails and both sides of the activation instant

These samples exercise separate receipts, a complete bundle, missing chain-time
evidence and a case prepared before cutover whose fee arrived after it. The
simulation inputs impose no bound on the values accepted by the rules.

```quint
pure val feeOnly: D::DirectBounty = { ...D::initial, admitted: true, terms: D::termsEvm, caseRevision: 4,
  payerWallet: D::payerOne, reporterWallet: D::reporterOne, consent: D::reporterOne, visibleConsent: true,
  intent: D::evmIntent, feeReceipt: D::feeTransfer }
pure val separatePaid: D::DirectBounty = { ...feeOnly, caseRevision: 5, researcherReceipt: D::researcherTransfer }
pure val bundledPaid: D::DirectBounty = { ...separatePaid, terms: { ...D::termsSolana, caseId: 2 }, intent: D::solanaIntent,
  researcherReceipt: D::bundledTransfer, feeReceipt: D::bundledTransfer }
pure val feeClock: TimedReceipt = { network: D::Base, transaction: "fee-tx", height: 2,
  chainTime: buybackCutover + 1, authenticated: true }
pure val researcherClock: TimedReceipt = { ...feeClock, transaction: "researcher-tx", chainTime: buybackCutover + 2 }
pure val bundleClock: TimedReceipt = { ...feeClock, network: D::Solana, transaction: "bundle-tx" }
pure val separateTimes: AwardTimes = { originalPreparedAt: buybackCutover - 1, aggregateVerifiedAt: buybackCutover + 3,
  feeTime: feeClock, researcherTime: researcherClock }
pure val bundleTimes: AwardTimes = { originalPreparedAt: buybackCutover - 1, aggregateVerifiedAt: buybackCutover + 3,
  feeTime: bundleClock, researcherTime: bundleClock }
pure val bountyValues = Set(D::initial).union(Set(feeOnly)).union(Set(separatePaid)).union(Set(bundledPaid))
pure val timingValues = Set(separateTimes).union(Set(bundleTimes)).union(Set({ ...separateTimes, feeTime: { ...feeClock, authenticated: false } }))
  .union(Set({ ...separateTimes, feeTime: { ...feeClock, chainTime: buybackCutover - 1 } }))
pure val weight_recordCash = 8
pure val weight_book = 8
```
