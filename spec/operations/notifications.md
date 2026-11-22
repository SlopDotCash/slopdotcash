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
provider records. `NotifyConfig` is the recipient configuration of the
reviewed notification Worker release (`SLOP_NOTIFY_RELEASE`): each
operator-verified pilot destination of the restricted security pilot
(PRD SEC-16), its effective time, the configured backup of each recipient,
and whether registered account destinations (`SLOP_NOTIFY_GENERAL_EMAIL`)
are in use. The shell supplies it only from that release.

Each notice has a category. Security mail (private case notices, report
receipts and essential wallet notices) needs security consent; every other
notice is activity mail. Consent and the destination version are never set
here: the outbox reads the recipient's snapshot of the account
[email enrollment](../backend/email.md), which owns verification,
consent, unsubscribe and closure. The [account service](../backend/accounts.md)
(`accountService`) commits each consent change and each account closure in
the same write as the outbox update below.

## Story: Save each notice once with its source change

### A replay of the same source change and recipient adds nothing

The kind decides the channel. Private case notices and report receipts use
the security outbox, with the case template or the receipt template. Wallet
changes are essential activity mail. Every other kind is queued only when
the recipient has activity email enabled at that moment. A queued row binds
the destination version consented for its channel. Enabling email never
queues history.

```quint
import email as E from "../backend/email"
type Kind = ApplicationApproved | ApplicationRejected | ProjectRevision | AwardReserved | PaymentPaid | PayoutHeld
  | WalletChanged | ProjectQuarantined | ProjectBanned | ReinstatementRequested | ProjectReinstated | ReinstatementDenied
  | ReinstatementReview | PayoutException | SecurityCase | ProjectReady | ProjectScanFailed | ProjectInstallationLost
  | SecurityReportReceived | SlopbotAppealReview | SlopbotScamReview
type Channel = NoEmail | SecurityOutbox | ActivityOutbox
type Template = CaseTemplate | ReceiptTemplate | ActivityTemplate
type DeliveryState = NotQueued | Queued | Retrying | Sending | ProviderAccepted | Delivered | Bounced | Suppressed
  | Exhausted | Ambiguous
type Category = ActivityMail | SecurityMail
type Notice = { id: int, key: int, kind: Kind, recipient: int, createdAt: int, readAt: int, acknowledgedAt: int,
  channel: Channel, category: Category, template: Template, essential: bool, state: DeliveryState, attempts: int,
  nextAt: int, claimedAt: int, prepared: bool, boundVersion: int, digest: int, providerSuppressed: bool,
  escalationOf: int, escalated: bool }
type Route = { recipient: int, backup: int, pilotDigest: int, pilotEffectiveAt: int }
type NotifyConfig = { routes: List[Route], generalEmail: bool }
type Inbox = { clock: int, notices: List[Notice], enrollments: List[E::Enrollment], evidence: List[int],
  config: NotifyConfig, configs: int }
pure val accountService = -8
pure val noRoute: Route = { recipient: 0, backup: 0, pilotDigest: 0, pilotEffectiveAt: 0 }
pure val initial: Inbox = { clock: 1, notices: List(), evidence: List(), enrollments: List(),
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
  channel: NoEmail, category: ActivityMail, template: ActivityTemplate, essential: false, state: NotQueued, attempts: 0, nextAt: 0, claimedAt: 0,
  prepared: false, boundVersion: 0, digest: 0, providerSuppressed: false, escalationOf: 0, escalated: false }
pure def enrollmentOf(i: Inbox, recipient: int): E::Enrollment =
  i.enrollments.foldl(E::newEnrollment(recipient, 0), (found, e) => if (e.actor == recipient) e else found)
pure def mailConsent(e: E::Enrollment, category: Category): bool =
  e.preference.version > 0 and e.preference.version == E::currentVersion(e) and
  (if (category == SecurityMail) e.preference.security else e.preference.activity)
pure def notice(i: Inbox, id: int): Notice = i.notices.nthOr(id - 1, noNotice)
pure def securityKind(kind: Kind): bool = kind == SecurityCase or kind == SecurityReportReceived
pure def noticeExists(i: Inbox, key: int, recipient: int): bool = i.notices.some(n => n.key == key and n.recipient == recipient)
pure def categoryOf(kind: Kind): Category = if (securityKind(kind) or kind == WalletChanged) SecurityMail else ActivityMail
pure def newNotice(i: Inbox, key: int, kind: Kind, recipient: int, escalationOf: int): Notice =
  val e = enrollmentOf(i, recipient)
  val category = categoryOf(kind)
  val channel = if (securityKind(kind)) SecurityOutbox
    else if (kind == WalletChanged or mailConsent(e, ActivityMail)) ActivityOutbox else NoEmail
  { ...noNotice, id: i.notices.length() + 1, key: key, kind: kind, recipient: recipient, createdAt: i.clock, channel: channel,
    category: category,
    template: if (kind == SecurityReportReceived) ReceiptTemplate else if (kind == SecurityCase) CaseTemplate else ActivityTemplate,
    essential: channel == ActivityOutbox and kind == WalletChanged, state: if (channel == NoEmail) NotQueued else Queued,
    nextAt: i.clock, escalationOf: escalationOf,
    boundVersion: if (mailConsent(e, category)) E::currentVersion(e) else 0 }
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
    and (n.kind == WalletChanged implies n.channel == ActivityOutbox) and n.category == categoryOf(n.kind)
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

## Story: Follow the account's email enrollment and closure

### A committed enrollment change suppresses waiting mail that lost its consent

The account service supplies the recipient's enrollment as committed by a
verification, consent save or unsubscribe. A new destination version, or a
category turned off, suppresses that recipient's queued and retrying rows
whose bound version or category consent no longer holds, without erasing the
Inbox; a provider call already in flight cannot be recalled. A snapshot older
than the stored one in revision or destination version is refused. Enabling
consent never queues history.

```quint
pure def waiting(n: Notice): bool = n.state == Queued or n.state == Retrying
pure def boundConsent(e: E::Enrollment, n: Notice): bool =
  n.boundVersion > 0 and E::currentVersion(e) == n.boundVersion and mailConsent(e, n.category)
