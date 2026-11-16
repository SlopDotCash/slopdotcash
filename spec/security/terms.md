# Receipt-time private award terms

PRD sections 8 and 10 bind a private award to the offer published when the
report was received. The case stores this exact immutable term record and
receipt time. Later project revisions cannot replace the retained offer. The
[program terms machine](./program.md) is the only constructor of a paid
record, through `receiptTerms`; the [case machine](./cases.md) freezes it at
receipt and checks every positive award against it.

## Story: Decide an award under the terms that accompanied the report

### Paid terms carry their split, funding policy, eligibility class and asset

Standard private awards divide exactly into the 75/25 split. A full award is
an after-approval offer of the platform program (PRD section 8, "Slop mainnet
contracts"); the program machine admits it only for that project and only
with an audited administrator split approval. An unpaid receipt keeps its
receipt time and project revision and promises no award. Approval remains
separate from funding, payment-path availability and financial authorization.

```quint
import money as M from "../settlement/money"
type AwardSplit = StandardSplit | FullAward
type FundingPolicy = AfterApproval | Prefunded
type Eligibility = InScopeSecurity | CriticalLossOfFunds
type ReceiptTerms = { revision: int, publishedAt: int, receivedAt: int, paidTerms: bool, fundingPolicy: FundingPolicy,
  eligibility: Eligibility, offeredGross: M::Amount, split: AwardSplit, asset: str }
pure def unpaidTerms(revision: int, receivedAt: int): ReceiptTerms = { revision: revision, publishedAt: 0, receivedAt: receivedAt,
  paidTerms: false, fundingPolicy: AfterApproval, eligibility: InScopeSecurity, offeredGross: M::zero, split: StandardSplit, asset: "" }
pure def validPaidTerms(t: ReceiptTerms): bool = t.revision > 0 and t.paidTerms and t.publishedAt >= 0 and t.publishedAt <= t.receivedAt
  and t.asset != "" and M::validAmount(t.offeredGross) and M::positiveAmount(t.offeredGross)
  and (if (t.split == StandardSplit) M::privateSplitPossible(t.offeredGross) else t.fundingPolicy == AfterApproval)
pure def validReceipt(t: ReceiptTerms): bool = t.revision > 0 and t.receivedAt > 0 and (if (t.paidTerms) validPaidTerms(t)
  else t.offeredGross == M::zero and t.asset == "")
```

### A finding qualifies only under its frozen eligibility class

New programs award in-scope security findings. A retained
`critical-loss-of-funds` program also requires a critical severity and a
verified potential or actual loss. Actual loss is neither required nor
permitted as evidence; the shell records a verified-potential finding from safe
evidence.

```quint
type Severity = SeverityUnset | Critical | High | Medium | Low | Informational | SeverityUnresolved
type LossFinding = LossUnset | VerifiedPotential | VerifiedActual | NotVerified | LossUnresolved
pure def eligibleFinding(t: ReceiptTerms, inScope: bool, severity: Severity, loss: LossFinding): bool = t.paidTerms and inScope
  and (t.eligibility == InScopeSecurity or (severity == Critical and (loss == VerifiedPotential or loss == VerifiedActual)))
pure def lawUnpaidFindingNeverEligible(t: ReceiptTerms, inScope: bool, severity: Severity, loss: LossFinding): bool =
  not(t.paidTerms) implies not(eligibleFinding(t, inScope, severity, loss))
pure def lawCriticalLossNeedsVerifiedLoss(t: ReceiptTerms, inScope: bool, severity: Severity, loss: LossFinding): bool =
  (t.eligibility == CriticalLossOfFunds and eligibleFinding(t, inScope, severity, loss)) implies
    severity == Critical and loss != LossUnset and loss != NotVerified and loss != LossUnresolved
```

### A fixed offer permits its receipt-time gross amount or no award

An after-approval offer is fixed: the owner awards the frozen gross amount or
none. A retained prefunded program keeps its historical discretionary amount
rule, and a standard split still divides exactly by four.

```quint
pure def fixedOffer(t: ReceiptTerms): bool = t.fundingPolicy == AfterApproval
pure def amountAllowed(t: ReceiptTerms, amount: M::Amount): bool = validPaidTerms(t) and M::validAmount(amount) and M::positiveAmount(amount)
  and (if (fixedOffer(t)) M::equalAmounts(amount, t.offeredGross) else true)
  and (t.split == FullAward or M::privateSplitPossible(amount))
pure def lawUnpaidIntakeCreatesNoAward(t: ReceiptTerms, amount: M::Amount): bool = not(t.paidTerms) implies not(amountAllowed(t, amount))
pure def lawFullAwardIsFixedPledge(t: ReceiptTerms, amount: M::Amount): bool =
  (t.split == FullAward and amountAllowed(t, amount)) implies t.fundingPolicy == AfterApproval and M::equalAmounts(amount, t.offeredGross)
pure def lawZeroIsNoAward(t: ReceiptTerms): bool = not(amountAllowed(t, M::zero))
```

### Simulation samples include absent, early and current paid terms

```quint
pure val standardTerms: ReceiptTerms = { revision: 1, publishedAt: 1, receivedAt: 2, paidTerms: true, fundingPolicy: AfterApproval,
  eligibility: InScopeSecurity, offeredGross: List(100), split: StandardSplit, asset: "usdc" }
pure val fullTerms: ReceiptTerms = { ...standardTerms, split: FullAward, offeredGross: List(101) }
pure val historicalTerms: ReceiptTerms = { ...standardTerms, fundingPolicy: Prefunded, eligibility: CriticalLossOfFunds }
pure val tValues = Set(standardTerms, fullTerms, historicalTerms, unpaidTerms(1, 2), { ...standardTerms, publishedAt: 3 },
  { ...fullTerms, fundingPolicy: Prefunded })
pure val amountValues = Set(List(0), List(4), List(100), List(101))
```
