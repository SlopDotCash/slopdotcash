# Finalized Solana payment discovery and checkpoints

PRD sections 6 and 12 require evidence to reconcile the reviewed vault and
never infer `paid` from a transaction handoff. The exact legacy source is
`0d0f0817a439df03cc022bf7aeed4bbe64ef4c65`, including
`workers/payments/scanner.ts`, `workers/payments/index.ts`,
`backend/payments/README.md`, `contracts/solana/adapter.ts`,
`migrations/0012_solana_scan_backlog.sql`, `workers/payments/solana-progress.workflow.mjs`
and `formal/models/payments/solana_scan_checkpoint.qnt`.
This machine owns one immutable project/PDA/program/network deployment.
Authoritative vault snapshots, payment event verification and obligations have
separate owners. A checkpoint alone never changes a balance or payment status.

## Story: Discover a complete frozen interval before processing

### A fresh scan invocation verifies the selected endpoint's network

The shell binds an authenticated, exact trusted network genesis observation to
each invocation before creating a scan row, fetching a page or reading a staged
transaction. A missing configured genesis refuses before any RPC. A mismatch
or an unavailable read refuses after the identity lookup and changes no scanner
state. A previously captured response can still be checked against its own
same-run evidence and exact revision. An accepted identity result never
substitutes for a missing or failed transaction read.

```quint
type ChainIdentity = MissingPin | WrongGenesis | GenesisUnavailable | PinnedGenesis
type IntervalPhase = Idle | Discovering | Processing
type Scan = { phase: IntervalPhase, generation: int, revision: int, cursor: str, frozenUntil: str,
  beforeSignature: str, pending: List[str] }
pure val initial: Scan = { phase: Idle, generation: 0, revision: 0, cursor: "", frozenUntil: "",
  beforeSignature: "", pending: List() }
pure val identityValues = Set(MissingPin, WrongGenesis, GenesisUnavailable, PinnedGenesis)
pure val weight_openInterval = 4
pure val weight_discoverPage = 5
pure val weight_checkpoint = 8
pure val weight_closeInterval = 3
pure def mayRequestGenesis(identity: ChainIdentity): bool = identity != MissingPin
pure def canOpenInterval(s: Scan, generation: int, identity: ChainIdentity): bool =
  s.phase == Idle and generation > s.generation and identity == PinnedGenesis
pure def openInterval(s: Scan, generation: int, identity: ChainIdentity): Scan =
  { ...s, phase: Discovering, generation: generation, revision: 0, frozenUntil: s.cursor,
    beforeSignature: "", pending: List() }
pure def sameCheckpoint(s: Scan, generation: int, revision: int): bool =
  generation == s.generation and revision == s.revision
```

### Store one page per invocation and keep the old cursor as the interval boundary

The adapter reads finalized signatures in descending chain order, using the
frozen prior cursor and the saved oldest signature as RPC bounds. The model's
`oldestFirst` is the verified ordering of the new page, so prepending it to the
existing list represents taking the greatest staged page number first. The
real page limit is 1,000. A short page, including an empty response, completes
discovery. Full pages may be resumed after restart; simulation includes a
full 1,000-signature page so the resume path is reached. Newly arriving signatures
above the first page belong to a future interval. Failed or malformed reads
leave all checkpoints untouched. Interval generation and revision are compared
atomically with page insert and progress, including for an empty result.

```quint
type PageCoverage = FullPage | ShortPage | UnavailablePage
pure val tenSignatures = List("f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9")
pure val hundredSignatures = tenSignatures.foldl(List(), (acc, ignored) => acc.concat(tenSignatures))
pure val fullPageSample = tenSignatures.foldl(List(), (acc, ignored) => acc.concat(hundredSignatures))
pure val coverageValues = Set(FullPage, ShortPage, UnavailablePage)
pure val oldestFirstValues = Set(List(), List("a"), List("b", "c")).union(Set(fullPageSample))
pure val generationValues = Set(1, 2, 3)
pure val revisionValues = Set(0, 1, 2, 3, 4)
pure def validPage(oldestFirst: List[str], coverage: PageCoverage): bool =
  oldestFirst.every(id => id != "") and
  ((coverage == FullPage and oldestFirst.length() == 1000) or (coverage == ShortPage and oldestFirst.length() < 1000))
pure def canDiscoverPage(s: Scan, generation: int, revision: int, identity: ChainIdentity, oldestFirst: List[str], coverage: PageCoverage): bool =
  s.phase == Discovering and identity == PinnedGenesis and sameCheckpoint(s, generation, revision)
    and s.revision < 9007199254740991 and validPage(oldestFirst, coverage)
pure def discoverPage(s: Scan, generation: int, revision: int, identity: ChainIdentity, oldestFirst: List[str], coverage: PageCoverage): Scan =
  { ...s, phase: if (coverage == ShortPage) Processing else Discovering, revision: s.revision + 1,
    beforeSignature: oldestFirst.nthOr(0, s.beforeSignature), pending: oldestFirst.concat(s.pending) }
```

