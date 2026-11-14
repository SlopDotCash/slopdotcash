# Retry a private trace and record a submitted pull request independently

PRD sections 4, 9, 11 and 12 separate optional private trajectory upload from
ordinary submission and the authenticated `pull_request_opened` event. This
component follows `skills/project-contributor-template/scripts/run-receipt.mjs`
and the retained `skill_run_local` model at
`6b3b9d0b979f0608d87941f1146056a98513ffcf`. The
[private upload contract](./evidence.md) owns consent, exact body checks and
permanent write-only storage. This companion retains captured remote identity,
known server state and local verification. No body or credential enters either
journal. A signed-in Slop run is never required to open a GitHub PR.

## Story: Recover a lost optional trace response without replacing accepted bytes

### The same local run resumes its own server record and bounded exact upload

A trace attempt starts from a matching active installed run and a contributor
inspected, disclosed and redacted file. Fresh private-request status and
current authenticated actor gate the intent. The exact returned server run ID,
client run ID, object digest and expiry belong to that request. The worker may
receive the original bytes once even when its response is lost. Retrying the
stable create-run identity can find server state awaiting upload, already
uploaded, or finalized. An already stored body is immutable. The following
client states represent one already authenticated contributor and measured run.
The server's authoritative projection comes from exact bound observations.

```quint
type ServerStage = NoServerRun | AwaitingTrace | TraceUploaded | TraceFinalized
type LocalPhase = Idle | Selected | Ready | Stored | Confirmed
type TraceRun = { phase: LocalPhase, serverStage: ServerStage, serverRun: str, selectedDigest: str,
  storedDigest: str, failure: bool }
pure val initial: TraceRun = { phase: Idle, serverStage: NoServerRun, serverRun: "", selectedDigest: "", storedDigest: "", failure: false }
pure def canSelectTrace(s: TraceRun, digest: str, activeAndInspected: bool, intakeCurrent: bool): bool =
  (s.phase == Idle or s.phase == Confirmed) and digest != "" and activeAndInspected and intakeCurrent
pure def selectTrace(s: TraceRun, digest: str, activeAndInspected: bool, intakeCurrent: bool): TraceRun =
  { ...s, phase: Selected, selectedDigest: digest, failure: false }
pure def canRegister(s: TraceRun, remoteRun: str, currentActorAndExactIdentity: bool): bool =
  s.phase == Selected and currentActorAndExactIdentity and remoteRun != "" and (s.serverRun == "" or s.serverRun == remoteRun)
pure def register(s: TraceRun, remoteRun: str, currentActorAndExactIdentity: bool): TraceRun =
  { ...s, phase: Ready, serverRun: remoteRun, serverStage: if (s.serverStage == NoServerRun) AwaitingTrace else s.serverStage }
pure def canUpload(s: TraceRun, remoteRun: str, digest: str, exactStoredBytes: bool): bool = s.phase == Ready
  and s.serverStage == AwaitingTrace and remoteRun == s.serverRun and digest == s.selectedDigest and exactStoredBytes
pure def upload(s: TraceRun, remoteRun: str, digest: str, exactStoredBytes: bool): TraceRun =
  { ...s, phase: Stored, serverStage: TraceUploaded, storedDigest: digest }
```

### A retained digest can be finalized again while changed local bytes fail

When a run is already uploaded the client does not PUT again. It can obtain
the exact previously persisted receipt through finalization. The underlying
server can finalize the retained object even if the newly selected file has a
different digest. The client then refuses the mismatching receipt and never
attaches it to those bytes. A missing or lost response resets local progress
without removing the retained server identity or object.

```quint
pure def canReuse(s: TraceRun): bool = s.phase == Ready and
  (s.serverStage == TraceUploaded or s.serverStage == TraceFinalized) and s.storedDigest == s.selectedDigest
pure def reuse(s: TraceRun): TraceRun = { ...s, phase: Stored }
pure def canFinalize(s: TraceRun, remoteRun: str, digest: str, exactObjectIdentity: bool): bool =
  s.phase == Stored and remoteRun == s.serverRun and digest == s.storedDigest and digest == s.selectedDigest and exactObjectIdentity
pure def finalize(s: TraceRun, remoteRun: str, digest: str, exactObjectIdentity: bool): TraceRun =
  { ...s, phase: Confirmed, serverStage: TraceFinalized }
pure def canRefuseDifferentSelection(s: TraceRun): bool = s.phase == Ready and
  (s.serverStage == TraceUploaded or s.serverStage == TraceFinalized) and s.storedDigest != s.selectedDigest
pure def refuseDifferentSelection(s: TraceRun): TraceRun = { ...s, phase: Idle, serverStage: TraceFinalized, failure: true }
pure def canLoseResponse(s: TraceRun): bool = s.phase == Selected or s.phase == Ready or s.phase == Stored or s.phase == Confirmed
pure def loseResponse(s: TraceRun): TraceRun = { ...s, phase: Idle }
pure def alwaysRunIdentity(s: TraceRun): bool = (s.serverStage == NoServerRun) iff (s.serverRun == "")
pure def alwaysActiveSelection(s: TraceRun): bool = s.phase != Idle implies s.selectedDigest != ""
pure def alwaysObject(s: TraceRun): bool = (s.serverStage == TraceUploaded or s.serverStage == TraceFinalized) iff (s.storedDigest != "")
pure def alwaysExactCompletion(s: TraceRun): bool =
  (s.phase == Stored or s.phase == Confirmed) implies s.storedDigest == s.selectedDigest and s.storedDigest != ""
    and (s.serverStage == TraceUploaded or s.serverStage == TraceFinalized)
pure def stepIdentityRetained(before: TraceRun, after: TraceRun): bool =
  (before.serverRun != "" implies after.serverRun == before.serverRun) and
  (before.storedDigest != "" implies after.storedDigest == before.storedDigest)
pure def sometimesConfirmed(s: TraceRun): bool = s.phase == Confirmed
pure def sometimesChangedRefused(s: TraceRun): bool = s.failure and s.serverStage == TraceFinalized and s.storedDigest != s.selectedDigest
```

