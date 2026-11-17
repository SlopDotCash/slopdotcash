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
provider records. `InboxUnsubscribeToken` is a token whose keyed digest the
transport verified; it names the recipient and the destination version it was
issued for, and no category. `NotifyConfig` is the recipient configuration of the
reviewed notification Worker release (`SLOP_NOTIFY_RELEASE`): each
operator-verified pilot destination of the restricted security pilot
(PRD SEC-16), its effective time, the configured backup of each recipient,
and whether registered account destinations (`SLOP_NOTIFY_GENERAL_EMAIL`)
are in use. The shell supplies it only from that release.

The destination version and the two consents here are this outbox's
projection of the account [email enrollment](../backend/email.md); that
machine owns verification mail, its expiry and cancellation, and closure.
Binding the two is a composition obligation.

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
  claimedAt: int, prepared: bool, boundVersion: int, digest: int, everBound: bool, providerSuppressed: bool, escalationOf: int,
  escalated: bool }
type Preference = { recipient: int, activity: bool, security: bool, saved: bool, version: int, effectiveAt: int, revision: int }
type Route = { recipient: int, backup: int, pilotDigest: int, pilotEffectiveAt: int }
type NotifyConfig = { routes: List[Route], generalEmail: bool }
type Inbox = { clock: int, notices: List[Notice], prefs: List[Preference], evidence: List[int], nextVersion: int,
  config: NotifyConfig, configs: int }
pure val noPreference: Preference = { recipient: 0, activity: false, security: false, saved: false, version: 0, effectiveAt: 0, revision: 0 }
pure val noRoute: Route = { recipient: 0, backup: 0, pilotDigest: 0, pilotEffectiveAt: 0 }
pure val initial: Inbox = { clock: 1, notices: List(), evidence: List(), nextVersion: 1,
  prefs: List({ ...noPreference, recipient: 1 }, { ...noPreference, recipient: 2 }, { ...noPreference, recipient: 3 }),
  config: { routes: List(), generalEmail: false }, configs: 0 }
pure def routeOf(i: Inbox, recipient: int): Route =
  i.config.routes.foldl(noRoute, (found, r) => if (found.recipient == 0 and r.recipient == recipient) r else found)
pure def backupOf(i: Inbox, recipient: int): int =
  val backup = routeOf(i, recipient).backup
  if (backup > 0 and backup != recipient and routeOf(i, backup).recipient == backup) backup else 0
pure def validConfig(config: NotifyConfig): bool = config.routes.every(r => r.recipient > 0 and r.backup >= 0
  and r.backup != r.recipient and r.pilotDigest >= 0 and r.pilotEffectiveAt >= 0)
pure def canPublishConfig(i: Inbox, config: NotifyConfig): bool = validConfig(config)
pure def publishConfig(i: Inbox, config: NotifyConfig): Inbox = { ...i, config: config, configs: i.configs + 1 }
pure def alwaysConfigValid(i: Inbox): bool = validConfig(i.config)
pure val noNotice: Notice = { id: 0, key: 0, kind: ProjectRevision, recipient: 0, createdAt: 0, readAt: 0, acknowledgedAt: 0,
  channel: NoEmail, template: ActivityTemplate, essential: false, state: NotQueued, attempts: 0, nextAt: 0, claimedAt: 0,
  prepared: false, boundVersion: 0, digest: 0, everBound: false, providerSuppressed: false, escalationOf: 0, escalated: false }
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
    and (n.escalated implies a.escalated) and (n.everBound implies a.everBound)))
pure def sometimesReplayKeptOne(i: Inbox): bool = i.notices.length() == 1 and i.notices.some(n => n.state == Queued)
```

## Story: Control future email with consent bound to a verified destination

### Consent binds one verified destination version and opt-out suppresses waiting mail

Verifying a new address issues a new destination version, takes effect at
verification and needs fresh consent; waiting mail bound to the earlier
version is suppressed. Activity consent governs optional notices; security
consent governs private case notices, report receipts and essential wallet
notices. Enabling either requires a verified destination. Turning a channel
off in settings suppresses its queued and retrying rows without erasing the
Inbox; a provider call already in flight cannot be recalled. An unsubscribe
token carries no category: a verified token for the current destination
version withdraws both activity and security consent, as the account
enrollment does (`spec/backend/email.md`, "Unsubscribe withdraws both
categories only for the destination version its token was issued for"), and
suppresses every queued and retrying row of that recipient. A token for an
earlier version changes nothing. Every preference save increments a revision.

```quint
pure def updatePref(i: Inbox, recipient: int, p: Preference): List[Preference] =
  i.prefs.listMap(x => if (x.recipient == recipient) p else x)
