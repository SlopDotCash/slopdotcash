# Contributor session exchange and durable run registration

PRD sections 4, 9 and 12. This model follows `contributor_session_exchange`
at `6b3b9d0b979f0608d87941f1146056a98513ffcf`, with source in
`skills/project-contributor-template/scripts/run-receipt.mjs`,
`workers/identity/{handler,persistence,contracts}.ts`,
`backend/trace/handler.ts` and `backend/trace/cloudflare-persistence.ts`.
The identity flow statuses are the `identity_oauth_flows.status` values of
migration 0108: `pending`, `callback_processing`, `callback_complete`,
`assertion_issued` and the terminal `callback_failed`. The client uses a
fixed HTTPS identity and session authority, rejects redirects, and validates
bounded response bytes. Flow authorization uses the numeric GitHub actor that
completes the provider flow, read by the identity Worker from GitHub `/user`;
request metadata never chooses that identity. The model carries phases,
server-fixed lifetimes and immutable references, never assertions, tokens or
poll capabilities. The run row that the create request reaches is the
[server trace run](./traceServer.md); this unit sees its reply.

## Story: Exchange one fresh assertion for a private-use session

### A fresh invocation owns its browser handoff and each poll

The identity Worker fixes every lifetime: a five-minute flow, a 90-second
assertion and a ten-minute contributor session. Start commit and response are
separate. Starts and polls are rate limited (12 starts and 120 polls per
minute per client digest); a limited start ends the invocation. A valid reply
presents the exact trusted browser URL. Poll sleeps use the server delay from
one to ten seconds, never below the initial delay. The deadline is checked
before waiting; the clock may cross it before the request arrives. The server
refuses a poll at or after its deadline. The hourly identity job removes
expired flows and assertions; a removed flow answers every later poll as
gone, and an assertion can be inserted only while its flow is
`callback_complete`, so a delayed poll cannot recreate it. A callback whose GitHub exchange
fails is terminal and the next poll reports it at once. A ready completion
moves the flow to `assertion_issued` server-side before the response, and a
repeated poll is refused; a lost reply cannot roll this back. A user retry
starts a new invocation, never a hidden retry of a failed exchange.

```quint
type ExchangePhase = Idle | Starting | StartReply | Waiting | Polling | PollReply | Exchanging | AuthReply | Authenticating | Inserting | CreateReply | Done
type FlowStatus = FlowNone | FlowPending | CallbackProcessing | CallbackComplete | AssertionIssued | CallbackFailed | FlowPurged
type PollResult = NoPoll | PollPending | FlowExpired | FlowGone | FlowFailed | AssertionReturned | PollLimited
type Outcome = Pending | Ready | StartError | StartLimited | PollError | FlowTimeout | FlowRefused | AssertionTimeout
  | IdentityRefused | SessionError | RunRefused | BannedRefused | RunConflict | WriteError | TransportError | Interrupted
type Role = NoRole | ContributorRole | OperatorRole
type RowStage = NoRow | AwaitingTrace | Uploaded | Finalized
type RunLookup = { serverId: str, status: RowStage }
type CreateKind = NoCreate | RowCreated | RowExisting | RowConflict | RowBanned
type CreateAnswer = { kind: CreateKind, row: RunLookup }
type Exchange = { phase: ExchangePhase, now: int, attempt: int, flowExpires: int, assertionIssuedAt: int, assertionExpires: int,
  bearerIssuedAt: int, bearerExpires: int, initialDelay: int, retryDelay: int, actor: int, key: str, flow: FlowStatus,
  poll: PollResult, displayed: bool, assertionConsumed: bool, minted: bool, role: Role, banned: bool,
  created: CreateKind, snapshot: RunLookup, result: Outcome }
pure val flowLifetime = 300
pure val assertionLifetime = 90
pure val bearerLifetime = 600
pure val noLookup: RunLookup = { serverId: "", status: NoRow }
pure val initial: Exchange = { phase: Idle, now: 0, attempt: 0, flowExpires: 0, assertionIssuedAt: 0, assertionExpires: 0,
  bearerIssuedAt: 0, bearerExpires: 0, initialDelay: 1, retryDelay: 1, actor: 0, key: "", flow: FlowNone,
  poll: NoPoll, displayed: false, assertionConsumed: false, minted: false, role: NoRole, banned: false,
  created: NoCreate, snapshot: noLookup, result: Pending }
pure def complete(result: Outcome, e: Exchange): Exchange = { ...e, phase: Done, result: result }
pure def canBegin(e: Exchange, attempt: int, key: str): bool = (e.phase == Idle or e.phase == Done)
  and attempt > e.attempt and attempt > 0 and key != ""
pure def begin(e: Exchange, attempt: int, key: str): Exchange =
  { ...initial, phase: Starting, now: e.now, attempt: attempt, key: key, banned: e.banned }
pure def canObserveTime(e: Exchange, time: int): bool = time >= e.now and time <= 9007199254740000
pure def observeTime(e: Exchange, time: int): Exchange = { ...e, now: time }
pure def canAcceptStart(e: Exchange, delay: int): bool = e.phase == Starting and 1 <= delay and delay <= 10
pure def acceptStart(e: Exchange, delay: int): Exchange = { ...e, phase: StartReply, flow: FlowPending,
  flowExpires: e.now + flowLifetime, initialDelay: delay, retryDelay: delay }
pure def canLimitStart(e: Exchange): bool = e.phase == Starting
pure def limitStart(e: Exchange): Exchange = complete(StartLimited, e)
pure def canReceiveStart(e: Exchange, attempt: int): bool = e.phase == StartReply and attempt == e.attempt
pure def receiveStart(e: Exchange, attempt: int, valid: bool): Exchange =
  if (valid) { ...e, phase: Waiting, displayed: true } else complete(StartError, e)
```

