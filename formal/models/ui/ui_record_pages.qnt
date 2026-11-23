// @source src/RecordPage.tsx
// @source src/ReceiptsPage.tsx
// @source src/RecordLoad.tsx
// @source src/lib/record-data.ts
// @evidence tests/e2e/record-pages.spec.ts
// /record and /receipts read one same-origin file, /data/record.json, through
// the shared public resource hook. `read` is 0 loading, 1 ready, 2 failed. A
// failed read (no file, an HTTP error, invalid JSON or a shape without the
// fields the pages read) shows a not-available message with Try again, never
// an empty record or zero amounts. A ready /receipts page shows its receipts,
// or the one sentence when there are none. The page never reads GitHub or a
// chain. Leaving the page drops a pending answer (`life` counts mounts). At
// most three reads and two remounts.
module ui_record_pages {
  type S = { life: int, read: int, loads: int, receipts: int, stale: int,
    pending: bool }
  var s: S
  action init = s' = { life: 1, read: 0, loads: 1, receipts: 0, stale: 0,
    pending: true }
  // `valid` is whether the file answered with the record's fields.
  action answer(valid: bool, receipts: int): bool = all { s.pending,
    0 <= receipts, receipts <= 2,
    s' = s.with("pending", false).with("read", if (valid) 1 else 2)
      .with("receipts", if (valid) receipts else 0) }
  action retry = all { not(s.pending), s.read == 2, s.loads < 3,
    s' = s.with("pending", true).with("read", 0).with("loads", s.loads + 1) }
  action remount = all { s.life < 3,
    s' = { life: s.life + 1, read: 0, loads: s.loads, receipts: 0,
      stale: s.stale + (if (s.pending) 1 else 0), pending: true } }
  action staleAnswer = all { s.stale > 0, s' = s.with("stale", s.stale - 1) }
  action step = any {
    { nondet valid = Set(false, true).oneOf()
      nondet receipts = 0.to(2).oneOf()
      answer(valid, receipts) },
    retry,
    remount,
    staleAnswer,
    all { not(s.pending), s.stale == 0, s' = s } }
  // What the reader sees: a spinner, the not-available message, the empty
  // sentence or the receipts.
  val shown: str =
    if (s.read == 0) "loading"
    else if (s.read == 2) "unavailable"
    else if (s.receipts == 0) "empty"
    else "receipts"
  val invariant = and {
    // Loading and a finished read never show together.
    s.pending iff s.read == 0,
    // A failed read never shows receipts or an empty record.
    s.read == 2 implies s.receipts == 0,
    s.loads <= 3 }
  run validRecordShowsReceiptsTest = init
    .then(answer(true, 2)).expect(shown == "receipts")
  run recordWithoutReceiptsShowsTheSentenceTest = init
    .then(answer(true, 0)).expect(shown == "empty")
  run failedReadOffersRetryTest = init
    .then(answer(false, 0)).expect(shown == "unavailable")
    .then(retry).expect(shown == "loading")
    .then(answer(true, 1)).expect(shown == "receipts")
  run remountDropsThePendingAnswerTest = init
    .then(remount).expect(s.stale == 1 and shown == "loading")
    .then(staleAnswer).expect(s.pending and s.stale == 0)
  run readyRecordCannotRetryTest = init
    .then(answer(true, 1)).then(retry.fail())
}
