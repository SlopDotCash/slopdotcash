# Server-side private trace run, upload capability and progress events

PRD sections 4, 5, 9, 10 and 11, CLAUDE.md "Private traces" and "Slopbot".
This unit owns the D1 and R2 records of one authenticated contributor's
server run: `trace_runs` (states `awaiting_trace`, `trace_uploaded`,
`finalized`), `trace_upload_intents` (`expires_at`, `consumed_at`),
`trace_write_reservations` (migration 0058), `trace_objects` and
`trace_uploads` (migration 0005), and `run_progress_events` (migration 0001).
It follows `backend/trace/handler.ts` and
`backend/trace/cloudflare-persistence.ts` in the development tree and the
legacy `api_trace`, `trace_run_creation` and `trace_event_finalization`
models. The [client retry machine](./runEvidence.md) and the
[`opened` command](./openedRun.md) observe this record only through its
replies.

One machine instance is one server run row of its owner, the immutable GitHub
actor ID that authenticated its creation. Another actor, or another create
idempotency key of the same actor, is a separate instance. The HMAC upload
capability is derived from the actor, run, intent idempotency key and digest;
this model names a capability by its intent key, and the shell proves the
derivation and hashing. Hex-format validation of digests, the `Digest:
sha-256=` header and strict JSON bounds are shell parsing obligations that run
before an event reaches this machine. No transition returns a trace body; the
read refusal for every role is `security/privacy.md` `alwaysNoTraceRead`
(composition obligation). The `trace_read_grants` table is retired: no
transition issues a grant.

## Story: Keep one permanent exact trace for a run without letting a ban or race attach new bytes

### The run, its intents, reservation, objects and events are separate records

```quint
type RunState = NoRun | AwaitingTrace | TraceUploaded | Finalized
type ContentType = TextPlain | Ndjson
type CreateRequest = { clientRun: str, project: int, repository: str, policyRevision: str,
  provider: str, model: str, client: str, clientVersion: str }
type Intent = { key: str, digest: str, size: int, contentType: ContentType, expiresAt: int, consumed: bool }
type TraceObject = { digest: str, size: int, contentType: ContentType }
type PutStage = PutReserved | PutWritten | PutAttached | PutFailed
type Put = { key: str, blob: TraceObject, authorizedAt: int, stage: PutStage }
type EventKind = RunStarted | TaskSelected | WorkStarted | Checkpoint | PullRequestOpened
  | ReviewRequested | Merged | RunCompleted | RunFailed
type EventSource = AgentSource | GitHubSource
type RunEvent = { key: str, kind: EventKind, source: EventSource, occurredAt: int, githubObject: str, recordedAt: int }
type Intake = { observed: bool, enabled: bool, verifiedAt: int }
type Reply = ReplyNone | ReplyCreated | ReplyExisting | ReplyRenewed | ReplyConflict | ReplyNotFound
  | ReplyBanned | ReplyFinalized | ReplyTraceConflict | ReplyInvalid | ReplyCapabilityGone
  | ReplyIntakeUnavailable | ReplyIntentMismatch | ReplyObjectConflict | ReplyTraceRequired | ReplyStorageFailed
type TraceServer = { owner: int, now: int, banned: bool, intake: Intake, createKey: str,
  request: CreateRequest, state: RunState, intents: List[Intent], reservation: List[TraceObject],
  objects: List[TraceObject], attached: str, finalizedAt: int, puts: List[Put], events: List[RunEvent], reply: Reply }
pure val maxTraceBytes = 8388608
pure val intentLifetime = 300
pure val eventClockSkew = 300
pure val intakeMaxAge = 86400
pure val noRequest: CreateRequest = { clientRun: "", project: 0, repository: "", policyRevision: "",
  provider: "", model: "", client: "", clientVersion: "" }
pure val noIntent: Intent = { key: "", digest: "", size: 0, contentType: TextPlain, expiresAt: 0, consumed: false }
pure val noObject: TraceObject = { digest: "", size: 0, contentType: TextPlain }
pure val noPut: Put = { key: "", blob: noObject, authorizedAt: 0, stage: PutFailed }
pure val initial: TraceServer = { owner: 1, now: 0, banned: false,
  intake: { observed: false, enabled: false, verifiedAt: 0 }, createKey: "", request: noRequest,
  state: NoRun, intents: List(), reservation: List(), objects: List(), attached: "", finalizedAt: 0,
  puts: List(), events: List(), reply: ReplyNone }
pure def alwaysRunRow(s: TraceServer): bool = ((s.state == NoRun) iff (s.createKey == ""))
  and ((s.intents.length() > 0 or s.puts.length() > 0 or s.events.length() > 0) implies s.createKey != "")
pure def alwaysAttachedState(s: TraceServer): bool =
  ((s.state == TraceUploaded or s.state == Finalized) iff (s.attached != ""))
  and (s.state == Finalized implies s.finalizedAt >= 0 and s.finalizedAt <= s.now)
```