### The provider callback is claimed once and either completes or fails terminally

```quint
pure def canBeginCallback(e: Exchange): bool = e.displayed and e.flow == FlowPending and e.now < e.flowExpires
pure def beginCallback(e: Exchange): Exchange = { ...e, flow: CallbackProcessing }
pure def canCompleteCallback(e: Exchange, actor: int): bool = e.flow == CallbackProcessing and actor > 0
pure def completeCallback(e: Exchange, actor: int): Exchange = { ...e, flow: CallbackComplete, actor: actor }
pure def canFailCallback(e: Exchange): bool = e.flow == CallbackProcessing
pure def failCallback(e: Exchange): Exchange = { ...e, flow: CallbackFailed }
pure def canPurgeExpired(e: Exchange): bool = e.flow != FlowNone and e.flow != FlowPurged and e.now >= e.flowExpires
  and not(e.flow == AssertionIssued and e.now < e.assertionExpires)
pure def purgeExpired(e: Exchange): Exchange = { ...e, flow: FlowPurged }
pure def canWaitPoll(e: Exchange): bool = e.phase == Waiting and e.now <= 9007199254740000
pure def waitPoll(e: Exchange): Exchange = if (e.now >= e.flowExpires) complete(FlowTimeout, e)
  else { ...e, phase: Polling, now: e.now + e.retryDelay }
pure def canAcceptPoll(e: Exchange): bool = e.phase == Polling
pure def acceptPoll(e: Exchange): Exchange =
  if (e.flow == FlowPurged) { ...e, phase: PollReply, poll: FlowGone }
  else if (e.flow == CallbackFailed) { ...e, phase: PollReply, poll: FlowFailed }
  else if (e.now >= e.flowExpires) { ...e, phase: PollReply, poll: FlowExpired }
  else if (e.flow == AssertionIssued) { ...e, phase: PollReply, poll: FlowGone }
  else if (e.flow == CallbackComplete) { ...e, phase: PollReply, poll: AssertionReturned, flow: AssertionIssued,
    assertionIssuedAt: e.now, assertionExpires: e.now + assertionLifetime }
  else { ...e, phase: PollReply, poll: PollPending }
pure def canLimitPoll(e: Exchange): bool = e.phase == Polling
pure def limitPoll(e: Exchange): Exchange = { ...e, phase: PollReply, poll: PollLimited }
pure def canReceivePoll(e: Exchange, attempt: int, retry: int): bool = e.phase == PollReply and attempt == e.attempt
  and (e.poll != PollPending or (retry >= e.initialDelay and retry <= 10))
pure def receivePoll(e: Exchange, attempt: int, retry: int, valid: bool): Exchange =
  if (not(valid) or e.poll == PollLimited or e.poll == FlowGone) complete(PollError, e)
  else if (e.poll == FlowFailed) complete(FlowRefused, e)
  else if (e.poll == FlowExpired) complete(FlowTimeout, e)
  else if (e.poll == PollPending) { ...e, phase: Waiting, retryDelay: retry }
  else if (e.now >= e.assertionExpires) complete(AssertionTimeout, e)
  else { ...e, phase: Exchanging }
```

### Assertion consumption survives signing errors and a lost session reply

