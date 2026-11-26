# Trace licensing consent records

Consent records for licensing one member's uploaded traces under the private
trace privacy contracts (v2 operator decision of 22 November 2026; v3 operator
decision of 23 November 2026). The pinned sources are migrations
`0148_trace_licensing.sql` and `0151_trace_terms_v3.sql`,
`apps/contributor/src/traces/licensing.vibe`,
`apps/contributor/src/traces/store.vibe`,
`apps/backend/src/accounts/store/store.vibe`,
`apps/operations/src/notifications/traceLicensing.vibe`, and the legacy model
`formal/models/api/api_trace_licensing.qnt`.

One machine instance models one contributor's account licensing setting,
confirmation terms version, account closure and participation-ban flags, and
two trace slots.

## Story: Record account licensing consent and trace licences across contract versions

> As a contributor, I want paid trace licensing to stay off until I opt in,
> require re-confirmation under v3 before licensing v3 uploads, withdraw every
> unsold licence when I turn it off or close my account, and refuse stale bulk
> counts or banned writes.

### Upload licences follow the active setting, ban status and confirmed terms version

A run finalizes once; a missing client terms version reads as v1. A v2 run
finalized while the account setting is on and the account is not banned receives
an upload licence (`BasisUpload`) together with its granted event. A v3 run
requires the same and that the setting's latest confirmation was given under v3.
A v1 run is never licensed on upload.

```quint
type TermsVersion = TermsV1 | TermsV2 | TermsV3
type ConfirmedVersion = NoConfirmation | ConfirmedV2 | ConfirmedV3
type LicenceState = LicenceNone | LicenceActive | LicenceWithdrawn
type LicenceEventKind = NoLicenceEvent | GrantedEvent | WithdrawnEvent
type LicenceBasis = BasisNone | BasisUpload | BasisOptIn
type TraceRecord = { finalized: bool, version: TermsVersion, licence: LicenceState, lastEvent: LicenceEventKind, basis: LicenceBasis }
type Licensing = { on: bool, confirmed: ConfirmedVersion, closed: bool, banned: bool, trace1: TraceRecord, trace2: TraceRecord, wrote: bool }
pure val emptyTrace: TraceRecord = { finalized: false, version: TermsV1, licence: LicenceNone, lastEvent: NoLicenceEvent, basis: BasisNone }
pure val initial: Licensing = { on: false, confirmed: NoConfirmation, closed: false, banned: false, trace1: emptyTrace, trace2: emptyTrace, wrote: false }
pure def traceAt(l: Licensing, slot: int): TraceRecord = if (slot == 1) l.trace1 else l.trace2
pure def withTrace(slot: int, t: TraceRecord, l: Licensing): Licensing =
  if (slot == 1) { ...l, trace1: t } else { ...l, trace2: t }
pure def licensedCount(l: Licensing): int =
  (if (l.trace1.licence == LicenceActive) 1 else 0) + (if (l.trace2.licence == LicenceActive) 1 else 0)
pure def eligible(t: TraceRecord, c: ConfirmedVersion): bool =
  t.finalized and t.licence != LicenceActive and (t.version != TermsV3 or c == ConfirmedV3)
pure def eligibleCount(l: Licensing): int =
  (if (eligible(l.trace1, l.confirmed)) 1 else 0) + (if (eligible(l.trace2, l.confirmed)) 1 else 0)
pure def withdrawTrace(t: TraceRecord): TraceRecord =
  if (t.licence == LicenceActive) { ...t, licence: LicenceWithdrawn, lastEvent: WithdrawnEvent } else t
pure def canFinalize(l: Licensing, slot: int, version: TermsVersion): bool =
  (slot == 1 or slot == 2) and not(traceAt(l, slot).finalized)
pure def finalize(l: Licensing, slot: int, version: TermsVersion): Licensing =
  val t = traceAt(l, slot)
  val nextTrace = if (l.on and not(l.banned) and (version == TermsV2 or (version == TermsV3 and l.confirmed == ConfirmedV3)))
    { finalized: true, version: version, licence: LicenceActive, lastEvent: GrantedEvent, basis: BasisUpload }
  else { ...t, finalized: true, version: version }
  { ...withTrace(slot, nextTrace, l), wrote: false }
pure def alwaysLicenceBacked(l: Licensing): bool =
  (l.trace1.licence == LicenceActive implies (l.trace1.lastEvent == GrantedEvent and l.trace1.finalized))
    and (l.trace2.licence == LicenceActive implies (l.trace2.lastEvent == GrantedEvent and l.trace2.finalized))
    and (not(l.trace1.finalized) implies l.trace1.basis == BasisNone)
    and (not(l.trace2.finalized) implies l.trace2.basis == BasisNone)
pure def alwaysGrantBacked(l: Licensing): bool =
  (l.trace1.lastEvent == GrantedEvent implies l.trace1.licence == LicenceActive)
    and (l.trace2.lastEvent == GrantedEvent implies l.trace2.licence == LicenceActive)
pure def alwaysUploadBasisIsV2OrV3(l: Licensing): bool =
  (l.trace1.basis == BasisUpload implies (l.trace1.version == TermsV2 or l.trace1.version == TermsV3))
    and (l.trace2.basis == BasisUpload implies (l.trace2.version == TermsV2 or l.trace2.version == TermsV3))
pure def sometimesUploadLicensed(l: Licensing): bool =
  l.trace1.licence == LicenceActive and l.trace1.basis == BasisUpload
```

