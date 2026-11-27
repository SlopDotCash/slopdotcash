# Public payment history assembly

PRD sections 6 and 9 publish only finalized payments, from cached records,
with explicit freshness. The public payment list of a project or vault
(`src/VaultPaymentHistory.tsx`, `src/PaymentRecords.tsx`,
`src/lib/use-direct-transfers.ts`, `src/lib/use-vault-payments.ts` at Slop
development `87a26cc98`) reads up to three pages of direct transfers or vault
payments and publishes them only as a whole. It succeeds the retained
`ui_payment_page_assembly` model. Which rows may be public at all is the
[projection](./projections.md) rule; this machine is the assembly of one
list for one resource, a project or vault page, and its
[read status](./requests.md). The shell validates each row's shape, exact
money and identity before it reaches `receivePage`; a direct-transfer page
also states its amount total, which must equal its rows'.

## Story: Publish a complete payment list or nothing

### Pages advance a strictly increasing cursor against the first page's boundary and total

The first page fixes the boundary (the last record the list may include) and
the total. Every later page must repeat both. A page that continues names a
cursor after the previous one and within the boundary, and carries rows. At
most three pages are read; a fourth would be needed only past the total, so
it is an error. Changing the page, project or vault starts a new lifetime and
discards whatever is in flight.

```quint
import requests as R from "./requests"
type Mode = DirectTransfers | VaultPayments
type Phase = Requesting | Waiting | Complete | Errored | Cancelled
type Failure = NoFailure | OriginRefused | TransportFailed | BadPage | ChangedBoundary | ChangedTotal | Stalled
  | DuplicateRow | CountMismatch | TooManyPages
type History = { lifetime: int, mode: Mode, phase: Phase, pages: int, retries: int, through: int, total: int,
  cursor: int, rows: List[int], published: bool, failure: Failure }
pure val maxPages = 3
pure val initial: History = { lifetime: 1, mode: DirectTransfers, phase: Requesting, pages: 0, retries: 0,
  through: -1, total: -1, cursor: 0, rows: List(), published: false, failure: NoFailure }
pure def restart(mode: Mode, lifetime: int, retries: int): History =
  { ...initial, lifetime: lifetime, mode: mode, retries: retries }
pure def failed(failure: Failure, h: History): History = { ...h, phase: Errored, published: false, failure: failure }
pure def canChangeResource(h: History, mode: Mode): bool = h.lifetime < 9007199254740991
pure def changeResource(h: History, mode: Mode): History = restart(mode, h.lifetime + 1, 0)
pure def canRefuseOrigin(h: History): bool = h.phase == Requesting and h.pages == 0
pure def refuseOrigin(h: History): History = failed(OriginRefused, h)
pure def canRequestPage(h: History): bool = h.phase == Requesting and h.pages < maxPages
pure def requestPage(h: History): History = { ...h, phase: Waiting, pages: h.pages + 1 }
```

### Rows publish only after the final page, and every inconsistency is an error

A changed boundary or total, a cursor that does not advance, a duplicate
row, a count that overruns the total or a final page short of it rejects the
whole list; the rows already read are never shown as a partial success. An
empty final page with a total of zero is an empty success. A transport
failure may be retried once, from a fresh assembly. Cancelling the read
discards its reply, as does a reply from an earlier lifetime.

