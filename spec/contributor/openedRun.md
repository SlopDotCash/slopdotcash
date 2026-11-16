# Record the opened pull request with the author's own Slop session

PRD sections 4, 5 and 11 (owner decision D6) and CLAUDE.md "Slopbot".
Automatic closure needs a slop.cash member's own authenticated Slop run that
records a `pull_request_opened` event for that exact pull request. This unit is
the contributor's `opened` command in
`skills/project-contributor-template/scripts/run-receipt.mjs`
(`recordPullRequestOpened`). The server record it writes is the
[server trace run](./traceServer.md) `appendEvent`, and closure reads it
through `traceServer.md` `recordedSkillRun`. The session is the
[session exchange](./sessionExchange.md): only a finished invocation that
satisfies every session exchange rule is accepted, and that the shell
supplies the invocation's actual state is a composition obligation. The command runs after the pull
request exists, so it never blocks submission; it uploads no trace, usage,
prompt or source bytes; and it has no GitHub write, so a failure leaves the
pull request open. It uses a separate server run, keyed by the client run
`pr_opened_<node id>`, from any optional trace.

## Story: Bind the ordinary PR-opened event to its own authenticated run

### One invocation validates the PR, reuses its own run and records one exact event

The pull request URL must name the project's repository and the node ID must
come from GitHub. The declared provider, model, client and client version are
exact. A finalized run takes no events, so the command fails. The event
idempotency key is the digest of the server run and the canonical body, so an
exact retry returns the same event. A reply must name the same server run,
the `pull_request_opened` kind and an event ID. A failure is reported once;
the command does not retry in a loop, and a user retry is a new invocation.

```quint
import sessionExchange as X from "./sessionExchange"
import traceServer as TS from "./traceServer"
type OpenedPhase = OpenIdle | AwaitingSession | AwaitingEvent | Recorded | OpenFailed
type OpenedFailure = NoOpenedFailure | InvalidInput | SessionFailed | RunFinalizedRefused | EventRefused | MismatchedEvidence
type Declaration = { provider: str, model: str, client: str, clientVersion: str }
type EventReply = { serverRun: str, kind: TS::EventKind, eventId: str }
type OpenedInvocation = { phase: OpenedPhase, attempt: int, repository: str, prRepository: str, prNode: str,
  serverRun: str, eventId: str, failure: OpenedFailure }
pure val initial: OpenedInvocation = { phase: OpenIdle, attempt: 0, repository: "o/r", prRepository: "", prNode: "",
  serverRun: "", eventId: "", failure: NoOpenedFailure }
pure def failWith(reason: OpenedFailure, o: OpenedInvocation): OpenedInvocation = { ...o, phase: OpenFailed, failure: reason }
pure def declared(d: Declaration): bool = d.provider != "" and d.model != "" and d.client != "" and d.clientVersion != ""
pure def idle(o: OpenedInvocation): bool = o.phase == OpenIdle or o.phase == Recorded or o.phase == OpenFailed
pure def canBegin(o: OpenedInvocation, attempt: int): bool = idle(o) and attempt > o.attempt
pure def begin(o: OpenedInvocation, attempt: int, prRepository: str, prNode: str, declaration: Declaration): OpenedInvocation =
  val fresh = { ...o, attempt: attempt, prRepository: prRepository, prNode: prNode, serverRun: "", eventId: "",
    failure: NoOpenedFailure }
  if (prRepository == o.repository and prNode != "" and declared(declaration)) { ...fresh, phase: AwaitingSession }
  else failWith(InvalidInput, fresh)
pure def canReceiveSession(o: OpenedInvocation, session: X::Exchange): bool = o.phase == AwaitingSession and session.phase == X::Done
  and X::consistentExchange(session)
pure def receiveSession(o: OpenedInvocation, session: X::Exchange): OpenedInvocation =
  if (session.result != X::Ready or session.snapshot.serverId == "") failWith(SessionFailed, o)
  else if (session.snapshot.status == X::Finalized) failWith(RunFinalizedRefused, o)
  else { ...o, phase: AwaitingEvent, serverRun: session.snapshot.serverId }
pure def canReceiveEvent(o: OpenedInvocation, eventReply: EventReply): bool = o.phase == AwaitingEvent
pure def receiveEvent(o: OpenedInvocation, eventReply: EventReply): OpenedInvocation =
  if (eventReply.serverRun == o.serverRun and eventReply.kind == TS::PullRequestOpened and eventReply.eventId != "")
    { ...o, phase: Recorded, eventId: eventReply.eventId }
  else failWith(MismatchedEvidence, o)
pure def canRefuseEvent(o: OpenedInvocation): bool = o.phase == AwaitingEvent
pure def refuseEvent(o: OpenedInvocation): OpenedInvocation = failWith(EventRefused, o)
pure def alwaysRecordedEvidence(o: OpenedInvocation): bool = o.phase == Recorded implies
  o.serverRun != "" and o.eventId != "" and o.prNode != "" and o.prRepository == o.repository
pure def alwaysInFlightValid(o: OpenedInvocation): bool =
  ((o.phase == AwaitingSession or o.phase == AwaitingEvent) implies o.prNode != "" and o.prRepository == o.repository)
  and (o.phase == AwaitingEvent implies o.serverRun != "")
pure def alwaysFailureNamed(o: OpenedInvocation): bool = (o.phase == OpenFailed) iff (o.failure != NoOpenedFailure)
pure def stepNoHiddenRetry(before: OpenedInvocation, after: OpenedInvocation): bool =
  (before.phase == OpenFailed and after.phase != OpenFailed) implies after.attempt > before.attempt
pure def stepRepositoryFixed(before: OpenedInvocation, after: OpenedInvocation): bool = after.repository == before.repository
pure def sometimesRecorded(o: OpenedInvocation): bool = o.phase == Recorded
pure def sometimesFinalizedRefused(o: OpenedInvocation): bool = o.failure == RunFinalizedRefused
pure def sometimesWrongRepositoryRefused(o: OpenedInvocation): bool = o.failure == InvalidInput and o.prRepository != o.repository
pure def sometimesMismatchRefused(o: OpenedInvocation): bool = o.failure == MismatchedEvidence
```

### Simulation samples cover the project repository, a foreign repository and each reply

```quint
pure val attemptValues = Set(1, 2)
pure val prRepositoryValues = Set("o/r", "x/y")
pure val prNodeValues = Set("", "PR_a")
pure val declarationValues = Set({ provider: "p", model: "m", client: "c", clientVersion: "1" },
  { provider: "", model: "m", client: "c", clientVersion: "1" })
pure val readyExchange: X::Exchange = { ...X::initial, phase: X::Done, result: X::Ready, now: 10, attempt: 1, key: "k",
  actor: 1, flow: X::AssertionIssued, flowExpires: 300, assertionIssuedAt: 5, assertionExpires: 95, assertionConsumed: true,
  minted: true, role: X::ContributorRole, bearerIssuedAt: 6, bearerExpires: 606, created: X::RowExisting,
  snapshot: { serverId: "s1", status: X::AwaitingTrace } }
pure val sessionValues = Set(readyExchange, { ...readyExchange, snapshot: { serverId: "s1", status: X::Finalized } },
  { ...X::initial, phase: X::Done, result: X::BannedRefused }, { ...readyExchange, minted: false })
pure val eventReplyValues = Set({ serverRun: "s1", kind: TS::PullRequestOpened, eventId: "e1" },
  { serverRun: "s2", kind: TS::PullRequestOpened, eventId: "e1" }, { serverRun: "s1", kind: TS::Checkpoint, eventId: "e1" })
```
