# Inbox notices and email delivery

PRD sections 9 ("Notifications") and 10 ("Notices") distinguish saved, read,
acknowledged, provider-accepted, delivered, failed and uncertain notices. The
pinned sources are migrations `0024`, `0029`, `0030`, `0033`, `0063`, `0065`,
`0079`, `0111` and `0116`, `workers/notify/{security,activity}.ts`,
`backend/notifications/` and the legacy models `notification_delivery`,
`notification_escalation`, `notification_admin_fanout` and `api_mail_delivery`.

A notice is one row per source change and recipient, written in the same
transaction as its source change. Its email delivery is a row of the security
outbox (private case notices and report receipts) or the activity outbox
(every other kind, optional except wallet changes). The `by` sender is the
authenticated GitHub actor. `AccessCheck` is the verdict of the current case
or audience authority reader (security, Slopbot appeal and dispute
authority), evaluated immediately before the step that uses it; it is a
verified-evidence record, never a caller flag. `ProviderEvidence` comes only
from the separate operator reconciliation path that reads independent
provider records.

## Story: Save each notice once with its source change

### A replay of the same source change and recipient adds nothing

The kind decides the channel. Private case notices and report receipts use
the security outbox, with the case template or the receipt template. Wallet
changes are essential activity mail. Every other kind is queued only when
the recipient has activity email enabled at that moment. A queued row binds
the destination version consented for its channel. Enabling email never
queues history.

