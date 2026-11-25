# Public record pages

PRD section 7. slop.cash publishes the public record: /record (money that has reached contributors, the monthly cycles, the pools and the sources), /receipts, the program terms pages /referrals, /buyback, /october-allocation and /sponsored-pools, and /privacy; they replace the retired record.slop.cash site. Every release build, fresh or published-data, rebuilds /data/record.json (scripts/record/) from slop.cash's own public data and the pinned archive commit, in the shape of the retired site's snapshot; any failure publishes the previous record unchanged and never fails the release. /receipts shows one receipt for each project month in which a project's vault sent money to at least one contributor who is neither a team account nor the project's owner, and every receipt links to this site's receipts page, so a receipt stays when a month passes and the page never offers a dead link to the retired site. The record is the evidence the outside agents read: what money reached contributors, what the program pays, what the record file says, and what a project must do for its receipts to appear. The pages and the record file show the same numbers: /record, /receipts and every terms page read the same file, /data/record.json, from the same origin. The two machines below are the pure form of `formal/models/release/record_publication.qnt` and `formal/models/ui/ui_record_pages.qnt` on `main`.

## Story: Open the public record

> As a reader, I want to see what money has reached contributors, so that I can check the program against its own record.

### Every record path answers the same content as the retired site

/record shows the money that has reached contributors, the monthly cycles, the pools and the sources. /receipts shows one receipt per project month. The program terms pages /referrals, /buyback, /october-allocation and /sponsored-pools keep their text, and /privacy states the privacy terms; each page's words live in its own file beside the page, so a status box or a date changes in one place. A receipt's anchor never changes: it is #<project>-<YYYY-MM>, and when two receipts would share it the later one takes #<project>-<YYYY-MM>-<network>, then #<project>-<YYYY-MM>-<network>-<asset>. Every path answers the same content as its matching path on the retired site.

### The record and the receipts read one shared file

/record and /receipts read one same-origin file, /data/record.json, through the shared public resource hook. The hook is 0 is loading, 1 ready, 2 failed. A failed read (no file, an HTTP error, invalid JSON or a shape without the fields the pages read) shows a not-available message with try again, never an empty record or zero amounts. A ready /receipts page shows its receipts, or the one sentence when there are none. The page never reads GitHub or a chain. Leaving the page drops a pending answer (`life` counts mounts). At most three reads and two remounts.

```quint
pure type RecordRead = { life: int, read: int, loads: int, receipts: int, stale: int, pending: bool }

pure val recordReadValues = Set(
  { life: 1, read: 0, loads: 1, receipts: 0, stale: 0, pending: true },
  { life: 1, read: 1, loads: 1, receipts: 2, stale: 0, pending: false },
  { life: 1, read: 2, loads: 1, receipts: 0, stale: 0, pending: false },
  { life: 2, read: 0, loads: 2, receipts: 0, stale: 1, pending: true }
)

pure def shown(read: RecordRead): str =
  if (read.read == 0) "loading"
  else if (read.read == 2) "unavailable"
  else if (read.receipts == 0) "empty"
  else "receipts"

pure def lawLoadingAndFinishedNeverShowTogether(read: RecordRead): bool =
  read.pending iff read.read == 0

pure def lawFailedReadShowsNoReceipts(read: RecordRead): bool =
  read.read == 2 implies read.receipts == 0

pure def lawAtMostThreeLoads(read: RecordRead): bool =
  read.loads <= 3

pure def lawAtMostTwoRemounts(read: RecordRead): bool =
  read.life <= 3

pure def lawReadyReceiptsNeedNoRetry(read: RecordRead): bool =
  (read.read == 1 and read.receipts > 0) implies shown(read) == "receipts"
```

## Story: Rebuild the public record at every release

> As the release, I want every release to rebuild /data/record.json, so that the record never goes stale and a failed rebuild never takes the site down.

### The record stage never fails a release

Every release build rebuilds /data/record.json. The switch is the environment: without SLOP_RECORD_BUILD=1 the stage is skipped and writes nothing, so pull requests skip it. The previous record is read first: this site's own /data/record.json, then the retired site's snapshot. The build is skipped without the switch, writes a new record on success, writes the previous record unchanged on any failure or once its deadline passes, and writes nothing when it has no previous record. Receipts are counted, not modelled one by one: a receipts read that fails keeps the previous receipts, and a successful read can only add to them, because a published receipt is carried forward even when its payments are no longer in the public record. The stage's own exit is always success, so the release continues. Network order, JSON shape and disk atomicity are outside this model. The build runs under an eight-minute deadline and writes through a temporary file that is renamed into place.

```quint
pure type RecordRun = { phase: str, switched: bool, prev: bool, prevReceipts: int, file: str, fileReceipts: int, releaseFailed: bool }

pure val recordRunValues = Set(
  { phase: "start", switched: true, prev: true, prevReceipts: 2, file: "absent", fileReceipts: 0, releaseFailed: false },
  { phase: "skipped", switched: false, prev: true, prevReceipts: 2, file: "absent", fileReceipts: 0, releaseFailed: false },
  { phase: "built", switched: true, prev: true, prevReceipts: 2, file: "new", fileReceipts: 3, releaseFailed: false },
  { phase: "previous", switched: true, prev: true, prevReceipts: 2, file: "previous", fileReceipts: 2, releaseFailed: false },
  { phase: "none", switched: true, prev: false, prevReceipts: 0, file: "absent", fileReceipts: 0, releaseFailed: false }
)

pure def lawRecordStageNeverFailsRelease(run: RecordRun): bool =
  not(run.releaseFailed)

pure def lawSkippedWritesNothing(run: RecordRun): bool =
  run.phase == "skipped" implies run.file == "absent"

pure def lawNothingWrittenWithoutARecord(run: RecordRun): bool =
  run.phase == "none" implies (run.file == "absent" and not(run.prev))

pure def lawFailureKeepsPrevious(run: RecordRun): bool =
  run.phase == "previous" implies (run.file == "previous" and run.prev)

pure def lawPublishedReceiptNeverDisappears(run: RecordRun): bool =
  run.file != "absent" implies run.fileReceipts >= run.prevReceipts
```

### The receipts rule

/receipts shows one receipt for each project month in which a project's vault sent money to at least one contributor who is neither a team account nor the project's owner (`scripts/record/receipts.mjs`). A month is announced only after every bar clears: every payment is named, every outside payment is final on its chain, the asset is known, the month's totals were read, and the newest payment is at least thirty minutes old. A published month stays published: a later read that cannot name a payment, cannot read the totals, or cannot confirm a payment keeps the previous receipt instead of dropping it. The fee is 2% of the gross award, taken before the contributor is paid. The fee on a receipt is exact only when the month's totals were read, no private record exists, and the read fees match the summed fees; otherwise the receipt says the fee is not exact and shows the fee the loop counted. Each recipient's transactions link to their chain explorer. Merge figures come from the merge activity feed and cover the last thirty days; a receipt without them says so.

### The record file

/data/record.json keeps the retired site's snapshot shape: `builtAt`, `sources` with `projects`, `disclosures` and `cycles`, `money` with `pools` and `settlements`, plus `months`, `projects` and `receipts` with `builtAt`, `items` and `confirmed`. A receipt item carries `anchor`, `url`, `projectId`, `project`, `month`, `network`, `networkName`, `asset`, `assetAddress`, `stable`, `contributors`, `total`, `fee`, `feeExact`, `recipients`, `own`, `privateRecords`, `reserved`, `firstSentAt`, `lastSentAt`, `publishedAt` and `merges`. Only a record with the fields the pages read is carried forward. The four outside agents read only this file, so they can trust it alone.