pure def canVerifyDestination(i: Inbox, by: int): bool = pref(i, by).recipient == by and by > 0
pure def verifyDestination(i: Inbox, by: int): Inbox =
  { ...i, nextVersion: i.nextVersion + 1, prefs: updatePref(i, by, { ...pref(i, by), version: i.nextVersion, effectiveAt: i.clock,
    activity: false, security: false, saved: true, revision: pref(i, by).revision + 1 }),
    notices: i.notices.listMap(n => if (n.recipient == by and waiting(n) and n.boundVersion > 0) { ...n, state: Suppressed } else n) }
pure def waiting(n: Notice): bool = n.state == Queued or n.state == Retrying
pure def canSetConsent(i: Inbox, activity: bool, security: bool, by: int): bool =
  val p = pref(i, by)
  p.recipient == by and by > 0 and ((activity or security) implies p.version > 0)
pure def setConsent(i: Inbox, activity: bool, security: bool, by: int): Inbox =
  { ...i, prefs: updatePref(i, by, { ...pref(i, by), activity: activity, security: security, saved: true, revision: pref(i, by).revision + 1 }),
    notices: i.notices.listMap(n => if (n.recipient == by and waiting(n) and (
      (not(activity) and n.channel == ActivityOutbox and not(n.essential))
      or (not(security) and (n.channel == SecurityOutbox or n.essential)))) { ...n, state: Suppressed } else n) }
type InboxUnsubscribeToken = { recipient: int, version: int }
pure def canUnsubscribe(i: Inbox, token: InboxUnsubscribeToken): bool =
  val p = pref(i, token.recipient)
  token.recipient > 0 and p.recipient == token.recipient and token.version > 0 and token.version == p.version
pure def unsubscribe(i: Inbox, token: InboxUnsubscribeToken): Inbox =
  val p = pref(i, token.recipient)
  { ...i, prefs: updatePref(i, token.recipient, { ...p, saved: true, revision: p.revision + 1, activity: false, security: false }),
    notices: i.notices.listMap(n => if (n.recipient == token.recipient and waiting(n)) { ...n, state: Suppressed } else n) }
pure def stepUnsubscribeWithdrawsBoth(before: Inbox, via: str, after: Inbox): bool =
  via == "unsubscribe" implies after.prefs.every(p => before.prefs.includes(p) or (not(p.activity) and not(p.security)))
pure def stepConsentNeverQueuesHistory(before: Inbox, via: str, after: Inbox): bool =
  (via == "setConsent" or via == "verifyDestination" or via == "unsubscribe") implies after.notices.length() == before.notices.length()
    and before.notices.every(n => after.notices.some(a => a.id == n.id and (a.state == n.state or a.state == Suppressed)))
pure def alwaysConsentNeedsDestination(i: Inbox): bool = i.nextVersion > 0
  and i.prefs.every(p => (p.activity or p.security) implies p.version > 0)
pure def sometimesOptOutSuppressed(i: Inbox): bool = i.notices.some(n => n.state == Suppressed and n.attempts == 0)
pure def sometimesUnsubscribed(i: Inbox): bool = i.prefs.some(p => p.saved and p.version > 0 and not(p.security) and not(p.activity) and p.revision > 1)
```

### A notice's destination version and consents are the recipient's current email enrollment

The owner's decision on which service owns enrollment is pending (O26,
OD5). Modelled meanwhile, as the old notify Worker behaved: the backend
account service enrolls and the operations outbox delivers. The machine's
`prefs` stand for this projection of the account
[email enrollment](../backend/email.md): before each `prepare` the shell
loads the recipient's preference as
`enrolledPreference(enrollment.actor, enrollment)` from the backend
email-consent port and keeps no other copy; binding the two is a composition
obligation (see the introduction). The destination version is the current
verified destination's, effective from its verification; consent counts only
when it was saved for that same version. A stored choice counts as saved
when it is for the current version or turned security mail off, so the
pilot destination is withheld exactly when the stored security choice is
off, whatever version it was saved for, as the old notify Worker did. The
alternative is that operations owns enrollment and the backend reads consent
from it.

```quint
import email as E from "../backend/email"
pure def enrolledPreference(recipient: int, enrollment: E::Enrollment): Preference =
  val currentDestination = enrollment.destination.version > 0 and enrollment.preference.version == enrollment.destination.version
  { recipient: recipient, activity: currentDestination and enrollment.preference.activity,
    security: currentDestination and enrollment.preference.security,
    saved: enrollment.preference.stored and (currentDestination or not(enrollment.preference.security)),
    version: enrollment.destination.version, effectiveAt: enrollment.destination.verifiedAt,
    revision: enrollment.preference.revision }
