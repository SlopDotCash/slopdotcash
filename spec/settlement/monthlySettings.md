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
account. Each change carries the sequence it read, so a concurrent change
refuses. Turning the default off after a month's cutoff reopens that month's
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
pure def canSetAutomatic(s: Settings, automatic: bool, expectedSequence: int, authority: SettingsAuthority,
  openCuts: List[CutNotice], now: int): bool =
  mayChange(s, authority) and expectedSequence == s.sequence
    and not(automatic and openCuts.some(notice => noticeCrossesCutoff(notice, now)))
pure def setAutomatic(s: Settings, automatic: bool, expectedSequence: int, authority: SettingsAuthority,
  openCuts: List[CutNotice], now: int): Settings =
  { ...s, automatic: automatic, sequence: s.sequence + 1,
    changes: s.changes.append({ sequence: s.sequence + 1, automatic: automatic, actor: authority.actor }) }
pure def canObserveRevision(s: Settings, revision: int): bool = revision > s.revision
pure def observeRevision(s: Settings, revision: int): Settings = { ...s, revision: revision }
```

### Turning the default on is refused while an open cut notice crosses an unfrozen month's cutoff

The automatic freeze must never lock a cut with less than 24 hours of
notice. For each month of the project with no frozen run, the shell reads the
time of its latest cut and its cutoff in the same transaction that appends
the change. Turning the default on is refused (`cut_notice_window`) while one
of those notices ends after its month's cutoff and has not ended yet; the
owner may finalize that month by hand once the notice is over. Turning the
default off is never refused for this reason. Operator decision of
15 November 2026; development `backend/payments/monthly.ts` (`setAutomatic`).

```quint
import monthly as MO from "./monthly"
type CutNotice = { period: int, latestCutAt: int, cutoff: int }
pure def noticeCrossesCutoff(notice: CutNotice, now: int): bool =
  notice.latestCutAt + MO::cutNoticeSeconds > notice.cutoff and now < notice.latestCutAt + MO::cutNoticeSeconds
pure val openCutsValues = Set(List(), List({ period: 202611, latestCutAt: 1796300000, cutoff: 1796342400 }))
pure val nowValues = Set(1796300000, 1796390000)
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
