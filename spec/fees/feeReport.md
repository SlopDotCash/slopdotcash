# Administrator fee report

PRD MVP-07c gives administrators a private read of the fee-wallet journals;
there is no public page or route. The pinned source is
`backend/fee-conversions/handler.ts` (`GET /api/v1/admin/fee-conversions`)
with its tests and `tests/e2e/admin-fee-conversions.spec.ts`; the owner
console shows it. The report reads the [conversion journal](./conversion.md)
rows, including the [buyback](./buyback.md) and [pool](./buybackPool.md)
sends and their bridge outcomes, and the network targets of the
[runtime](./runtime.md). This library is the projection; the shell renders
every amount as an exact decimal string of its base units and never as a
floating-point number, and keeps the wire shape the old route had.

Journal records arrive in creation order with increasing identifiers. Each
record keeps the exact signed bytes for rebroadcast as a secret; the
report has no place that could hold them.

## Story: Show administrators what the fee wallets did

### Only an administrator reads the fee report, and it never contains a signed transaction or secret

Any method other than `GET` is refused first. A request with no session is
unauthenticated; a signed-in account that is not an administrator is
forbidden. The shared admission checks of every private route (an expected
actor header that names someone else, rate limits) apply before the report
is read. Nothing in a report line is computed from the signed bytes, key
material or a private report, so `model` refuses any change that would let
them through.

```quint
import runtime as R from "./runtime"
import money as M from "../settlement/money"
type Method = Get | OtherMethod
type Viewer = Anonymous | Member | Administrator
type ReportAccess = Granted | MethodNotAllowed | Unauthenticated | Forbidden
type SecretSignedBytes = str
type RecordKind = ConversionRecord | ApprovalRecord | ClaimRecord | BridgeRecord | BuybackRecord | BurnRecord
type RecordState = QuotedRecord | DustPendingRecord | SkippedRecord | NoRouteRecord | SubmittedRecord | UnknownRecord
  | FinalizedRecord | FailedRecord
type BridgeOutcome = NoOutcome | ArrivedOutcome | RefundedOutcome
type JournalRecord = { id: int, kind: RecordKind, network: R::Network, live: bool, state: RecordState, token: str,
  targetToken: str, amountIn: M::Amount, amountOut: M::Amount, txId: str, landedTxId: str, reason: str, createdAt: int,
  order: int, outcome: BridgeOutcome, signedBytes: SecretSignedBytes }
type ReportLine = { id: int, kind: RecordKind, network: R::Network, live: bool, state: RecordState, token: str,
  targetToken: str, amountIn: M::Amount, amountOut: M::Amount, txId: str, landedTxId: str, reason: str, createdAt: int,
  order: int, outcome: BridgeOutcome }
pure def reportAccess(method: Method, viewer: Viewer): ReportAccess =
  if (method != Get) MethodNotAllowed else if (viewer == Anonymous) Unauthenticated
  else if (viewer == Member) Forbidden else Granted
pure def lineOf(r: JournalRecord): ReportLine = { id: r.id, kind: r.kind, network: r.network, live: r.live, state: r.state,
  token: r.token, targetToken: r.targetToken, amountIn: r.amountIn, amountOut: r.amountOut, txId: r.txId,
  landedTxId: r.landedTxId, reason: r.reason, createdAt: r.createdAt, order: r.order, outcome: r.outcome }
pure def lawOnlyAdministratorsRead(method: Method, viewer: Viewer): bool =
  (reportAccess(method, viewer) == Granted) iff (method == Get and viewer == Administrator)
```

### The report shows the latest 100 rows, finalized live totals per token as decimal strings, 24-hour state counts and each network's target

The latest rows are the 100 newest conversion records, newest first;
approvals and claims are not listed. Totals sum every live, finalized
conversion per network and wallet token, with its count, exact input and
exact output; the shell orders them by network and token. The 24-hour
counts group the conversion records created in the last 86,400,000
milliseconds by network, mode and state. Each network shows its target:
USDC where it converts, or **not converted** for Robinhood Chain, whose
received assets stay in the wallet.