pure def lawEnrolledConsentNeedsCurrentDestination(recipient: int, enrollment: E::Enrollment): bool =
  val p = enrolledPreference(recipient, enrollment)
  (p.activity or p.security) implies (p.version > 0 and enrollment.preference.version == p.version)
pure def lawPilotBlockedOnlyByExplicitOptOut(recipient: int, enrollment: E::Enrollment): bool =
  val p = enrolledPreference(recipient, enrollment)
  (p.saved and not(p.security)) iff (enrollment.preference.stored and not(enrollment.preference.security))
pure val enrollmentValues = Set(E::newEnrollment(1, 0)).union(Set({ ...E::newEnrollment(1, 0),
  destination: { address: "a", version: 2, verifiedAt: 5 },
  preference: { stored: true, activity: true, security: true, version: 2, revision: 1 } }))
  .union(Set({ ...E::newEnrollment(2, 0), destination: { address: "b", version: 3, verifiedAt: 7 },
    preference: { stored: true, activity: true, security: false, version: 2, revision: 2 } }))
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
recipient without current access is suppressed. While registered account
destinations are in use, a recipient with a registered destination needs
consent for the bound destination version. Otherwise a security notice may
use the recipient's operator-verified pilot destination unless the
recipient explicitly turned security mail off; a recipient with neither is
suppressed. Activity mail always needs a registered destination and its
consent. A suppression sent nothing and never escalates. A provider
acceptance proves acceptance only. A documented quota rejection retries; any
other thrown send is ambiguous.

```quint
type AccessCheck = Allowed({ acknowledgeHours: int }) | Denied | Unavailable
type ProviderResult = Accepted | QuotaRejected | Thrown
pure def consentHolds(i: Inbox, n: Notice): bool =
  val p = pref(i, n.recipient)
  n.boundVersion > 0 and p.version == n.boundVersion
    and (if (n.channel == SecurityOutbox or n.essential) p.security else p.activity)
pure def allowed(access: AccessCheck): bool = match access { | Allowed(a) => a.acknowledgeHours >= 0 | _ => false }
pure def unavailable(access: AccessCheck): bool = match access { | Unavailable => true | _ => false }
pure def registered(i: Inbox, n: Notice): bool = i.config.generalEmail and pref(i, n.recipient).version > 0
pure def pilotUsable(i: Inbox, n: Notice): bool =
  val p = pref(i, n.recipient)
  n.channel == SecurityOutbox and not(registered(i, n)) and routeOf(i, n.recipient).pilotDigest > 0
    and not(p.saved and not(p.security))
pure def destinationEffectiveAt(i: Inbox, n: Notice): int =
  if (registered(i, n)) pref(i, n.recipient).effectiveAt else routeOf(i, n.recipient).pilotEffectiveAt
pure def destinationDigest(i: Inbox, n: Notice): int =
  if (registered(i, n)) n.boundVersion else 1000 + routeOf(i, n.recipient).pilotDigest
pure def canPrepare(i: Inbox, id: int, attempt: int, access: AccessCheck): bool = val n = notice(i, id)
  id > 0 and n.id == id and owns(n, attempt) and not(n.prepared)
pure def prepare(i: Inbox, id: int, attempt: int, access: AccessCheck): Inbox = val n = notice(i, id)
  val usable = (registered(i, n) and consentHolds(i, n)) or pilotUsable(i, n)
  val updated = if (unavailable(access)) retried(i, n)
    else if (not(allowed(access)) or not(usable)) { ...n, state: Suppressed }
    else if (destinationEffectiveAt(i, n) > i.clock) retried(i, n)
    else { ...n, prepared: true, digest: destinationDigest(i, n), everBound: true }
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
pure def sometimesPilotAccepted(i: Inbox): bool = i.notices.some(n => n.state == ProviderAccepted and n.digest > 1000)
pure def sometimesRetriedBeforeEffective(i: Inbox): bool = i.notices.some(n => n.state == Retrying and n.digest == 0)
  and i.config.routes.some(r => r.pilotEffectiveAt > i.clock)
```