### The clock, private-intake observation and ban state come from their owning services

The hourly identity Worker renews the private-intake observation
(`private_intake_status`): a verified enabled status no older than 24 hours.
Missing, disabled, stale or future-dated status refuses only the byte upload.
The participation standing is the composed fact of the
[access area](../access.md): an account is banned while any
per-enforcement ban lacks its reinstatement. `observeStanding` mirrors that
fact for this run's owner; the shell evaluates it inside the same D1 statement
as each write (`NOT EXISTS (PARTICIPATION_BAN_QUERY)`), so a ban that lands
between two requests refuses the second.

```quint
pure def intakeFresh(s: TraceServer): bool = s.intake.observed and s.intake.enabled
  and s.intake.verifiedAt <= s.now and s.now - s.intake.verifiedAt <= intakeMaxAge
pure def canObserveTime(s: TraceServer, t: int): bool = t >= s.now and t <= 9007199254740000
pure def observeTime(s: TraceServer, t: int): TraceServer = { ...s, now: t, reply: ReplyNone }
pure def canRenewIntake(s: TraceServer, verifiedAt: int): bool =
  verifiedAt >= 0 and verifiedAt <= s.now and verifiedAt >= s.intake.verifiedAt
pure def renewIntake(s: TraceServer, intakeEnabled: bool, verifiedAt: int): TraceServer =
  { ...s, intake: { observed: true, enabled: intakeEnabled, verifiedAt: verifiedAt }, reply: ReplyNone }
pure def observeStanding(s: TraceServer, banned: bool): TraceServer = { ...s, banned: banned, reply: ReplyNone }
pure def alwaysIntakeNotFuture(s: TraceServer): bool = s.intake.verifiedAt >= 0 and s.intake.verifiedAt <= s.now
pure def stepClockMonotone(before: TraceServer, after: TraceServer): bool = before.now <= after.now
```

### Run creation is keyed by the authenticated actor and idempotency key

A ban refuses before lookup. A retry with the same key and the same complete
request returns the existing row; a different request under that key is an
idempotency conflict and never changes the row.

```quint
pure def validRequest(r: CreateRequest): bool = r.clientRun != "" and r.project > 0 and r.repository != ""
  and r.policyRevision != "" and r.provider != "" and r.model != "" and r.client != "" and r.clientVersion != ""
pure def canCreateRun(s: TraceServer, by: int, key: str, request: CreateRequest): bool =
  by == s.owner and key != "" and validRequest(request) and (s.createKey == "" or s.createKey == key)
pure def createRun(s: TraceServer, by: int, key: str, request: CreateRequest): TraceServer =
  if (s.banned) { ...s, reply: ReplyBanned }
  else if (s.createKey == "") { ...s, createKey: key, request: request, state: AwaitingTrace, reply: ReplyCreated }
  else if (s.request == request) { ...s, reply: ReplyExisting }
  else { ...s, reply: ReplyConflict }
pure def stepRequestImmutable(before: TraceServer, after: TraceServer): bool =
  before.createKey != "" implies after.createKey == before.createKey and after.request == before.request
```

### An upload intent is a five-minute one-time capability that only its exact retry renews

Intent creation checks the owner, the non-finalized run and a compatible
attached digest. The size is 1 to 8 MiB. Repeating the exact request returns
the same intent; an expired, unconsumed intent is renewed for five minutes. A
consumed intent stays consumed. A mismatched retry is a conflict.

