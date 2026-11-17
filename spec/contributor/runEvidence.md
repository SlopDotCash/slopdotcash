# Retry a private trace without replacing accepted bytes

PRD sections 4, 9, 11 and 12 separate optional private trajectory upload from
ordinary submission. This component follows
`skills/project-contributor-template/scripts/run-receipt.mjs` and the
retained `skill_run_local` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf`. It refines the
[abstract evidence decision](./evidence.md): every reachable retry state maps
onto a reachable evidence state, so the consent, exact-selection,
stored-digest and receipt rules proved there hold here. The authoritative
server records are the [server trace run](./traceServer.md); this unit sees
them only as typed replies. No body or credential enters this journal. A
signed-in Slop run is never required to open a GitHub PR. The separate
pull-request-opened record is the [`opened` command](./openedRun.md).

## Story: Recover a lost optional trace response without replacing accepted bytes

### The same local run resumes its own server record and bounded exact upload

A trace attempt starts from the active local measured run (the
[local receipt](./localReceipt.md) state, a record satisfying every local
receipt rule; that the shell supplies the actual stored record is a
composition obligation) and an inspected, disclosed, consented snapshot. The
bounded server preflight must report the
[private-intake observation](../operations/intakeHealth.md) ready for trace
collection at the time of the check (`traceCollectionReadyAt`: enabled,
verified no more than 24 hours earlier and no more than five minutes in the
future); the server rechecks it at upload. Contribution never reads it. The exact returned
server run ID belongs to that request. The contributor's client (sender
`contributorClient`) selects, reuses, refuses and stops; the Slop server's
authenticated replies (sender `slopServer`) register, store and finalize. Retrying the stable create-run
identity can find server state awaiting upload, already uploaded or
finalized, and the server's stage never moves backwards. An already stored
body is immutable.

```quint
import evidence as E from "./evidence"
import localReceipt as LR from "./localReceipt"
import intakeHealth as IH from "../operations/intakeHealth"
type LocalPhase = LocalIdle | LocalSelected | Registered | LocalStored | Confirmed
type StopReason = LostResponse | ServerRefused | TransportFailed
type FinalizeReply = { serverRun: str, digest: str, stage: E::ServerStage }
type TraceRun = { phase: LocalPhase, serverStage: E::ServerStage, serverRun: str, selected: E::Snapshot,
  storedDigest: str, failure: bool }
pure val initial: TraceRun = { phase: LocalIdle, serverStage: E::NoServerRun, serverRun: "", selected: E::noSnapshot,
  storedDigest: "", failure: false }
pure def stageRank(stage: E::ServerStage): int =
  if (stage == E::NoServerRun) 0 else if (stage == E::AwaitingTrace) 1 else if (stage == E::TraceUploaded) 2 else 3
pure def canSelectTrace(s: TraceRun, by: int, snapshot: E::Snapshot, intake: IH::Observation, checkedAt: int, local: LR::LocalReceipt): bool =
  by == E::contributorClient and (s.phase == LocalIdle or s.phase == Confirmed) and E::validSnapshot(snapshot) and IH::traceCollectionReadyAt(intake, checkedAt)
    and LR::consistentReceipt(local) and local.started and local.active
pure def selectTrace(s: TraceRun, by: int, snapshot: E::Snapshot, intake: IH::Observation, checkedAt: int, local: LR::LocalReceipt): TraceRun =
  { ...s, phase: LocalSelected, selected: snapshot, failure: false }
pure def canRegister(s: TraceRun, by: int, runReply: E::RunReply): bool = by == E::slopServer and s.phase == LocalSelected and E::consistentRun(runReply)
  and (s.serverRun == "" or runReply.serverRun == s.serverRun) and stageRank(runReply.stage) >= stageRank(s.serverStage)
  and (s.storedDigest == "" or runReply.storedDigest == s.storedDigest)
pure def register(s: TraceRun, by: int, runReply: E::RunReply): TraceRun =
  { ...s, phase: Registered, serverRun: runReply.serverRun, serverStage: runReply.stage,
    storedDigest: if (s.storedDigest == "") runReply.storedDigest else s.storedDigest }
pure def canStore(s: TraceRun, by: int, uploadReply: E::UploadReply): bool = by == E::slopServer and s.phase == Registered
  and s.serverStage == E::AwaitingTrace and uploadReply.serverRun == s.serverRun
  and uploadReply.digest == s.selected.digest and uploadReply.stage == E::TraceUploaded
pure def store(s: TraceRun, by: int, uploadReply: E::UploadReply): TraceRun =
  { ...s, phase: LocalStored, serverStage: E::TraceUploaded, storedDigest: uploadReply.digest }
```

### A retained digest can be finalized again while changed local bytes fail

When a run is already uploaded the client does not upload again. It can obtain
the exact previously persisted receipt through finalization. The server can
finalize the retained object even if the newly selected file has a different
digest. The client then refuses the mismatching selection and never attaches
it to those bytes; the refusal records no server stage it has not been told,
so the server stage stays the last one a reply reported. A lost response, a server refusal (stale intake, ban, used or
expired capability, conflict) or a transport failure stops the attempt
without removing the retained server identity or object.

```quint
pure def canReuse(s: TraceRun, by: int): bool = by == E::contributorClient and s.phase == Registered and
  (s.serverStage == E::TraceUploaded or s.serverStage == E::TraceFinalized) and s.storedDigest == s.selected.digest
