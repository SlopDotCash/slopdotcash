# Private-reporting intake health

CLAUDE.md "Private traces" and "Deployment" and PRD sections 9 and 12 make
optional trace collection depend on an independently renewed observation of
GitHub private vulnerability reporting. Contribution never depends on it.
The pinned sources are migration `0006_private_intake_status.sql`,
`renewPrivateIntakeStatus` and the hourly cron in `workers/identity/index.ts`,
`readPrivateIntakeStatus` in `backend/trace/cloudflare-persistence.ts`,
`scripts/renew-private-intake.mjs`,
`.github/workflows/private-intake-watch.yml` and
`backend/trace/PRIVATE_INTAKE_RECOVERY.md`.

One singleton observation records whether reporting is enabled and when it
was verified. Three authenticated renewers write it: the identity Worker's
hourly cron, the code release once after migrations, and an operator running
the recovery script with Cloudflare credentials. A `GitHubAnswer` is the
verdict of the renewer's own authenticated read of GitHub's status endpoint.
The hourly watch workflow only reads the public status and holds no secrets
and no publication lock. Clock values are UTC epoch milliseconds.

## Story: Renew the observation only from a usable GitHub answer

### A usable answer replaces the observation; anything else leaves it to expire

An enabled or disabled answer writes the observation with the renewal time.
Disabled reporting stops collection at the next read. An unreachable,
rate-limited, unauthorized, rejected or malformed answer leaves the previous
observation in place, so it expires on schedule rather than being refreshed
on bad evidence. A renewer reads GitHub with its optional read-only token
or anonymously. A token GitHub refuses, or one of the wrong shape, is
reported and the read is repeated anonymously once, never again with a
token: an unauthorized answer to a token read is never the verdict, and the
anonymous answer is. A failed database write is an explicit
failed renewal and changes nothing. A skipped renewal is also an explicit
operational failure: the invocation reports failure even though nothing was
written. Each renewer stamps the observation with its own read time, and the
write is conditional: an answer read earlier than the stored observation,
delivered late, never replaces it.

```quint
type Renewer = IdentityCron | ReleaseJob | OperatorScript | HealthWatch | Contributor
type Skip = Unreachable | RateLimited | Unauthorized | Rejected | Malformed
type GitHubAnswer = ReportingEnabled | ReportingDisabled | Unusable({ reason: Skip })
type Observation = NoObservation | Observed({ enabled: bool, verifiedAt: int })
type RenewalResult = NotRun | Renewed | OlderThanStored | Skipped({ reason: Skip }) | WriteFailed
type ReadStage = NoRead | TokenRead | AnonymousRead
type Health = { clock: int, observation: Observation, last: RenewalResult, failures: int, skips: int, renewals: int, alerts: int,
  failedInvocations: int, read: ReadStage, tokenRejected: bool }
pure val initial: Health = { clock: 1, observation: NoObservation, last: NotRun, failures: 0, skips: 0, renewals: 0, alerts: 0,
  failedInvocations: 0, read: NoRead, tokenRejected: false }
pure def renewerAllowed(by: Renewer): bool = by == IdentityCron or by == ReleaseJob or by == OperatorScript
pure def canAdvanceClock(h: Health, now: int): bool = now > h.clock
pure def advanceClock(h: Health, now: int): Health = { ...h, clock: now }
pure def observedAt(h: Health): int =
  val observation = h.observation
  match observation { | Observed(o) => o.verifiedAt | NoObservation => 0 }
pure def written(isEnabled: bool, readAt: int, h: Health): Health =
  if (readAt > observedAt(h)) { ...h, observation: Observed({ enabled: isEnabled, verifiedAt: readAt }), last: Renewed, renewals: h.renewals + 1 }
  else { ...h, last: OlderThanStored }
pure def canStartRead(h: Health, by: Renewer, withToken: bool): bool = renewerAllowed(by) and h.read == NoRead
pure def startRead(h: Health, by: Renewer, withToken: bool): Health =
  { ...h, read: if (withToken) TokenRead else AnonymousRead, tokenRejected: false }
pure def canRejectToken(h: Health, by: Renewer): bool = renewerAllowed(by) and h.read == TokenRead
pure def rejectToken(h: Health, by: Renewer): Health = { ...h, read: AnonymousRead, tokenRejected: true }
pure def canRenew(h: Health, answer: GitHubAnswer, readAt: int, by: Renewer): bool = renewerAllowed(by) and h.read != NoRead
  and readAt > 0 and readAt <= h.clock and not(h.read == TokenRead and answer == Unusable({ reason: Unauthorized }))
pure def renew(h: Health, answer: GitHubAnswer, readAt: int, by: Renewer): Health =
  val done = { ...h, read: NoRead }
  match answer {
  | ReportingEnabled => written(true, readAt, done)
  | ReportingDisabled => written(false, readAt, done)
  | Unusable(u) => { ...done, last: Skipped({ reason: u.reason }), skips: h.skips + 1, failedInvocations: h.failedInvocations + 1 } }
pure def canFailWrite(h: Health, by: Renewer): bool = renewerAllowed(by) and h.read != NoRead
pure def failWrite(h: Health, by: Renewer): Health =
  { ...h, read: NoRead, last: WriteFailed, failures: h.failures + 1, failedInvocations: h.failedInvocations + 1 }
pure def alwaysRejectedTokenNotReused(h: Health): bool = h.tokenRejected implies h.read != TokenRead
pure def stepAnonymousRetryOnce(before: Health, after: Health): bool = before.read == AnonymousRead implies after.read != TokenRead
pure def lawRefusedTokenIsRetriedAnonymously(h: Health, readAt: int, by: Renewer): bool =
  h.read == TokenRead implies not(canRenew(h, Unusable({ reason: Unauthorized }), readAt, by))
pure def sometimesRenewedAfterTokenRejected(h: Health): bool = renewedLast(h.last) and h.tokenRejected
pure def alwaysUnsuccessfulRenewalsReported(h: Health): bool = h.failedInvocations == h.failures + h.skips
  and h.failures >= 0 and h.skips >= 0
pure def alwaysObservationNotFuture(h: Health): bool = observedAt(h) >= 0 and observedAt(h) <= h.clock
pure def stepOnlyRenewersWrite(before: Health, via: str, after: Health): bool =
  after.observation != before.observation implies via == "renew"
pure def stepObservationAdvances(before: Health, after: Health): bool = observedAt(after) >= observedAt(before)
pure def sometimesSkippedKeepsObservation(h: Health): bool = h.skips > 0 and observedAt(h) > 0
pure def failedLast(result: RenewalResult): bool = match result { | WriteFailed => true | _ => false }
pure def renewedLast(result: RenewalResult): bool = match result { | Renewed => true | _ => false }
pure def sometimesWriteFailed(h: Health): bool = failedLast(h.last)
pure def sometimesLateAnswerIgnored(h: Health): bool =
  val result = h.last
  match result { | OlderThanStored => observedAt(h) > 0 | _ => false }
pure def sometimesDisabled(h: Health): bool =
  val observation = h.observation
  match observation { | Observed(o) => not(o.enabled) | _ => false }
```