```quint
pure def distinctRows(rows: List[int]): bool = rows.every(x => rows.select(y => y == x).length() == 1)
pure def pageFailure(h: History, rows: List[int], through: int, total: int, nextCursor: int, amountMatches: bool): Failure =
  val count = h.rows.length() + rows.length()
  if (through < 0 or total < 0 or (h.mode == DirectTransfers and not(amountMatches))) BadPage
  else if (h.through >= 0 and through != h.through) ChangedBoundary
  else if (h.total >= 0 and total != h.total) ChangedTotal
  else if (nextCursor != -1 and (rows.length() == 0 or nextCursor <= h.cursor or nextCursor > through)) Stalled
  else if (not(distinctRows(h.rows.concat(rows)))) DuplicateRow
  else if (count > total or (nextCursor == -1 and count != total) or (nextCursor != -1 and count >= total)) CountMismatch
  else if (nextCursor != -1 and h.pages >= maxPages) TooManyPages
  else NoFailure
pure def canReceivePage(h: History, lifetime: int, rows: List[int], through: int, total: int, nextCursor: int, amountMatches: bool): bool =
  h.phase == Waiting and lifetime == h.lifetime
pure def receivePage(h: History, lifetime: int, rows: List[int], through: int, total: int, nextCursor: int, amountMatches: bool): History =
  val failure = pageFailure(h, rows, through, total, nextCursor, amountMatches)
  if (failure != NoFailure) failed(failure, h)
  else if (nextCursor == -1) { ...h, phase: Complete, through: through, total: total, rows: h.rows.concat(rows), published: true }
  else { ...h, phase: Requesting, through: through, total: total, rows: h.rows.concat(rows), cursor: nextCursor }
pure def canFailTransport(h: History, lifetime: int): bool = h.phase == Waiting and lifetime == h.lifetime
pure def failTransport(h: History, lifetime: int): History = failed(TransportFailed, h)
pure def canCancel(h: History): bool = h.phase == Waiting
pure def cancel(h: History): History = { ...h, phase: Cancelled, published: false }
pure def canRetry(h: History): bool = h.phase == Errored and h.failure == TransportFailed and h.retries == 0
pure def retry(h: History): History = restart(h.mode, h.lifetime, 1)
pure def historyStatus(h: History): R::ReadStatus =
  if (h.phase == Requesting or h.phase == Waiting) R::Loading
  else if (h.phase == Cancelled) R::Cancelled
  else if (h.phase == Complete) (if (h.rows.length() == 0) R::Empty else R::Current)
  else if (h.failure == OriginRefused) R::Unavailable
  else if (h.failure == TransportFailed) R::Failed
  else R::Invalid
```

### Rules

```quint
pure def alwaysPublishedIsComplete(h: History): bool = h.published iff h.phase == Complete
pure def alwaysCompleteIsExact(h: History): bool = h.phase == Complete implies
  h.rows.length() == h.total and distinctRows(h.rows) and h.through >= 0
pure def alwaysBounded(h: History): bool = h.pages >= 0 and h.pages <= maxPages and h.retries >= 0 and h.retries <= 1
  and h.lifetime >= 1
pure def alwaysErrorHasReason(h: History): bool = (h.phase == Errored) iff (h.failure != NoFailure)
pure def alwaysBoundaryAndTotalTogether(h: History): bool = (h.through >= 0) iff (h.total >= 0)
pure def stepBoundaryFixedWithinAssembly(before: History, after: History): bool =
  (before.through >= 0 and after.through >= 0 and before.lifetime == after.lifetime and before.retries == after.retries)
    implies after.through == before.through and after.total == before.total
pure def stepCursorAdvances(before: History, after: History): bool =
  (before.lifetime == after.lifetime and before.retries == after.retries) implies after.cursor >= before.cursor
pure def sometimesMultiPageComplete(h: History): bool = h.phase == Complete and h.pages >= 2
pure def sometimesEmptySuccess(h: History): bool = historyStatus(h) == R::Empty
pure def sometimesChangedBoundary(h: History): bool = h.failure == ChangedBoundary and h.rows.length() > 0
pure def sometimesChangedTotal(h: History): bool = h.failure == ChangedTotal
pure def sometimesStalled(h: History): bool = h.failure == Stalled
pure def sometimesRetriedComplete(h: History): bool = h.retries == 1 and h.phase == Complete
pure def sometimesCancelled(h: History): bool = h.phase == Cancelled
pure def sometimesVaultComplete(h: History): bool = h.mode == VaultPayments and h.phase == Complete and h.rows.length() > 0
pure val rowsValues = Set(List(), List(1), List(2), List(1, 1))
pure val throughValues = Set(2, 3)
pure val totalValues = Set(0, 2)
pure val nextCursorValues = Set(-1, 1, 2)
pure val lifetimeValues = Set(1, 2)
pure val weight_requestPage = 4
pure val weight_receivePage = 8
pure val eval_witness_sometimesMultiPageComplete = (
  "requestPage",
  ("receivePage", 1, List(1), 2, 2, 1, true),
  "requestPage",
  ("receivePage", 1, List(2), 2, 2, -1, true))
pure val eval_witness_sometimesRetriedComplete = (
  "requestPage",
  ("failTransport", 1),
  "retry",
  "requestPage",
  ("receivePage", 1, List(), 2, 0, -1, true))
```
