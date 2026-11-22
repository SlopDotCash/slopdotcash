# Accepted cycle files and unsafe-destination evidence

PRD sections 7 and 12: an accepted cycle manifest and the signed reports
that a payout destination is unsafe are evidence a later pull request may
extend but never rewrite. Development runs this gate on every pull request,
from the trusted base only (`.github/workflows/unsafe-destination-transitions.yml`,
called from `pr-hygiene.yml`). Sources at development `8660a6121`:
`scripts/check-unsafe-destination-transitions.ts`
(`inspectUnsafeDestinationTransitions`,
`verifyUnsafeDestinationTransitionAuthorities`) and
`scripts/unsafe-destination-hold.ts`. The [public payment
records](./publicRecords.md) and [payout exclusions](./payoutExclusions.md)
read the same manifests.

## Story: Keep accepted cycle files and unsafe-destination evidence on a trusted base

> As a contributor whose payout destination was reported unsafe, I want the
> report and the hold on my award kept exactly as accepted, so that no later
> pull request can quietly pay the reported wallet or drop the evidence.

### An existing cycle manifest keeps its identity

The gate takes an immutable 40-hex base and head commit and runs only from
the exact checkout of the base, with the base's own code: from the pull
request it reads Git objects only, never its tree, dependencies or code.
The manifests are `cycles/<project>/<YYYY-MM>/proposal.json` and
`allocation.json`, each a regular `100644` file of strict JSON without a
duplicate key at any depth; a cycle tree with another kind of Git object
refuses. At most 2,400 manifests, 8 MiB a manifest (and above zero bytes),
32 MiB in all and 4,096 reports are read, and a run past a limit refuses.
Every manifest of the base exists in the head: none is deleted or renamed.
A new or changed manifest names the project and month of its path, and a
changed one keeps the project, month and kind it had. All reports in base
and head, keyed by source commit, agree with every other copy of the same
report, and each is verified as a report signed by its wallet's account
before the gate passes. A signed report alone never changes a row: a
maintainer-invoked draft of the next proposal adds it, from a verified
signed commit not already in the reviewed proposal.

```quint
import money as M from "./money"
type ManifestKind = RewardAllocation | ExternalContributionShare
type UnsafeReport = { commit: str, period: int }
type CycleRow = { intent: str, actor: int, wallet: str, suggested: M::Amount, accrued: M::Amount, approved: M::Amount,
  held: bool, hold: str, lines: str, reports: List[UnsafeReport] }
type Manifest = { project: str, period: int, kind: ManifestKind, rows: List[CycleRow], lastChange: int, endsAt: int }
type TrustedReport = { project: str, actor: int, report: UnsafeReport }
type PrefixScan = { matches: bool, position: int }
pure val maxManifests = 2400
pure val maxManifestBytes = 8388608
pure val maxTotalBytes = 33554432
pure val maxReports = 4096
pure def manifestAdmitted(size: int, spent: int): bool = size > 0 and size <= maxManifestBytes and spent + size <= maxTotalBytes
pure def everyPathKept(basePaths: List[str], headPaths: List[str]): bool = basePaths.every(p => headPaths.includes(p))
pure def namedByPath(project: str, period: int, after: Manifest): bool = after.project == project and after.period == period
pure def sameIdentity(before: Manifest, after: Manifest): bool =
  before.project == after.project and before.period == after.period and before.kind == after.kind
pure def lawLimitsHold(size: int, spent: int): bool =
  manifestAdmitted(size, spent) implies (size <= maxManifestBytes and spent + size <= maxTotalBytes)
pure val sizeValues = Set(0, 1, 8388608, 8388609)
pure val spentValues = Set(0, 25165824, 33554431)
```

### A new or changed cycle row keeps every trusted unsafe-destination report as an append-only prefix

The trusted history is every report on a reward-allocation row of the
base's manifests, by project and contributor. Each row of a new or changed
reward-allocation manifest carries every trusted report of its contributor
in that project whose month is not later than the manifest's. Each row of a
changed manifest that had a report or a hold is still there under the same
intent and contributor, and its reports begin with exactly the reports it
had, in order; later reports may only be appended.

```quint
pure val noReport: UnsafeReport = { commit: "", period: 0 }
pure def prefixOf(earlier: List[UnsafeReport], later: List[UnsafeReport]): bool =
  earlier.length() <= later.length() and earlier.foldl({ matches: true, position: 0 }, (scan, r) =>
    { matches: scan.matches and later.nthOr(scan.position, noReport) == r, position: scan.position + 1 }).matches
pure def keepsTrustedHistory(after: Manifest, trusted: List[TrustedReport]): bool =
  after.kind != RewardAllocation or after.rows.every(r => trusted.every(t =>
    (t.project == after.project and t.actor == r.actor and t.report.period <= after.period) implies r.reports.includes(t.report)))
pure def evidenceRow(previous: CycleRow): bool = previous.reports.length() > 0 or previous.hold != ""
pure def holdKept(previous: CycleRow, next: CycleRow): bool = previous.hold == "" or
  (next.hold == previous.hold and next.held and next.approved == M::zero and next.wallet == previous.wallet
    and next.suggested == previous.suggested and next.accrued == previous.accrued and next.lines == previous.lines)
pure def rowKept(previous: CycleRow, after: Manifest): bool = not(evidenceRow(previous)) or
  after.rows.some(n => n.intent == previous.intent and n.actor == previous.actor and prefixOf(previous.reports, n.reports)
    and holdKept(previous, n))
```

