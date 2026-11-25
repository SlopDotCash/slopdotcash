# Scheduled scanner controller

PRD sections 8 and 11. `.github/workflows/vetting-controller.yml` dispatches
the bounded [admission scanner](./admission.md) on the protected `main` and
`development` branches. The scan job runs only on the isolated runner that
the release of the same branch head deployed, or on a later commit of the
same branch that changed no scanner input. The dispatch step refuses
anything else before any scan. Each release publishes the scanner input list
at `/scanner-inputs.json`, so a scheduler without a checkout applies the
same rule.

## Story: Dispatch a scan only for the deployed release of the branch head or an equivalent later commit

### Each protected branch tracks its head, its released head and its active scans

```quint
type Ref = Main | Development
type Branch = { head: int, releasedSha: int, deployed: bool, activeRuns: int, runSha: int, compareReadable: bool, scannerChanged: bool, compareFiles: int }
type Controller = { main: Branch, development: Branch, dispatches: int, skips: int }
pure val noBranch: Branch = { head: 1, releasedSha: 0, deployed: false, activeRuns: 0, runSha: 0, compareReadable: false, scannerChanged: false, compareFiles: 0 }
pure val initial: Controller = { main: noBranch, development: noBranch, dispatches: 0, skips: 0 }
pure def branchOf(c: Controller, ref: Ref): Branch = if (ref == Main) c.main else c.development
pure def withBranch(ref: Ref, b: Branch, c: Controller): Controller = if (ref == Main) { ...c, main: b } else { ...c, development: b }
pure def canPush(c: Controller, ref: Ref, sha: int): bool = sha > 0 and sha != branchOf(c, ref).head
pure def push(c: Controller, ref: Ref, sha: int): Controller = withBranch(ref, { ...branchOf(c, ref), head: sha }, c)
pure def canCompleteRelease(c: Controller, ref: Ref, sha: int, deployed: bool): bool = sha == branchOf(c, ref).head
pure def completeRelease(c: Controller, ref: Ref, sha: int, deployed: bool): Controller =
  withBranch(ref, { ...branchOf(c, ref), releasedSha: sha, deployed: deployed }, c)
pure val shaValues = Set(1, 2, 3)
```

### A run dispatches only when every gate holds and otherwise skips

The schedule variable, the released head with a successful deployment job,
an unchanged head, no non-completed controller run on the branch and the
scanner release variable (which gates the scan job) are all required. A
release completes only for the head it built. A branch that advanced past its
release waits for its new head to deploy, unless the advance changed no
scanner input: the dispatch compares the released commit with the branch
head, and a head ahead of the release by fewer than 300 files, with no
changed scanner input, still dispatches on the released runner. A compare
that cannot be read, a head that is not ahead of the release, or a changed
scanner input waits for the new head to deploy. The per-ref concurrency group
never cancels a run in progress.