pure def withdrawn(e: E::Enrollment, n: Notice): bool =
  (n.boundVersion > 0 and not(boundConsent(e, n))) or
  (e.preference.stored and not(if (n.category == SecurityMail) e.preference.security else e.preference.activity))
pure def withSnapshot(i: Inbox, e: E::Enrollment): List[E::Enrollment] =
  if (i.enrollments.some(x => x.actor == e.actor)) i.enrollments.listMap(x => if (x.actor == e.actor) e else x)
  else i.enrollments.append(e)
pure def canObserveEnrollment(i: Inbox, by: int, enrollment: E::Enrollment): bool =
  val prior = enrollmentOf(i, enrollment.actor)
  by == accountService and enrollment.actor > 0 and enrollment.preference.revision >= prior.preference.revision and
  enrollment.destination.version >= prior.destination.version
pure def observeEnrollment(i: Inbox, by: int, enrollment: E::Enrollment): Inbox =
  { ...i, enrollments: withSnapshot(i, enrollment),
    notices: i.notices.listMap(n => if (n.recipient == enrollment.actor and waiting(n) and withdrawn(enrollment, n))
      { ...n, state: Suppressed } else n) }
pure def alwaysOneSnapshotPerRecipient(i: Inbox): bool =
  i.enrollments.every(e => e.actor > 0 and i.enrollments.select(x => x.actor == e.actor).length() == 1)
pure def lawEnrollmentDecidesConsent(e: E::Enrollment, category: Category): bool =
  mailConsent(e, category) implies (e.preference.version > 0 and
    (if (category == SecurityMail) e.preference.security else e.preference.activity))
pure def sometimesOptOutSuppressed(i: Inbox): bool = i.notices.some(n => n.state == Suppressed and n.attempts == 0)
pure def sometimesUnsubscribed(i: Inbox): bool =
  i.enrollments.some(e => e.preference.stored and not(e.preference.security) and not(e.preference.activity))
```

### Account closure suppresses every waiting notice of the account in the same write

Closing an account withdraws both consents in the enrollment and, in the same
commit, suppresses each of the account's queued and retrying notices, exactly
as an opt-out of both consents does. The Inbox rows remain; a send already
claimed is not recalled. A suppressed row stays suppressed: it is never
claimed, prepared or sent again.

```quint
pure def canCloseAccount(i: Inbox, by: int, enrollment: E::Enrollment): bool =
  by == accountService and enrollment.actor > 0 and not(enrollment.preference.activity) and
  not(enrollment.preference.security)
