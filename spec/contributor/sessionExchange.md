# Contributor session exchange and durable run registration

PRD sections 4, 9 and 12. This model follows `contributor_session_exchange`
at `6b3b9d0b979f0608d87941f1146056a98513ffcf`, with source in
`skills/project-contributor-template/scripts/run-receipt.mjs`,
`backend/trace/handler.ts`, `backend/trace/cloudflare-persistence.ts`, and
`backend/identity-assertion.ts`. The client uses a fixed HTTPS identity and
session authority, rejects redirects, and validates bounded response bytes.
Flow authorization uses the GitHub account that completes the provider flow.
Request metadata never chooses that identity. The model carries phases and
immutable references, without carrying assertions, tokens or poll capabilities.

## Story: Exchange one fresh assertion for a private-use session

### A fresh invocation owns its browser handoff and each poll

Start commit and response are separate. A valid reply presents the exact
trusted browser URL. Poll sleeps use the server delay from one to ten seconds,
never below the initial delay. The deadline is checked before waiting; the
clock may cross it before the request arrives. The server refuses a poll at
or after its deadline. A ready completion consumes its exact flow server-side
before the response and issues a short-lived assertion. A lost reply cannot
roll this back. A user retry starts a new invocation, never a hidden retry of
a failed exchange.

```quint
type ExchangePhase = Idle | Starting | StartReply | Waiting | Polling | PollReply | Exchanging | AuthReply | Authenticating | Inserting | CreateReply | Done
type PollResult = NoPoll | PollPending | FlowExpired | AssertionIssued
type Outcome = Pending | Ready | StartError | PollError | FlowTimeout | AssertionTimeout | IdentityRefused | SessionError | RunRefused | WriteError | TransportError | Interrupted
type RowStage = NoRow | AwaitingTrace | Uploaded | Finalized
type RunLookup = { serverId: str, status: RowStage }
type Exchange = { phase: ExchangePhase, now: int, attempt: int, flowExpires: int, assertionExpires: int, bearerExpires: int,
  initialDelay: int, retryDelay: int, actor: str, key: str, flowReady: bool, poll: PollResult, displayed: bool,
  flowConsumed: bool, assertionConsumed: bool, minted: bool, snapshot: RunLookup, result: Outcome }
pure val noLookup: RunLookup = { serverId: "", status: NoRow }
pure val initial: Exchange = { phase: Idle, now: 0, attempt: 0, flowExpires: 0, assertionExpires: 0, bearerExpires: 0,
  initialDelay: 1, retryDelay: 1, actor: "", key: "", flowReady: false, poll: NoPoll, displayed: false,
  flowConsumed: false, assertionConsumed: false, minted: false, snapshot: noLookup, result: Pending }
pure def complete(result: Outcome, e: Exchange): Exchange = { ...e, phase: Done, result: result }
pure def canBegin(e: Exchange, attempt: int, key: str): bool = (e.phase == Idle or e.phase == Done)
  and attempt > e.attempt and attempt > 0 and key != ""
pure def begin(e: Exchange, attempt: int, key: str): Exchange = { ...initial, phase: Starting, now: e.now, attempt: attempt, key: key }
pure def canObserveTime(e: Exchange, time: int): bool = time >= e.now
pure def observeTime(e: Exchange, time: int): Exchange = { ...e, now: time }
pure def canAcceptStart(e: Exchange, deadline: int, delay: int): bool = e.phase == Starting and deadline > e.now and 1 <= delay and delay <= 10
pure def acceptStart(e: Exchange, deadline: int, delay: int): Exchange = { ...e, phase: StartReply,
  flowExpires: deadline, initialDelay: delay, retryDelay: delay }
pure def canReceiveStart(e: Exchange, attempt: int): bool = e.phase == StartReply and attempt == e.attempt
pure def receiveStart(e: Exchange, attempt: int, valid: bool): Exchange =
  if (valid) { ...e, phase: Waiting, displayed: true } else complete(StartError, e)
pure def canAuthorizeFlow(e: Exchange, actor: str): bool = (e.phase == Waiting or e.phase == Polling)
  and e.now < e.flowExpires and not(e.flowReady) and actor != ""
pure def authorizeFlow(e: Exchange, actor: str): Exchange = { ...e, flowReady: true, actor: actor }
pure def canWaitPoll(e: Exchange): bool = e.phase == Waiting and e.now <= 9007199254740981
pure def waitPoll(e: Exchange): Exchange = if (e.now >= e.flowExpires) complete(FlowTimeout, e)
  else { ...e, phase: Polling, now: e.now + e.retryDelay }
pure def canAcceptPoll(e: Exchange, assertionUntil: int): bool = e.phase == Polling
  and (e.now >= e.flowExpires or not(e.flowReady) or assertionUntil > e.now)
pure def acceptPoll(e: Exchange, assertionUntil: int): Exchange =
  if (e.now >= e.flowExpires) { ...e, phase: PollReply, poll: FlowExpired }
  else if (not(e.flowReady)) { ...e, phase: PollReply, poll: PollPending }
  else { ...e, phase: PollReply, poll: AssertionIssued, flowConsumed: true, assertionExpires: assertionUntil }
pure def canReceivePoll(e: Exchange, attempt: int, retry: int): bool = e.phase == PollReply and attempt == e.attempt
  and (e.poll != PollPending or (retry >= e.initialDelay and retry <= 10))
pure def receivePoll(e: Exchange, attempt: int, retry: int, valid: bool): Exchange =
  if (not(valid)) complete(PollError, e)
  else if (e.poll == FlowExpired) complete(FlowTimeout, e)
  else if (e.poll == PollPending) { ...e, phase: Waiting, retryDelay: retry }
  else if (e.now >= e.assertionExpires) complete(AssertionTimeout, e)
  else { ...e, phase: Exchanging }
```