The trace API consumes a valid assertion of the exact audience atomically
before issuing the bearer; `exactAssertion` is the identity service's
verdict on the presented assertion's digest and audience. A signing failure
can consume an assertion without issuing a usable token. The exchange issues
only the contributor role; operator status is never issued by this endpoint.
Current server authentication checks the bearer deadline and the actor's
participation standing before accepting the create request. The standing
mirrors the [access area](../access.md) ban fact for the authenticated actor
(composition obligation). An accepted request may commit and reply after its
prior authentication check.

```quint
pure def canExchange(e: Exchange): bool = e.phase == Exchanging
pure def exchange(e: Exchange, exactAssertion: bool, signed: bool): Exchange =
  if (not(exactAssertion) or e.now >= e.assertionExpires or e.assertionConsumed) complete(IdentityRefused, e)
  else { ...e, phase: AuthReply, assertionConsumed: true, minted: signed, role: if (signed) ContributorRole else NoRole,
    bearerIssuedAt: e.now, bearerExpires: e.now + bearerLifetime }
pure def canReceiveBearer(e: Exchange, attempt: int): bool = e.phase == AuthReply and attempt == e.attempt
pure def receiveBearer(e: Exchange, attempt: int, valid: bool): Exchange =
  if (valid and e.minted) { ...e, phase: Authenticating } else complete(SessionError, e)
pure def observeStanding(e: Exchange, banned: bool): Exchange = { ...e, banned: banned }
pure def canAuthenticateCreate(e: Exchange): bool = e.phase == Authenticating
pure def authenticateCreate(e: Exchange): Exchange =
  if (e.now >= e.bearerExpires) complete(RunRefused, e)
  else if (e.banned) complete(BannedRefused, e)
  else { ...e, phase: Inserting }
```

## Story: Commit the actor- and request-keyed row before acknowledging it

### A lost response preserves server registration without claiming local receipt

The idempotency key binds the complete canonical request body, including local
run ID, project, repository, reviewed policy revision, exact provider, model,
client and client version. The server row store keys rows by authenticated
actor and key (`traceServer.md` `createRun`): an identical retry returns the
existing row, a changed payload under the same key is a conflict, and a ban
refuses a new row. A different actor or key reaches an independent row.
Neither a client reply failure nor process interruption discards a committed
row. Returning a valid existing finalized row does not represent a new upload
or finalization.