### Enabling, v3 re-confirmation, disabling, closure and bans enforce consent boundaries

Enabling is refused when closed or banned and records confirmation under v3.
An earlier v2 enable (recorded before v3 shipped) confirmed under v2 without
covering v3 traces; while on under v2, re-confirming records a v3 confirmation
event without changing existing licences. A no-op toggle writes nothing.
Disabling is allowed even for a banned account and withdraws every active
licence. Closing an account turns licensing off and withdraws every active
licence, writing an account event only when the setting was on or a licence
existed; reopening restores neither. Placing a ban leaves existing licences in
place while refusing new enables and opt-ins.

```quint
pure def canEnable(l: Licensing): bool = not(l.closed) and not(l.banned) and not(l.on)
pure def enable(l: Licensing): Licensing = { ...l, on: true, confirmed: ConfirmedV3, wrote: true }
pure def canEnableUnderV2(l: Licensing): bool = not(l.closed) and not(l.banned) and not(l.on) and l.confirmed != ConfirmedV3
pure def enableUnderV2(l: Licensing): Licensing = { ...l, on: true, confirmed: ConfirmedV2, wrote: true }
pure def canReconfirm(l: Licensing): bool = l.on and not(l.closed) and not(l.banned) and l.confirmed != ConfirmedV3
pure def reconfirm(l: Licensing): Licensing = { ...l, confirmed: ConfirmedV3, wrote: true }
pure def canNoopToggle(l: Licensing): bool = not(l.closed)
pure def noopToggle(l: Licensing): Licensing = { ...l, wrote: false }
pure def canDisable(l: Licensing): bool = not(l.closed) and l.on
pure def disable(l: Licensing): Licensing =
  { ...l, trace1: withdrawTrace(l.trace1), trace2: withdrawTrace(l.trace2), on: false, wrote: true }
pure def canClose(l: Licensing): bool = not(l.closed)
pure def close(l: Licensing): Licensing =
  { ...l, trace1: withdrawTrace(l.trace1), trace2: withdrawTrace(l.trace2), closed: true, on: false, wrote: l.on or licensedCount(l) > 0 }
pure def canReopen(l: Licensing): bool = l.closed
pure def reopen(l: Licensing): Licensing = { ...l, closed: false, wrote: false }
pure def canBan(l: Licensing): bool = not(l.banned)
pure def ban(l: Licensing): Licensing = { ...l, banned: true, wrote: false }
pure def alwaysLicensedNeedsConsent(l: Licensing): bool =
  (l.trace1.licence == LicenceActive implies (l.on and not(l.closed)))
    and (l.trace2.licence == LicenceActive implies (l.on and not(l.closed)))
pure def alwaysV3UploadNeedsV3Confirmation(l: Licensing): bool =
  ((l.trace1.basis == BasisUpload and l.trace1.version == TermsV3) implies l.confirmed == ConfirmedV3)
    and ((l.trace2.basis == BasisUpload and l.trace2.version == TermsV3) implies l.confirmed == ConfirmedV3)
pure def alwaysV3LicenceNeedsV3Confirmation(l: Licensing): bool =
  ((l.trace1.licence == LicenceActive and l.trace1.version == TermsV3) implies l.confirmed == ConfirmedV3)
    and ((l.trace2.licence == LicenceActive and l.trace2.version == TermsV3) implies l.confirmed == ConfirmedV3)
pure def alwaysClosedHoldsNothing(l: Licensing): bool =
  l.closed implies (not(l.on) and licensedCount(l) == 0)
pure def sometimesWithdrawnOnDisable(l: Licensing): bool =
  not(l.on) and l.trace1.licence == LicenceWithdrawn and l.trace1.lastEvent == WithdrawnEvent
pure def sometimesReconfirmedV3(l: Licensing): bool =
  l.confirmed == ConfirmedV3 and l.trace1.version == TermsV3 and l.trace1.licence == LicenceActive
pure def sometimesClosedAndReopened(l: Licensing): bool =
  not(l.closed) and not(l.on) and l.trace1.licence == LicenceWithdrawn
```