```quint
type Kind = ApplicationApproved | ApplicationRejected | ProjectRevision | AwardReserved | PaymentPaid | PayoutHeld
  | WalletChanged | ProjectQuarantined | ProjectBanned | ReinstatementRequested | ProjectReinstated | ReinstatementDenied
  | ReinstatementReview | PayoutException | SecurityCase | ProjectReady | ProjectScanFailed | ProjectInstallationLost
  | SecurityReportReceived | SlopbotAppealReview | SlopbotScamReview
type Channel = NoEmail | SecurityOutbox | ActivityOutbox
type Template = CaseTemplate | ReceiptTemplate | ActivityTemplate
type DeliveryState = NotQueued | Queued | Retrying | Sending | ProviderAccepted | Delivered | Bounced | Suppressed | Exhausted | Ambiguous
type Notice = { id: int, key: int, kind: Kind, recipient: int, createdAt: int, readAt: int, acknowledgedAt: int,
  channel: Channel, template: Template, essential: bool, state: DeliveryState, attempts: int, nextAt: int,
  claimedAt: int, prepared: bool, boundVersion: int, digest: int, providerSuppressed: bool, escalationOf: int, escalated: bool }
type Preference = { recipient: int, activity: bool, security: bool, version: int, revision: int }
type Inbox = { clock: int, notices: List[Notice], prefs: List[Preference], evidence: List[int], nextVersion: int }
pure val noPreference: Preference = { recipient: 0, activity: false, security: false, version: 0, revision: 0 }
pure val initial: Inbox = { clock: 1, notices: List(), evidence: List(), nextVersion: 1,
  prefs: List({ ...noPreference, recipient: 1 }, { ...noPreference, recipient: 2 }, { ...noPreference, recipient: 3 }) }
pure val noNotice: Notice = { id: 0, key: 0, kind: ProjectRevision, recipient: 0, createdAt: 0, readAt: 0, acknowledgedAt: 0,
  channel: NoEmail, template: ActivityTemplate, essential: false, state: NotQueued, attempts: 0, nextAt: 0, claimedAt: 0,
  prepared: false, boundVersion: 0, digest: 0, providerSuppressed: false, escalationOf: 0, escalated: false }
pure def pref(i: Inbox, recipient: int): Preference = i.prefs.foldl(noPreference, (found, p) => if (p.recipient == recipient) p else found)
pure def notice(i: Inbox, id: int): Notice = i.notices.nthOr(id - 1, noNotice)
pure def securityKind(kind: Kind): bool = kind == SecurityCase or kind == SecurityReportReceived
pure def noticeExists(i: Inbox, key: int, recipient: int): bool = i.notices.some(n => n.key == key and n.recipient == recipient)
pure def newNotice(i: Inbox, key: int, kind: Kind, recipient: int, escalationOf: int): Notice =
  val p = pref(i, recipient)
  val channel = if (securityKind(kind)) SecurityOutbox else if (kind == WalletChanged or p.activity) ActivityOutbox else NoEmail
  val usesSecurity = channel == SecurityOutbox or kind == WalletChanged
  { ...noNotice, id: i.notices.length() + 1, key: key, kind: kind, recipient: recipient, createdAt: i.clock, channel: channel,
    template: if (kind == SecurityReportReceived) ReceiptTemplate else if (kind == SecurityCase) CaseTemplate else ActivityTemplate,
    essential: channel == ActivityOutbox and kind == WalletChanged, state: if (channel == NoEmail) NotQueued else Queued,
    nextAt: i.clock, escalationOf: escalationOf,
    boundVersion: if (usesSecurity) (if (p.security) p.version else 0) else if (p.activity) p.version else 0 }
pure def canSave(i: Inbox, key: int, kind: Kind, recipient: int): bool = key > 0 and key < 1000 and recipient > 0
pure def save(i: Inbox, key: int, kind: Kind, recipient: int): Inbox =
  if (noticeExists(i, key, recipient)) i else { ...i, notices: i.notices.append(newNotice(i, key, kind, recipient, 0)) }
pure def alwaysNoticeIdentity(i: Inbox): bool = i.notices.every(n => n.id > 0 and notice(i, n.id) == n)
pure def stepNoticeFresh(before: Inbox, after: Inbox): bool =
  val added = after.notices.nthOr(before.notices.length(), noNotice)
  after.notices.length() == before.notices.length()
    or (after.notices.length() == before.notices.length() + 1 and not(noticeExists(before, added.key, added.recipient)))
pure def alwaysChannelByKind(i: Inbox): bool = i.notices.every(n =>
  (securityKind(n.kind) iff n.channel == SecurityOutbox) and (n.essential iff (n.channel == ActivityOutbox and n.kind == WalletChanged))
    and (n.kind == WalletChanged implies n.channel == ActivityOutbox)
    and (n.channel == NoEmail implies n.state == NotQueued and n.attempts == 0)
    and (n.channel != NoEmail implies n.state != NotQueued)
    and ((n.template == CaseTemplate) iff n.kind == SecurityCase) and ((n.template == ReceiptTemplate) iff n.kind == SecurityReportReceived))
pure def stepNoticesPermanent(before: Inbox, after: Inbox): bool = after.notices.length() >= before.notices.length()
  and before.notices.every(n => after.notices.some(a => a.id == n.id and a.key == n.key and a.kind == n.kind
    and a.recipient == n.recipient and a.channel == n.channel and a.createdAt == n.createdAt and a.escalationOf == n.escalationOf
    and (n.readAt > 0 implies a.readAt == n.readAt) and (n.acknowledgedAt > 0 implies a.acknowledgedAt == n.acknowledgedAt)
    and (n.escalated implies a.escalated)))
pure def sometimesReplayKeptOne(i: Inbox): bool = i.notices.length() == 1 and i.notices.some(n => n.state == Queued)
```

## Story: Control future email with consent bound to a verified destination

### Consent binds one verified destination version and opt-out suppresses waiting mail

Verifying a new address issues a new destination version. Activity consent
governs optional notices; security consent governs private case notices,
report receipts and essential wallet notices. Enabling either requires a
verified destination. Turning a channel off suppresses its queued and
retrying rows without erasing the Inbox; a provider call already in flight
cannot be recalled. Every preference save increments a revision.

