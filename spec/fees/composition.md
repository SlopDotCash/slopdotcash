# Received-fee flow composition

PRD section 6 "Received-fee handling" and "SLOP buyback and burn" require
every fee that reaches a network fee wallet to come from a settled source,
and every buyback income entry to come from a finalized USDC vault claim, a
finalized conversion output or a completed direct-award fee, each counted
once. This
machine composes the [conversion journal](./conversion.md) of one network fee
wallet, the [direct-award fee journal](./directBountyIncome.md) and the
[buyback bridge leg](./buyback.md) of the same network. It drives the
journal's receipt, run and settlement path and the buyback's income; the
other transitions stay with each machine. Accrued vault fees, including
unused-fund withdrawal fees, accrue in [escrow accounting](../settlement/escrow.md)
and enter the wallet only through the conversion journal's claim of a
reviewed vault, so they never arrive here as a transfer. No transition here
touches a contributor payment, signs anything the conversion journal would
not sign, or converts anything but fees already in the wallet.

## Story: Every fee receipt names one settled source

### A transfer enters the conversion journal only from a reconciled payout fee or a recorded direct-award fee

A reconciled vault payout fee is the exact fee leg of a payout the
[settlement composition](../settlement/composition.md) reconciled to this
fee wallet; its evidence comes from that journal's authenticated reader. A
direct-award fee must match a cash entry the direct-award fee journal
recorded for the same case with the same amount. Each receipt and each
direct-award case enters once. The entry records the source, token, asset
kind, amount and finalized chain time.

```quint
import runtime as R from "./runtime"
import conversion as CV from "./conversion"
import directBountyIncome as J from "./directBountyIncome"
import buyback as B from "./buyback"
import money as M from "../settlement/money"
import directBounty as D from "../settlement/directBounty"
type FeeSource = PayoutFee | DirectAwardFee
type SourceEvidence = { source: FeeSource, receipt: int, token: int, amount: int, chainTime: int, caseId: int, reconciled: bool }
type FeeEntry = { source: FeeSource, receipt: int, token: int, usdc: bool, amount: int, chainTime: int, caseId: int }
type Output = { row: int, output: int }
type Credit = { key: B::IncomeKey, amount: M::Amount }
type FeeFlow = { fee: CV::Fee, journal: J::FeeJournal, buyback: B::Buyback, entries: List[FeeEntry], outputs: List[Output], credits: List[Credit] }
pure val initial: FeeFlow = { fee: CV::initial, journal: J::initial, buyback: B::initial, entries: List(), outputs: List(), credits: List() }
pure def transferOf(evidence: SourceEvidence): CV::FinalizedTransfer =
  { receipt: evidence.receipt, token: evidence.token, amount: evidence.amount, toFeeWallet: true, sameAsset: true, finalized: true }
pure def cashMatches(s: FeeFlow, evidence: SourceEvidence): bool =
  s.journal.received.some(row => row.caseId == evidence.caseId and M::equalAmounts(row.amount, M::smallAmount(evidence.amount)))
pure def sourceAdmitted(s: FeeFlow, evidence: SourceEvidence): bool =
  if (evidence.source == PayoutFee) evidence.reconciled and evidence.caseId == 0
  else evidence.caseId > 0 and cashMatches(s, evidence)
    and not(s.entries.some(x => x.source == DirectAwardFee and x.caseId == evidence.caseId))
pure def canReceive(s: FeeFlow, evidence: SourceEvidence, by: R::Sender): bool =
  by == R::Worker and evidence.chainTime > 0 and sourceAdmitted(s, evidence)
    and not(s.entries.some(x => x.receipt == evidence.receipt)) and CV::canReceiveFee(s.fee, transferOf(evidence), R::Worker)
pure def receive(s: FeeFlow, evidence: SourceEvidence, by: R::Sender): FeeFlow =
  { ...s, fee: CV::receiveFee(s.fee, transferOf(evidence), R::Worker),
    entries: s.entries.append({ source: evidence.source, receipt: evidence.receipt, token: evidence.token,
      usdc: CV::holding(s.fee, evidence.token).asset == CV::TargetStable, amount: evidence.amount,
      chainTime: evidence.chainTime, caseId: evidence.caseId }) }
pure def alwaysEveryReceiptHasSource(s: FeeFlow): bool = s.fee.receipts.length() == s.entries.length()
  and s.fee.receipts.every(r => s.entries.some(e => e.receipt == r))
  and s.entries.every(e => e.receipt > 0 and e.amount > 0 and e.chainTime > 0
    and (e.source == PayoutFee implies e.caseId == 0) and (e.source == DirectAwardFee implies e.caseId > 0)
    and s.entries.select(x => x.receipt == e.receipt).length() == 1)
pure def sometimesDirectFeeReceived(s: FeeFlow): bool = s.entries.some(e => e.source == DirectAwardFee)
```