pure def reuse(s: TraceRun, by: int): TraceRun = { ...s, phase: LocalStored }
pure def canFinalize(s: TraceRun, by: int, finalizeReply: FinalizeReply): bool = by == E::slopServer and s.phase == LocalStored
  and finalizeReply.serverRun == s.serverRun and finalizeReply.digest == s.storedDigest
  and finalizeReply.digest == s.selected.digest and finalizeReply.stage == E::TraceFinalized
pure def finalize(s: TraceRun, by: int, finalizeReply: FinalizeReply): TraceRun = { ...s, phase: Confirmed, serverStage: E::TraceFinalized }
pure def canRefuseDifferentSelection(s: TraceRun, by: int): bool = by == E::contributorClient and s.phase == Registered and
  (s.serverStage == E::TraceUploaded or s.serverStage == E::TraceFinalized) and s.storedDigest != s.selected.digest
pure def refuseDifferentSelection(s: TraceRun, by: int): TraceRun = { ...s, phase: LocalIdle, failure: true }
pure def canStopAttempt(s: TraceRun, by: int, reason: StopReason): bool = by == E::contributorClient and s.phase != LocalIdle
pure def stopAttempt(s: TraceRun, by: int, reason: StopReason): TraceRun = { ...s, phase: LocalIdle, failure: reason != LostResponse }
pure def alwaysRunIdentity(s: TraceRun): bool = (s.serverStage == E::NoServerRun) iff (s.serverRun == "")
pure def alwaysActiveSelection(s: TraceRun): bool = s.phase != LocalIdle implies E::validSnapshot(s.selected)
pure def alwaysObject(s: TraceRun): bool = (s.serverStage == E::TraceUploaded or s.serverStage == E::TraceFinalized) iff (s.storedDigest != "")
pure def alwaysExactCompletion(s: TraceRun): bool =
  (s.phase == LocalStored or s.phase == Confirmed) implies s.storedDigest == s.selected.digest and s.storedDigest != ""
    and (s.serverStage == E::TraceUploaded or s.serverStage == E::TraceFinalized)
pure def stepIdentityRetained(before: TraceRun, after: TraceRun): bool =
  (before.serverRun != "" implies after.serverRun == before.serverRun) and
  (before.storedDigest != "" implies after.storedDigest == before.storedDigest)
  and stageRank(before.serverStage) <= stageRank(after.serverStage)
```

### Every retry state is a state of the abstract evidence decision

```quint
pure def abstractPhase(s: TraceRun): E::EvidencePhase =
  if (s.phase == LocalSelected or s.phase == Registered) E::Selected
  else if (s.phase == LocalStored or s.phase == Confirmed) E::Stored
  else if (s.selected.digest == "") E::Undecided
  else if (s.storedDigest == s.selected.digest) E::Stored
  else E::UploadFailed
pure def refinesE(s: TraceRun): E::Evidence =
  { ...E::initial, phase: abstractPhase(s), digest: s.selected.digest, size: s.selected.size, storedDigest: s.storedDigest }
pure def sometimesConfirmed(s: TraceRun): bool = s.phase == Confirmed
pure def sometimesChangedRefused(s: TraceRun): bool = s.failure and s.phase == LocalIdle and s.storedDigest != ""
  and s.storedDigest != s.selected.digest
```

### Simulation uses bounded representative digests and distinct identities

```quint
pure val snapA: E::Snapshot = { digest: "d1", size: 2, media: E::NdjsonText, inspected: true, disclosed: true, consent: true }
pure val snapshotValues = Set(snapA, { ...snapA, digest: "d2" }, { ...snapA, consent: false }, { ...snapA, inspected: false })
pure val intakeValues = Set(IH::Observed({ enabled: true, verifiedAt: 1000 }), IH::Observed({ enabled: false, verifiedAt: 1000 }),
  IH::NoObservation)
pure val checkedAtValues = Set(2000, 86401001)
pure val localActive: LR::LocalReceipt = { ...LR::initial, started: true, active: true, startedAt: 1,
  declared: { provider: "p", model: "m", client: "c", lane: LR::ContributionLane },
  installed: { template: "0123456789abcdef0123456789abcdef01234567", revision: 1, digest: "m1" } }
pure val localValues = Set(localActive, LR::initial, { ...localActive, declared: LR::noDeclared })
pure val runReplyValues = Set({ serverRun: "r1", stage: E::AwaitingTrace, storedDigest: "" },
  { serverRun: "r1", stage: E::TraceUploaded, storedDigest: "d1" }, { serverRun: "r2", stage: E::AwaitingTrace, storedDigest: "" })
pure val uploadReplyValues = Set({ serverRun: "r1", digest: "d1", stage: E::TraceUploaded },
  { serverRun: "r1", digest: "d2", stage: E::TraceUploaded })
pure val finalizeReplyValues = Set({ serverRun: "r1", digest: "d1", stage: E::TraceFinalized },
  { serverRun: "r1", digest: "d2", stage: E::TraceFinalized })
pure val byValues = Set(E::contributorClient, E::slopServer, E::signatureVerifier)
pure val weight_selectTrace = 6
pure val weight_register = 6
pure val weight_store = 8
pure val weight_finalize = 8
```