```quint
pure def keyed(s: TraceServer, key: str): List[Intent] = s.intents.select(i => i.key == key)
pure def owns(s: TraceServer, by: int): bool = by == s.owner and s.state != NoRun
pure def canCreateIntent(s: TraceServer, by: int, key: str, digest: str): bool = key != "" and digest != ""
pure def createIntent(s: TraceServer, by: int, key: str, digest: str, byteCount: int, contentType: ContentType): TraceServer =
  val found = keyed(s, key)
  val prior = found.nthOr(0, noIntent)
  if (s.banned) { ...s, reply: ReplyBanned }
  else if (not(owns(s, by))) { ...s, reply: ReplyNotFound }
  else if (s.state == Finalized) { ...s, reply: ReplyFinalized }
  else if (s.attached != "" and s.attached != digest) { ...s, reply: ReplyTraceConflict }
  else if (byteCount < 1 or byteCount > maxTraceBytes) { ...s, reply: ReplyInvalid }
  else if (not(s.intents.some(i => i.key == key)))
    { ...s, intents: s.intents.append({ key: key, digest: digest, size: byteCount, contentType: contentType,
        expiresAt: s.now + intentLifetime, consumed: false }), reply: ReplyCreated }
  else if (prior.digest != digest or prior.size != byteCount or prior.contentType != contentType) { ...s, reply: ReplyConflict }
  else if (not(prior.consumed) and prior.expiresAt <= s.now)
    { ...s, intents: s.intents.listMap(i => if (i.key == key) { ...i, expiresAt: s.now + intentLifetime } else i),
      reply: ReplyRenewed }
  else { ...s, reply: ReplyExisting }
pure def alwaysIntentsBounded(s: TraceServer): bool = s.intents.every(i => i.key != "" and i.digest != ""
  and 1 <= i.size and i.size <= maxTraceBytes and i.expiresAt <= s.now + intentLifetime
  and s.intents.every(j => j.key == i.key implies j == i))
pure def alwaysConsumedAttached(s: TraceServer): bool = s.intents.every(i => i.consumed implies i.digest == s.attached)
pure def stepConsumedStaysConsumed(before: TraceServer, after: TraceServer): bool =
  before.intents.every(i => i.consumed implies after.intents.includes(i))
```

### A capability upload reserves one permanent object before writing and attaches only while still allowed

The capability PUT is not bearer-authenticated. It needs a live intent, the
owner's clear standing, fresh private intake, and the exact intent content
type, size and digest. Existing content-addressed object metadata must match.
Before any write, D1 reserves exactly one object for the run; the reservation
is permanent, even when storage or attachment fails, and a different digest
then needs a new run. Attachment consumes the intent atomically, measured at
the request's authorization time, and rechecks the ban, the finalized state
and the attached digest. Bytes written under a reservation made before a ban
stay unattached.