### The direct-award fee journal records and books from the settlement journal reader

Only the authenticated settlement journal reader, here the fee Worker's
read of it, records cash or books a completed award.

```quint
pure def readerOf(by: R::Sender): J::Reader = if (by == R::Worker) J::SettlementJournal else J::OtherReader
pure def canRecordCash(s: FeeFlow, bounty: D::DirectBounty, read: J::JournalRead, by: R::Sender): bool =
  J::canRecordCash(s.journal, bounty, read, readerOf(by))
pure def recordCash(s: FeeFlow, bounty: D::DirectBounty, read: J::JournalRead, by: R::Sender): FeeFlow =
  { ...s, journal: J::recordCash(s.journal, bounty, read, readerOf(by)) }
pure def canBook(s: FeeFlow, bounty: D::DirectBounty, timing: J::AwardTimes, read: J::JournalRead, by: R::Sender): bool =
  J::canBook(s.journal, bounty, timing, read, readerOf(by))
pure def book(s: FeeFlow, bounty: D::DirectBounty, timing: J::AwardTimes, read: J::JournalRead, by: R::Sender): FeeFlow =
  { ...s, journal: J::book(s.journal, bounty, timing, read, readerOf(by)) }
```

## Story: Convert received fees through the journal's own run

### The conversion run is the journal's, and a finalized conversion output is retained once

Publication, readiness, token discovery, the lease, evaluation, the native
reservation, signing, vault registration, accrual, claims and settlement
are the conversion journal's own guarded transitions. When a settlement
finalizes a conversion or a vault claim with a positive output, that row
and output are retained as the output's identity.

