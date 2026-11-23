# Read-only fee Worker diagnostics

The pinned sources are `scripts/inspect-fee-worker-operations.ts`,
`scripts/probe-fee-solana-rpc.ts`, `scripts/inspect-fee-worker-bindings.ts`
with their tests, and `workers/fee-converter/README.md` ("Operations" and
"Diagnose Solana RPC access from Cloudflare"); development's model of a
read-only watch is `formal/models/release/workflow_authority.qnt`. Both
programs run from the manual fee Worker inspection workflow and only read:
they never change a Worker version, setting, schedule, binding or secret,
never write a fee journal record, and never sign or submit anything. Their
only output is the run's report in the runner's temporary directory, which
keeps allowlisted event names, error categories, fixed method names,
aggregate amounts and, for a claim error, a conversion error or a Solana
buyback bridge-leg error, the provider failure the Worker logged: its
provider (EVM RPC, Solana RPC, Jupiter or KyberSwap), its stage (deployment
check, RPC response or response JSON), an allowlisted method of that
provider when it names one and an HTTP status from 100 to 599 when it has
one, and nothing else; raw tail messages and RPC URLs are discarded in memory. A
diagnostic never stands for a completed deployment, payment or scan.

Versions, deployments and sources are opaque integers here. One instance
follows one run.

## Story: Inspect the exact active fee Worker without changing anything

### A fee diagnostic starts only on protected main, reads the exact active Worker before and after, and writes nothing

A run needs the `main` ref and the runner's temporary directory ("Main
runner required"). It first pins the exact active fee Worker: its version,
deployment and source tag. The inspection then checks that the pinned
version binds the reviewed fee database (`FEE_DB`), reads the schedule and
three fixed queries in order, each bounded by its own limit (the network
locks, at most 4 rows; the native gas journal, at most 500; the latest
attempts, at most 100), and opens one 90-second tail of that exact version,
which it removes before it reports; a tail whose removal fails refuses the
run ("Fee tail cleanup failed"). The RPC probe instead uploads one
ephemeral preview Worker with no bindings, sending the private candidate
URL only in the authenticated preview request and storing it nowhere, and
reads no fee table. Either finishes only when the active version,
deployment and source tag read again equal the pin; otherwise it refuses
("Fee Worker changed during diagnostics", "Active fee version changed").