```quint
pure def updatePref(i: Inbox, recipient: int, p: Preference): List[Preference] =
  i.prefs.listMap(x => if (x.recipient == recipient) p else x)
pure def canVerifyDestination(i: Inbox, by: int): bool = pref(i, by).recipient == by and by > 0
pure def verifyDestination(i: Inbox, by: int): Inbox =
  { ...i, nextVersion: i.nextVersion + 1, prefs: updatePref(i, by, { ...pref(i, by), version: i.nextVersion, revision: pref(i, by).revision + 1 }) }
pure def waiting(n: Notice): bool = n.state == Queued or n.state == Retrying
pure def canSetConsent(i: Inbox, activity: bool, security: bool, by: int): bool =
  val p = pref(i, by)
  p.recipient == by and by > 0 and ((activity or security) implies p.version > 0)
pure def setConsent(i: Inbox, activity: bool, security: bool, by: int): Inbox =
  { ...i, prefs: updatePref(i, by, { ...pref(i, by), activity: activity, security: security, revision: pref(i, by).revision + 1 }),
    notices: i.notices.listMap(n => if (n.recipient == by and waiting(n) and (
      (not(activity) and n.channel == ActivityOutbox and not(n.essential))
      or (not(security) and (n.channel == SecurityOutbox or n.essential)))) { ...n, state: Suppressed } else n) }
pure def stepConsentNeverQueuesHistory(before: Inbox, via: str, after: Inbox): bool =
  (via == "setConsent" or via == "verifyDestination") implies after.notices.length() == before.notices.length()
    and before.notices.every(n => after.notices.some(a => a.id == n.id and (a.state == n.state or a.state == Suppressed)))
pure def alwaysConsentNeedsDestination(i: Inbox): bool = i.nextVersion > 0
  and i.prefs.every(p => (p.activity or p.security) implies p.version > 0)
pure def sometimesOptOutSuppressed(i: Inbox): bool = i.notices.some(n => n.state == Suppressed and n.attempts == 0)
```

## Story: Deliver each attempt once and never resend an uncertain one

### A claimed attempt has one owner; a stale claim becomes ambiguous

A due queued or retrying row is claimed with its attempt count incremented.
A claim older than five minutes is marked ambiguous, because the process may
have stopped after the provider accepted; it is never resent automatically.
Every later step names its attempt, so a stale worker cannot overwrite a
successor.

```quint
pure val claimMs = 300000
pure val maxAttempts = 5
pure def backoffMs(previous: int): int =
  if (previous <= 0) 60000 else if (previous == 1) 120000 else if (previous == 2) 240000 else if (previous == 3) 480000 else 960000
pure def setNotice(i: Inbox, id: int, n: Notice): List[Notice] = i.notices.listMap(x => if (x.id == id) n else x)
pure def canAdvanceClock(i: Inbox, elapsed: int): bool = elapsed > 0
pure def advanceClock(i: Inbox, elapsed: int): Inbox = { ...i, clock: i.clock + elapsed }
pure def canClaim(i: Inbox, id: int): bool = val n = notice(i, id)
  id > 0 and n.id == id and waiting(n) and n.nextAt <= i.clock and n.attempts < maxAttempts
pure def claim(i: Inbox, id: int): Inbox = val n = notice(i, id)
  { ...i, notices: setNotice(i, id, { ...n, state: Sending, attempts: n.attempts + 1, claimedAt: i.clock, prepared: false, digest: 0 }) }
pure def canExpireClaim(i: Inbox, id: int): bool = val n = notice(i, id)
  id > 0 and n.id == id and n.state == Sending and i.clock - n.claimedAt > claimMs
pure def expireClaim(i: Inbox, id: int): Inbox = val n = notice(i, id)
  { ...i, notices: setNotice(i, id, { ...n, state: Ambiguous, prepared: false }) }
pure def owns(n: Notice, attempt: int): bool = n.state == Sending and n.attempts == attempt and attempt > 0
pure def retried(i: Inbox, n: Notice): Notice =
  if (n.attempts >= maxAttempts) { ...n, state: Exhausted, prepared: false }
  else { ...n, state: Retrying, prepared: false, nextAt: i.clock + backoffMs(n.attempts - 1) }
pure def alwaysAttemptBudget(i: Inbox): bool = i.notices.every(n => n.attempts >= 0 and n.attempts <= maxAttempts
  and (n.state == Exhausted implies n.attempts == maxAttempts) and (n.state == Retrying implies n.attempts < maxAttempts)
  and (n.state == Sending implies n.attempts > 0 and n.claimedAt > 0)
  and (n.prepared implies n.state == Sending and n.digest > 0))
pure def sometimesStaleClaimAmbiguous(i: Inbox): bool = i.notices.some(n => n.state == Ambiguous and not(n.prepared) and n.digest == 0)
```