```quint
type Gate = { scheduleEnabled: bool, releaseEnabled: bool }
pure val gateValues = Set({ scheduleEnabled: true, releaseEnabled: true }, { scheduleEnabled: false, releaseEnabled: true },
  { scheduleEnabled: true, releaseEnabled: false })
pure def headIsEquivalent(b: Branch): bool = b.compareReadable and b.head > b.releasedSha
  and not(b.scannerChanged) and b.compareFiles < 300
pure def mayDispatch(b: Branch, gate: Gate): bool = gate.scheduleEnabled and gate.releaseEnabled and b.deployed
  and b.releasedSha > 0 and (b.head == b.releasedSha or headIsEquivalent(b)) and b.activeRuns == 0
pure def dispatch(c: Controller, ref: Ref, gate: Gate): Controller =
  val b = branchOf(c, ref)
  if (mayDispatch(b, gate)) { ...withBranch(ref, { ...b, activeRuns: b.activeRuns + 1, runSha: b.head }, c), dispatches: c.dispatches + 1 }
  else { ...c, skips: c.skips + 1 }
pure def canFinishRun(c: Controller, ref: Ref): bool = branchOf(c, ref).activeRuns > 0
pure def finishRun(c: Controller, ref: Ref): Controller = withBranch(ref, { ...branchOf(c, ref), activeRuns: 0 }, c)
pure def alwaysOneActiveScanPerRef(c: Controller): bool =
  branchOf(c, Main).activeRuns >= 0 and branchOf(c, Main).activeRuns <= 1
    and branchOf(c, Development).activeRuns >= 0 and branchOf(c, Development).activeRuns <= 1
pure def alwaysActiveRunBound(c: Controller): bool =
  (branchOf(c, Main).activeRuns > 0 implies branchOf(c, Main).runSha > 0)
    and (branchOf(c, Development).activeRuns > 0 implies branchOf(c, Development).runSha > 0)
pure def lawUndeployedHeadSkips(c: Controller, ref: Ref, gate: Gate): bool =
  not(mayDispatch(branchOf(c, ref), gate)) implies dispatch(c, ref, gate).dispatches == c.dispatches
    and dispatch(c, ref, gate).skips == c.skips + 1
pure def lawDispatchScansReleasedOrEquivalentHead(c: Controller, ref: Ref, gate: Gate): bool =
  dispatch(c, ref, gate).dispatches > c.dispatches implies
    branchOf(dispatch(c, ref, gate), ref).runSha == branchOf(c, ref).head and branchOf(c, ref).deployed
    and (branchOf(c, ref).head == branchOf(c, ref).releasedSha or headIsEquivalent(branchOf(c, ref)))
pure def lawScannerChangeWaitsForRelease(c: Controller, ref: Ref, gate: Gate): bool =
  branchOf(c, ref).head != branchOf(c, ref).releasedSha and branchOf(c, ref).scannerChanged implies
    dispatch(c, ref, gate).dispatches == c.dispatches
pure def lawUnreadableCompareWaitsForRelease(c: Controller, ref: Ref, gate: Gate): bool =
  branchOf(c, ref).head != branchOf(c, ref).releasedSha and not(branchOf(c, ref).compareReadable) implies
    dispatch(c, ref, gate).dispatches == c.dispatches
pure def lawLargeCompareWaitsForRelease(c: Controller, ref: Ref, gate: Gate): bool =
  branchOf(c, ref).head != branchOf(c, ref).releasedSha and branchOf(c, ref).compareFiles >= 300 implies
    dispatch(c, ref, gate).dispatches == c.dispatches
pure def sometimesDispatched(c: Controller): bool = branchOf(c, Main).activeRuns > 0 and branchOf(c, Development).activeRuns > 0
pure def sometimesAdvancedHeadSkipped(c: Controller): bool = c.skips > 0 and branchOf(c, Main).releasedSha > 0
  and branchOf(c, Main).deployed and branchOf(c, Main).head != branchOf(c, Main).releasedSha
pure def sometimesEquivalentHeadDispatched(c: Controller): bool =
  branchOf(c, Main).activeRuns > 0 and branchOf(c, Main).head != branchOf(c, Main).releasedSha
    and not(branchOf(c, Main).scannerChanged) and branchOf(c, Main).compareReadable
    and branchOf(c, Main).compareFiles < 300
```

## Story: Publish the scanner input list with each release

### The scanner inputs are the files the admission scan depends on

The scanner inputs are the relative-import closure of the scan program
entry `apps/security/src/programs/main.vibe` and the sandbox supervisor
`apps/security/sandbox/supervise.py`; every non-test, non-Markdown file under
`apps/security/`; every file under `spec/security/` except Dafny proofs
(`*.proof.dfy`), because the scanner is generated from the security spec;
and `.github/workflows/vetting-controller.yml`, `package.json`, and
`pnpm-lock.yaml`. An import the closure cannot resolve refuses the list:
`scripts/scanner-inputs.mjs` fails naming the unresolvable import, so the
deploy step fails and the release publishes no list.

### Each release publishes its input list beside the template index

The deploy workflow writes `scanner-inputs.json` into the published site
with the release commit and the sorted scanner input files:

```json
{ "commit": "<release commit>", "files": ["apps/security/..."] }
```

A scheduler without a checkout reads the served list at
`/scanner-inputs.json`, compares the served commit with the branch head, and
applies the same rule: the head runs on the served release when the compare
is readable, the head is ahead of the served commit, fewer than 300 files
changed, and none of them is a scanner input.

```quint
type ScannerInputs = { commit: int, scannerFiles: Set[int] }
type Compare = { base: int, head: int, readable: bool, files: Set[int] }
pure def publishedInputs(commit: int, scannerFiles: Set[int]): ScannerInputs =
  { commit: commit, scannerFiles: scannerFiles }
pure def changedScannerInputs(inputs: ScannerInputs, compare: Compare): Set[int] =
  compare.files.intersect(inputs.scannerFiles)
pure def mayRunOnEarlierRelease(inputs: ScannerInputs, compare: Compare): bool =
  compare.readable and compare.base == inputs.commit and compare.files.size() < 300
    and changedScannerInputs(inputs, compare).isEmpty()
pure def lawPublishedListNamesItsCommit(inputs: ScannerInputs, commit: int, scannerFiles: Set[int]): bool =
  publishedInputs(commit, scannerFiles) == { commit: commit, scannerFiles: scannerFiles }
pure def lawScannerInputChangeRefuses(inputs: ScannerInputs, compare: Compare): bool =
  not(changedScannerInputs(inputs, compare).isEmpty()) implies not(mayRunOnEarlierRelease(inputs, compare))
pure def lawUnreadableCompareRefuses(inputs: ScannerInputs, compare: Compare): bool =
  not(compare.readable) implies not(mayRunOnEarlierRelease(inputs, compare))
pure def lawLargeCompareRefuses(inputs: ScannerInputs, compare: Compare): bool =
  compare.files.size() >= 300 implies not(mayRunOnEarlierRelease(inputs, compare))
```