### Assertion consumption survives signing errors and a lost session reply

A valid assertion of the exact scope and actor is consumed atomically before
issuing the bearer. A signing failure can consume an assertion without issuing
a usable token. The client schema checks the session expiration. Current server
authentication checks the actual deadline before accepting the create request.
An accepted request may commit and reply after its prior authentication check.

```quint
pure def canExchange(e: Exchange, bearerUntil: int): bool = e.phase == Exchanging and bearerUntil > e.now
pure def exchange(e: Exchange, bearerUntil: int, exactAssertion: bool, signed: bool): Exchange =
  if (not(exactAssertion) or e.now >= e.assertionExpires or e.assertionConsumed) complete(IdentityRefused, e)
  else { ...e, phase: AuthReply, assertionConsumed: true, minted: signed, bearerExpires: bearerUntil }
pure def canReceiveBearer(e: Exchange, attempt: int): bool = e.phase == AuthReply and attempt == e.attempt
pure def receiveBearer(e: Exchange, attempt: int, valid: bool): Exchange =
  if (valid and e.minted) { ...e, phase: Authenticating } else complete(SessionError, e)
pure def canAuthenticateCreate(e: Exchange): bool = e.phase == Authenticating
pure def authenticateCreate(e: Exchange, currentAuthority: bool): Exchange =
  if (currentAuthority and e.now < e.bearerExpires) { ...e, phase: Inserting } else complete(RunRefused, e)
```

## Story: Commit the actor- and request-keyed row before acknowledging it

### A lost response preserves server registration without claiming local receipt

The idempotency key binds the complete canonical request body, including local
run ID, project, repository, reviewed policy revision, exact provider, model,
client and client version. The durable adapter uses the authenticated GitHub
actor and request key, and rejects a conflicting payload for that key. An
actor and payload retry reuses the existing row. A different actor or complete
payload gets an independent row. Neither a client reply failure nor process
interruption discards a committed row. Returning a valid existing finalized
row does not represent a new upload or finalization. This unit keeps the
response projection; the separate durable row store and its atomic idempotency
check are a shell contract.