### An accepted unsafe-destination hold keeps its wallet, amount and zero approval

A row that the accepted manifest holds for an unsafe destination stays
held with the same hold record, the original wallet, suggested and accrued
amounts and lines, and an approved amount of zero.

```quint
pure def sameAmounts(before: Manifest, after: Manifest): bool = before.rows.length() == after.rows.length()
  and before.rows.every(r => after.rows.some(n => n.intent == r.intent and n.suggested == r.suggested))
  and after.rows.every(n => before.rows.some(r => r.intent == n.intent and r.suggested == n.suggested))
pure def reviewKept(before: Manifest, after: Manifest): bool =
  if (sameAmounts(before, after)) after.lastChange == before.lastChange and after.endsAt == before.endsAt
  else after.lastChange > before.lastChange
pure def transitionAllowed(before: Manifest, after: Manifest, trusted: List[TrustedReport]): bool =
  sameIdentity(before, after) and keepsTrustedHistory(after, trusted)
    and (before.kind != RewardAllocation or (reviewKept(before, after) and before.rows.every(p => rowKept(p, after))))
pure def newManifestAllowed(after: Manifest, trusted: List[TrustedReport]): bool = keepsTrustedHistory(after, trusted)
pure def lawIdentityIsImmutable(before: Manifest, after: Manifest, trusted: List[TrustedReport]): bool =
  transitionAllowed(before, after, trusted) implies sameIdentity(before, after)
pure def lawHoldIsFrozen(before: Manifest, after: Manifest, trusted: List[TrustedReport]): bool =
  (transitionAllowed(before, after, trusted) and before.kind == RewardAllocation) implies
    before.rows.every(p => p.hold != "" implies after.rows.some(n => n.intent == p.intent and n.held and n.wallet == p.wallet
      and n.suggested == p.suggested and n.approved == M::zero))
pure def lawHistoryIsAppendOnly(before: Manifest, after: Manifest, trusted: List[TrustedReport]): bool =
  (transitionAllowed(before, after, trusted) and before.kind == RewardAllocation) implies
    before.rows.every(p => p.reports.length() > 0 implies after.rows.some(n => n.intent == p.intent and prefixOf(p.reports, n.reports)))
```

### A changed cycle amount restarts its public review after the accepted proposal's last change and an unchanged one keeps its window

Every change of a suggested amount restarts the 14-day public review
(`cycles/README.md`): the changed manifest's last material change is later
than the accepted one's. A manifest whose suggested amounts are unchanged
keeps the accepted last material change and review end exactly.

```quint
pure def lawChangedAmountRestartsReview(before: Manifest, after: Manifest, trusted: List[TrustedReport]): bool =
  (transitionAllowed(before, after, trusted) and before.kind == RewardAllocation and not(sameAmounts(before, after)))
    implies after.lastChange > before.lastChange
pure def lawUnchangedAmountKeepsWindow(before: Manifest, after: Manifest, trusted: List[TrustedReport]): bool =
  (transitionAllowed(before, after, trusted) and before.kind == RewardAllocation and sameAmounts(before, after))
    implies (after.lastChange == before.lastChange and after.endsAt == before.endsAt)
pure val reportOne: UnsafeReport = { commit: "c1", period: 202611 }
pure val heldRow: CycleRow = { intent: "i1", actor: 1, wallet: "w1", suggested: List(5), accrued: List(5), approved: List(0),
  held: true, hold: "h1", lines: "l1", reports: List(reportOne) }
pure val accepted: Manifest = { project: "asi", period: 202611, kind: RewardAllocation, rows: List(heldRow), lastChange: 10, endsAt: 20 }
pure val beforeValues = Set(accepted)
pure val afterValues = Set(accepted, { ...accepted, rows: List({ ...heldRow, wallet: "w2" }) },
  { ...accepted, rows: List({ ...heldRow, reports: List(reportOne, { commit: "c2", period: 202611 }) }) },
  { ...accepted, rows: List({ ...heldRow, reports: List() }) }, { ...accepted, rows: List({ ...heldRow, suggested: List(6) }), lastChange: 11 },
  { ...accepted, rows: List({ ...heldRow, suggested: List(6) }) }, { ...accepted, lastChange: 11 }, { ...accepted, period: 202612 })
pure val trustedValues = Set(List(), List({ project: "asi", actor: 1, report: reportOne }))
```
