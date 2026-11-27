# Maintainer holds

PRD section 5 and CLAUDE.md "Slopbot": an uncertain finding goes to the
maintainer first; after 7 days without maintainer action, Slopbot applies its
verdict as a label only and never closes. Source
`workers/slopbot/maintainer-holds.ts` (`recordMaintainerHold`,
`dispatchDueJobs`), `review.ts` (`applyMaintainerHold`, `reconcileAppeal`,
`reconcileConfirmedReopen`) and migration `0064`
(`slopbot_maintainer_holds`).

One instance is one item revision that [the closure decision](./closure.md)
recorded as uncertain in an active project. It starts from that decision and
owns the hold window, its scheduled dispatch and the `slopbot:uncertain`
label. Its inputs are the same gate observation as the decision, a
maintainer timeline read bound to the hold, GitHub's reopen event with the
actor's verified role, the appeal outcome from [appeals](./appeals.md) and
GitHub's label read. Creating an instance only from an uncertain decision is
a composition obligation.

## Story: Give the maintainer seven days to decide an uncertain finding

### The first durable maintainer notice starts the window once

The deadline is derived from the stored hold timestamp and preserved on
retry. The hold starts when the maintainer comment is confirmed and the
durable hold is recorded, while ordinary review actions are still allowed.
The adapter supplies an absolute trusted time in seconds. A notification
retry cannot restart the window.

```quint
import categories as F from "./categories"
import closure as C from "./closure"
type HeldFinding = { identity: C::ReviewIdentity, category: F::Category, decidedSeq: int }
type HoldStatus = NoHold | WaitingForMaintainer | MaintainerActed | HoldSuperseded | HoldLabeled
type Hold = { finding: HeldFinding, gate: C::GateObservation, now: int, heldAt: int, queuedAt: int,
  hold: HoldStatus, uncertainLabel: bool, maintainerReopened: bool, appealUpheld: bool }
pure val holdSeconds = 604800
pure val requeueSeconds = 86400
pure def mayAct(h: Hold): bool = C::mayActOrdinaryFor(h.gate.source, h.finding.identity)
pure def canObserve(h: Hold, observation: C::GateObservation): bool =
  observation.seq > h.gate.seq and observation.source.identity == h.finding.identity
pure def observe(h: Hold, observation: C::GateObservation): Hold = { ...h, gate: observation }
pure def canObserveTime(h: Hold, observedAt: int): bool = observedAt >= h.now
pure def observeTime(h: Hold, observedAt: int): Hold = { ...h, now: observedAt }
pure def canNotifyMaintainer(h: Hold): bool = h.hold == NoHold and mayAct(h) and not(reversed(h))
pure def notifyMaintainer(h: Hold): Hold = { ...h, heldAt: h.now, hold: WaitingForMaintainer }
pure def holdDue(h: Hold): bool = h.hold == WaitingForMaintainer and h.now - h.heldAt >= holdSeconds
pure def alwaysHoldTime(h: Hold): bool = h.now >= 0 and h.heldAt >= 0 and h.heldAt <= h.now and
  h.queuedAt >= 0 and h.queuedAt <= h.now
pure def alwaysFindingCanLabel(h: Hold): bool = F::permittedAction(h.finding.category) != F::NoAction
pure def stepHoldStartRetained(before: Hold, after: Hold): bool =
  before.hold != NoHold implies after.heldAt == before.heldAt and after.hold != NoHold
pure def stepFindingFixed(before: Hold, after: Hold): bool = after.finding == before.finding and after.gate.seq >= before.gate.seq
```

### The scheduled dispatcher queues each due hold and requeues a lost message after a day

Source `dispatchDueJobs`: the five-minute cron selects unresolved holds whose
deadline passed and whose last queue time is absent or a day old, then
records the queue time. The one-time hold resolution and the unique label
action make a duplicate delivery harmless.

```quint
pure def canDispatchHold(h: Hold): bool = holdDue(h) and (h.queuedAt == 0 or h.now - h.queuedAt >= requeueSeconds)
pure def dispatchHold(h: Hold): Hold = { ...h, queuedAt: h.now }
pure def holdQueued(h: Hold): bool = h.queuedAt > 0 and h.queuedAt >= h.heldAt + holdSeconds
pure def alwaysQueuedOnlyWhenDue(h: Hold): bool =
  h.queuedAt > 0 implies h.queuedAt - h.heldAt >= holdSeconds and h.hold != NoHold
pure def sometimesRequeued(h: Hold): bool = holdQueued(h) and h.queuedAt - h.heldAt >= holdSeconds + requeueSeconds
```

### The due hold resolves on every known source: the maintainer acted, it is superseded, or it is labeled

