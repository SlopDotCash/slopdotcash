# Public record pages

The public `/record` and `/receipts` pages (main `src/RecordPage.tsx`,
`src/ReceiptsPage.tsx`, `src/RecordLoad.tsx`, `src/lib/record-data.ts` and
`formal/models/ui/ui_record_pages.qnt` at `bd8ab0f67`): both pages read one
same-origin file, `/data/record.json`, through the shared public resource read
and never read GitHub or a chain. A failed read (no file, an HTTP error,
invalid JSON, or a shape without the fields the pages read) shows a
not-available message with Try again, never an empty record or zero amounts. A
ready `/receipts` page shows its published receipts, or the one empty sentence
when there are none. Leaving the page drops any pending answer (`life` counts
mounts).

## Story: Read the public record and published payout receipts without mistaking failure for an empty record

> As a visitor, I want `/record` and `/receipts` to load `/data/record.json`,
> offer Try again when the read fails instead of showing zero amounts or an
> empty record, and drop any in-flight answer when I leave the page.

### A failed record read shows unavailable with retry and never empty receipts, and remount drops pending answers

Each mount starts a new lifetime (`life`) with a loading read (`pending` true,
`read` `RecordLoading`). A valid answer settles `read` to `RecordReady` with
its non-negative receipt count (`0` shows `ShownEmpty`, positive shows
`ShownReceipts`); an invalid or failed answer settles `read` to `RecordFailed`
with `receipts` `0` (`ShownUnavailable`) and enables `retry` up to three total
loads. A ready page never retries. Remounting increments `life`, resets the
view to `RecordLoading`, and moves any in-flight read into `stale` so a later
`staleAnswer` is dropped without changing the current lifetime's view.

```quint
type RecordRead = RecordLoading | RecordReady | RecordFailed
type RecordShown = ShownLoading | ShownUnavailable | ShownEmpty | ShownReceipts
type RecordPage = { life: int, read: RecordRead, loads: int, receipts: int, stale: int, pending: bool }
pure val initial: RecordPage = { life: 1, read: RecordLoading, loads: 1, receipts: 0, stale: 0, pending: true }
pure def canAnswer(s: RecordPage, valid: bool, receipts: int): bool =
  s.pending and 0 <= receipts and receipts <= 2
pure def answer(s: RecordPage, valid: bool, receipts: int): RecordPage =
  { ...s, pending: false, read: if (valid) RecordReady else RecordFailed, receipts: if (valid) receipts else 0 }
pure def canRetry(s: RecordPage): bool = not(s.pending) and s.read == RecordFailed and s.loads < 3
pure def retry(s: RecordPage): RecordPage = { ...s, pending: true, read: RecordLoading, loads: s.loads + 1 }
pure def canRemount(s: RecordPage): bool = s.life < 3
pure def remount(s: RecordPage): RecordPage =
  { life: s.life + 1, read: RecordLoading, loads: s.loads, receipts: 0,
    stale: s.stale + (if (s.pending) 1 else 0), pending: true }
pure def canStaleAnswer(s: RecordPage): bool = s.stale > 0
pure def staleAnswer(s: RecordPage): RecordPage = { ...s, stale: s.stale - 1 }
pure def shown(s: RecordPage): RecordShown =
  if (s.read == RecordLoading) ShownLoading
  else if (s.read == RecordFailed) ShownUnavailable
  else if (s.receipts == 0) ShownEmpty
  else ShownReceipts
pure def alwaysLoadingMatchesPending(s: RecordPage): bool = s.pending == (s.read == RecordLoading)
pure def alwaysFailedShowsNoReceipts(s: RecordPage): bool = s.read == RecordFailed implies s.receipts == 0
pure def alwaysLoadsBounded(s: RecordPage): bool = s.loads <= 3
pure def alwaysStaleNonNegative(s: RecordPage): bool = s.stale >= 0
pure def alwaysReceiptsNonNegative(s: RecordPage): bool = s.receipts >= 0
pure def alwaysReadyNeverRetries(s: RecordPage): bool = s.read == RecordReady implies not(canRetry(s))
pure def sometimesValidRecordShowsReceipts(s: RecordPage): bool = shown(s) == ShownReceipts
pure def sometimesEmptyRecordShowsEmptySentence(s: RecordPage): bool = shown(s) == ShownEmpty
pure def sometimesFailedReadRecoversOnRetry(s: RecordPage): bool = shown(s) == ShownReceipts and s.loads >= 2
pure def sometimesRemountDropsStaleAnswer(s: RecordPage): bool = s.life >= 2 and s.pending and s.stale == 0
pure val validValues = Set(false, true)
pure val receiptsValues = Set(0, 1, 2)
pure val eval_witness_sometimesFailedReadRecoversOnRetry =
  (("answer", false, 0), "retry", ("answer", true, 1))
pure val eval_witness_sometimesRemountDropsStaleAnswer =
  ("remount", "staleAnswer")
```