### Each notice kind names the role its recipient must still hold when the attempt is prepared

The authority reader answers `Allowed` for an activity notice only when the
recipient still belongs to its kind's audience at preparation, from the
current project, enforcement, appeal and penalty records and the
administrator and moderator sets of the current configuration snapshot;
otherwise it answers `Denied` and the attempt is suppressed. A payout
exception reaches only the project's current steward. A project ban made by
the vetting service reaches a current owner, a current affected contributor
or current staff (an administrator or moderator), whichever writer won the
shared notice key. Every other project-owner notice (ready, revision, scan
failed, installation lost, quarantined, banned, reinstatement requested,
reinstated, reinstatement denied) reaches a current owner, or current staff
when its action path is the administration page. A reinstatement review
reaches a current moderator. A scam-closure account review reaches a current
moderator who is not the closed account's author, and only while the scam
penalty is not reversed. An escalated Slopbot appeal reaches a current
moderator who is not its appellant while the appeal is open; a points
dispute's opening notice reaches its appellant, or a current moderator while
the dispute is escalated and open; its resolution notice reaches its
appellant once resolved. An appeal notice whose appeal record is missing is
suppressed. Other activity kinds need no role beyond being the recipient.
Private case notices and report receipts keep the case authority reader.

```quint
type AppealSource = NoAppeal | EscalatedAppeal | DisputeOpened | DisputeResolved
type Audience = { steward: bool, owner: bool, affectedContributor: bool, administrator: bool, moderator: bool,
  vettingBan: bool, staffPath: bool, appeal: AppealSource, appellant: bool, escalated: bool, resolved: bool,
  scamPenaltyStands: bool, author: bool }
pure def ownerKind(kind: Kind): bool = kind == ProjectReady or kind == ProjectRevision or kind == ProjectScanFailed
  or kind == ProjectInstallationLost or kind == ProjectQuarantined or kind == ProjectBanned
  or kind == ReinstatementRequested or kind == ProjectReinstated or kind == ReinstatementDenied
pure def appealAudience(audience: Audience): bool =
  if (audience.appeal == EscalatedAppeal)
    audience.moderator and audience.escalated and not(audience.resolved) and not(audience.appellant)
  else if (audience.appeal == DisputeOpened)
    audience.appellant or (audience.moderator and audience.escalated and not(audience.resolved))
  else if (audience.appeal == DisputeResolved) audience.appellant and audience.resolved
  else false
pure def audienceHolds(kind: Kind, audience: Audience): bool =
  val staff = audience.administrator or audience.moderator
  if (kind == PayoutException) audience.steward
  else if (kind == ProjectBanned and audience.vettingBan) audience.owner or audience.affectedContributor or staff
  else if (ownerKind(kind)) audience.owner or (audience.staffPath and staff)
  else if (kind == ReinstatementReview) audience.moderator
  else if (kind == SlopbotScamReview) audience.moderator and audience.scamPenaltyStands and not(audience.author)
  else if (kind == SlopbotAppealReview) appealAudience(audience)
  else true
pure def activityAccess(kind: Kind, audience: Audience): AccessCheck =
  if (audienceHolds(kind, audience)) Allowed({ acknowledgeHours: 0 }) else Denied
pure def lawFormerOwnerLosesOwnerNotices(noticeKind: Kind, audience: Audience): bool =
  (ownerKind(noticeKind) and not(audience.vettingBan) and not(audience.owner) and not(audience.staffPath))
    implies not(audienceHolds(noticeKind, audience))
pure def lawScamReviewNeverReachesAuthorOrAfterReversal(audience: Audience): bool =
  (audience.author or not(audience.scamPenaltyStands)) implies not(audienceHolds(SlopbotScamReview, audience))
pure def lawPayoutExceptionOnlyToSteward(audience: Audience): bool =
  audienceHolds(PayoutException, audience) iff audience.steward
pure val audienceValues = Set(
  { steward: true, owner: false, affectedContributor: false, administrator: false, moderator: false, vettingBan: false,
    staffPath: false, appeal: NoAppeal, appellant: false, escalated: false, resolved: false, scamPenaltyStands: false, author: false },
  { steward: false, owner: false, affectedContributor: true, administrator: false, moderator: false, vettingBan: true,
    staffPath: false, appeal: NoAppeal, appellant: false, escalated: false, resolved: false, scamPenaltyStands: false, author: false },
  { steward: false, owner: false, affectedContributor: false, administrator: true, moderator: false, vettingBan: false,
    staffPath: true, appeal: NoAppeal, appellant: false, escalated: false, resolved: false, scamPenaltyStands: false, author: false },
  { steward: false, owner: false, affectedContributor: false, administrator: false, moderator: true, vettingBan: false,
    staffPath: false, appeal: EscalatedAppeal, appellant: false, escalated: true, resolved: false, scamPenaltyStands: true, author: false },
  { steward: false, owner: false, affectedContributor: false, administrator: false, moderator: true, vettingBan: false,
    staffPath: false, appeal: DisputeOpened, appellant: true, escalated: true, resolved: true, scamPenaltyStands: false, author: true },
  { steward: false, owner: true, affectedContributor: false, administrator: false, moderator: false, vettingBan: false,
    staffPath: false, appeal: DisputeResolved, appellant: true, escalated: false, resolved: true, scamPenaltyStands: true, author: true })
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

### The Inbox shows one delivery word and never the address, digest, provider reference or attempt count

An Inbox item carries the notice's identity, kind, read and acknowledgment
times and one email word, and no other outbox field. Queued, retrying and
sending rows read `queued`; provider acceptance reads `sent`, never
delivered; independent delivery evidence reads `delivered`; a bounce, or an
exhausted row any of whose attempts ever bound a destination, reads
`failed`; an ambiguous row reads `uncertain`. A row that sent nothing
(suppressed for consent, access or destination, never queued, or exhausted
without ever binding a destination) shows no email word, so the Inbox never
reveals why private mail was withheld. Each claim clears the current
attempt's destination digest, but whether any attempt bound one is kept for
good, as the old notify Worker kept the digest of an earlier attempt: an
exhaustion whose last attempt never reached the provider, or whose
preparation failed after binding, still reads `failed` once some attempt
bound a destination. Only case notices show an acknowledgment time.

The stored kinds are the 21 of `Kind`. A Slopbot appeal review whose appeal
or points dispute has since been resolved is shown as resolved, the 22nd
kind the Inbox parser accepts; titles and links stay a presentation table.
Appeal and scam reviews are listed only to current moderators, a points
dispute's notices also to its appellant, and a scam review only while its
penalty stands, by the audience of "Each notice kind names the role its
recipient must still hold when the attempt is prepared".

```quint
type EmailWord = NoEmailWord | QueuedWord | SentWord | DeliveredWord | FailedWord | UncertainWord
type InboxItem = { id: int, key: int, kind: Kind, appealResolved: bool, readAt: int, acknowledgedAt: int,
  asksAcknowledgment: bool, email: EmailWord }
