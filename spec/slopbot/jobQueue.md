# Slopbot job queue retries, dead letters and recovery

PRD section 5 requires visible retryable-failure outcomes and queue limits,
and PRD section 12 requires retry, interruption and recovery paths. Source is
`workers/slopbot/index.ts` (`queue`, `scheduled`),
`workers/slopbot/wrangler.toml` (`max_retries = 5`,
`dead_letter_queue = "slopbot-jobs-dlq"`), `workers/slopbot/persistence.ts`
(`ReviewBusyError`, `REVIEW_LEASE_SECONDS`) and
`workers/slopbot/maintainer-holds.ts` (`dispatchDueJobs`) at the pinned
development revision.

This unit owns the delivery of the messages for one logical job: the
message copies, their delivery count, retry delay, acknowledgement and dead
letter. The [webhook](./webhookDelivery.md) sends the first copy. The
handlers ([review](./review.md), [closure](./closure.md) and
[appeals](./appeals.md)) own the job's effects and their idempotence. Their
claims and one-time resolutions make a duplicate copy harmless.

## Story: Deliver a job at least once and stop after the retry limit

### A failed or contended handler retries with a bounded delay

The queue delivers a copy and the handler reports one result. A completed,
skipped or deliberately blocked job is acknowledged. A changed source
retries after 60 seconds. A review still claimed by another attempt retries
after the remaining claim time, at least 1 second and at most the
1200-second claim. A thrown failure retries after 60 seconds. Cloudflare
retries a copy at most five times, so its sixth failed delivery moves it to
the dead-letter queue. A send whose acknowledgement was lost can create a
second copy, so a copy is only a request to run the idempotent handler.
A waiting copy is delivered no earlier than its retry time, so its delivery
advances the clock to that time when the clock is behind it.

```quint
type JobKind = NoKind | ReviewJob | MaintainerHoldJob | AppealCommandJob | AppealDueJob | HumanSignalJob
type CopyState = Queued | Delivered | Acked | Waiting | DeadLettered
type HandlerResult = Done | SourceChanged | Busy | Failed
type Copy = { id: int, state: CopyState, deliveries: int, availableAt: int }
type Durable = { exists: bool, resolved: bool, dueAt: int, queuedAt: int }
type AdministratorEvidence = { actor: int, verifiedAdministrator: bool }
type JobQueue = { now: int, kind: JobKind, copies: List[Copy], nextId: int, durable: Durable,
  operatorRequeues: int }
pure val maxDeliveries = 6
pure val claimSeconds = 1200
pure val requeueAfter = 86400
pure val noDurable: Durable = { exists: false, resolved: false, dueAt: 0, queuedAt: 0 }
pure val noCopy: Copy = { id: 0, state: Acked, deliveries: 0, availableAt: 0 }
pure val initial: JobQueue = { now: 1, kind: NoKind, copies: List(), nextId: 1, durable: noDurable,
  operatorRequeues: 0 }
pure def copyOf(q: JobQueue, copyId: int): Copy = q.copies.nthOr(copyId - 1, noCopy)
pure def putCopy(prior: Copy, c: Copy, q: JobQueue): JobQueue =
  { ...q, copies: q.copies.listMap(old => if (old == prior) c else old) }
pure def withCopy(now: int, q: JobQueue): JobQueue =
  { ...q, copies: q.copies.append({ id: q.nextId, state: Queued, deliveries: 0, availableAt: now }),
    nextId: q.nextId + 1 }
pure def durableKind(kind: JobKind): bool = kind == MaintainerHoldJob or kind == AppealDueJob
pure def canSubmit(q: JobQueue, kind: JobKind, dueAt: int): bool =
  q.kind == NoKind and kind != NoKind and dueAt >= 0
pure def submit(q: JobQueue, kind: JobKind, dueAt: int): JobQueue =
  withCopy(q.now, { ...q, kind: kind, durable: if (durableKind(kind))
    { exists: true, resolved: false, dueAt: dueAt, queuedAt: q.now } else noDurable })
pure def canElapse(q: JobQueue, seconds: int): bool = seconds > 0
pure def elapse(q: JobQueue, seconds: int): JobQueue = { ...q, now: q.now + seconds }
pure def canDuplicate(q: JobQueue): bool = q.kind != NoKind and q.copies.length() > 0
pure def duplicate(q: JobQueue): JobQueue = withCopy(q.now, q)
pure def canDeliver(q: JobQueue, copyId: int): bool =
  val c = copyOf(q, copyId)
  c.id == copyId and copyId > 0 and (c.state == Queued or c.state == Waiting)
pure def deliver(q: JobQueue, copyId: int): JobQueue =
  val c = copyOf(q, copyId)
  putCopy(c, { ...c, state: Delivered, deliveries: c.deliveries + 1 },
    { ...q, now: if (c.availableAt > q.now) c.availableAt else q.now })
pure def retryDelay(result: HandlerResult, remaining: int): int =
  if (result == Busy) (if (remaining < 1) 1 else if (remaining > claimSeconds) claimSeconds else remaining) else 60
pure def canHandle(q: JobQueue, copyId: int, result: HandlerResult, remaining: int): bool =
  copyId > 0 and copyOf(q, copyId).id == copyId and copyOf(q, copyId).state == Delivered
pure def handle(q: JobQueue, copyId: int, result: HandlerResult, remaining: int): JobQueue =
  val c = copyOf(q, copyId)
  if (result == Done)
    putCopy(c, { ...c, state: Acked, availableAt: 0 },
      { ...q, durable: if (q.durable.exists) { ...q.durable, resolved: true } else q.durable })
  else if (c.deliveries >= maxDeliveries) putCopy(c, { ...c, state: DeadLettered, availableAt: 0 }, q)
  else putCopy(c, { ...c, state: Waiting, availableAt: q.now + retryDelay(result, remaining) }, q)
pure def lawBusyDelayStaysWithinClaim(remaining: int): bool =
  retryDelay(Busy, remaining) >= 1 and retryDelay(Busy, remaining) <= claimSeconds
pure def lawOtherRetriesWaitOneMinute(result: HandlerResult, remaining: int): bool =
  result != Busy implies retryDelay(result, remaining) == 60
```