```quint
pure def canPublishWorker(s: FeeFlow, config: R::WorkerConfig, by: R::Sender): bool = CV::canPublishWorker(s.fee, config, by)
pure def publishWorker(s: FeeFlow, config: R::WorkerConfig, by: R::Sender): FeeFlow = { ...s, fee: CV::publishWorker(s.fee, config, by) }
pure def canSetReleaseVariable(s: FeeFlow, variable: bool, by: R::Sender): bool = CV::canSetReleaseVariable(s.fee, variable, by)
pure def setReleaseVariable(s: FeeFlow, variable: bool, by: R::Sender): FeeFlow = { ...s, fee: CV::setReleaseVariable(s.fee, variable, by) }
pure def canVerifyReadiness(s: FeeFlow, by: R::Sender): bool = CV::canVerifyReadiness(s.fee, by)
pure def verifyReadiness(s: FeeFlow, by: R::Sender): FeeFlow = { ...s, fee: CV::verifyReadiness(s.fee, by) }
pure def canAddToken(s: FeeFlow, asset: CV::HoldingKind, by: R::Sender): bool = CV::canAddToken(s.fee, asset, by)
pure def addToken(s: FeeFlow, asset: CV::HoldingKind, by: R::Sender): FeeFlow = { ...s, fee: CV::addToken(s.fee, asset, by) }
pure def canAcquireLease(s: FeeFlow, runId: int, trigger: CV::Trigger, by: R::Sender): bool = CV::canAcquireLease(s.fee, runId, trigger, by)
pure def acquireLease(s: FeeFlow, runId: int, trigger: CV::Trigger, by: R::Sender): FeeFlow = { ...s, fee: CV::acquireLease(s.fee, runId, trigger, by) }
pure def canEvaluate(s: FeeFlow, runId: int, quote: CV::Quote, by: R::Sender): bool = CV::canEvaluate(s.fee, runId, quote, by)
pure def evaluate(s: FeeFlow, runId: int, quote: CV::Quote, by: R::Sender): FeeFlow = { ...s, fee: CV::evaluate(s.fee, runId, quote, by) }
pure def canReserveGas(s: FeeFlow, runId: int, nonce: int, maximum: int, by: R::Sender): bool = CV::canReserveGas(s.fee, runId, nonce, maximum, by)
pure def reserveGas(s: FeeFlow, runId: int, nonce: int, maximum: int, by: R::Sender): FeeFlow = { ...s, fee: CV::reserveGas(s.fee, runId, nonce, maximum, by) }
pure def canSign(s: FeeFlow, runId: int, send: CV::SignedSend, by: R::Sender): bool = CV::canSign(s.fee, runId, send, by)
pure def sign(s: FeeFlow, runId: int, send: CV::SignedSend, by: R::Sender): FeeFlow = { ...s, fee: CV::sign(s.fee, runId, send, by) }
pure def canFinalizeSend(s: FeeFlow, runId: int, id: int, receipt: CV::SendReceipt, by: R::Sender): bool =
  CV::canFinalizeSend(s.fee, runId, id, receipt, by) and not(s.outputs.some(o => o.row == id))
pure def finalizeSend(s: FeeFlow, runId: int, id: int, receipt: CV::SendReceipt, by: R::Sender): FeeFlow =
  val after = CV::finalizeSend(s.fee, runId, id, receipt, by)
  val row = after.rows.nthOr(id - 1, CV::noRow)
  { ...s, fee: after, outputs: if ((row.kind == CV::Conversion or row.kind == CV::Claim) and row.state == CV::Finalized and row.output > 0)
      s.outputs.append({ row: id, output: row.output }) else s.outputs }
pure def canRegisterVault(s: FeeFlow, reviewed: CV::ReviewedVault, by: R::Sender): bool = CV::canRegisterVault(s.fee, reviewed, by)
pure def registerVault(s: FeeFlow, reviewed: CV::ReviewedVault, by: R::Sender): FeeFlow = { ...s, fee: CV::registerVault(s.fee, reviewed, by) }
pure def canAccrue(s: FeeFlow, accrual: CV::VaultAccrual, by: R::Sender): bool = CV::canAccrue(s.fee, accrual, by)
pure def accrue(s: FeeFlow, accrual: CV::VaultAccrual, by: R::Sender): FeeFlow = { ...s, fee: CV::accrue(s.fee, accrual, by) }
pure def canClaim(s: FeeFlow, runId: int, vaultClaim: CV::VaultClaim, by: R::Sender): bool = CV::canClaim(s.fee, runId, vaultClaim, by)
pure def claim(s: FeeFlow, runId: int, vaultClaim: CV::VaultClaim, by: R::Sender): FeeFlow = { ...s, fee: CV::claim(s.fee, runId, vaultClaim, by) }
pure def outputRow(s: FeeFlow, id: int): CV::Row = s.fee.rows.nthOr(id - 1, CV::noRow)
pure def alwaysOutputsOnce(s: FeeFlow): bool = s.outputs.every(o => o.row > 0 and o.output > 0
  and s.outputs.select(x => x.row == o.row).length() == 1
  and outputRow(s, o.row).id == o.row and outputRow(s, o.row).state == CV::Finalized and outputRow(s, o.row).output == o.output
  and (outputRow(s, o.row).kind == CV::Conversion or outputRow(s, o.row).kind == CV::Claim))
```

## Story: Count each buyback income once, from its own receipt

### Buyback income is a finalized USDC claim, a finalized conversion output or a booked direct-award fee

Payout fees accrue in the reviewed vaults and reach the fee wallet only
through the journal's claims, so a USDC payout fee counts as its finalized
claim of the network's USDC holding, for the claimed amount the receipt
proved. A fee in another token, a claim of one included, counts only as
its later conversion output. A direct-award fee counts only once its case
is booked as complete and eligible, and only when it arrived in USDC;
otherwise its conversion output counts. Each income key is the identity of
its own record: the journal row for a claim or a conversion output, the fee
receipt for a direct-award fee (`buyback-store.ts` `feeIncome`: live
finalized conversions into the token and claims of it, plus completed
direct-award fees). Only the fee Worker records income, on the buyback
instance of this wallet's network.