```quint
pure def canCommitCreate(e: Exchange): bool = e.phase == Inserting
pure def commitCreate(e: Exchange, response: RunLookup, actorAndKeyMatched: bool): Exchange =
  { ...e, phase: CreateReply,
    snapshot: if (actorAndKeyMatched and response.serverId != "" and response.status != NoRow) response else noLookup }
pure def canReceiveCreate(e: Exchange, attempt: int): bool = e.phase == CreateReply and attempt == e.attempt
pure def receiveCreate(e: Exchange, attempt: int, exactSchema: bool): Exchange =
  if (exactSchema and e.snapshot.serverId != "") complete(Ready, e) else complete(WriteError, e)
pure def canInterrupt(e: Exchange): bool = e.phase != Idle and e.phase != Done
pure def interrupt(e: Exchange): Exchange = complete(Interrupted, e)
pure def canTransportFails(e: Exchange): bool = e.phase == Starting or e.phase == Polling or e.phase == Exchanging or e.phase == Authenticating
pure def transportFails(e: Exchange): Exchange = complete(TransportError, e)
pure def alwaysClock(e: Exchange): bool = 0 <= e.now and 1 <= e.initialDelay and e.initialDelay <= e.retryDelay and e.retryDelay <= 10
pure def alwaysActor(e: Exchange): bool = e.flowReady implies e.actor != ""
pure def alwaysEvidenceOrder(e: Exchange): bool = (e.minted implies e.assertionConsumed) and (e.assertionConsumed implies e.flowConsumed)
  and (e.flowConsumed implies e.flowReady) and (e.phase == Exchanging implies e.flowConsumed)
  and ((e.phase == Authenticating or e.phase == Inserting or e.phase == CreateReply) implies e.minted)
  and ((e.phase == PollReply and e.poll != PollPending and e.poll != FlowExpired) implies e.poll == AssertionIssued and e.flowConsumed)
pure def alwaysReply(e: Exchange): bool = (e.snapshot.serverId != "") implies e.snapshot.status != NoRow
  and e.actor != "" and e.key != "" and (e.phase == CreateReply or e.phase == Done)
pure def alwaysActiveInvocation(e: Exchange): bool = (e.phase != Idle and e.phase != Done) implies e.attempt > 0 and e.key != ""
pure def alwaysReady(e: Exchange): bool = e.result == Ready implies e.phase == Done and e.snapshot.serverId != "" and e.minted
pure def stepInvocationAndClock(before: Exchange, after: Exchange): bool = before.now <= after.now and before.attempt <= after.attempt
pure def sometimesReady(e: Exchange): bool = e.result == Ready
pure def sometimesLostButCommitted(e: Exchange): bool = e.result == WriteError and e.snapshot.serverId != ""
pure def sometimesConsumedWithoutBearer(e: Exchange): bool = e.assertionConsumed and not(e.minted) and e.result == SessionError
```

### Simulation uses representative deadlines and actor-scoped response outcomes

```quint
pure val attemptValues = Set(1, 2)
pure val keyValues = Set("key-a", "key-b")
pure val actorValues = Set("actor-a", "actor-b")
pure val deadlineValues = Set(10, 20, 30)
pure val delayValues = Set(1, 2)
pure val retryValues = Set(1, 2)
pure val timeValues = Set(1, 3, 20)
pure val assertionUntilValues = Set(10, 20, 30)
pure val bearerUntilValues = Set(10, 20, 30)
pure val responseValues = Set(noLookup, { serverId: "server-a", status: AwaitingTrace }, { serverId: "server-b", status: Finalized })
pure val weight_begin = 10
pure val weight_acceptStart = 12
pure val weight_receiveStart = 12
pure val weight_authorizeFlow = 12
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
