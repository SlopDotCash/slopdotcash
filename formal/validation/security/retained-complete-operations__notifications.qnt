module operations__notifications { // # Inbox and email delivery

// PRD section 9 distinguishes saved, read, acknowledged, provider-accepted,
// delivered, failed and uncertain notices. A notice is written atomically with
// its source mutation and carries an idempotency key.

// ## Story: Receive one notice and control future email

// ### Inbox state is independent of email delivery

// ```quint
type Delivery = NotQueued | Queued | Preparing | Sending | Uncertain | ProviderAccepted | Delivered | Failed | Cancelled
type Notice = { saved: bool, read: bool, acknowledged: bool, delivery: Delivery, destinationVersion: int, consentVersion: int, consent: bool, attempts: int, activeAttempt: int, knownUnsent: bool, escalated: bool }
pure val initial: Notice = { saved: false, read: false, acknowledged: false, delivery: NotQueued, destinationVersion: 1, consentVersion: 0, consent: false, attempts: 0, activeAttempt: 0, knownUnsent: false, escalated: false }
pure def canSave(n: Notice): bool = not(n.saved)
pure def save(n: Notice): Notice = { ...n, saved: true }
pure def canRead(n: Notice, currentAuthority: bool): bool = n.saved and currentAuthority
pure def read(n: Notice, currentAuthority: bool): Notice = { ...n, read: true }
pure def canAcknowledge(n: Notice, currentAuthority: bool): bool = n.saved and currentAuthority
pure def acknowledge(n: Notice, currentAuthority: bool): Notice = { ...n, acknowledged: true }
pure def alwaysInboxAvailable(n: Notice): bool = (n.read or n.acknowledged) implies n.saved
// ```

// ### Activity email requires consent for the exact verified destination version

// Opt-in applies to notices saved later. It cannot queue historical notices.
// Opt-out cancels queued mail without erasing Inbox history. Security and private
// case policies are separate from activity consent.

// ```quint
pure def canConsent(n: Notice, verifiedDestination: bool): bool = verifiedDestination and not(n.saved)
pure def consent(n: Notice, verifiedDestination: bool): Notice = { ...n, consent: true, consentVersion: n.destinationVersion }
pure def canChangeDestination(n: Notice): bool = true
pure def changeDestination(n: Notice): Notice = { ...n, destinationVersion: n.destinationVersion + 1, consent: false, delivery: if (n.delivery == Queued) Cancelled else n.delivery }
pure def canOptOut(n: Notice): bool = n.consent
pure def optOut(n: Notice): Notice = { ...n, consent: false, delivery: if (n.delivery == Queued) Cancelled else n.delivery }
pure def canQueue(n: Notice): bool = n.saved and n.delivery == NotQueued and n.consent and n.consentVersion == n.destinationVersion
pure def queue(n: Notice): Notice = { ...n, delivery: Queued }
// ```

// ### Every attempt has one owner and uncertain delivery blocks retries

// The pre-send check revalidates current role, verified destination and consent.
// A provider call already in flight cannot be recalled by a later opt-out.
// The retained security-notification service budget is five attempts, from
// `workers/notify/security.ts` line 59 and `formal/models/api/notification_delivery.qnt`
// at main commit `6b3b9d0b979f0608d87941f1146056a98513ffcf`. This is a source-derived
// service bound. The PRD requirement is bounded retries. An uncertain send consumes its
// attempt and is reconciled before another attempt can start.

// ```quint
pure def canClaim(n: Notice, currentAuthority: bool): bool = currentAuthority and n.consent and n.consentVersion == n.destinationVersion and (n.delivery == Queued or n.delivery == Failed) and n.attempts < 5
pure def claim(n: Notice, currentAuthority: bool): Notice = { ...n, delivery: Preparing, attempts: n.attempts + 1, activeAttempt: n.attempts + 1, knownUnsent: false }
pure def canSend(n: Notice, attempt: int, currentAuthority: bool): bool = n.delivery == Preparing and attempt == n.activeAttempt and currentAuthority and n.consent and n.consentVersion == n.destinationVersion
pure def send(n: Notice, attempt: int, currentAuthority: bool): Notice = { ...n, delivery: Sending }
pure def canRetirePreparation(n: Notice, attempt: int): bool = n.delivery == Preparing and attempt == n.activeAttempt
pure def retirePreparation(n: Notice, attempt: int): Notice = { ...n, delivery: Cancelled }
pure def canAccept(n: Notice, attempt: int): bool = n.delivery == Sending and attempt == n.activeAttempt
pure def accept(n: Notice, attempt: int): Notice = { ...n, delivery: ProviderAccepted }
pure def canReject(n: Notice, attempt: int, nonacceptanceProved: bool): bool = n.delivery == Sending and attempt == n.activeAttempt and nonacceptanceProved
pure def reject(n: Notice, attempt: int, nonacceptanceProved: bool): Notice = { ...n, delivery: Failed, knownUnsent: true }
pure def canLoseResponse(n: Notice, attempt: int): bool = n.delivery == Sending and attempt == n.activeAttempt
pure def loseResponse(n: Notice, attempt: int): Notice = { ...n, delivery: Uncertain }
pure def canProveUnsent(n: Notice, attempt: int, negativeReceipt: bool): bool = n.delivery == Uncertain and attempt == n.activeAttempt and negativeReceipt
pure def proveUnsent(n: Notice, attempt: int, negativeReceipt: bool): Notice = { ...n, delivery: Failed, knownUnsent: true }
pure def canConfirmDelivery(n: Notice, actualReceipt: bool): bool = (n.delivery == ProviderAccepted or n.delivery == Uncertain) and actualReceipt
pure def confirmDelivery(n: Notice, actualReceipt: bool): Notice = { ...n, delivery: Delivered }
pure def canEscalate(n: Notice, overdue: bool, currentBackup: bool): bool = n.saved and currentBackup and (overdue or n.attempts == 5) and n.delivery != Delivered
pure def escalate(n: Notice, overdue: bool, currentBackup: bool): Notice = { ...n, escalated: true }
pure def alwaysAttemptBudget(n: Notice): bool = n.attempts >= 0 and n.attempts <= 5 and n.activeAttempt <= n.attempts
pure def stepNoticeRetained(before: Notice, after: Notice): bool = before.saved implies after.saved
pure def sometimesDelivered(n: Notice): bool = n.delivery == Delivered
pure def sometimesUncertain(n: Notice): bool = n.delivery == Uncertain
pure def sometimesCancelled(n: Notice): bool = n.delivery == Cancelled
// ```

// Stale attempt completions cannot mutate a successor. Generic private email
// contains only the secure Inbox link. Real provider receipt and user
// acknowledgment remain distinct evidence. Failure cannot delete a case or its
// obligation. A future implementation must test changed consent during an outage,
// role revocation during a send, provider ambiguity and backup escalation.

// ### Simulation samples exercise missing, matching and conflicting evidence

// These input sets bound simulation only. The generated guards accept every
// value allowed by their declared types and product rules.

// ```quint
pure val attemptValues = Set(0, 1, 2, 3, 4, 5)
// ```

}