### A due maintainer hold or appeal is sent again after a day without resolution

A maintainer hold and an appeal deadline each keep a durable row. Every
five-minute run sends each due, unresolved row whose last send is at least a
day old, then records the send time. A send that succeeds before its record
fails is sent again on a later run. The row's one-time resolution prevents
a second effect. A review, appeal command or human signal has no durable
due row. Its only automatic recovery is GitHub's next event for the item,
or a [budget block resume](./budgetBlocks.md).

```quint
pure def canRedispatch(q: JobQueue): bool =
  q.durable.exists and not(q.durable.resolved) and q.now >= q.durable.dueAt
    and q.now - q.durable.queuedAt >= requeueAfter
pure def redispatch(q: JobQueue): JobQueue = withCopy(q.now, q)
pure def canRecordDispatch(q: JobQueue): bool = canRedispatch(q)
pure def recordDispatch(q: JobQueue): JobQueue = { ...q, durable: { ...q.durable, queuedAt: q.now } }
```

### A dead-lettered review stays visible until an administrator requeues it

Nothing consumes the dead-letter queue automatically. A review whose
copies are all dead-lettered keeps its failed review row and its public
"could not complete" comment, which is the retryable-failure outcome.
A verified administrator may requeue a dead-lettered review, appeal
command or human signal as a new copy. The durable kinds recover through
their own dispatch instead. The development worker has no requeue route,
so its comment's promise of operator recovery has no implementation.

```quint
pure def deadLettered(q: JobQueue): bool =
  q.copies.length() > 0 and q.copies.every(c => c.state == DeadLettered)
pure def canRequeue(q: JobQueue, admin: AdministratorEvidence): bool =
  deadLettered(q) and not(durableKind(q.kind)) and admin.actor > 0 and admin.verifiedAdministrator
pure def requeue(q: JobQueue, admin: AdministratorEvidence): JobQueue =
  withCopy(q.now, { ...q, operatorRequeues: q.operatorRequeues + 1 })
pure def alwaysDeliveriesBounded(q: JobQueue): bool =
  q.copies.every(c => c.deliveries >= 0 and c.deliveries <= maxDeliveries and c.id > 0 and c.id < q.nextId)
    and q.nextId == q.copies.length() + 1 and q.now >= 1
pure def alwaysDeadLetterOnlyAfterRetries(q: JobQueue): bool =
  q.copies.every(c => c.state == DeadLettered implies c.deliveries == maxDeliveries)
pure def alwaysWaitingHasTime(q: JobQueue): bool =
  q.copies.every(c => c.state == Waiting implies c.availableAt > 0 and c.deliveries > 0 and c.deliveries < maxDeliveries)
pure def alwaysQueuedUndelivered(q: JobQueue): bool =
  q.copies.every(c => (c.state == Queued implies c.deliveries == 0) and (c.state == Delivered implies c.deliveries > 0)
    and (c.state == Acked implies c.availableAt == 0))
pure def alwaysDurableOnlyForDurableKinds(q: JobQueue): bool =
  (q.durable.exists implies durableKind(q.kind)) and (q.kind == NoKind implies q.copies.length() == 0)
pure def alwaysRequeueNeedsNonDurableKind(q: JobQueue): bool =
  q.operatorRequeues > 0 implies not(durableKind(q.kind)) and q.kind != NoKind
pure def stepTerminalCopiesStay(before: JobQueue, after: JobQueue): bool =
  before.copies.every(c => (c.state == Acked or c.state == DeadLettered) implies after.copies.includes(c))
pure def stepResolutionIsFinal(before: JobQueue, after: JobQueue): bool =
  before.durable.resolved implies after.durable.resolved
pure def sometimesAcked(q: JobQueue): bool = q.copies.some(c => c.state == Acked)
pure def sometimesDeadLettered(q: JobQueue): bool = q.kind == ReviewJob and deadLettered(q)
pure def sometimesRequeued(q: JobQueue): bool = q.operatorRequeues > 0
pure def sometimesDuplicateCopy(q: JobQueue): bool = q.copies.length() > 1 and q.kind == ReviewJob
pure def sometimesHoldResent(q: JobQueue): bool =
  q.kind == MaintainerHoldJob and q.copies.length() > 1 and q.durable.resolved
pure val kindValues = Set(ReviewJob, MaintainerHoldJob, AppealDueJob, AppealCommandJob)
pure val dueAtValues = Set(0, 2)
pure val secondsValues = Set(1200, 86400)
pure val copyIdValues = Set(1)
pure val remainingValues = Set(0, 30, 5000)
pure val adminValues = Set({ actor: 1, verifiedAdministrator: true }, { actor: 1, verifiedAdministrator: false })
pure val weight_deliver = 12
pure val weight_handle = 12
pure val weight_elapse = 2
```