pure def closeAccount(i: Inbox, by: int, enrollment: E::Enrollment): Inbox =
  { ...i, enrollments: withSnapshot(i, enrollment),
    notices: i.notices.listMap(n => if (n.recipient == enrollment.actor and waiting(n)) { ...n, state: Suppressed } else n) }
pure def noWaitingMail(i: Inbox, recipient: int): bool = i.notices.every(n => n.recipient == recipient implies not(waiting(n)))
pure def lawClosedAccountHasNoWaitingMail(i: Inbox, enrollment: E::Enrollment): bool =
  noWaitingMail(closeAccount(i, accountService, enrollment), enrollment.actor)
pure def stepConsentNeverQueuesHistory(before: Inbox, via: str, after: Inbox): bool =
  (via == "observeEnrollment" or via == "closeAccount") implies after.notices.length() == before.notices.length()
    and before.notices.every(n => after.notices.some(a => a.id == n.id and
      (a.state == n.state or (waiting(n) and a.state == Suppressed))))
pure def stepSuppressedStaysSuppressed(before: Inbox, after: Inbox): bool =
  before.notices.every(n => n.state == Suppressed implies after.notices.some(a => a.id == n.id and a.state == Suppressed))
pure def anySuppressed(i: Inbox): bool = i.notices.some(n => n.state == Suppressed)
pure def sometimesClosedSuppressed(i: Inbox): bool = i.notices.some(n => n.state == Suppressed and n.attempts > 0)
```

## Story: Deliver each attempt once and never resend an uncertain one

### A claimed attempt has one owner; a stale claim becomes ambiguous

A due queued or retrying row is claimed with its attempt count incremented;
the claim keeps the destination digest an earlier attempt bound.
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
  { ...i, notices: setNotice(i, id, { ...n, state: Sending, attempts: n.attempts + 1, claimedAt: i.clock, prepared: false }) }
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
consent for the bound destination version. Otherwise a security notice, or
an essential activity notice, may use the recipient's operator-verified
pilot destination unless the recipient explicitly turned security mail off;
a recipient with neither is suppressed. Optional activity mail always needs
a registered destination and its consent. A suppression sent nothing and never escalates. A provider
acceptance proves acceptance only. A documented quota rejection retries; any
other thrown send is ambiguous.

```quint
type AccessCheck = Allowed({ acknowledgeHours: int }) | Denied | Unavailable
type ProviderResult = Accepted | QuotaRejected | Thrown
pure def consentHolds(i: Inbox, n: Notice): bool = boundConsent(enrollmentOf(i, n.recipient), n)
pure def allowed(access: AccessCheck): bool = match access { | Allowed(a) => a.acknowledgeHours >= 0 | _ => false }
pure def unavailable(access: AccessCheck): bool = match access { | Unavailable => true | _ => false }
pure def registered(i: Inbox, n: Notice): bool = i.config.generalEmail and enrollmentOf(i, n.recipient).destination.version > 0
pure def pilotUsable(i: Inbox, n: Notice): bool =
  val e = enrollmentOf(i, n.recipient)
  n.category == SecurityMail and not(registered(i, n)) and routeOf(i, n.recipient).pilotDigest > 0
    and not(e.preference.stored and not(e.preference.security))
pure def destinationEffectiveAt(i: Inbox, n: Notice): int =
  if (registered(i, n)) enrollmentOf(i, n.recipient).destination.verifiedAt else routeOf(i, n.recipient).pilotEffectiveAt
pure def destinationDigest(i: Inbox, n: Notice): int =
  if (registered(i, n)) n.boundVersion else 1000 + routeOf(i, n.recipient).pilotDigest
pure def canPrepare(i: Inbox, id: int, attempt: int, access: AccessCheck): bool = val n = notice(i, id)
  id > 0 and n.id == id and owns(n, attempt) and not(n.prepared)
