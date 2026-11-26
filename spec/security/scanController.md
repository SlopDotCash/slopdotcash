# Scheduled scanner controller

PRD sections 8 and 11. `.github/workflows/vetting-controller.yml` dispatches
the bounded [admission scanner](./admission.md) on the protected `main` and
`development` branches. The scan job runs only on the isolated runner that
the release of the same branch deployed, at the branch head or at an earlier
commit of the branch with no scanner input changed since (PRD section 8,
operator decision of 23 November 2026). The controller then refuses anything
but the exact protected workflow checkout and verified rate cards, before any
scan.

## Story: Dispatch a scan only for the deployed release of the branch head

### Each protected branch tracks its head, its released head and its active scans

A push records whether the new head still descends from the released
commit (`ahead`) and whether any commit since the release changed a scanner
input (`scannerChanged`). Returning to the released commit itself changes
nothing in the scanner. A deployed release serves the scanner input list of
its own commit (`inputsSha`). A scan run keeps the deployed scanner it runs
on (`runSha`) and the branch head it checks out (`runHead`).

```quint
type Ref = Main | Development
type Branch = { head: int, releasedSha: int, deployed: bool, activeRuns: int, runSha: int,
  ahead: bool, scannerChanged: bool, inputsSha: int, runHead: int }
type Controller = { main: Branch, development: Branch, dispatches: int, skips: int }
pure val noBranch: Branch = { head: 1, releasedSha: 0, deployed: false, activeRuns: 0, runSha: 0,
  ahead: false, scannerChanged: false, inputsSha: 0, runHead: 0 }
pure val initial: Controller = { main: noBranch, development: noBranch, dispatches: 0, skips: 0 }
pure def branchOf(c: Controller, ref: Ref): Branch = if (ref == Main) c.main else c.development
pure def withBranch(ref: Ref, b: Branch, c: Controller): Controller = if (ref == Main) { ...c, main: b } else { ...c, development: b }
pure def canPush(c: Controller, ref: Ref, sha: int): bool = sha > 0 and sha != branchOf(c, ref).head
pure def push(c: Controller, ref: Ref, sha: int, descends: bool, touchesScanner: bool): Controller =
  val b = branchOf(c, ref)
  if (sha == b.releasedSha) withBranch(ref, { ...b, head: sha, ahead: true, scannerChanged: false }, c)
  else withBranch(ref, { ...b, head: sha, ahead: b.ahead and descends, scannerChanged: b.scannerChanged or touchesScanner }, c)
pure def canCompleteRelease(c: Controller, ref: Ref, sha: int, deployed: bool): bool = sha == branchOf(c, ref).head
pure def completeRelease(c: Controller, ref: Ref, sha: int, deployed: bool): Controller =
  val b = branchOf(c, ref)
  withBranch(ref, { ...b, releasedSha: sha, deployed: deployed, ahead: true, scannerChanged: false,
    inputsSha: if (deployed) sha else b.inputsSha }, c)
pure val shaValues = Set(1, 2, 3)
```

### A run dispatches only when every gate holds and otherwise skips

The schedule variable, the released head with a successful deployment job,
an unchanged head, no non-completed controller run on the branch and the
scanner release variable (which gates the scan job) are all required. A
release completes only for the head it built. A branch that advanced past its
release waits for its new head to deploy, unless the head is a later commit
of the same branch with no scanner input changed since the release (the next
story). The per-ref concurrency group never cancels a run in progress.

```quint
type Gate = { scheduleEnabled: bool, releaseEnabled: bool, inputsReadable: bool }
pure val gateValues = Set({ scheduleEnabled: true, releaseEnabled: true, inputsReadable: true },
  { scheduleEnabled: false, releaseEnabled: true, inputsReadable: true },
  { scheduleEnabled: true, releaseEnabled: false, inputsReadable: true },
  { scheduleEnabled: true, releaseEnabled: true, inputsReadable: false })
pure def unchangedScanner(b: Branch): bool = b.ahead and not(b.scannerChanged)
pure def scansUnchangedRunner(b: Branch, gate: Gate): bool =
  gate.inputsReadable and b.inputsSha == b.releasedSha and unchangedScanner(b)
pure def mayDispatch(b: Branch, gate: Gate): bool = gate.scheduleEnabled and gate.releaseEnabled and b.deployed
  and b.releasedSha > 0 and (b.head == b.releasedSha or scansUnchangedRunner(b, gate)) and b.activeRuns == 0
pure def dispatch(c: Controller, ref: Ref, gate: Gate): Controller =
  val b = branchOf(c, ref)
  if (mayDispatch(b, gate))
    { ...withBranch(ref, { ...b, activeRuns: b.activeRuns + 1, runSha: b.releasedSha, runHead: b.head }, c), dispatches: c.dispatches + 1 }
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
pure def lawDispatchScansReleasedHead(c: Controller, ref: Ref, gate: Gate): bool =
  dispatch(c, ref, gate).dispatches > c.dispatches implies
    branchOf(dispatch(c, ref, gate), ref).runSha == branchOf(c, ref).releasedSha and branchOf(c, ref).deployed
pure def sometimesDispatched(c: Controller): bool = branchOf(c, Main).activeRuns > 0 and branchOf(c, Development).activeRuns > 0
pure def sometimesAdvancedHeadSkipped(c: Controller): bool = c.skips > 0 and branchOf(c, Main).releasedSha > 0
  and branchOf(c, Main).deployed and branchOf(c, Main).head != branchOf(c, Main).releasedSha
```