pure def emailWord(delivery: DeliveryState, everBound: bool): EmailWord =
  if (delivery == Queued or delivery == Retrying or delivery == Sending) QueuedWord
  else if (delivery == ProviderAccepted) SentWord
  else if (delivery == Delivered) DeliveredWord
  else if (delivery == Bounced or (delivery == Exhausted and everBound)) FailedWord
  else if (delivery == Ambiguous) UncertainWord
  else NoEmailWord
pure def inboxItem(n: Notice, appealResolved: bool): InboxItem =
  { id: n.id, key: n.key, kind: n.kind, appealResolved: n.kind == SlopbotAppealReview and appealResolved,
    readAt: n.readAt, acknowledgedAt: if (n.template == CaseTemplate) n.acknowledgedAt else 0,
    asksAcknowledgment: n.template == CaseTemplate, email: emailWord(n.state, n.everBound) }
pure def listedInInbox(kind: Kind, audience: Audience): bool =
  if (kind == SlopbotScamReview) audience.moderator and audience.scamPenaltyStands
  else if (kind == SlopbotAppealReview) audience.moderator
    or (audience.appellant and (audience.appeal == DisputeOpened or audience.appeal == DisputeResolved))
  else true
pure def lawEmailWordNeverOverstates(delivery: DeliveryState, everBound: bool): bool =
  val word = emailWord(delivery, everBound)
  (word == SentWord iff delivery == ProviderAccepted) and (word == DeliveredWord iff delivery == Delivered)
    and ((delivery == Suppressed or delivery == NotQueued) implies word == NoEmailWord)