pure def prepare(i: Inbox, id: int, attempt: int, access: AccessCheck): Inbox = val n = notice(i, id)
  val usable = (registered(i, n) and consentHolds(i, n)) or pilotUsable(i, n)
  val updated = if (unavailable(access)) retried(i, n)
    else if (not(allowed(access)) or not(usable)) { ...n, state: Suppressed }
    else if (destinationEffectiveAt(i, n) > i.clock) retried(i, n)
    else { ...n, prepared: true, digest: destinationDigest(i, n) }
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
exception reaches the project's current
[payout audience](./payoutAudience.md): its steward when the steward is a
GitHub user account, the account that listed the project when the steward is
a GitHub Organization, and that Organization steward when no lister is
recorded; the `steward` fact holds exactly when
`payoutExceptionAudience` of the current project and the recipient holds. An
owner cut's notice (keyed `monthly-cut:<project>:<period>:<sequence>`, its
subject that project) also reaches the contributor that cut record names: the
`cutContributor` fact. A
project ban made by the vetting service reaches a current owner, a current
affected contributor or current staff (an administrator or moderator),
whichever writer won the shared notice key. Every other project-owner notice (ready, revision, scan
failed, installation lost, quarantined, banned, reinstatement requested,
reinstated, reinstatement denied) reaches a current owner, or current staff
when its action path is the administration page. A reinstatement review
reaches a current moderator only while the request it names is undecided (the
`requestOpen` fact: no later enforcement record of the project has decided
it, as the [moderation](./moderation.md) queue folds it). A scam-closure account review reaches a current
moderator who is not the closed account's author, and only while the scam
penalty is not reversed. An escalated Slopbot appeal reaches a current
moderator who is not its appellant while the appeal is open; a points
dispute's opening notice reaches its appellant, or a current moderator while
the dispute is escalated and open; its resolution notice reaches its
appellant once resolved. An appeal notice whose appeal record is missing is
suppressed. Other activity kinds need no role beyond being the recipient.
Private case notices and report receipts keep the case authority reader.

