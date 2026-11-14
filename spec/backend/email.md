# Account-bound email enrollment

This model covers PRD sections 3 and 9. The transport validates addresses and
stores a digest of a high-entropy token. Plaintext tokens and email bodies stay
outside public projections. Provider delivery is distinct from enrollment.

## Story: Verify a notification address and choose consent

The account owner verifies their own address, chooses security and activity
consent independently, and may unsubscribe without gaining account authority.

### Enrollment keeps pending and verified addresses separate

```quint
type Enrollment = { actor: int, verifiedAddress: str, pendingAddress: str,
  tokenDigest: str, expiresAt: int, consumed: bool, now: int,
  securityConsent: bool, activityConsent: bool, notices: int }
pure def newEnrollment(actorId: int): Enrollment = { actor: actorId, verifiedAddress: "", pendingAddress: "",
  tokenDigest: "", expiresAt: 0, consumed: false, now: 0,
  securityConsent: false, activityConsent: false, notices: 0 }
pure val initial: Enrollment = newEnrollment(1)
pure def alwaysEnrollmentTimes(e: Enrollment): bool = e.now >= 0 and e.expiresAt >= 0 and e.notices >= 0
```

### Only the authenticated owner can create a pending verification

```quint
pure def canEnroll(e: Enrollment, by: int, address: str, digest: str, expiresAt: int): bool =
  by == e.actor and address != "" and digest != "" and expiresAt > e.now
pure def enroll(e: Enrollment, by: int, address: str, digest: str, expiresAt: int): Enrollment =
  { ...e, pendingAddress: address, tokenDigest: digest, expiresAt: expiresAt, consumed: false }
pure def canAdvanceTime(e: Enrollment, now: int): bool = now >= e.now
pure def advanceTime(e: Enrollment, now: int): Enrollment = { ...e, now: now }
```

### Verification is account-bound, single-use, and unexpired

```quint
pure def canVerify(e: Enrollment, by: int, digest: str): bool =
  by == e.actor and e.pendingAddress != "" and digest == e.tokenDigest and
  digest != "" and not(e.consumed) and e.now < e.expiresAt
pure def verify(e: Enrollment, by: int, digest: str): Enrollment =
  { ...e, verifiedAddress: e.pendingAddress, pendingAddress: "", consumed: true,
    securityConsent: if (e.pendingAddress == e.verifiedAddress) e.securityConsent else false,
    activityConsent: if (e.pendingAddress == e.verifiedAddress) e.activityConsent else false }
pure def canSetConsent(e: Enrollment, by: int, security: bool, activity: bool): bool =
  by == e.actor and e.verifiedAddress != ""
pure def setConsent(e: Enrollment, by: int, security: bool, activity: bool): Enrollment =
  { ...e, securityConsent: security, activityConsent: activity }
```

### A changed verified address requires fresh consent

Discovered by review: carrying consent from the old destination to a newly
verified address would authorize delivery without consent for that address.

```quint
pure def stepChangedAddressClearsConsent(before: Enrollment, via: str, after: Enrollment): bool =
  (via == "verify" and before.verifiedAddress != after.verifiedAddress) implies
    not(after.securityConsent) and not(after.activityConsent)
```

### Unsubscribe only removes consent and in-app notices remain independent

The verified unsubscribe token is scoped to this account and category. It has
no authority to read a case or mutate account identity.

```quint
pure def canUnsubscribe(e: Enrollment, tokenVerified: bool, security: bool): bool = tokenVerified
pure def unsubscribe(e: Enrollment, tokenVerified: bool, security: bool): Enrollment =
  { ...e, securityConsent: if (security) false else e.securityConsent,
    activityConsent: if (security) e.activityConsent else false }
pure def addNotice(e: Enrollment): Enrollment = { ...e, notices: e.notices + 1 }
pure def sometimesVerified(e: Enrollment): bool = e.verifiedAddress != "" and e.consumed
pure def sometimesBothConsent(e: Enrollment): bool = e.securityConsent and e.activityConsent
pure def sometimesIndependentNotice(e: Enrollment): bool = e.notices > 0 and not(e.securityConsent) and not(e.activityConsent)
```

### Account closure withdraws both email consents and cancels pending verification

The account aggregate calls this transition in the same commit as closure.
A revoked pending token cannot verify after reopening. The verified destination
and in-app notice history remain stored. The notification adapter cancels
queued mail for both withdrawn categories as part of closure and rechecks
consent before a later send. Withdrawal does not erase provider delivery history.

```quint
pure def canCloseEnrollment(e: Enrollment, by: int, closureConfirmed: bool): bool =
  by == e.actor and closureConfirmed
pure def closeEnrollment(e: Enrollment, by: int, closureConfirmed: bool): Enrollment =
  { ...e, pendingAddress: "", tokenDigest: "", expiresAt: 0, consumed: false,
    securityConsent: false, activityConsent: false }
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val addressValues = Set("", "a", "b")
pure val byValues = Set(0, 1, 2)
pure val digestValues = Set("", "a", "b")
pure val expiresAtValues = Set(0, 1, 2)
pure val nowValues = Set(0, 1, 2)
```