pure def lawOnlyAppealReviewsShowResolved(noticeKind: Kind, appealResolved: bool): bool =
  inboxItem({ ...noNotice, id: 1, kind: noticeKind }, appealResolved).appealResolved implies noticeKind == SlopbotAppealReview
pure def sometimesEarlierBindingOutlivesTheClaim(i: Inbox): bool =
  i.notices.some(n => n.everBound and n.digest == 0 and n.attempts > 1)
```

### A failed or overdue case notice escalates once to a backup with current access

A primary private notice escalates when its delivery bounced, exhausted, is
ambiguous or was suppressed by provider evidence, or, for a case notice that
asks for acknowledgment, when it is unacknowledged past the recipient's
acknowledgment window even though it was accepted or delivered. A report
receipt escalates only on failed delivery. Activity notices, acknowledged
notices, withheld or access-suppressed mail and escalation copies never
escalate. The backup is the recipient's backup in the current released
configuration, must itself be a configured recipient, needs current access to
the case, and receives one generic private notice. A later configuration
never changes an escalation already made.

```quint
pure def failedDelivery(n: Notice): bool = n.state == Ambiguous or n.state == Exhausted or n.state == Bounced
  or (n.state == Suppressed and n.providerSuppressed)
pure def overdue(i: Inbox, n: Notice, primaryAccess: AccessCheck): bool = match primaryAccess {
  | Allowed(a) => n.template == CaseTemplate and a.acknowledgeHours > 0
      and (n.state == ProviderAccepted or n.state == Delivered) and i.clock >= n.createdAt + a.acknowledgeHours * 3600000
  | _ => false }
pure def canEscalate(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck): bool = val n = notice(i, id)
  id > 0 and n.id == id and n.channel == SecurityOutbox and n.escalationOf == 0 and not(n.escalated) and n.acknowledgedAt == 0
    and backupOf(i, n.recipient) > 0 and allowed(primaryAccess) and allowed(backupAccess)
    and (failedDelivery(n) or overdue(i, n, primaryAccess))
pure def escalate(i: Inbox, id: int, primaryAccess: AccessCheck, backupAccess: AccessCheck): Inbox = val n = notice(i, id)
  { ...i, notices: setNotice(i, id, { ...n, escalated: true })
    .append(newNotice(i, 1000 + id, SecurityCase, backupOf(i, n.recipient), id)) }
pure def alwaysEscalationOnce(i: Inbox): bool = i.notices.every(n =>
  (n.escalationOf > 0 implies n.kind == SecurityCase and n.key == 1000 + n.escalationOf and n.escalationOf < n.id
    and notice(i, n.escalationOf).escalated and notice(i, n.escalationOf).channel == SecurityOutbox
    and notice(i, n.escalationOf).escalationOf == 0 and n.recipient > 0 and n.recipient != notice(i, n.escalationOf).recipient
    and not(n.escalated))
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
pure val weight_publishConfig = 4
pure val configValues = Set(
  { routes: List({ recipient: 1, backup: 2, pilotDigest: 0, pilotEffectiveAt: 0 }, { recipient: 2, backup: 3, pilotDigest: 0, pilotEffectiveAt: 0 },
    { recipient: 3, backup: 0, pilotDigest: 0, pilotEffectiveAt: 0 }), generalEmail: true },
  { routes: List({ recipient: 1, backup: 2, pilotDigest: 7, pilotEffectiveAt: 0 }, { recipient: 2, backup: 1, pilotDigest: 8, pilotEffectiveAt: 5000000 }),
    generalEmail: false })
pure val tokenValues = Set({ recipient: 1, version: 1 }, { recipient: 1, version: 2 }, { recipient: 2, version: 2 })
```
