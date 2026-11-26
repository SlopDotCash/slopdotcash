# Public record publication

PRD section 7 ("Public record pages"): every release build rebuilds
`/data/record.json` and never fails a release because of it. The pinned sources
are `apps/operations/src/release/record/{build.vibe,agg.ts,receipts.ts}`,
`.github/workflows/deploy.yml` (`SLOP_RECORD_BUILD` and
`SLOP_RECORD_GITHUB_TOKEN`), and the legacy model
`formal/models/release/record_publication.qnt`.

## Story: Rebuild /data/record.json on every release while preserving prior records and receipts

> As an operator, I want every release to rebuild `/data/record.json` without
> failing the release on external read errors, to fall back to the previous
> record unchanged on failure or deadline expiry, and to never drop a published
> receipt.

### Every release rebuilds /data/record.json without failing the release and never drops a published receipt

Before building, the stage checks `SLOP_RECORD_BUILD == 1` and reads any
previous record (first from `https://slop.cash/data/record.json`, then from the
retired `https://record.slop.cash/data/snapshot.json`). Without the switch, it
skips and writes nothing. When enabled, a successful build writes the new
record carrying forward every previously published receipt (adding any newly
confirmed receipts, or keeping the previous receipts if the receipts read
failed). On any failure or deadline expiry, it writes the previous record
unchanged if one was read, or writes nothing when none was available. The stage
always exits cleanly so it never fails a release.

```quint
type RecordPhase = PhaseUnconfigured | PhaseStart | PhaseSkipped | PhaseBuilt | PhasePrevious | PhaseNone
type WrittenFile = FileAbsent | FileNew | FilePrevious
type RecordRun = { phase: RecordPhase, switched: bool, hasPrev: bool, prevReceipts: int, file: WrittenFile, fileReceipts: int, releaseFailed: bool }
pure val initial: RecordRun = { phase: PhaseUnconfigured, switched: false, hasPrev: false, prevReceipts: 0, file: FileAbsent, fileReceipts: 0, releaseFailed: false }
pure def canConfigure(r: RecordRun, switched: bool, hasPrev: bool, prevReceipts: int): bool =
  r.phase == PhaseUnconfigured and prevReceipts >= 0 and prevReceipts <= 3
pure def configure(r: RecordRun, switched: bool, hasPrev: bool, prevReceipts: int): RecordRun =
  { phase: PhaseStart, switched: switched, hasPrev: hasPrev, prevReceipts: if (hasPrev) prevReceipts else 0,
    file: FileAbsent, fileReceipts: 0, releaseFailed: false }
pure def canSkip(r: RecordRun): bool = r.phase == PhaseStart and not(r.switched)
pure def skip(r: RecordRun): RecordRun = { ...r, phase: PhaseSkipped }
pure def canBuild(r: RecordRun, receiptsRead: bool, added: int): bool =
  r.phase == PhaseStart and r.switched and added >= 0 and added <= 2
pure def build(r: RecordRun, receiptsRead: bool, added: int): RecordRun =
  { ...r, phase: PhaseBuilt, file: FileNew, fileReceipts: r.prevReceipts + (if (receiptsRead) added else 0) }
pure def canFailBuild(r: RecordRun): bool = r.phase == PhaseStart and r.switched
pure def failBuild(r: RecordRun): RecordRun =
  if (r.hasPrev) { ...r, phase: PhasePrevious, file: FilePrevious, fileReceipts: r.prevReceipts }
  else { ...r, phase: PhaseNone }
pure def alwaysNeverFailsRelease(r: RecordRun): bool = not(r.releaseFailed)
pure def alwaysNothingWrittenWhenSkippedOrNone(r: RecordRun): bool =
  (r.phase == PhaseStart implies r.file == FileAbsent)
    and (r.phase == PhaseSkipped implies r.file == FileAbsent)
    and (r.phase == PhaseNone implies (r.file == FileAbsent and not(r.hasPrev)))
pure def alwaysFailureWritesPreviousOnly(r: RecordRun): bool =
  r.phase == PhasePrevious implies (r.file == FilePrevious and r.hasPrev)
pure def alwaysPublishedReceiptsNeverDisappear(r: RecordRun): bool =
  (r.file != FileAbsent implies r.fileReceipts >= r.prevReceipts)
    and (not(r.hasPrev) implies r.prevReceipts == 0)
    and r.prevReceipts >= 0 and r.fileReceipts >= 0
pure def sometimesBuiltWithNewReceipts(r: RecordRun): bool =
  r.phase == PhaseBuilt and r.file == FileNew and r.fileReceipts > r.prevReceipts
pure def sometimesBuiltKeptReceiptsOnReadError(r: RecordRun): bool =
  r.phase == PhaseBuilt and r.hasPrev and r.prevReceipts > 0 and r.fileReceipts == r.prevReceipts
pure def sometimesFailedWrotePrevious(r: RecordRun): bool =
  r.phase == PhasePrevious and r.file == FilePrevious and not(r.releaseFailed)
pure def sometimesFailedWithoutPrevious(r: RecordRun): bool =
  r.phase == PhaseNone and r.file == FileAbsent
pure def sometimesSkipped(r: RecordRun): bool =
  r.phase == PhaseSkipped and r.file == FileAbsent
pure val prevReceiptsValues = Set(0, 1, 2, 3)
pure val addedValues = Set(0, 1, 2)
```