## Story: Scan on an earlier release of the branch when no scanner input changed since

PRD section 8, operator decision of 23 November 2026: a scan pass runs on the
deployed isolated runner when it reports the controller's own commit, or an
earlier commit of the same branch with no scanner input (the scanner's code,
its imports, the isolated runner, the vetting API, the workflow and the
dependency lock) changed since, so merges that do not touch the scanner do not
hold scans until their own release. Each release publishes that input list for
its commit at `/scanner-inputs.json`, so a scheduler without a checkout applies
the same rule.

### A deployed release serves the scanner input list of its own commit

The release that deploys a commit publishes that commit's scanner input list
with it; the dispatcher reads the list and the commit it names from the site,
not from a checkout.

```quint
pure def alwaysServedInputsMatchRelease(c: Controller): bool =
  (branchOf(c, Main).deployed implies branchOf(c, Main).inputsSha == branchOf(c, Main).releasedSha)
    and (branchOf(c, Development).deployed implies branchOf(c, Development).inputsSha == branchOf(c, Development).releasedSha)
pure def alwaysReleasedHeadIsUnchanged(c: Controller): bool =
  (branchOf(c, Main).head == branchOf(c, Main).releasedSha implies unchangedScanner(branchOf(c, Main)))
    and (branchOf(c, Development).head == branchOf(c, Development).releasedSha implies unchangedScanner(branchOf(c, Development)))
```

### A later head dispatches only when it descends from the release and no scanner input changed

A dispatch for a head other than the deployed commit needs a readable,
complete compare showing the head ahead of that commit and the served input
list of that commit, and no listed input (or path in a scanner directory)
changed in between. A force push, a scanner change or an unreadable compare
waits for the head's own release. The run still scans on the deployed
scanner and checks out the head.

```quint
pure def lawDispatchRunsUnchangedScanner(c: Controller, ref: Ref, gate: Gate): bool =
  dispatch(c, ref, gate).dispatches > c.dispatches implies
    (branchOf(c, ref).head == branchOf(c, ref).releasedSha
      or (gate.inputsReadable and unchangedScanner(branchOf(c, ref))))
    and branchOf(dispatch(c, ref, gate), ref).runHead == branchOf(c, ref).head
pure def sometimesScannedBehindRelease(c: Controller): bool =
  branchOf(c, Main).activeRuns > 0 and branchOf(c, Main).runHead != branchOf(c, Main).runSha
pure def sometimesScannerChangeWaits(c: Controller): bool =
  c.skips > 0 and branchOf(c, Main).deployed and branchOf(c, Main).scannerChanged
    and branchOf(c, Main).head != branchOf(c, Main).releasedSha and branchOf(c, Main).activeRuns == 0
pure val eval_witness_sometimesScannedBehindRelease = (("completeRelease", Main, 1, true), ("push", Main, 2, true, false),
  ("dispatch", Main, { scheduleEnabled: true, releaseEnabled: true, inputsReadable: true }))
pure val eval_witness_sometimesScannerChangeWaits = (("completeRelease", Main, 1, true), ("push", Main, 2, true, true),
  ("dispatch", Main, { scheduleEnabled: true, releaseEnabled: true, inputsReadable: true }))
```

### The controller runs a pass only on the same commit or an unchanged earlier commit of its branch

The controller compares the commit the isolated runner reports with its own
checkout. Another commit qualifies only when GitHub's compare is readable,
reports the checkout `ahead`, lists fewer than its 300-file cap, and touches
no scanner input of the checkout; anything else refuses the pass before any
scan.

```quint
type RunnerCompare = { sameCommit: bool, readable: bool, ahead: bool, complete: bool, scannerTouched: bool }
pure val compareValues = Set(
  { sameCommit: true, readable: false, ahead: false, complete: false, scannerTouched: true },
  { sameCommit: false, readable: true, ahead: true, complete: true, scannerTouched: false },
  { sameCommit: false, readable: true, ahead: true, complete: true, scannerTouched: true },
  { sameCommit: false, readable: true, ahead: false, complete: true, scannerTouched: false },
  { sameCommit: false, readable: true, ahead: true, complete: false, scannerTouched: false },
  { sameCommit: false, readable: false, ahead: true, complete: true, scannerTouched: false })
pure def runnerMayScan(compare: RunnerCompare): bool =
  compare.sameCommit or (compare.readable and compare.ahead and compare.complete and not(compare.scannerTouched))
pure def lawRunnerScansOnlyAnUnchangedScanner(compare: RunnerCompare): bool =
  runnerMayScan(compare) implies (compare.sameCommit or (compare.ahead and not(compare.scannerTouched)))
```
