# Scheduled scanner controller

PRD sections 8 and 11. `.github/workflows/vetting-controller.yml` dispatches
the bounded [admission scanner](./admission.md) on the protected `main` and
`development` branches. The scan job runs only on the isolated runner that
the release of the same branch head deployed. `scripts/run-vetting-controller.ts`
then refuses anything but the exact protected workflow checkout and verified
rate cards, before any scan.

## Story: Dispatch a scan only for the deployed release of the branch head

### Each protected branch tracks its head, its released head and its active scans

```quint
type Ref = Main | Development
type Branch = { head: int, releasedSha: int, deployed: bool, activeRuns: int, runSha: int }
type Controller = { main: Branch, development: Branch, dispatches: int, skips: int }
pure val noBranch: Branch = { head: 1, releasedSha: 0, deployed: false, activeRuns: 0, runSha: 0 }
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
release waits for its new head to deploy. The per-ref concurrency group never
cancels a run in progress.

```quint
type Gate = { scheduleEnabled: bool, releaseEnabled: bool }
pure val gateValues = Set({ scheduleEnabled: true, releaseEnabled: true }, { scheduleEnabled: false, releaseEnabled: true },
  { scheduleEnabled: true, releaseEnabled: false })
pure def mayDispatch(b: Branch, gate: Gate): bool = gate.scheduleEnabled and gate.releaseEnabled and b.deployed
  and b.releasedSha > 0 and b.head == b.releasedSha and b.activeRuns == 0
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
pure def lawDispatchScansReleasedHead(c: Controller, ref: Ref, gate: Gate): bool =
  dispatch(c, ref, gate).dispatches > c.dispatches implies
    branchOf(dispatch(c, ref, gate), ref).runSha == branchOf(c, ref).releasedSha and branchOf(c, ref).deployed
pure def sometimesDispatched(c: Controller): bool = branchOf(c, Main).activeRuns > 0 and branchOf(c, Development).activeRuns > 0
pure def sometimesAdvancedHeadSkipped(c: Controller): bool = c.skips > 0 and branchOf(c, Main).releasedSha > 0
  and branchOf(c, Main).deployed and branchOf(c, Main).head != branchOf(c, Main).releasedSha
```