```quint
pure def entryFor(s: FeeFlow, feeReceipt: int): FeeEntry =
  s.entries.foldl({ source: PayoutFee, receipt: 0, token: 0, usdc: false, amount: 0, chainTime: 0, caseId: 0 },
    (found, e) => if (e.receipt == feeReceipt) e else found)
pure def outputFor(s: FeeFlow, id: int): Output = s.outputs.foldl({ row: 0, output: 0 }, (found, o) => if (o.row == id) o else found)
pure def booked(s: FeeFlow, caseId: int, amount: M::Amount): bool = s.journal.entries.some(row => row.caseId == caseId
  and row.sourceKey.network == s.fee.network and M::equalAmounts(row.amount, amount))
pure def credited(s: FeeFlow, key: B::IncomeKey): bool = s.credits.some(c => c.key == key)
pure def keyOf(kind: B::IncomeKind, network: R::Network, id: int): B::IncomeKey = { kind: kind, network: network, id: id }
pure def canAdvanceBuybackClock(s: FeeFlow, now: int, by: R::Sender): bool = by == R::Worker and B::canAdvanceClock(s.buyback, now, R::Worker)
pure def advanceBuybackClock(s: FeeFlow, now: int, by: R::Sender): FeeFlow = { ...s, buyback: B::advanceClock(s.buyback, now, R::Worker) }
pure def usdcClaimRow(s: FeeFlow, id: int): bool =
  outputRow(s, id).kind == CV::Claim and CV::holding(s.fee, outputRow(s, id).token).asset == CV::TargetStable
pure def canCreditClaim(s: FeeFlow, id: int, chainTime: int, by: R::Sender): bool =
  val o = outputFor(s, id)
  val key = keyOf(B::UsdcClaim, s.fee.network, id)
  by == R::Worker and s.fee.network == s.buyback.source and o.row > 0 and usdcClaimRow(s, id) and not(credited(s, key))
    and B::canRecordIncome(s.buyback, key, M::smallAmount(o.output), chainTime, R::Worker)
pure def creditClaim(s: FeeFlow, id: int, chainTime: int, by: R::Sender): FeeFlow =
  val o = outputFor(s, id)
  val key = keyOf(B::UsdcClaim, s.fee.network, id)
  { ...s, buyback: B::recordIncome(s.buyback, key, M::smallAmount(o.output), chainTime, R::Worker),
    credits: s.credits.append({ key: key, amount: M::smallAmount(o.output) }) }
pure def canCreditConversion(s: FeeFlow, id: int, chainTime: int, by: R::Sender): bool =
  val o = outputFor(s, id)
  val key = keyOf(B::ConversionOutput, s.fee.network, id)
  by == R::Worker and s.fee.network == s.buyback.source and o.row > 0 and outputRow(s, id).kind == CV::Conversion and not(credited(s, key))
    and B::canRecordIncome(s.buyback, key, M::smallAmount(o.output), chainTime, R::Worker)
pure def creditConversion(s: FeeFlow, id: int, chainTime: int, by: R::Sender): FeeFlow =
  val o = outputFor(s, id)
  val key = keyOf(B::ConversionOutput, s.fee.network, id)
  { ...s, buyback: B::recordIncome(s.buyback, key, M::smallAmount(o.output), chainTime, R::Worker),
    credits: s.credits.append({ key: key, amount: M::smallAmount(o.output) }) }
pure def canCreditDirectFee(s: FeeFlow, feeReceipt: int, chainTime: int, by: R::Sender): bool =
  val e = entryFor(s, feeReceipt)
  val key = keyOf(B::DirectFee, s.fee.network, feeReceipt)
  by == R::Worker and s.fee.network == s.buyback.source and e.receipt > 0 and e.source == DirectAwardFee and e.usdc
    and booked(s, e.caseId, M::smallAmount(e.amount)) and chainTime == e.chainTime and not(credited(s, key))
    and B::canRecordIncome(s.buyback, key, M::smallAmount(e.amount), chainTime, R::Worker)
pure def creditDirectFee(s: FeeFlow, feeReceipt: int, chainTime: int, by: R::Sender): FeeFlow =
  val e = entryFor(s, feeReceipt)
  val key = keyOf(B::DirectFee, s.fee.network, feeReceipt)
  { ...s, buyback: B::recordIncome(s.buyback, key, M::smallAmount(e.amount), chainTime, R::Worker),
    credits: s.credits.append({ key: key, amount: M::smallAmount(e.amount) }) }
pure def backed(s: FeeFlow, credit: Credit): bool =
  if (credit.key.kind == B::ConversionOutput) outputRow(s, credit.key.id).kind == CV::Conversion
    and s.outputs.some(o => o.row == credit.key.id and M::equalAmounts(credit.amount, M::smallAmount(o.output)))
  else if (credit.key.kind == B::UsdcClaim) usdcClaimRow(s, credit.key.id)
    and s.outputs.some(o => o.row == credit.key.id and M::equalAmounts(credit.amount, M::smallAmount(o.output)))
  else credit.key.kind == B::DirectFee and s.entries.some(e => e.receipt == credit.key.id and e.usdc
    and M::equalAmounts(credit.amount, M::smallAmount(e.amount)) and e.source == DirectAwardFee)
pure def alwaysIncomeBackedByReceiptOrConversion(s: FeeFlow): bool = s.credits.every(c => backed(s, c))
  and s.buyback.sources.length() == s.credits.length() and s.credits.every(c => s.buyback.sources.includes(c.key))
  and s.buyback.income == s.credits.foldl(M::zero, (total, c) => M::addAmounts(total, c.amount))
pure def receiptKeyed(credit: Credit): bool = credit.key.kind == B::DirectFee
pure def rowKeyed(credit: Credit): bool = credit.key.kind == B::ConversionOutput or credit.key.kind == B::UsdcClaim
pure def alwaysNoReceiptCountedTwice(s: FeeFlow): bool = s.credits.every(c => s.credits.select(x => x.key == c.key).length() == 1
  and (receiptKeyed(c) implies s.credits.select(x => receiptKeyed(x) and x.key.id == c.key.id).length() == 1)
  and (rowKeyed(c) implies s.credits.select(x => rowKeyed(x) and x.key.id == c.key.id).length() == 1))
pure def sometimesUsdcFeeIncome(s: FeeFlow): bool = s.credits.some(c => c.key.kind == B::UsdcClaim)
pure def sometimesConversionIncome(s: FeeFlow): bool = s.credits.some(c => c.key.kind == B::ConversionOutput)
pure def sometimesDirectFeeIncome(s: FeeFlow): bool = s.credits.some(c => c.key.kind == B::DirectFee)
pure val evidenceValues = Set(
  { source: PayoutFee, receipt: 1, token: 1, amount: 1000000000, chainTime: B::buybackStart, caseId: 0, reconciled: true },
  { source: PayoutFee, receipt: 3, token: 2, amount: 1000000000, chainTime: B::buybackStart, caseId: 0, reconciled: true },
  { source: PayoutFee, receipt: 2, token: 1, amount: 1000000000, chainTime: B::buybackStart, caseId: 0, reconciled: false },
  { source: DirectAwardFee, receipt: 4, token: 1, amount: 25, chainTime: B::buybackStart + 1, caseId: 1, reconciled: true },
  { source: DirectAwardFee, receipt: 5, token: 1, amount: 26, chainTime: B::buybackStart + 1, caseId: 1, reconciled: true })
pure val feeReceiptValues = Set(1, 3, 4)
pure val reviewedValues = CV::reviewedValues
pure val accrualValues = CV::accrualValues
pure val vaultClaimValues = CV::vaultClaimValues
pure val chainTimeValues = Set(B::buybackStart - 1, B::buybackStart, B::buybackStart + 1)
pure val byValues = Set(R::Worker, R::ReleaseWorkflow, R::Owner)
pure val idValues = Set(1, 2)
pure val nowValues = Set(B::buybackStart + 1)
pure val bountyValues = Set(J::separatePaid)
pure val timingValues = Set(J::separateTimes)
pure val readValues = Set(J::CurrentRead)
pure val configValues = CV::configValues
pure val variableValues = CV::variableValues
pure val assetValues = CV::assetValues
pure val runIdValues = CV::runIdValues
pure val quoteValues = CV::quoteValues
pure val nonceValues = CV::nonceValues
pure val maximumValues = CV::maximumValues
pure val sendValues = CV::sendValues
pure val receiptValues = CV::receiptValues
pure val weight_receive = 10
pure val weight_recordCash = 6
pure val weight_book = 6
pure val weight_evaluate = 8
pure val weight_reserveGas = 8
pure val weight_sign = 10
pure val weight_finalizeSend = 10
pure val weight_creditClaim = 8
pure val weight_creditConversion = 8
pure val weight_creditDirectFee = 8
```
