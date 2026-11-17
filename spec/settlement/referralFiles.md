# Public referral accrual files

PRD section 11 publishes every filed referral month so that anyone can
recompute it from the public payment record, and the
[independent watcher](./referralWatch.md) reads exactly these bytes. The
[accrual ledger](./referralAccrual.md) files one month at a time in epoch
order; each stored file keeps the exact JSON bytes the job filed, their
SHA-256, the Merkle root and total of its tree and its leaf count. Source
anchors are development `backend/referrals/handler.ts` (`handleReferralsApi`)
and migration `0086_referral_accruals.sql` (`referral_accrual_files`). The
routes read no session and no key, and there is no write route. Rendering
the JSON, the URL path and the response headers belongs to the shell.

## Story: Serve every filed month exactly as it was filed

### The index lists every filed period once in epoch order with its digest, root, total, leaf count and URL

`GET /api/v1/referrals/accruals` answers the schema
`slop-referral-accrual-index-v1` with one entry per stored file, ordered by
epoch: its period (`YYYY-MM`), epoch, mode, body digest, Merkle root (none
for an empty tree), tree total in base units, leaf count, filing time and
its URL `/api/v1/referrals/accruals/<period>`. Files are stored only in
epoch order, one per period, so the index never lists a period twice.

```quint
import money as M from "./money"
type FileMode = DryRunFile | PostingFile
type StoredFile = { period: int, epoch: int, mode: FileMode, body: str, bodySha256: str, merkleRoot: str,
  treeTotal: M::Amount, leafCount: int, createdAt: int }
type IndexEntry = { period: int, epoch: int, mode: FileMode, bodySha256: str, merkleRoot: str,
  treeTotal: M::Amount, leafCount: int, createdAt: int }
type EpochFold = { position: int, ordered: bool }
pure def filedInEpochOrder(files: List[StoredFile]): bool =
  files.foldl({ position: 0, ordered: true }, (acc, f) => { position: acc.position + 1,
    ordered: acc.ordered and f.epoch == acc.position and files.select(o => o.period == f.period).length() == 1 }).ordered
pure def indexEntry(f: StoredFile): IndexEntry = { period: f.period, epoch: f.epoch, mode: f.mode, bodySha256: f.bodySha256,
  merkleRoot: f.merkleRoot, treeTotal: f.treeTotal, leafCount: f.leafCount, createdAt: f.createdAt }
pure def accrualIndex(files: List[StoredFile]): List[IndexEntry] = files.listMap(f => indexEntry(f))
```

### A period file answers its exact stored bytes and the SHA-256 recorded when it was filed

`GET /api/v1/referrals/accruals/<period>`, with or without a `.json`
suffix, answers the stored body unchanged and the digest recorded at filing
in the `x-slop-sha256` header. `HEAD` answers the same status and headers
with an empty body. The digest is never recomputed at read time, so a
changed body shows up as a mismatch to any reader.

```quint
type Method = GetMethod | HeadMethod | OtherMethod
type FileError = NoError | NotFound | MethodNotAllowed | ReadFailed
type FileRequest = { method: Method, wantsIndex: bool, period: int, wellFormed: bool }
type FileAnswer = { status: int, error: FileError, body: str, digest: str, entries: List[IndexEntry], cacheSeconds: int }
pure val publicCacheSeconds = 300
pure val noEntries: List[IndexEntry] = List()
pure def fileFor(files: List[StoredFile], period: int): StoredFile =
  files.select(f => f.period == period).nthOr(0, { period: 0, epoch: -1, mode: DryRunFile, body: "", bodySha256: "",
    merkleRoot: "", treeTotal: M::zero, leafCount: 0, createdAt: 0 })
```

### A malformed or unfiled period is not found and only GET and HEAD are answered

A path segment that is not a calendar month, or a month with no stored file,
answers 404 `not_found`. Any method other than `GET` and `HEAD` answers 405
`method_not_allowed`.

```quint
pure def answerFiles(files: List[StoredFile], request: FileRequest, readSucceeded: bool): FileAnswer =
  val none = { status: 0, error: NoError, body: "", digest: "", entries: noEntries, cacheSeconds: publicCacheSeconds }
  val stored = fileFor(files, request.period)
  if (request.method == OtherMethod) { ...none, status: 405, error: MethodNotAllowed }
  else if (not(readSucceeded)) { ...none, status: 500, error: ReadFailed, cacheSeconds: 0 }
  else if (request.wantsIndex) { ...none, status: 200, entries: accrualIndex(files) }
  else if (not(request.wellFormed) or stored.epoch < 0) { ...none, status: 404, error: NotFound }
  else { ...none, status: 200, body: if (request.method == HeadMethod) "" else stored.body, digest: stored.bodySha256 }
```

### Every answer is publicly cacheable for five minutes and a read failure is an explicit error, never an empty index

Every answer other than a failure carries `public, max-age=300`. A database
failure answers the redacted API error (`referral accruals API failure`);
it never answers an empty index or a missing file, which a reader would take
for "nothing filed".

```quint
pure def lawFailureIsNeverEmptyIndex(files: List[StoredFile], request: FileRequest): bool =
  request.method != OtherMethod implies
    (answerFiles(files, request, false).status == 500 and answerFiles(files, request, false).error == ReadFailed)
pure def lawHeadHasNoBody(files: List[StoredFile], request: FileRequest): bool =
  request.method == HeadMethod implies answerFiles(files, request, true).body == ""
pure def lawAnswersCacheable(files: List[StoredFile], request: FileRequest): bool =
  answerFiles(files, request, true).cacheSeconds == publicCacheSeconds
pure val fileSample: StoredFile = { period: 24322, epoch: 0, mode: DryRunFile, body: "{}", bodySha256: "sha", merkleRoot: "",
  treeTotal: List(0), leafCount: 0, createdAt: 1 }
pure val filesValues = Set(List(), List(fileSample))
pure val requestValues = Set({ method: GetMethod, wantsIndex: true, period: 0, wellFormed: true },
  { method: GetMethod, wantsIndex: false, period: 24322, wellFormed: true }, { method: HeadMethod, wantsIndex: false, period: 24322, wellFormed: true },
  { method: GetMethod, wantsIndex: false, period: 24323, wellFormed: true }, { method: GetMethod, wantsIndex: false, period: 0, wellFormed: false },
  { method: OtherMethod, wantsIndex: true, period: 0, wellFormed: true })
```
