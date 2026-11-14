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
on bad evidence. A refused token is retried anonymously once by the adapter;
the verdict here is the final answer. A failed database write is an explicit
failed renewal and changes nothing.

```quint
type Renewer = IdentityCron | ReleaseJob | OperatorScript | HealthWatch | Contributor
type Skip = Unreachable | RateLimited | Unauthorized | Rejected | Malformed
type GitHubAnswer = ReportingEnabled | ReportingDisabled | Unusable({ reason: Skip })
type Observation = NoObservation | Observed({ enabled: bool, verifiedAt: int })
type RenewalResult = NotRun | Renewed | Skipped({ reason: Skip }) | WriteFailed
type Health = { clock: int, observation: Observation, last: RenewalResult, failures: int, skips: int, renewals: int, alerts: int }
pure val initial: Health = { clock: 1, observation: NoObservation, last: NotRun, failures: 0, skips: 0, renewals: 0, alerts: 0 }
pure def renewerAllowed(by: Renewer): bool = by == IdentityCron or by == ReleaseJob or by == OperatorScript
pure def canAdvanceClock(h: Health, now: int): bool = now > h.clock
pure def advanceClock(h: Health, now: int): Health = { ...h, clock: now }
pure def canRenew(h: Health, answer: GitHubAnswer, by: Renewer): bool = renewerAllowed(by)
pure def renew(h: Health, answer: GitHubAnswer, by: Renewer): Health = match answer {
  | ReportingEnabled => { ...h, observation: Observed({ enabled: true, verifiedAt: h.clock }), last: Renewed, renewals: h.renewals + 1 }
  | ReportingDisabled => { ...h, observation: Observed({ enabled: false, verifiedAt: h.clock }), last: Renewed, renewals: h.renewals + 1 }
  | Unusable(u) => { ...h, last: Skipped({ reason: u.reason }), skips: h.skips + 1 } }
pure def canFailWrite(h: Health, by: Renewer): bool = renewerAllowed(by)
pure def failWrite(h: Health, by: Renewer): Health = { ...h, last: WriteFailed, failures: h.failures + 1 }
pure def observedAt(h: Health): int =
  val observation = h.observation
  match observation { | Observed(o) => o.verifiedAt | NoObservation => 0 }
pure def alwaysObservationNotFuture(h: Health): bool = observedAt(h) >= 0 and observedAt(h) <= h.clock
pure def stepOnlyRenewersWrite(before: Health, via: str, after: Health): bool =
  after.observation != before.observation implies via == "renew"
pure def stepObservationAdvances(before: Health, after: Health): bool = observedAt(after) >= observedAt(before)
pure def sometimesSkippedKeepsObservation(h: Health): bool = h.skips > 0 and observedAt(h) > 0
pure def sometimesWriteFailed(h: Health): bool = h.last == WriteFailed
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
  observedAt(h) > 0 and not(traceCollectionReady(h)) and h.last == Renewed
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
pure val answerValues = Set(ReportingEnabled, ReportingDisabled, Unusable({ reason: Unreachable }), Unusable({ reason: RateLimited }), Unusable({ reason: Malformed }))
pure val byValues = Set(IdentityCron, ReleaseJob, OperatorScript, HealthWatch, Contributor)
pure val observationValues = Set(NoObservation, Observed({ enabled: true, verifiedAt: 1 }), Observed({ enabled: false, verifiedAt: 1 }),
  Observed({ enabled: true, verifiedAt: 400000 }))
pure val weight_renew = 4
pure val weight_advanceClock = 4
```