```quint
pure def canBeginPut(s: TraceServer, key: str, digest: str): bool = key != "" and digest != ""
pure def beginPut(s: TraceServer, key: str, digest: str, byteCount: int, contentType: ContentType): TraceServer =
  val live = s.intents.select(i => i.key == key and not(i.consumed) and i.expiresAt > s.now)
  val intent = live.nthOr(0, noIntent)
  val blob = { digest: digest, size: byteCount, contentType: contentType }
  if (live.length() == 0) { ...s, reply: ReplyCapabilityGone }
  else if (s.banned) { ...s, reply: ReplyBanned }
  else if (not(intakeFresh(s))) { ...s, reply: ReplyIntakeUnavailable }
  else if (contentType != intent.contentType or byteCount != intent.size or digest != intent.digest) { ...s, reply: ReplyIntentMismatch }
  else if (s.objects.some(o => o.digest == digest and o != blob)) { ...s, reply: ReplyObjectConflict }
  else if (s.state == Finalized) { ...s, reply: ReplyFinalized }
  else if (s.attached != "" and s.attached != digest) { ...s, reply: ReplyTraceConflict }
  else if (s.reservation.length() > 0 and s.reservation.nthOr(0, noObject) != blob) { ...s, reply: ReplyTraceConflict }
  else { ...s, reservation: List(blob),
    puts: s.puts.append({ key: key, blob: blob, authorizedAt: s.now, stage: PutReserved }), reply: ReplyNone }
pure def reservedPut(s: TraceServer, key: str): bool = s.puts.some(p => p.key == key and p.stage == PutReserved)
pure def canWriteBytes(s: TraceServer, key: str): bool = reservedPut(s, key)
pure def writeBytes(s: TraceServer, key: str, succeeds: bool): TraceServer =
  val p = s.puts.select(x => x.key == key and x.stage == PutReserved).nthOr(0, noPut)
  val conflicting = s.objects.some(o => o.digest == p.blob.digest and o != p.blob)
  if (succeeds and not(conflicting))
    { ...s, objects: if (s.objects.includes(p.blob)) s.objects else s.objects.append(p.blob),
      puts: s.puts.listMap(x => if (x.key == key and x.stage == PutReserved) { ...x, stage: PutWritten } else x),
      reply: ReplyNone }
  else { ...s, puts: s.puts.listMap(x => if (x.key == key and x.stage == PutReserved) { ...x, stage: PutFailed } else x),
    reply: ReplyStorageFailed }
pure def writtenPut(s: TraceServer, key: str): bool = s.puts.some(p => p.key == key and p.stage == PutWritten)
pure def canAttachPut(s: TraceServer, key: str): bool = writtenPut(s, key)
pure def attachPut(s: TraceServer, key: str): TraceServer =
  val p = s.puts.select(x => x.key == key and x.stage == PutWritten).nthOr(0, noPut)
  val live = s.intents.some(i => i.key == key and not(i.consumed) and i.expiresAt > p.authorizedAt
    and i.digest == p.blob.digest and i.size == p.blob.size and i.contentType == p.blob.contentType)
  val failed = s.puts.listMap(x => if (x.key == key and x.stage == PutWritten) { ...x, stage: PutFailed } else x)
  if (s.banned) { ...s, puts: failed, reply: ReplyBanned }
  else if (not(live) or s.state == Finalized or (s.attached != "" and s.attached != p.blob.digest))
    { ...s, puts: failed, reply: ReplyConflict }
  else { ...s, intents: s.intents.listMap(i => if (i.key == key) { ...i, consumed: true } else i),
    attached: p.blob.digest, state: TraceUploaded,
    puts: s.puts.listMap(x => if (x.key == key and x.stage == PutWritten) { ...x, stage: PutAttached } else x),
    reply: ReplyCreated }
pure def canObserveForeignObject(s: TraceServer, blob: TraceObject): bool =
  blob.digest != "" and not(s.objects.some(o => o.digest == blob.digest))
pure def observeForeignObject(s: TraceServer, blob: TraceObject): TraceServer =
  { ...s, objects: s.objects.append(blob), reply: ReplyNone }
pure def alwaysOneReservation(s: TraceServer): bool = s.reservation.length() <= 1
  and s.puts.every(p => s.reservation.length() == 1 and s.reservation.nthOr(0, noObject) == p.blob)
pure def alwaysAttachedObject(s: TraceServer): bool = s.attached != "" implies
  s.objects.some(o => o.digest == s.attached) and s.reservation.length() == 1
    and s.reservation.nthOr(0, noObject).digest == s.attached
pure def alwaysWrittenStored(s: TraceServer): bool =
  s.puts.every(p => (p.stage == PutWritten or p.stage == PutAttached) implies s.objects.includes(p.blob))
pure def alwaysContentAddressed(s: TraceServer): bool =
  s.objects.every(o => o.digest != "" and s.objects.every(x => x.digest == o.digest implies x == o))
pure def stepReservationPermanent(before: TraceServer, after: TraceServer): bool =
  before.reservation.length() > 0 implies after.reservation == before.reservation
pure def stepObjectsPermanent(before: TraceServer, after: TraceServer): bool =
  before.objects.every(o => after.objects.includes(o))
pure def stepAttachedImmutable(before: TraceServer, after: TraceServer): bool =
  before.attached != "" implies after.attached == before.attached
```

### Finalization needs an attached trace and freezes the run

Finalization of an already finalized run keeps its first time.