### Preparation rechecks authority, consent and destination before any provider call

An unavailable authority check, a preparation failure or a destination not
yet in effect sends nothing and retries within the five-attempt bound. A
recipient without current access, or without consent for the bound
destination version, is suppressed; that suppression sent nothing and never
escalates. A provider acceptance proves acceptance only. A documented quota
rejection retries; any other thrown send is ambiguous.

```quint
type AccessCheck = Allowed({ acknowledgeHours: int }) | Denied | Unavailable
type ProviderResult = Accepted | QuotaRejected | Thrown
pure def consentHolds(i: Inbox, n: Notice): bool =
  val p = pref(i, n.recipient)
  n.boundVersion > 0 and p.version == n.boundVersion
    and (if (n.channel == SecurityOutbox or n.essential) p.security else p.activity)
pure def allowed(access: AccessCheck): bool = match access { | Allowed(a) => a.acknowledgeHours >= 0 | _ => false }
pure def unavailable(access: AccessCheck): bool = match access { | Unavailable => true | _ => false }
pure def canPrepare(i: Inbox, id: int, attempt: int, access: AccessCheck): bool = val n = notice(i, id)
  id > 0 and n.id == id and owns(n, attempt) and not(n.prepared)
pure def prepare(i: Inbox, id: int, attempt: int, access: AccessCheck): Inbox = val n = notice(i, id)
  val updated = if (unavailable(access)) retried(i, n)
    else if (not(allowed(access)) or not(consentHolds(i, n))) { ...n, state: Suppressed }
    else { ...n, prepared: true, digest: n.boundVersion }
  { ...i, notices: setNotice(i, id, updated) }
pure def canFailPreparation(i: Inbox, id: int, attempt: int): bool = val n = notice(i, id)
  id > 0 and n.id == id and owns(n, attempt)
pure def failPreparation(i: Inbox, id: int, attempt: int): Inbox = { ...i, notices: setNotice(i, id, retried(i, notice(i, id))) }
pure def canSend(i: Inbox, id: int, attempt: int, result: ProviderResult): bool = val n = notice(i, id)
  id > 0 and n.id == id and owns(n, attempt) and n.prepared
pure def send(i: Inbox, id: int, attempt: int, result: ProviderResult): Inbox = val n = notice(i, id)
  val updated = if (result == Accepted) { ...n, state: ProviderAccepted, prepared: false }
    else if (result == QuotaRejected) retried(i, n) else { ...n, state: Ambiguous, prepared: false }
  { ...i, notices: setNotice(i, id, updated) }
pure def sometimesProviderAccepted(i: Inbox): bool = i.notices.some(n => n.state == ProviderAccepted)
pure def sometimesRetrying(i: Inbox): bool = i.notices.some(n => n.state == Retrying)
pure def sometimesSuppressedWithoutAccess(i: Inbox): bool = i.notices.some(n => n.state == Suppressed and n.attempts > 0 and not(n.providerSuppressed))
```

### Only independent provider evidence for the exact attempt and destination settles a send

Evidence names the attempt, the destination digest and a unique reference;
it is stored append-only. Delivered, bounced and provider-suppressed are
final. Proof that the provider did not accept an accepted or ambiguous
attempt retries it after a minute, or exhausts it at the fifth attempt.