## Story: Bind the ordinary PR-opened event to its own authenticated run

### Stable event bodies are idempotent and never share the measured trace run

The adapter validates the exact project repository, canonical GitHub PR URL,
PR node and current signed-in PR author. `pr_opened_<PR-node-id>` is the stable
client run key and uses a separate server run from an optional trace. A known
finalized PR run cannot accept new events. The event identity binds immutable
actor, PR node and the canonical event body including its timestamp. Exact body
retries produce the same identity. A different timestamp may identify a second
event. The caller retains the current, verified response rather than assuming
success from a Slop marker or a signed local receipt.

```quint
type OpenedRun = { actor: str, pr: str, remoteRun: str, finalized: bool, eventBodies: Set[str] }
pure val noOpenedRun: OpenedRun = { actor: "", pr: "", remoteRun: "", finalized: false, eventBodies: Set() }
pure def mayRegisterOpened(s: OpenedRun, actor: str, pr: str, remoteRun: str, verifiedAuthorAndPr: bool): bool =
  actor != "" and pr != "" and remoteRun != "" and verifiedAuthorAndPr and
  (s.remoteRun == "" or (s.remoteRun == remoteRun and s.actor == actor and s.pr == pr))
pure def registerOpened(s: OpenedRun, actor: str, pr: str, remoteRun: str, verifiedAuthorAndPr: bool): OpenedRun =
  { ...s, actor: actor, pr: pr, remoteRun: remoteRun }
pure def mayRecordOpened(s: OpenedRun, actor: str, pr: str, remoteRun: str, eventBody: str, authorized: bool): bool =
  s.remoteRun != "" and not(s.finalized) and actor == s.actor and pr == s.pr and remoteRun == s.remoteRun and eventBody != "" and authorized
pure def recordOpened(s: OpenedRun, actor: str, pr: str, remoteRun: str, eventBody: str, authorized: bool): OpenedRun =
  if (s.eventBodies.contains(eventBody)) s else { ...s, eventBodies: s.eventBodies.union(Set(eventBody)) }
pure def mayObserveOpenedFinalized(s: OpenedRun, remoteRun: str, verified: bool): bool = s.remoteRun != "" and remoteRun == s.remoteRun and verified
pure def observeOpenedFinalized(s: OpenedRun, remoteRun: str, verified: bool): OpenedRun = { ...s, finalized: true }
pure def lawOpenedRetryIdempotent(s: OpenedRun, actor: str, pr: str, remoteRun: str, eventBody: str, authorized: bool): bool =
  val once = recordOpened(s, actor, pr, remoteRun, eventBody, authorized)
  once.eventBodies.subseteq(recordOpened(once, actor, pr, remoteRun, eventBody, authorized).eventBodies)
    and recordOpened(once, actor, pr, remoteRun, eventBody, authorized).eventBodies.subseteq(once.eventBodies)
pure def lawCannotRecordOtherActor(s: OpenedRun, actor: str, pr: str, remoteRun: str, eventBody: str, authorized: bool): bool =
  actor != s.actor implies not(mayRecordOpened(s, actor, pr, remoteRun, eventBody, authorized))
```

### Simulation uses bounded representative digests and distinct identities

```quint
pure val digestValues = Set("digest-a", "digest-b")
pure val remoteRunValues = Set("remoteRun-a", "remoteRun-b")
pure val actorValues = Set("actor-a", "actor-b")
pure val prValues = Set("PR_a", "PR_b")
pure val eventBodyValues = Set("event-a", "event-b")
pure val openedSample: OpenedRun = { actor: "actor-a", pr: "PR_a", remoteRun: "remoteRun-a", finalized: false, eventBodies: Set() }
pure val sValues = Set(noOpenedRun, openedSample, { ...openedSample, finalized: true })
pure val weight_register = 5
pure val weight_upload = 8
pure val weight_finalize = 8
```