Current maintainer comments, reviews, labels, assignments and state changes
since the hold began count once attributed to the maintainer. Passive
mentions and subscriptions do not. The timeline read binds the reviewed
revision, the first notice time and the current decision time. A known
changed source, scope or installation, a closed or merged item, a draft,
limited coverage, a confirmed maintainer reopen or an upheld appeal
supersedes the hold. An unresolved author appeal does not: the source labels
unless the appeal was upheld (`reconcileAppeal`). An unknown source or
timeline refuses and leaves the hold retryable. On every known source exactly
one of superseding and labeling applies, so a due hold never waits forever on
a known state. The only automatic hold output is the once-only
`slopbot:uncertain` label; it never closes.

```quint
type MaintainerTimeline = TimelineUnknown | NoMaintainerAction | MaintainerAction
type TimelineObservation = { itemNode: str, revision: str, heldAt: int, checkedAt: int, timeline: MaintainerTimeline }
type ReopenRole = ReopenByMaintainer | ReopenByAuthor | ReopenByOther
type ReopenEvidence = { itemNode: str, revision: str, actor: int, role: ReopenRole, at: int }
type AppealVerdict = AppealUpheld | AppealDenied
type AppealOutcome = { itemNode: str, revision: str, verdict: AppealVerdict }
pure def reversed(h: Hold): bool = h.maintainerReopened or h.appealUpheld
pure def sourceKnown(o: C::SourceObservation): bool =
  o.source != C::SourceUnknown and o.installation != C::InstallationUnknown and o.item != C::ItemUnknown and
  o.coverage != C::CoverageUnknown
pure def supersedingSource(o: C::SourceObservation): bool =
  o.source == C::SourceSuperseded or o.scope != C::Active or o.installation == C::InstallationRemoved or
  o.installation == C::InstallationSuspended or o.item == C::ItemClosed or o.item == C::ItemMerged or o.draft or
  o.coverage == C::CoverageLimited
pure def lawKnownSourceDecides(o: C::SourceObservation, identity: C::ReviewIdentity): bool =
  (sourceKnown(o) and o.identity == identity) implies (supersedingSource(o) or C::mayActOrdinaryFor(o, identity))
pure def matchesHoldObservation(h: Hold, timeline: TimelineObservation): bool =
  timeline.itemNode == h.finding.identity.itemNode and timeline.revision == h.finding.identity.revision and
  timeline.heldAt == h.heldAt and timeline.checkedAt == h.now
pure def readyToResolve(h: Hold): bool = holdDue(h) and holdQueued(h)
pure def canResolveMaintainerAction(h: Hold, timeline: TimelineObservation): bool =
  readyToResolve(h) and mayAct(h) and not(reversed(h)) and matchesHoldObservation(h, timeline) and
  timeline.timeline == MaintainerAction
pure def resolveMaintainerAction(h: Hold, timeline: TimelineObservation): Hold = { ...h, hold: MaintainerActed }
pure def canSupersedeHold(h: Hold): bool = readyToResolve(h) and
  ((sourceKnown(h.gate.source) and h.gate.source.identity == h.finding.identity and supersedingSource(h.gate.source)) or
    reversed(h))
pure def supersedeHold(h: Hold): Hold = { ...h, hold: HoldSuperseded }
pure def canLabelUncertain(h: Hold, timeline: TimelineObservation): bool =
  readyToResolve(h) and mayAct(h) and not(reversed(h)) and matchesHoldObservation(h, timeline) and
  timeline.timeline == NoMaintainerAction and not(h.uncertainLabel)
pure def labelUncertain(h: Hold, timeline: TimelineObservation): Hold = { ...h, hold: HoldLabeled, uncertainLabel: true }
pure def alwaysUncertainLabelAfterWindow(h: Hold): bool =
  h.uncertainLabel implies h.hold == HoldLabeled and h.now - h.heldAt >= holdSeconds
pure def alwaysHoldResolvedAfterDispatch(h: Hold): bool =
  (h.hold == HoldLabeled or h.hold == MaintainerActed or h.hold == HoldSuperseded) implies h.queuedAt > 0
pure def stepHoldResolutionFinal(before: Hold, after: Hold): bool =
  (before.hold == HoldLabeled or before.hold == MaintainerActed or before.hold == HoldSuperseded) implies after.hold == before.hold
pure def stepLabelOnlyWhenUnreversed(before: Hold, via: str, after: Hold): bool =
  via == "labelUncertain" implies not(reversed(before)) and mayAct(before)
pure def sometimesUncertainLabel(h: Hold): bool = h.hold == HoldLabeled
pure def sometimesMaintainerActed(h: Hold): bool = h.hold == MaintainerActed
pure def sometimesSupersededByCoverage(h: Hold): bool = h.hold == HoldSuperseded and h.gate.source.coverage == C::CoverageLimited
pure def sometimesSupersededByReopen(h: Hold): bool = h.hold == HoldSuperseded and h.maintainerReopened
```