```quint
pure val recentLimit = 100
pure val reportDayMs = 86400000
type TokenTotal = { network: R::Network, token: str, targetToken: str, conversions: int, amountIn: M::Amount, amountOut: M::Amount }
type StateCount = { network: R::Network, live: bool, state: RecordState, recordCount: int }
type NetworkTarget = { network: R::Network, converted: bool }
pure val reportNetworks: List[R::Network] = List(R::Base, R::Ethereum, R::Robinhood, R::Solana)
pure val reportRoutes: List[NetworkTarget] = reportNetworks.listMap(n => { network: n, converted: R::converts(n) })
pure def newerOfKinds(records: List[JournalRecord], r: JournalRecord, kinds: Set[RecordKind]): int =
  records.foldl(0, (t, o) => if (kinds.contains(o.kind) and o.id > r.id) t + 1 else t)
pure def latestLines(records: List[JournalRecord], kinds: Set[RecordKind]): List[ReportLine] =
  records.foldl(List(), (acc, r) =>
    if (kinds.contains(r.kind) and newerOfKinds(records, r, kinds) < recentLimit) List(lineOf(r)).concat(acc) else acc)
pure def settledConversion(r: JournalRecord): bool = r.kind == ConversionRecord and r.live and r.state == FinalizedRecord
pure def tokenTotal(records: List[JournalRecord], network: R::Network, token: str): TokenTotal =
  records.foldl({ network: network, token: token, targetToken: "", conversions: 0, amountIn: M::zero, amountOut: M::zero },
    (t, r) => if (settledConversion(r) and r.network == network and r.token == token)
      { ...t, targetToken: r.targetToken, conversions: t.conversions + 1, amountIn: M::addAmounts(t.amountIn, r.amountIn),
        amountOut: M::addAmounts(t.amountOut, r.amountOut) } else t)
pure def firstOfToken(records: List[JournalRecord], r: JournalRecord): bool = settledConversion(r)
  and not(records.some(o => settledConversion(o) and o.id < r.id and o.network == r.network and o.token == r.token))
pure def tokenTotals(records: List[JournalRecord]): List[TokenTotal] =
  records.foldl(List(), (acc, r) => if (firstOfToken(records, r)) acc.append(tokenTotal(records, r.network, r.token)) else acc)
pure def inLastDay(r: JournalRecord, now: int): bool = r.kind == ConversionRecord and r.createdAt >= now - reportDayMs
pure def sameGroup(a: JournalRecord, b: JournalRecord): bool = a.network == b.network and a.live == b.live and a.state == b.state
pure def stateCounts(records: List[JournalRecord], now: int): List[StateCount] =
  records.foldl(List(), (acc, r) =>
    if (inLastDay(r, now) and not(records.some(o => inLastDay(o, now) and o.id < r.id and sameGroup(o, r))))
      acc.append({ network: r.network, live: r.live, state: r.state,
        recordCount: records.foldl(0, (t, o) => if (inLastDay(o, now) and sameGroup(o, r)) t + 1 else t) })
    else acc)
```

### The buyback block shows the latest orders, purchases and burns with their outcomes and live totals

The block lists the 100 newest bridge, purchase and burn records, newest
first, each with its order identifier and its proven outcome: arrived,
refunded, or none while a deposit is in transit. Its totals sum the live,
finalized sends per network, leg and token: their count, exact input and
output, the input of finalized bridge deposits with no proven outcome (in
transit) and the input of refunded deposits.

```quint
type LegTotal = { network: R::Network, kind: RecordKind, token: str, sends: int, amountIn: M::Amount, amountOut: M::Amount,
  inTransit: M::Amount, refunded: M::Amount }
type BuybackBlock = { recent: List[ReportLine], totals: List[LegTotal] }
type FeeReport = { recent: List[ReportLine], routes: List[NetworkTarget], totals: List[TokenTotal], last24Hours: List[StateCount],
  buyback: BuybackBlock }
pure val buybackKinds: Set[RecordKind] = Set(BridgeRecord, BuybackRecord, BurnRecord)
pure def settledLeg(r: JournalRecord): bool = buybackKinds.contains(r.kind) and r.live and r.state == FinalizedRecord
pure def sameLeg(a: JournalRecord, b: JournalRecord): bool = a.network == b.network and a.kind == b.kind and a.token == b.token
pure def legTotal(records: List[JournalRecord], leg: JournalRecord): LegTotal =
  records.foldl({ network: leg.network, kind: leg.kind, token: leg.token, sends: 0, amountIn: M::zero, amountOut: M::zero,
    inTransit: M::zero, refunded: M::zero },
    (t, r) => if (settledLeg(r) and sameLeg(r, leg))
      { ...t, sends: t.sends + 1, amountIn: M::addAmounts(t.amountIn, r.amountIn), amountOut: M::addAmounts(t.amountOut, r.amountOut),
        inTransit: if (r.kind == BridgeRecord and r.outcome == NoOutcome) M::addAmounts(t.inTransit, r.amountIn) else t.inTransit,
        refunded: if (r.outcome == RefundedOutcome) M::addAmounts(t.refunded, r.amountIn) else t.refunded } else t)
pure def legTotals(records: List[JournalRecord]): List[LegTotal] =
  records.foldl(List(), (acc, r) =>
    if (settledLeg(r) and not(records.some(o => settledLeg(o) and o.id < r.id and sameLeg(o, r)))) acc.append(legTotal(records, r))
    else acc)
pure def feeReport(records: List[JournalRecord], now: int): FeeReport =
  { recent: latestLines(records, Set(ConversionRecord)), routes: reportRoutes, totals: tokenTotals(records),
    last24Hours: stateCounts(records, now), buyback: { recent: latestLines(records, buybackKinds), totals: legTotals(records) } }
```