```quint
import payoutAudience as PA from "./payoutAudience"
type AppealSource = NoAppeal | EscalatedAppeal | DisputeOpened | DisputeResolved
type NoticeAudience = { steward: bool, owner: bool, affectedContributor: bool, administrator: bool, moderator: bool,
  vettingBan: bool, staffPath: bool, appeal: AppealSource, appellant: bool, escalated: bool, resolved: bool,
  scamPenaltyStands: bool, author: bool, cutContributor: bool, requestOpen: bool }
pure def ownerKind(kind: Kind): bool = kind == ProjectReady or kind == ProjectRevision or kind == ProjectScanFailed
  or kind == ProjectInstallationLost or kind == ProjectQuarantined or kind == ProjectBanned
  or kind == ReinstatementRequested or kind == ProjectReinstated or kind == ReinstatementDenied
pure def appealAudience(audience: NoticeAudience): bool =
  if (audience.appeal == EscalatedAppeal)
    audience.moderator and audience.escalated and not(audience.resolved) and not(audience.appellant)
  else if (audience.appeal == DisputeOpened)
    audience.appellant or (audience.moderator and audience.escalated and not(audience.resolved))
  else if (audience.appeal == DisputeResolved) audience.appellant and audience.resolved
  else false
pure def audienceHolds(kind: Kind, audience: NoticeAudience): bool =
  val staff = audience.administrator or audience.moderator
  if (kind == PayoutException) audience.steward or audience.cutContributor
  else if (kind == ProjectBanned and audience.vettingBan) audience.owner or audience.affectedContributor or staff
  else if (ownerKind(kind)) audience.owner or (audience.staffPath and staff)
  else if (kind == ReinstatementReview) audience.moderator and audience.requestOpen
  else if (kind == SlopbotScamReview) audience.moderator and audience.scamPenaltyStands and not(audience.author)
  else if (kind == SlopbotAppealReview) appealAudience(audience)
  else true
pure def payoutExceptionAudience(payout: PA::PayoutProject, recipient: int): bool = PA::inPayoutAudience(payout, recipient)
pure def activityAccess(kind: Kind, audience: NoticeAudience): AccessCheck =
  if (audienceHolds(kind, audience)) Allowed({ acknowledgeHours: 0 }) else Denied
pure def lawFormerOwnerLosesOwnerNotices(noticeKind: Kind, audience: NoticeAudience): bool =
  (ownerKind(noticeKind) and not(audience.vettingBan) and not(audience.owner) and not(audience.staffPath))
    implies not(audienceHolds(noticeKind, audience))
pure def lawScamReviewNeverReachesAuthorOrAfterReversal(audience: NoticeAudience): bool =
  (audience.author or not(audience.scamPenaltyStands)) implies not(audienceHolds(SlopbotScamReview, audience))
pure def lawPayoutExceptionOnlyToItsAudience(audience: NoticeAudience): bool =
  audienceHolds(PayoutException, audience) iff (audience.steward or audience.cutContributor)
pure def lawDecidedReinstatementMailsNobody(audience: NoticeAudience): bool =
  not(audience.requestOpen) implies not(audienceHolds(ReinstatementReview, audience))
pure val audienceValues = Set(
  { steward: true, owner: false, affectedContributor: false, administrator: false, moderator: false, vettingBan: false,
    staffPath: false, appeal: NoAppeal, appellant: false, escalated: false, resolved: false, scamPenaltyStands: false, author: false,
    cutContributor: false, requestOpen: false },
  { steward: false, owner: false, affectedContributor: true, administrator: false, moderator: false, vettingBan: true,
    staffPath: false, appeal: NoAppeal, appellant: false, escalated: false, resolved: false, scamPenaltyStands: false, author: false,
    cutContributor: false, requestOpen: false },
  { steward: false, owner: false, affectedContributor: false, administrator: true, moderator: false, vettingBan: false,
    staffPath: true, appeal: NoAppeal, appellant: false, escalated: false, resolved: false, scamPenaltyStands: false, author: false,
    cutContributor: false, requestOpen: false },
  { steward: false, owner: false, affectedContributor: false, administrator: false, moderator: true, vettingBan: false,
    staffPath: false, appeal: EscalatedAppeal, appellant: false, escalated: true, resolved: false, scamPenaltyStands: true, author: false,
    cutContributor: false, requestOpen: true },
  { steward: false, owner: false, affectedContributor: false, administrator: false, moderator: true, vettingBan: false,
    staffPath: false, appeal: DisputeOpened, appellant: true, escalated: true, resolved: true, scamPenaltyStands: false, author: true,
    cutContributor: false, requestOpen: false },
  { steward: false, owner: true, affectedContributor: false, administrator: false, moderator: false, vettingBan: false,
    staffPath: false, appeal: DisputeResolved, appellant: true, escalated: false, resolved: true, scamPenaltyStands: true, author: true,
    cutContributor: false, requestOpen: false },
  { steward: false, owner: false, affectedContributor: false, administrator: false, moderator: false, vettingBan: false,
    staffPath: false, appeal: NoAppeal, appellant: false, escalated: false, resolved: false, scamPenaltyStands: false, author: false,
    cutContributor: true, requestOpen: false })
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

### The Inbox shows one delivery word and never the address, digest, provider reference or attempt count

An Inbox item carries the notice's identity, kind, read and acknowledgment
times and one email word, and no other outbox field. Queued, retrying and
sending rows read `queued`; provider acceptance reads `sent`, never
delivered; independent delivery evidence reads `delivered`; a bounce, or an
exhausted row whose attempt bound a destination, reads `failed`; an
ambiguous row reads `uncertain`. A row that sent nothing (suppressed for
consent, access, destination or account closure, never queued,
or exhausted without a bound destination) shows no email word, so the Inbox
never reveals why private mail was withheld. Whether an exhausted row bound a destination is read from
its destination digest, which a claim keeps, so it reads whether any of its
attempts bound one. Only case notices show an acknowledgment time.

The stored kinds are the 21 of `Kind`. A Slopbot appeal review whose appeal
or points dispute has since been resolved is shown as resolved, the 22nd
kind the Inbox parser accepts; titles and links stay a presentation table.
Which moderator and steward rows a viewer may list or open is the
[moderator and steward Inbox](./moderation.md).

```quint
type EmailWord = NoEmailWord | QueuedWord | SentWord | DeliveredWord | FailedWord | UncertainWord
type InboxItem = { id: int, key: int, kind: Kind, appealResolved: bool, readAt: int, acknowledgedAt: int,
  asksAcknowledgment: bool, email: EmailWord }
pure def emailWord(delivery: DeliveryState, bound: bool): EmailWord =
  if (delivery == Queued or delivery == Retrying or delivery == Sending) QueuedWord
  else if (delivery == ProviderAccepted) SentWord
  else if (delivery == Delivered) DeliveredWord
  else if (delivery == Bounced or (delivery == Exhausted and bound)) FailedWord
  else if (delivery == Ambiguous) UncertainWord
  else NoEmailWord
