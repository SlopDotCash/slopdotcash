# Receipt-time private award terms

PRD sections 8 and 10 bind a private award to the offer published when the
report was received. The case stores this exact immutable term revision and
receipt time. Later project revisions cannot replace the retained offer.

## Story: Decide an award under the terms that accompanied the report

### Paid terms must exist before receipt and a full award belongs to the platform program

Standard private awards divide exactly into the 75/25 split. The platform's
authorized full-award terms use the full amount. Approval remains separate from
funding, payment-path availability and financial authorization.

```quint
import money as M from "../settlement/money"
type AwardSplit = StandardSplit | FullAward
type ReceiptTerms = { revision: int, publishedAt: int, receivedAt: int, paidTerms: bool, fixedOffer: bool, offeredGross: M::Amount, split: AwardSplit, platformProject: bool, fullAwardApproved: bool }
type Qualification = { accepted: bool, firstQualifying: bool, inScope: bool, duplicate: bool, relatedPartyCleared: bool, legacyAmountApproved: bool }
type BoundAward = { receipt: ReceiptTerms, approvedGross: M::Amount }
pure def validPaidTerms(t: ReceiptTerms): bool = t.revision > 0 and t.paidTerms and t.publishedAt >= 0 and t.publishedAt <= t.receivedAt and M::validAmount(t.offeredGross) and M::positiveAmount(t.offeredGross) and
  (if (t.split == StandardSplit) M::privateSplitPossible(t.offeredGross) else t.platformProject and t.fullAwardApproved)
```

### A fixed offer permits its receipt-time gross amount or no award

A positive decision requires technical acceptance, eligible scope and the first
qualifying report for the underlying finding. A historical variable-amount
decision additionally carries approval under its retained historical terms.

```quint
pure def canDecideAward(t: ReceiptTerms, amount: M::Amount, q: Qualification, currentAuthority: bool): bool = currentAuthority and M::validAmount(amount) and
  (if (not(M::positiveAmount(amount))) true else validPaidTerms(t) and q.accepted and q.firstQualifying and q.inScope and not(q.duplicate) and q.relatedPartyCleared and
    (if (t.fixedOffer) M::equalAmounts(amount, t.offeredGross) else q.legacyAmountApproved))
pure def bindAward(t: ReceiptTerms, amount: M::Amount): BoundAward = { receipt: t, approvedGross: amount }
pure def lawFixedOfferPreserved(t: ReceiptTerms, amount: M::Amount, q: Qualification): bool =
  (t.fixedOffer and canDecideAward(t, amount, q, true)) implies (not(M::positiveAmount(amount)) or M::equalAmounts(amount, t.offeredGross))
pure def lawUnpaidIntakeCreatesNoAward(t: ReceiptTerms, amount: M::Amount, q: Qualification): bool =
  (not(t.paidTerms) and canDecideAward(t, amount, q, true)) implies not(M::positiveAmount(amount))
pure def lawFullAwardIsPlatformOnly(t: ReceiptTerms, amount: M::Amount, q: Qualification): bool =
  (t.split == FullAward and M::positiveAmount(amount) and canDecideAward(t, amount, q, true)) implies t.platformProject and t.fullAwardApproved
pure def lawFirstQualifyingReportRequired(t: ReceiptTerms, amount: M::Amount, q: Qualification): bool =
  (M::positiveAmount(amount) and canDecideAward(t, amount, q, true)) implies q.firstQualifying and not(q.duplicate)
pure def lawDecisionRetainsReceipt(t: ReceiptTerms, amount: M::Amount): bool = bindAward(t, amount).receipt == t
```

### Simulation samples include absent, stale and current paid terms

```quint
pure val tValues = Set(
  { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: true, fixedOffer: true, offeredGross: List(100), split: StandardSplit, platformProject: false, fullAwardApproved: false },
  { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: false, fixedOffer: true, offeredGross: List(100), split: StandardSplit, platformProject: false, fullAwardApproved: false },
  { revision: 1, publishedAt: 3, receivedAt: 2, paidTerms: true, fixedOffer: true, offeredGross: List(100), split: StandardSplit, platformProject: false, fullAwardApproved: false },
  { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: true, fixedOffer: true, offeredGross: List(100), split: FullAward, platformProject: true, fullAwardApproved: true },
  { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: true, fixedOffer: true, offeredGross: List(100), split: FullAward, platformProject: false, fullAwardApproved: true }
)
pure val amountValues = Set(List(0), List(1), List(100), List(101))
pure val qValues = Set(
  { accepted: true, firstQualifying: true, inScope: true, duplicate: false, relatedPartyCleared: true, legacyAmountApproved: false },
  { accepted: true, firstQualifying: false, inScope: true, duplicate: true, relatedPartyCleared: true, legacyAmountApproved: false },
  { accepted: false, firstQualifying: true, inScope: false, duplicate: false, relatedPartyCleared: true, legacyAmountApproved: false }
)
```