```quint
pure def canFinalize(s: TraceServer, by: int, key: str): bool = key != ""
pure def finalize(s: TraceServer, by: int, key: str): TraceServer =
  if (s.banned) { ...s, reply: ReplyBanned }
  else if (not(owns(s, by))) { ...s, reply: ReplyNotFound }
  else if (s.attached == "") { ...s, reply: ReplyTraceRequired }
  else if (s.state == Finalized) { ...s, reply: ReplyExisting }
  else { ...s, state: Finalized, finalizedAt: s.now, reply: ReplyCreated }
pure def stepFinalizedFrozen(before: TraceServer, after: TraceServer): bool = before.state == Finalized implies
  after.state == Finalized and after.finalizedAt == before.finalizedAt and after.events == before.events
    and after.intents == before.intents and after.attached == before.attached
```

### Progress events are the owner's agent-source records, idempotent by key and refused once finalized

The contributor route accepts only `source: agent` and refuses an event more
than five minutes in the future. GitHub-source events are reserved for a
webhook processor; no write path for them exists, so every recorded event is
an agent event. A retry with the same key and body returns the same event; a
different body under that key is a conflict.

```quint
pure def canAppendEvent(s: TraceServer, by: int, key: str, occurredAt: int): bool = key != "" and occurredAt >= 0
pure def appendEvent(s: TraceServer, by: int, key: str, kind: EventKind, source: EventSource, occurredAt: int, githubObject: str): TraceServer =
  val found = s.events.select(e => e.key == key)
  val prior = found.nthOr(0, { key: "", kind: RunStarted, source: AgentSource, occurredAt: 0, githubObject: "", recordedAt: 0 })
  if (s.banned) { ...s, reply: ReplyBanned }
  else if (not(owns(s, by))) { ...s, reply: ReplyNotFound }
  else if (s.state == Finalized) { ...s, reply: ReplyFinalized }
  else if (source != AgentSource or occurredAt > s.now + eventClockSkew) { ...s, reply: ReplyInvalid }
  else if (s.events.some(e => e.key == key))
    { ...s, reply: if (prior.kind == kind and prior.occurredAt == occurredAt and prior.githubObject == githubObject) ReplyExisting else ReplyConflict }
  else { ...s, events: s.events.append({ key: key, kind: kind, source: source, occurredAt: occurredAt,
      githubObject: githubObject, recordedAt: s.now }), reply: ReplyCreated }
pure def alwaysAgentEvents(s: TraceServer): bool = s.events.every(e => e.source == AgentSource and e.key != ""
  and e.occurredAt <= e.recordedAt + eventClockSkew and e.recordedAt <= s.now
  and s.events.every(x => x.key == e.key implies x == e))
pure def stepEventsAppendOnly(before: TraceServer, after: TraceServer): bool =
  before.events.length() <= after.events.length() and before.events.every(e => after.events.includes(e))
```

### A banned owner starts nothing new and a different actor changes nothing

```quint
pure def stepBannedAddsNothing(before: TraceServer, after: TraceServer): bool = (before.banned and after.banned) implies
  after.createKey == before.createKey and after.intents == before.intents and after.reservation == before.reservation
    and after.attached == before.attached and after.state == before.state and after.events == before.events
pure def lawOtherActorAddsNoIntent(s: TraceServer, by: int, key: str, digest: str, byteCount: int, contentType: ContentType): bool =
  by != s.owner implies createIntent(s, by, key, digest, byteCount, contentType).intents == s.intents
pure def lawOtherActorAddsNoEvent(s: TraceServer, by: int, key: str, kind: EventKind, source: EventSource, occurredAt: int, githubObject: str): bool =
  by != s.owner implies appendEvent(s, by, key, kind, source, occurredAt, githubObject).events == s.events
pure def lawOtherActorCannotFinalize(s: TraceServer, by: int, key: str): bool =
  by != s.owner implies finalize(s, by, key).state == s.state
```

### The author's own pull_request_opened event is the only closure run evidence

Automatic closure requires a run its author created through their own
authenticated session for this project's repository, with a
`pull_request_opened` event naming the exact pull request node. A copied
marker, receipt or footer cannot produce this record. Repository aliases come
from the registry and are a shell lookup.