```quint
type Finding = DeliveredOutcome | BouncedOutcome | SuppressedOutcome | NotAccepted
type ProviderEvidence = { reference: int, attempt: int, digest: int, finding: Finding }
pure def canReconcile(i: Inbox, id: int, providerEvidence: ProviderEvidence): bool = val n = notice(i, id)
  id > 0 and n.id == id and (n.state == ProviderAccepted or n.state == Ambiguous) and providerEvidence.attempt == n.attempts
    and providerEvidence.digest == n.digest and n.digest > 0 and providerEvidence.reference > 0
    and not(i.evidence.includes(providerEvidence.reference))
pure def reconcile(i: Inbox, id: int, providerEvidence: ProviderEvidence): Inbox = val n = notice(i, id)
  val finding = providerEvidence.finding
  val updated = match finding {
    | DeliveredOutcome => { ...n, state: Delivered }
    | BouncedOutcome => { ...n, state: Bounced }
    | SuppressedOutcome => { ...n, state: Suppressed, providerSuppressed: true }
    | NotAccepted => if (n.attempts >= maxAttempts) { ...n, state: Exhausted } else { ...n, state: Retrying, nextAt: i.clock + 60000 }
  }
  { ...i, notices: setNotice(i, id, updated), evidence: i.evidence.append(providerEvidence.reference) }
pure def stepProviderStatesNeedEvidence(before: Inbox, via: str, after: Inbox): bool =
  after.notices.every(a => (a.state == Delivered or a.state == Bounced or a.providerSuppressed) implies
    (via == "reconcile" or before.notices.some(b => b.id == a.id and b.state == a.state and b.providerSuppressed == a.providerSuppressed)))
pure def stepEvidenceAppendOnly(before: Inbox, after: Inbox): bool = after.evidence.length() >= before.evidence.length()
  and before.evidence.every(r => after.evidence.includes(r))
pure def stepEvidenceFresh(before: Inbox, after: Inbox): bool = after.evidence == before.evidence
  or (after.evidence.length() == before.evidence.length() + 1
    and not(before.evidence.includes(after.evidence.nthOr(before.evidence.length(), 0))))
pure def alwaysSettledHasDigest(i: Inbox): bool = i.notices.every(n =>
  (n.state == Delivered or n.state == Bounced or n.providerSuppressed or n.state == ProviderAccepted) implies n.digest > 0)
pure def sometimesDelivered(i: Inbox): bool = i.notices.some(n => n.state == Delivered)
pure def sometimesNotAcceptedRetried(i: Inbox): bool = i.notices.some(n => n.state == Retrying and n.digest > 0)
pure def sometimesExhausted(i: Inbox): bool = i.notices.some(n => n.state == Exhausted)
```

## Story: Read, acknowledge and escalate private case notices

### Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment

Reading is never acknowledgment. Acknowledgment needs current case access.
Provider acceptance and delivery never prove acknowledgment.

```quint
pure def canRead(i: Inbox, id: int, by: int): bool = val n = notice(i, id)
  id > 0 and n.id == id and n.recipient == by and n.readAt == 0
pure def read(i: Inbox, id: int, by: int): Inbox = { ...i, notices: setNotice(i, id, { ...notice(i, id), readAt: i.clock }) }
pure def canAcknowledge(i: Inbox, id: int, by: int, access: AccessCheck): bool = val n = notice(i, id)
  id > 0 and n.id == id and n.recipient == by and n.template == CaseTemplate and n.acknowledgedAt == 0 and allowed(access)
pure def acknowledge(i: Inbox, id: int, by: int, access: AccessCheck): Inbox =
  { ...i, notices: setNotice(i, id, { ...notice(i, id), acknowledgedAt: i.clock }) }
pure def alwaysAcknowledgmentForCases(i: Inbox): bool = i.notices.every(n => n.acknowledgedAt > 0 implies n.template == CaseTemplate)
```

### A failed or overdue case notice escalates once to a backup with current access

A primary private notice escalates when its delivery bounced, exhausted, is
ambiguous or was suppressed by provider evidence, or, for a case notice that
asks for acknowledgment, when it is unacknowledged past the recipient's
acknowledgment window even though it was accepted or delivered. A report
receipt escalates only on failed delivery. Activity notices, acknowledged
notices, withheld or access-suppressed mail and escalation copies never
escalate. The backup is the configured backup of the recipient, needs current
access to the case, and receives one generic private notice.