```quint
pure def consistentCreate(reply: CreateAnswer): bool =
  if (reply.kind == RowCreated) reply.row.serverId != "" and reply.row.status == AwaitingTrace
  else if (reply.kind == RowExisting) reply.row.serverId != "" and reply.row.status != NoRow
  else reply.kind != NoCreate and reply.row == noLookup
pure def canCommitCreate(e: Exchange, reply: CreateAnswer): bool = e.phase == Inserting and consistentCreate(reply)
  and (e.banned implies reply.kind != RowCreated)
pure def commitCreate(e: Exchange, reply: CreateAnswer): Exchange =
  { ...e, phase: CreateReply, created: reply.kind, snapshot: reply.row }
pure def canReceiveCreate(e: Exchange, attempt: int): bool = e.phase == CreateReply and attempt == e.attempt
pure def receiveCreate(e: Exchange, attempt: int, exactSchema: bool): Exchange =
  if (e.created == RowConflict) complete(RunConflict, e)
  else if (e.created == RowBanned) complete(BannedRefused, e)
  else if (exactSchema and e.snapshot.serverId != "") complete(Ready, e) else complete(WriteError, e)
pure def canInterrupt(e: Exchange): bool = e.phase != Idle and e.phase != Done
pure def interrupt(e: Exchange): Exchange = complete(Interrupted, e)
pure def canTransportFails(e: Exchange): bool = e.phase == Starting or e.phase == Polling or e.phase == Exchanging or e.phase == Authenticating
pure def transportFails(e: Exchange): Exchange = complete(TransportError, e)
pure def flowRank(flow: FlowStatus): int = if (flow == FlowNone) 0 else if (flow == FlowPending) 1
  else if (flow == CallbackProcessing) 2 else if (flow == CallbackComplete) 3 else if (flow == FlowPurged) 5 else 4
pure def alwaysClock(e: Exchange): bool = 0 <= e.now and 1 <= e.initialDelay and e.initialDelay <= e.retryDelay and e.retryDelay <= 10
pure def alwaysActor(e: Exchange): bool = (e.flow == CallbackComplete or e.flow == AssertionIssued) implies e.actor > 0
pure def stepPurgedStaysPurged(before: Exchange, via: str, after: Exchange): bool =
  (before.flow == FlowPurged and via != "begin") implies after.flow == FlowPurged
pure def alwaysLifetimes(e: Exchange): bool =
  (e.flow != FlowNone implies e.flowExpires > 0 and e.flowExpires <= e.now + flowLifetime)
  and ((e.flow == AssertionIssued or e.assertionIssuedAt > 0) implies e.assertionExpires == e.assertionIssuedAt + assertionLifetime)
  and (e.assertionConsumed implies e.bearerExpires == e.bearerIssuedAt + bearerLifetime)
pure def alwaysContributorOnly(e: Exchange): bool = e.role != OperatorRole and (e.minted iff e.role == ContributorRole)
pure def issued(e: Exchange): bool = e.assertionIssuedAt > 0 and (e.flow == AssertionIssued or e.flow == FlowPurged)
pure def alwaysEvidenceOrder(e: Exchange): bool = (e.minted implies e.assertionConsumed)
  and (e.assertionConsumed implies issued(e))
  and (e.phase == Exchanging implies issued(e))
  and ((e.phase == Authenticating or e.phase == Inserting or e.phase == CreateReply) implies e.minted)
  and ((e.phase == PollReply and e.poll == AssertionReturned) implies issued(e))
pure def alwaysReply(e: Exchange): bool = (e.snapshot.serverId != "") implies e.snapshot.status != NoRow
  and e.key != "" and e.minted and (e.created == RowCreated or e.created == RowExisting) and (e.phase == CreateReply or e.phase == Done)
pure def alwaysActiveInvocation(e: Exchange): bool = ((e.phase != Idle and e.phase != Done) implies e.attempt > 0 and e.key != "")
  and ((e.phase == Idle or e.phase == Starting) implies e.flow == FlowNone and not(e.assertionConsumed) and not(e.minted)
    and e.assertionIssuedAt == 0 and e.poll == NoPoll)
  and (e.phase == StartReply implies (e.flow == FlowPending or e.flow == FlowPurged) and e.assertionIssuedAt == 0 and not(e.assertionConsumed))
  and ((e.phase == Idle or e.phase == Starting or e.phase == StartReply) implies not(e.displayed))
  and (e.phase == Polling implies e.now > 0)
  and (e.phase == PollReply implies e.poll != NoPoll)
pure def alwaysReady(e: Exchange): bool = e.result == Ready implies e.phase == Done and e.snapshot.serverId != "" and e.minted
  and (e.created == RowCreated or e.created == RowExisting)
pure def stepInvocationAndClock(before: Exchange, after: Exchange): bool = before.now <= after.now and before.attempt <= after.attempt
pure def stepFlowForward(before: Exchange, via: str, after: Exchange): bool = via != "begin" implies
  flowRank(before.flow) <= flowRank(after.flow)
  and (before.flow == CallbackFailed implies (after.flow == CallbackFailed or after.flow == FlowPurged))
pure def sometimesReady(e: Exchange): bool = e.result == Ready
pure def sometimesLostButCommitted(e: Exchange): bool = e.result == WriteError and e.snapshot.serverId != ""
pure def sometimesConsumedWithoutBearer(e: Exchange): bool = e.assertionConsumed and not(e.minted) and e.result == SessionError
pure def sometimesCallbackFailed(e: Exchange): bool = e.result == FlowRefused
pure def sometimesBannedRefused(e: Exchange): bool = e.result == BannedRefused
pure def sometimesConflict(e: Exchange): bool = e.result == RunConflict
pure def sometimesStartLimited(e: Exchange): bool = e.result == StartLimited
```

### Simulation uses representative deadlines and actor-scoped response outcomes

```quint
pure val attemptValues = Set(1, 2)
pure val keyValues = Set("key-a", "key-b")
pure val actorValues = Set(1, 2)
pure val delayValues = Set(1, 2)
pure val retryValues = Set(1, 2)
pure val timeValues = Set(1, 3, 100, 400)
pure val replyValues = Set({ kind: RowCreated, row: { serverId: "server-a", status: AwaitingTrace } },
  { kind: RowExisting, row: { serverId: "server-b", status: Finalized } },
  { kind: RowConflict, row: noLookup }, { kind: RowBanned, row: noLookup })
pure val weight_begin = 10
pure val weight_acceptStart = 12
pure val weight_receiveStart = 12
pure val weight_beginCallback = 12
pure val weight_completeCallback = 12
pure val weight_receivePoll = 10
pure val weight_exchange = 12
pure val weight_receiveBearer = 12
pure val weight_authenticateCreate = 12
pure val weight_commitCreate = 12
pure val weight_interrupt = 1
pure val weight_transportFails = 1
pure val weight_receiveCreate = 8
pure val weight_waitPoll = 8
pure val weight_acceptPoll = 8
```