```quint
pure def recordedSkillRun(s: TraceServer, author: int, project: int, repository: str, prNode: str): bool =
  s.owner == author and s.state != NoRun and s.request.project == project and s.request.repository == repository
    and prNode != "" and s.events.some(e => e.kind == PullRequestOpened and e.source == AgentSource and e.githubObject == prNode)
pure def lawRecordedRunIsTheAuthors(s: TraceServer, author: int, project: int, repository: str, prNode: str): bool =
  recordedSkillRun(s, author, project, repository, prNode) implies author == s.owner and s.state != NoRun
    and s.events.some(e => e.githubObject == prNode)
pure def sometimesOpenedRecorded(s: TraceServer): bool = s.events.some(e => e.kind == PullRequestOpened and e.githubObject != "")
pure def sometimesFinalized(s: TraceServer): bool = s.state == Finalized
pure def sometimesRenewed(s: TraceServer): bool = s.reply == ReplyRenewed
pure def sometimesConsumedCapabilityRefused(s: TraceServer): bool = s.reply == ReplyCapabilityGone and s.intents.some(i => i.consumed)
pure def sometimesReservedUnattachedAfterBan(s: TraceServer): bool = s.banned and s.reservation.length() == 1 and s.attached == ""
pure def sometimesIntakeRefused(s: TraceServer): bool = s.reply == ReplyIntakeUnavailable
pure def sometimesCompetingDigestRefused(s: TraceServer): bool = s.reply == ReplyTraceConflict and s.reservation.length() == 1
pure def sometimesStorageFailedReservationKept(s: TraceServer): bool = s.reply == ReplyStorageFailed and s.reservation.length() == 1 and s.attached == ""
pure def sometimesTraceRequired(s: TraceServer): bool = s.reply == ReplyTraceRequired
pure def sometimesFinalizedRefusesEvent(s: TraceServer): bool = s.state == Finalized and s.reply == ReplyFinalized
pure def sometimesCreateConflict(s: TraceServer): bool = s.reply == ReplyConflict and s.state == AwaitingTrace
pure def sometimesBannedCreate(s: TraceServer): bool = s.reply == ReplyBanned and s.state == NoRun
```

### Simulation samples cover both actors, both keys, both digests and the boundaries

These input sets bound simulation only.

```quint
pure val byValues = Set(1, 2)
pure val keyValues = Set("k1", "k2")
pure val digestValues = Set("d1", "d2")
pure val byteCountValues = Set(0, 1, 2)
pure val tValues = Set(0, 1, 301, 90000)
pure val verifiedAtValues = Set(0, 1, 301)
pure val occurredAtValues = Set(0, 1000)
pure val githubObjectValues = Set("", "PR_a")
pure val requestA: CreateRequest = { clientRun: "run-a", project: 1, repository: "o/r", policyRevision: "rev",
  provider: "p", model: "m", client: "c", clientVersion: "1" }
pure val requestValues = Set(requestA, { ...requestA, clientRun: "run-b" })
pure val runningState: TraceServer = { ...initial, createKey: "k1", request: requestA, state: AwaitingTrace,
  intents: List({ key: "k1", digest: "d1", size: 2, contentType: Ndjson, expiresAt: 300, consumed: false }) }
pure val sValues = Set(initial, runningState, { ...runningState, banned: true },
  { ...runningState, state: TraceUploaded, attached: "d1", reservation: List({ digest: "d1", size: 2, contentType: Ndjson }),
    objects: List({ digest: "d1", size: 2, contentType: Ndjson }),
    events: List({ key: "e1", kind: PullRequestOpened, source: AgentSource, occurredAt: 0, githubObject: "PR_a", recordedAt: 0 }) })
pure val authorValues = Set(1, 2)
pure val projectValues = Set(1, 2)
pure val repositoryValues = Set("o/r", "x/y")
pure val prNodeValues = Set("", "PR_a")
pure val blobValues = Set({ digest: "d1", size: 2, contentType: Ndjson })
pure val weight_createRun = 6
pure val weight_createIntent = 8
pure val weight_beginPut = 10
pure val weight_writeBytes = 8
pure val weight_attachPut = 8
pure val weight_renewIntake = 6
pure val weight_finalize = 4
pure val weight_appendEvent = 5
```