### A confirmed maintainer reopen or an upheld appeal removes the uncertain label

A current maintainer's reopen of this revision and an upheld appeal of it
supersede an unresolved hold at its due time and remove an applied
`slopbot:uncertain` label once GitHub confirms removal or absence. A reopen
by the author or anyone else is not a maintainer decision.

```quint
type RemovalEvidence = { itemNode: str, revision: str, confirmedRemoval: bool }
pure def canObserveReopen(h: Hold, reopen: ReopenEvidence): bool =
  reopen.itemNode == h.finding.identity.itemNode and reopen.revision == h.finding.identity.revision and
  reopen.at > 0 and reopen.role == ReopenByMaintainer and not(h.maintainerReopened)
pure def observeReopen(h: Hold, reopen: ReopenEvidence): Hold = { ...h, maintainerReopened: true }
pure def canObserveAppealOutcome(h: Hold, appealOutcome: AppealOutcome): bool =
  appealOutcome.itemNode == h.finding.identity.itemNode and appealOutcome.revision == h.finding.identity.revision and
  appealOutcome.verdict == AppealUpheld and not(h.appealUpheld)
pure def observeAppealOutcome(h: Hold, appealOutcome: AppealOutcome): Hold = { ...h, appealUpheld: true }
pure def canRemoveUncertainLabel(h: Hold, removal: RemovalEvidence): bool =
  reversed(h) and h.uncertainLabel and removal.itemNode == h.finding.identity.itemNode and
  removal.revision == h.finding.identity.revision and removal.confirmedRemoval
pure def removeUncertainLabel(h: Hold, removal: RemovalEvidence): Hold = { ...h, uncertainLabel: false }
pure def stepReversalPermanent(before: Hold, after: Hold): bool =
  (before.maintainerReopened implies after.maintainerReopened) and (before.appealUpheld implies after.appealUpheld)
pure def sometimesLabelRemoved(h: Hold): bool = h.hold == HoldLabeled and not(h.uncertainLabel) and h.appealUpheld
```

### Simulation samples cover the exact boundary, unknown sources and timelines, coverage changes and reopens

```quint
pure val heldFinding: HeldFinding = { identity: C::reviewedItem, category: F::Spam, decidedSeq: 1 }
pure val initial: Hold = { finding: heldFinding, gate: C::eligibleGate, now: 0, heldAt: 0, queuedAt: 0,
  hold: NoHold, uncertainLabel: false, maintainerReopened: false, appealUpheld: false }
pure val observationValues = Set({ ...C::eligibleGate, seq: 2, source: { ...C::verifiedSource, coverage: C::CoverageLimited } },
  { ...C::eligibleGate, seq: 2, source: { ...C::verifiedSource, draft: true } },
  { ...C::eligibleGate, seq: 3, source: { ...C::verifiedSource, source: C::SourceUnknown } })
pure val oValues = Set(C::verifiedSource, C::unknownSource,
  { ...C::verifiedSource, coverage: C::CoverageLimited }, { ...C::verifiedSource, draft: true },
  { ...C::verifiedSource, scope: C::SecurityOnly }, { ...C::verifiedSource, item: C::ItemMerged },
  { ...C::verifiedSource, installation: C::InstallationSuspended }, { ...C::verifiedSource, source: C::SourceSuperseded })
pure val identityValues = Set(C::reviewedItem, { ...C::reviewedItem, revision: "older" })
pure val observedAtValues = Set(604800, 691200)
pure val dueObservation: TimelineObservation = { itemNode: "pr", revision: "head", heldAt: 0, checkedAt: 604800,
  timeline: NoMaintainerAction }
pure val timelineValues = Set(dueObservation, { ...dueObservation, timeline: MaintainerAction },
  { ...dueObservation, timeline: TimelineUnknown }, { ...dueObservation, checkedAt: 691200 })
pure val reopenValues = Set({ itemNode: "pr", revision: "head", actor: 9, role: ReopenByMaintainer, at: 50 },
  { itemNode: "pr", revision: "head", actor: 5, role: ReopenByAuthor, at: 50 })
pure val appealOutcomeValues = Set({ itemNode: "pr", revision: "head", verdict: AppealUpheld })
pure val removalValues = Set({ itemNode: "pr", revision: "head", confirmedRemoval: true })
pure val weight_notifyMaintainer = 2
pure val weight_dispatchHold = 2
pure val weight_labelUncertain = 2
pure val weight_resolveMaintainerAction = 1
pure val weight_supersedeHold = 1
pure val weight_removeUncertainLabel = 2
pure val eval_witness_sometimesMaintainerActed = (
  "notifyMaintainer",
  ("observeTime", 604800),
  "dispatchHold",
  ("resolveMaintainerAction", { ...dueObservation, timeline: MaintainerAction })
)
```