### Explicit opt-in requires active licensing, matching bulk count and v3 confirmation for v3 traces

Single-trace and bulk opt-ins succeed only while the setting is on and the
account is neither closed nor banned. A bulk opt-in whose expected count
differs from the current eligible count (`count_changed`), or any opt-in when
licensing is off, closed or banned, is refused and writes nothing. Choosing a
finalized v3 trace before confirming under v3 is refused (`confirm_again`) and
writes nothing.

```quint
pure def canOptIn(l: Licensing, slot: int): bool =
  (slot == 1 or slot == 2) and l.on and not(l.closed) and not(l.banned) and eligible(traceAt(l, slot), l.confirmed)
pure def optIn(l: Licensing, slot: int): Licensing =
  val t = traceAt(l, slot)
  { ...withTrace(slot, { ...t, licence: LicenceActive, lastEvent: GrantedEvent, basis: BasisOptIn }, l), wrote: true }
pure def canOptInAll(l: Licensing, expected: int): bool =
  l.on and not(l.closed) and not(l.banned) and expected == eligibleCount(l) and expected > 0
pure def optInAll(l: Licensing, expected: int): Licensing =
  val next1 = if (eligible(l.trace1, l.confirmed)) { ...l.trace1, licence: LicenceActive, lastEvent: GrantedEvent, basis: BasisOptIn } else l.trace1
  val next2 = if (eligible(l.trace2, l.confirmed)) { ...l.trace2, licence: LicenceActive, lastEvent: GrantedEvent, basis: BasisOptIn } else l.trace2
  { ...l, trace1: next1, trace2: next2, wrote: true }
pure def canOptInRefused(l: Licensing, expected: int): bool =
  expected != eligibleCount(l) or not(l.on) or l.closed or l.banned
pure def optInRefused(l: Licensing, expected: int): Licensing = { ...l, wrote: false }
pure def canOptInNeedsConfirm(l: Licensing, slot: int): bool =
  (slot == 1 or slot == 2) and l.on and traceAt(l, slot).finalized and traceAt(l, slot).version == TermsV3 and l.confirmed != ConfirmedV3
pure def optInNeedsConfirm(l: Licensing, slot: int): Licensing = { ...l, wrote: false }
pure def sometimesOptedIn(l: Licensing): bool =
  l.trace1.licence == LicenceActive and l.trace1.basis == BasisOptIn
pure val slotValues = Set(1, 2)
pure val expectedValues = Set(0, 1, 2)
```