### Optional trace collection needs an enabled observation no older than 24 hours

The runtime accepts an enabled observation from at most 24 hours ago and at
most five minutes in the future. A missing, disabled, unreadable or older
observation makes only optional trace collection unavailable. Ordinary
GitHub contribution, attribution and receipts never read this observation.
The contributor evidence machine takes `traceCollectionReady` of this state
as its request-status input (a composition obligation).

```quint
pure val freshnessMs = 86400000
pure val futureSkewMs = 300000
pure def traceCollectionReadyAt(observation: Observation, now: int): bool = match observation {
  | Observed(o) => o.enabled and now - o.verifiedAt <= freshnessMs and o.verifiedAt - now <= futureSkewMs
  | NoObservation => false }
pure def traceCollectionReady(h: Health): bool = traceCollectionReadyAt(h.observation, h.clock)
pure def lawStaleObservationBlocksCollection(observation: Observation, now: int): bool = match observation {
  | Observed(o) => (now - o.verifiedAt > freshnessMs or not(o.enabled)) implies not(traceCollectionReadyAt(observation, now))
  | NoObservation => not(traceCollectionReadyAt(observation, now)) }
pure def lawReadinessNeedsEnabledRenewal(observation: Observation, now: int): bool =
  traceCollectionReadyAt(observation, now) implies match observation { | Observed(o) => o.enabled | NoObservation => false }
pure def sometimesReady(h: Health): bool = traceCollectionReady(h)
pure def sometimesExpired(h: Health): bool =
  val observation = h.observation
  observedAt(h) > 0 and not(traceCollectionReady(h)) and renewedLast(h.last)
    and (match observation { | Observed(o) => o.enabled | _ => false })
```

### The hourly watch only reads and alerts after three hours

The watch fails when the public status is unavailable, not enabled, or older
than three hours, which means the cron missed at least two renewals. It
writes no observation and takes no release or publication lock.

```quint
pure val watchAlertMs = 10800000
pure def watchHealthy(h: Health): bool =
  val observation = h.observation
  match observation {
  | Observed(o) => o.enabled and h.clock - o.verifiedAt <= watchAlertMs | NoObservation => false }
pure def canWatch(h: Health, by: Renewer): bool = by == HealthWatch
pure def watch(h: Health, by: Renewer): Health = if (watchHealthy(h)) h else { ...h, alerts: h.alerts + 1 }
pure def stepWatchReadsOnly(before: Health, via: str, after: Health): bool =
  via == "watch" implies after.observation == before.observation and after.last == before.last
pure def sometimesWatchAlerted(h: Health): bool = h.alerts > 0
```

### Simulation samples cover every answer and both freshness boundaries

```quint
pure val nowValues = Set(2, 3600002, 10800003, 86400003, 86400004)
pure val answerValues = Set(ReportingEnabled, ReportingDisabled, Unusable({ reason: Unreachable }), Unusable({ reason: RateLimited }),
  Unusable({ reason: Malformed }), Unusable({ reason: Unauthorized }))
pure val byValues = Set(IdentityCron, ReleaseJob, OperatorScript, HealthWatch, Contributor)
pure val observationValues = Set(NoObservation, Observed({ enabled: true, verifiedAt: 1 }), Observed({ enabled: false, verifiedAt: 1 }),
  Observed({ enabled: true, verifiedAt: 400000 }))
pure val readAtValues = Set(1, 2, 3600002, 86400003)
pure val weight_renew = 4
pure val weight_startRead = 4
pure val hValues = Set(initial, { ...initial, read: TokenRead, clock: 3600002 }, { ...initial, read: AnonymousRead, tokenRejected: true })
pure val weight_advanceClock = 4
```
