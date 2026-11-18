# Project monthly payment settings

PRD section 6: automatic monthly payment is the default for every project
with funds committed in its vault; the owner can turn the default off and on
again. The setting is project-level and versioned, so every month reads the
latest value at its own boundary. Source anchors are development
`backend/payments/monthly.ts` (`setAutomatic`, `automaticMonthlyPayment`),
`backend/payments/README.md` step 2 and the `monthly_payment_settings` table
keyed by project and sequence. [Monthly allocations](./monthly.md) observes
each new `{automatic, sequence}` pair.

## Story: Change the automatic default with current authority

### The default starts on, and each change appends the next sequence

Only the project owner, steward or a current repository administrator may
change it, never write or maintain permission alone and never a banned
account. Turning the default on carries the sequence it read, so a
concurrent change refuses it; turning it off is accepted whatever sequence it
read, so even a later saved change never keeps an opt-out from being stored
(development `setAutomatic`: an enable's sequence is checked, an opt-out's
is not). Turning the default on is also refused, storing nothing, while one
of the project's unfrozen months has a cut whose 24-hour notice ends after
that month's cutoff and has not yet ended (`cut_notice_window`, operator
decision of 15 November 2026): the shell reads the latest cut of each
unfrozen month and passes `lateCutNotice` when
[monthly allocations](./monthly.md) `lateCutNoticeAt` holds for any of them.
Turning the default off after a month's cutoff reopens that month's
adjustments; turning it on again closes them.

```quint
type SettingsRole = SettingsOwner | SettingsSteward | SettingsAdmin | SettingsWriter | SettingsNone
type SettingsAuthority = { actor: int, role: SettingsRole, banned: bool, revision: int }
type Change = { sequence: int, automatic: bool, actor: int }
type Settings = { project: str, revision: int, automatic: bool, sequence: int, changes: List[Change] }
pure val initial: Settings = { project: "eliza", revision: 1, automatic: true, sequence: 0, changes: List() }
pure def mayChange(s: Settings, authority: SettingsAuthority): bool =
  (authority.role == SettingsOwner or authority.role == SettingsSteward or authority.role == SettingsAdmin)
    and not(authority.banned) and authority.actor > 0 and authority.revision == s.revision
pure def canSetAutomatic(s: Settings, automatic: bool, expectedSequence: int, authority: SettingsAuthority, lateCutNotice: bool): bool =
  mayChange(s, authority) and (not(automatic) or expectedSequence == s.sequence) and not(automatic and lateCutNotice)
pure def setAutomatic(s: Settings, automatic: bool, expectedSequence: int, authority: SettingsAuthority, lateCutNotice: bool): Settings =
  { ...s, automatic: automatic, sequence: s.sequence + 1,
    changes: s.changes.append({ sequence: s.sequence + 1, automatic: automatic, actor: authority.actor }) }
pure def canObserveRevision(s: Settings, revision: int): bool = revision > s.revision
pure def observeRevision(s: Settings, revision: int): Settings = { ...s, revision: revision }
```

### The journal is append-only and the current value is its last entry

```quint
pure def alwaysCurrentIsLast(s: Settings): bool =
  s.sequence == s.changes.length() and (s.changes.length() == 0 implies s.automatic)
    and (s.changes.length() > 0 implies s.changes.nthOr(s.changes.length() - 1, { sequence: 0, automatic: true, actor: 0 }).automatic == s.automatic)
pure def stepAppendOnly(before: Settings, after: Settings): bool =
  after.sequence >= before.sequence and before.changes.every(c => after.changes.includes(c))
pure def sometimesTurnedOffAndOn(s: Settings): bool = s.automatic and s.sequence >= 2
pure def sometimesOff(s: Settings): bool = not(s.automatic)
```

### Simulation samples

```quint
pure val automaticValues = Set(true, false)
pure val expectedSequenceValues = Set(0, 1, 2)
pure val revisionValues = Set(2)
pure val authorityValues = Set({ actor: 1, role: SettingsOwner, banned: false, revision: 1 },
  { actor: 2, role: SettingsWriter, banned: false, revision: 1 }, { actor: 1, role: SettingsOwner, banned: true, revision: 1 },
  { actor: 3, role: SettingsAdmin, banned: false, revision: 2 })
```