```quint
pure def backupOf(recipient: int): int = if (recipient == 1) 2 else if (recipient == 2) 3 else 0
pure def failedDelivery(n: Notice): bool = n.state == Ambiguous or n.state == Exhausted or n.state == Bounced
  or (n.state == Suppressed and n.providerSuppressed)
pure def overdue(i: Inbox, n: Notice, primaryAccess: AccessCheck): bool = match primaryAccess {
  | Allowed(a) => n.template == CaseTemplate and a.acknowledgeHours > 0
      and (n.state == ProviderAccepted or n.state == Delivered) and i.clock >= n.createdAt + a.acknowledgeHours * 3600000
  | _ => false }
pure def canEscalate(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck): bool = val n = notice(i, id)
  id > 0 and n.id == id and n.channel == SecurityOutbox and n.escalationOf == 0 and not(n.escalated) and n.acknowledgedAt == 0
    and backupOf(n.recipient) > 0 and allowed(primaryAccess) and allowed(backupAccess)
    and (failedDelivery(n) or overdue(i, n, primaryAccess))
pure def escalate(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck): Inbox = val n = notice(i, id)
  { ...i, notices: setNotice(i, id, { ...n, escalated: true })
    .append(newNotice(i, 1000 + id, SecurityCase, backupOf(n.recipient), id)) }
pure def alwaysEscalationOnce(i: Inbox): bool = i.notices.every(n =>
  (n.escalationOf > 0 implies n.kind == SecurityCase and n.key == 1000 + n.escalationOf and n.escalationOf < n.id
    and notice(i, n.escalationOf).escalated and notice(i, n.escalationOf).channel == SecurityOutbox
    and notice(i, n.escalationOf).escalationOf == 0 and n.recipient == backupOf(notice(i, n.escalationOf).recipient) and not(n.escalated))
  and (n.escalated iff i.notices.some(e => e.escalationOf == n.id)))
pure def stepEscalationOnce(before: Inbox, after: Inbox): bool =
  val added = after.notices.nthOr(before.notices.length(), noNotice)
  (after.notices.length() > before.notices.length() and added.escalationOf > 0) implies
    not(notice(before, added.escalationOf).escalated)
pure def sometimesEscalatedAfterFailure(i: Inbox): bool = i.notices.some(n => n.escalated and failedDelivery(n))
pure def sometimesEscalatedOverdue(i: Inbox): bool = i.notices.some(n => n.escalated and (n.state == ProviderAccepted or n.state == Delivered))
pure def sometimesAcknowledged(i: Inbox): bool = i.notices.some(n => n.acknowledgedAt > 0)
```

Generic private email contains only the secure Inbox link and an unsubscribe
link for a registered destination. Failure never deletes a case or its
obligation. The shell must test changed consent during an outage, role
revocation during a send, provider ambiguity and backup escalation against
the real outbox.

### Simulation samples exercise replays, consent changes and conflicting evidence

These sets bound simulation only.

```quint
pure val keyValues = Set(1, 2)
pure val kindValues = Set(SecurityCase, SecurityReportReceived, WalletChanged, PayoutHeld)
pure val recipientValues = Set(1, 2)
pure val byValues = Set(1, 2, 4)
pure val idValues = Set(1, 2, 3)
pure val attemptValues = Set(1, 2, 3, 4, 5)
pure val elapsedValues = Set(60000, 400000, 3600000)
pure val weight_advanceClock = 8
pure val activityValues = Set(true, false)
pure val securityValues = Set(true, false)
pure val accessValues = Set(Allowed({ acknowledgeHours: 1 }), Denied, Unavailable)
pure val primaryAccessValues = Set(Allowed({ acknowledgeHours: 1 }), Denied)
pure val backupAccessValues = Set(Allowed({ acknowledgeHours: 1 }), Unavailable)
pure val resultValues = Set(Accepted, QuotaRejected, Thrown)
pure val providerEvidenceValues = Set(
  { reference: 1, attempt: 1, digest: 1, finding: DeliveredOutcome }, { reference: 2, attempt: 1, digest: 1, finding: BouncedOutcome },
  { reference: 3, attempt: 1, digest: 1, finding: NotAccepted }, { reference: 4, attempt: 1, digest: 2, finding: DeliveredOutcome },
  { reference: 5, attempt: 2, digest: 1, finding: SuppressedOutcome }, { reference: 1, attempt: 2, digest: 1, finding: DeliveredOutcome })
pure val weight_save = 4
pure val weight_claim = 8
pure val weight_prepare = 8
pure val weight_send = 8
pure val weight_failPreparation = 8
pure val weight_reconcile = 6
pure val weight_escalate = 6
pure val weight_setConsent = 4
pure val weight_verifyDestination = 4
```