```quint
type DiagnosticKind = Inspection | RpcProbe
type DiagnosticPhase = Idle | Pinned | Reading | Tailing | Inspected | Done | Refused
type Pin = { version: int, deployment: int, source: int }
type DiagnosticRun = { kind: DiagnosticKind, mainRef: bool, runnerTemp: bool, pin: Pin }
type QueryName = LocksQuery | GasQuery | AttemptsQuery
type QueryRead = { query: QueryName, accepted: bool, rows: int }
type TailEnd = { delivered: bool, removed: bool }
type PreviewUpload = { accepted: bool, bindings: int, candidateStored: bool }
type Diagnostic = { kind: DiagnosticKind, phase: DiagnosticPhase, pin: Pin, reads: int, rows: int, tailOpen: bool,
  tailRemoved: bool, previewUploaded: bool }
pure val noPin: Pin = { version: 0, deployment: 0, source: 0 }
pure val initial: Diagnostic = { kind: Inspection, phase: Idle, pin: noPin, reads: 0, rows: 0, tailOpen: false,
  tailRemoved: false, previewUploaded: false }
pure def pinValid(pin: Pin): bool = pin.version > 0 and pin.deployment > 0 and pin.source > 0
pure def queryAt(index: int): QueryName = if (index == 0) LocksQuery else if (index == 1) GasQuery else AttemptsQuery
pure def rowLimit(query: QueryName): int = if (query == LocksQuery) 4 else if (query == GasQuery) 500 else 100
pure def limitsThrough(reads: int): int = if (reads <= 0) 0 else if (reads == 1) 4 else if (reads == 2) 504 else 604
pure def canStartDiagnostic(d: Diagnostic, request: DiagnosticRun): bool = d.phase == Idle
pure def startDiagnostic(d: Diagnostic, request: DiagnosticRun): Diagnostic =
  if (request.mainRef and request.runnerTemp and pinValid(request.pin)) { ...d, kind: request.kind, phase: Pinned, pin: request.pin }
  else { ...d, kind: request.kind, phase: Refused }
pure def canCheckBinding(d: Diagnostic, bindingMatches: bool): bool = d.phase == Pinned and d.kind == Inspection
pure def checkBinding(d: Diagnostic, bindingMatches: bool): Diagnostic =
  { ...d, phase: if (bindingMatches) Reading else Refused }
pure def canReadQuery(d: Diagnostic, read: QueryRead): bool =
  d.phase == Reading and d.kind == Inspection and d.reads < 3 and read.query == queryAt(d.reads)
    and read.rows >= 0 and read.rows <= rowLimit(read.query)
pure def readQuery(d: Diagnostic, read: QueryRead): Diagnostic =
  if (read.accepted) { ...d, reads: d.reads + 1, rows: d.rows + read.rows } else { ...d, phase: Refused }
pure def canOpenTail(d: Diagnostic, opened: bool): bool = d.phase == Reading and d.kind == Inspection and d.reads == 3
pure def openTail(d: Diagnostic, opened: bool): Diagnostic =
  if (opened) { ...d, phase: Tailing, tailOpen: true } else { ...d, phase: Refused }
pure def canEndTail(d: Diagnostic, tailEnd: TailEnd): bool = d.phase == Tailing and d.tailOpen
pure def endTail(d: Diagnostic, tailEnd: TailEnd): Diagnostic =
  { ...d, tailOpen: not(tailEnd.removed), tailRemoved: tailEnd.removed,
    phase: if (tailEnd.delivered and tailEnd.removed) Inspected else Refused }
pure def canUploadPreview(d: Diagnostic, upload: PreviewUpload): bool =
  d.phase == Pinned and d.kind == RpcProbe and upload.bindings == 0 and not(upload.candidateStored)
pure def uploadPreview(d: Diagnostic, upload: PreviewUpload): Diagnostic =
  { ...d, previewUploaded: true, phase: if (upload.accepted) Inspected else Refused }
pure def canRecheckPin(d: Diagnostic, pinAfter: Pin): bool = d.phase == Inspected
pure def recheckPin(d: Diagnostic, pinAfter: Pin): Diagnostic = { ...d, phase: if (pinAfter == d.pin) Done else Refused }
pure def alwaysReadsBounded(d: Diagnostic): bool = d.reads >= 0 and d.reads <= 3 and d.rows >= 0 and d.rows <= limitsThrough(d.reads)
pure def alwaysProbeReadsNoFeeTable(d: Diagnostic): bool = d.kind == RpcProbe implies d.reads == 0 and not(d.tailOpen) and not(d.tailRemoved)
pure def alwaysInspectionNeverUploads(d: Diagnostic): bool = d.kind == Inspection implies not(d.previewUploaded)
pure def alwaysFinishedLeavesNoTail(d: Diagnostic): bool = (d.phase == Inspected or d.phase == Done) implies
  not(d.tailOpen) and pinValid(d.pin) and (if (d.kind == Inspection) d.tailRemoved and d.reads == 3 else d.previewUploaded)
pure def alwaysPhasesConsistent(d: Diagnostic): bool =
  ((d.phase == Pinned or d.phase == Reading or d.phase == Tailing) implies pinValid(d.pin))
    and ((d.phase == Reading or d.phase == Tailing) implies d.kind == Inspection)
    and (d.phase == Tailing implies d.reads == 3 and d.tailOpen and not(d.tailRemoved))
    and ((d.phase == Idle or d.phase == Pinned or d.phase == Reading) implies not(d.tailOpen) and not(d.tailRemoved))
    and ((d.phase == Idle or d.phase == Pinned) implies d.reads == 0 and not(d.previewUploaded))
pure def stepPinFixed(before: Diagnostic, after: Diagnostic): bool = before.phase != Idle implies after.pin == before.pin and after.kind == before.kind
pure def stepRefusedIsFinal(before: Diagnostic, after: Diagnostic): bool =
  (before.phase == Refused or before.phase == Done) implies after == before
pure def sometimesInspectionDone(d: Diagnostic): bool = d.kind == Inspection and d.phase == Done
pure def sometimesProbeDone(d: Diagnostic): bool = d.kind == RpcProbe and d.phase == Done
pure def sometimesChangedDuringDiagnostics(d: Diagnostic): bool = d.phase == Refused and d.tailRemoved and d.reads == 3
pure def sometimesRefusedOffMain(d: Diagnostic): bool = d.phase == Refused and not(pinValid(d.pin))
pure def sometimesTailLeftOpen(d: Diagnostic): bool = d.phase == Refused and d.tailOpen
```

### Simulation samples cover matching, changed and refused pins and reads

These sets bound simulation only.

```quint
pure val pinSample: Pin = { version: 10, deployment: 20, source: 7 }
pure val requestValues = Set({ kind: Inspection, mainRef: true, runnerTemp: true, pin: pinSample },
  { kind: RpcProbe, mainRef: true, runnerTemp: true, pin: pinSample },
  { kind: Inspection, mainRef: false, runnerTemp: true, pin: pinSample })
pure val bindingMatchesValues = Set(true, false)
pure val readValues = Set({ query: LocksQuery, accepted: true, rows: 4 }, { query: GasQuery, accepted: true, rows: 500 },
  { query: AttemptsQuery, accepted: true, rows: 100 }, { query: AttemptsQuery, accepted: true, rows: 101 },
  { query: GasQuery, accepted: false, rows: 0 })
pure val openedValues = Set(true, false)
pure val tailEndValues = Set({ delivered: true, removed: true }, { delivered: false, removed: true }, { delivered: true, removed: false })
pure val uploadValues = Set({ accepted: true, bindings: 0, candidateStored: false }, { accepted: false, bindings: 0, candidateStored: false },
  { accepted: true, bindings: 1, candidateStored: false })
pure val pinAfterValues = Set(pinSample).union(Set({ ...pinSample, version: 11 }))
```