## Story: Checkpoint only after a fully observed transaction

### Stale or partial work leaves the authoritative prefix intact

A signature marked failed in its finalized list can be skipped. A successfully
listed signature needs a finalized transaction with successful metadata.
Unrelated program instructions and other vaults may be skipped. All relevant
instructions for the exact project/PDA and configured program must be verified
and durably indexed before advancing the prefix. Missing transactions, award
accounts, identifiers, and partially indexed transactions hold the checkpoint.
Retry may replay already indexed events using their immutable evidence keys.
An invocation processes at most 100 transactions. For each full transaction,
the cursor, staged page prefix and revision advance in one compare-and-swap.
A stale worker may finish an idempotent observation but cannot checkpoint or
close a successor revision or generation. Empty complete intervals retain the
old cursor. Process restart drops transient work and retains the frozen interval
and authoritative prefix.

```quint
type Observation = ListedFailure | FullyIndexed | FinalizedUnrelated | Incomplete
pure val signatureValues = Set("a", "b", "c", "other")
pure val observationValues = Set(ListedFailure, FullyIndexed, FinalizedUnrelated, Incomplete)
pure def mayCapture(s: Scan, generation: int, revision: int, identity: ChainIdentity, signature: str): bool =
  s.phase == Processing and sameCheckpoint(s, generation, revision) and identity == PinnedGenesis
    and signature != "" and s.pending.nthOr(0, "") == signature
pure def canCheckpoint(s: Scan, generation: int, revision: int, identity: ChainIdentity, signature: str, observation: Observation): bool =
  mayCapture(s, generation, revision, identity, signature) and s.revision < 9007199254740991 and observation != Incomplete
pure def checkpoint(s: Scan, generation: int, revision: int, identity: ChainIdentity, signature: str, observation: Observation): Scan =
  { ...s, pending: s.pending.removeAt(0), cursor: signature, revision: s.revision + 1 }
pure def canCloseInterval(s: Scan, generation: int, revision: int, identity: ChainIdentity): bool =
  s.phase == Processing and identity == PinnedGenesis and sameCheckpoint(s, generation, revision) and s.pending.length() == 0
pure def closeInterval(s: Scan, generation: int, revision: int, identity: ChainIdentity): Scan =
  { ...s, phase: Idle, frozenUntil: "", beforeSignature: "" }
pure def alwaysIdleEmpty(s: Scan): bool = s.phase == Idle implies
  s.pending.length() == 0 and s.frozenUntil == "" and s.beforeSignature == ""
pure def alwaysIdentity(s: Scan): bool = s.generation >= 0 and s.revision >= 0
  and (s.phase != Idle implies s.generation > 0)
pure def stepOnlyCheckpointChangesCursor(before: Scan, via: str, after: Scan): bool =
  via != "checkpoint" implies after.cursor == before.cursor
pure def stepNeverRewinds(before: Scan, after: Scan): bool = after.generation >= before.generation
  and (after.generation == before.generation implies after.revision >= before.revision)
pure def stepFrozenBoundary(before: Scan, via: str, after: Scan): bool =
  (via != "openInterval" and via != "closeInterval") implies after.frozenUntil == before.frozenUntil
pure def sometimesStaged(s: Scan): bool = s.phase == Processing and s.pending.length() > 0
pure def sometimesFullPageResumes(s: Scan): bool = s.phase == Discovering and s.pending.length() >= 1000
pure def sometimesCheckpointed(s: Scan): bool = s.phase == Processing and s.cursor != ""
pure def sometimesClosedAfterProgress(s: Scan): bool = s.phase == Idle and s.cursor != ""
```