pure def inboxItem(n: Notice, appealResolved: bool): InboxItem =
  { id: n.id, key: n.key, kind: n.kind, appealResolved: n.kind == SlopbotAppealReview and appealResolved,
    readAt: n.readAt, acknowledgedAt: if (n.template == CaseTemplate) n.acknowledgedAt else 0,
    asksAcknowledgment: n.template == CaseTemplate, email: emailWord(n.state, n.digest > 0) }
pure def lawEmailWordNeverOverstates(delivery: DeliveryState, bound: bool): bool =
  val word = emailWord(delivery, bound)
  (word == SentWord iff delivery == ProviderAccepted) and (word == DeliveredWord iff delivery == Delivered)
    and ((delivery == Suppressed or delivery == NotQueued) implies word == NoEmailWord)
pure def lawOnlyAppealReviewsShowResolved(noticeKind: Kind, appealResolved: bool): bool =
  inboxItem({ ...noNotice, id: 1, kind: noticeKind }, appealResolved).appealResolved implies noticeKind == SlopbotAppealReview
```

## Story: Read, acknowledge and escalate private case notices

### Only the current recipient reads or acknowledges, and only case notices ask for acknowledgment

Reading is never acknowledgment. Any private case notice of the recipient,
the report receipt included, may be acknowledged with current case access;
only case notices ask for it. Provider acceptance and delivery never prove
acknowledgment.

```quint
pure def canRead(i: Inbox, id: int, by: int): bool = val n = notice(i, id)
  id > 0 and n.id == id and n.recipient == by and n.readAt == 0
pure def read(i: Inbox, id: int, by: int): Inbox = { ...i, notices: setNotice(i, id, { ...notice(i, id), readAt: i.clock }) }
pure def canAcknowledge(i: Inbox, id: int, by: int, access: AccessCheck): bool = val n = notice(i, id)
  id > 0 and n.id == id and n.recipient == by and n.channel == SecurityOutbox and n.acknowledgedAt == 0 and allowed(access)
pure def acknowledge(i: Inbox, id: int, by: int, access: AccessCheck): Inbox =
  { ...i, notices: setNotice(i, id, { ...notice(i, id), acknowledgedAt: i.clock }) }
pure def alwaysAcknowledgmentOnSecurityNotices(i: Inbox): bool =
  i.notices.every(n => n.acknowledgedAt > 0 implies n.channel == SecurityOutbox)
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
pure val byValues = Set(1, 2, 4, accountService)
pure val idValues = Set(1, 2, 3)
pure val attemptValues = Set(1, 2, 3, 4, 5)
pure val elapsedValues = Set(60000, 400000, 3600000)
pure val weight_advanceClock = 8
pure val consentedEnrollment: E::Enrollment = { ...E::newEnrollment(1, 0), destination: { address: "a", version: 1, verifiedAt: 1 },
  preference: { stored: true, activity: true, security: true, version: 1, revision: 0 } }
pure val enrollmentValues = Set(consentedEnrollment, { ...consentedEnrollment, preference: { ...consentedEnrollment.preference,
    activity: false, revision: 1 } }, { ...consentedEnrollment, preference: { ...consentedEnrollment.preference,
    activity: false, security: false, revision: 2 } }, { ...consentedEnrollment, actor: 2,
    destination: { address: "b", version: 2, verifiedAt: 1 }, preference: { ...consentedEnrollment.preference, version: 2 } },
  { ...consentedEnrollment, destination: { address: "c", version: 3, verifiedAt: 1 },
    preference: { ...consentedEnrollment.preference, activity: false, security: false, version: 0, revision: 3 } })
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
pure val weight_observeEnrollment = 5
pure val weight_closeAccount = 3
pure val weight_publishConfig = 4
pure val configValues = Set(
  { routes: List({ recipient: 1, backup: 2, pilotDigest: 0, pilotEffectiveAt: 0 }, { recipient: 2, backup: 3, pilotDigest: 0, pilotEffectiveAt: 0 },
    { recipient: 3, backup: 0, pilotDigest: 0, pilotEffectiveAt: 0 }), generalEmail: true },
  { routes: List({ recipient: 1, backup: 2, pilotDigest: 7, pilotEffectiveAt: 0 }, { recipient: 2, backup: 1, pilotDigest: 8, pilotEffectiveAt: 5000000 }),
    generalEmail: false })
```
