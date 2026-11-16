# Slopbot repository identity and review scope

PRD sections 5 and 8 limit Slopbot to registered repositories, keep security
review for paused, flagged, quarantined and banned projects, and give a
retired project no new review. CLAUDE.md requires permanent repository and
actor IDs. Source is `workers/slopbot/registry.ts`,
`src/lib/project-capabilities.mjs` and `backend/notifications/events.ts`
(`projectsServedByInstallation`) at the pinned development revision.

This library derives one scope from a typed registry observation. The
[project registry](../backend/projects.md) and the
[enforcement record](../security/enforcement.md) own the facts. The
project composition supplies them as a `RegistryObservation` read from the
live D1 registry, never from a webhook payload or the release snapshot. The
[webhook](./webhookDelivery.md), [routing](./routing.md),
[value requests](./valueRequests.md) and
[historical import](./historicalImport.md) units consume the derived scope.

## Story: A repository answers only to its permanent identity

### A current path lookup must also match the permanent repository ID

The registry looks a repository up by its current lowercase `owner/repo`
path. The path names a candidate, and the permanent GitHub repository ID
decides. The first repository's ID is the project authority. An appended
repository carries its own ID. A former path kept as an alias is history.
It never authorizes review of whatever repository now holds that name.
A renamed or transferred repository is reviewed only after an immutable
project revision records its new current path. Until then it is
unregistered for review, and its history remains readable by permanent ID.

```quint
import installation as I from "./installation"
type Restriction = Clear | Quarantined | Banned | RestrictionUnknown
type FlagState = NotFlagged | Flagged | FlagUnknown
type Retirement = NotRetired | OwnerRetired | RestrictionRetired | RetirementProofUnavailable
type LookupMatch = NoRow | CurrentPath | AliasOnly
type RegistryObservation = { lookup: LookupMatch, registeredId: int, observedId: int, rowActive: bool,
  manifestActive: bool, retirement: Retirement, restriction: Restriction, flags: FlagState }
type Scope = Unregistered | Contributor | SecurityOnly | ReversalOnly
pure def identityMatches(o: RegistryObservation): bool =
  o.lookup == CurrentPath and o.registeredId > 0 and o.observedId == o.registeredId
pure def lawReusedNameIsUnregistered(o: RegistryObservation): bool =
  (o.lookup == CurrentPath and o.observedId != o.registeredId) implies not(identityMatches(o))
pure def lawAliasNeverIdentifies(o: RegistryObservation): bool =
  o.lookup == AliasOnly implies not(identityMatches(o))
```

### Scope follows registration, status, retirement and restriction in a fixed order

Contributor scope needs an active row, an active manifest, no retirement,
a clear restriction and no flag pause. Both the D1 row status and the
manifest status must say active. A paused, flagged or restricted project
keeps security-only review while it stays listed. A quarantine or ban that
retired the listing keeps security-only review. Only an owner's retirement
ends review. Missing revision proof for a retirement counts as the owner's
retirement, which is the fail-safe direction. A retired project still
permits the reversal of an existing debit through an appeal, a maintainer
reopen or a moderator decision, and nothing else.

```quint
pure def contributorOpen(o: RegistryObservation): bool =
  o.rowActive and o.manifestActive and o.retirement == NotRetired and o.restriction == Clear
    and o.flags == NotFlagged
pure def securityOpen(o: RegistryObservation): bool =
  o.retirement == NotRetired or o.retirement == RestrictionRetired
pure def slopbotScope(o: RegistryObservation): Scope =
  if (not(identityMatches(o))) Unregistered
  else if (contributorOpen(o)) Contributor
  else if (securityOpen(o)) SecurityOnly
  else ReversalOnly
pure def mayAssessValue(scope: Scope): bool = scope == Contributor
pure def mayReview(scope: Scope): bool = scope == Contributor or scope == SecurityOnly
pure def mayReverseOnly(scope: Scope): bool = scope == ReversalOnly
pure def lawUnregisteredHasNoAuthority(o: RegistryObservation): bool =
  not(identityMatches(o)) implies (slopbotScope(o) == Unregistered and not(mayReview(slopbotScope(o)))
    and not(mayReverseOnly(slopbotScope(o))))
pure def lawPausedIsSecurityOnly(o: RegistryObservation): bool =
  (identityMatches(o) and o.retirement == NotRetired and (not(o.rowActive) or not(o.manifestActive)))
    implies slopbotScope(o) == SecurityOnly
pure def lawRowAndManifestMustAgree(o: RegistryObservation): bool =
  (o.rowActive != o.manifestActive) implies slopbotScope(o) != Contributor
pure def lawRestrictionRetiredKeepsSecurity(o: RegistryObservation): bool =
  (identityMatches(o) and o.retirement == RestrictionRetired) implies slopbotScope(o) == SecurityOnly
pure def lawOwnerRetiredReversalOnly(o: RegistryObservation): bool =
  (identityMatches(o) and o.retirement == OwnerRetired) implies slopbotScope(o) == ReversalOnly
pure def lawMissingRetirementProofFailsSafe(o: RegistryObservation): bool =
  (identityMatches(o) and o.retirement == RetirementProofUnavailable) implies slopbotScope(o) == ReversalOnly
pure def lawUnknownRestrictionOrFlagIsNotContributor(o: RegistryObservation): bool =
  (o.restriction == RestrictionUnknown or o.flags == FlagUnknown) implies slopbotScope(o) != Contributor
pure def lawOnlyContributorScopeAssessesValue(o: RegistryObservation): bool =
  mayAssessValue(slopbotScope(o)) iff (identityMatches(o) and contributorOpen(o))
```

### Installed, public and registered are separate conditions

A review, a value assessment and a GitHub write each need the derived scope
and an active installation of the exact repository, and the repository must
be public. The installation row is the [installation](./installation.md)
machine's own state. Visibility and coverage come from GitHub's repository
read through that installation's token, which the shell performs: a
repository the token cannot read is not covered, and an unreadable
visibility is unknown, which never counts as public. Installation access
alone never authorizes review. Registration alone never proves
installation. A repository transferred to another account needs that
account's installation to be active.

```quint
type Visibility = PublicRepo | PrivateRepo | VisibilityUnknown
type Authority = { scope: Scope, install: I::Installation, tokenReadsRepository: bool, visibility: Visibility }
pure def installed(a: Authority): bool = I::active(a.install) and a.tokenReadsRepository and a.visibility == PublicRepo
pure def mayWrite(a: Authority): bool = mayReview(a.scope) and installed(a)
pure def mayValue(a: Authority): bool = mayAssessValue(a.scope) and installed(a)
pure def lawInstallationAloneNeverAuthorizes(a: Authority): bool =
  a.scope == Unregistered implies not(mayWrite(a)) and not(mayValue(a))
pure def lawInactiveInstallationNeverAuthorizes(a: Authority): bool =
  not(I::active(a.install)) implies not(mayWrite(a)) and not(mayValue(a))
pure def lawOnlyPublicRepositoryAuthorizes(a: Authority): bool =
  a.visibility != PublicRepo implies not(mayWrite(a)) and not(mayValue(a))
```

### Samples cover each lookup, retirement and restriction

```quint
pure val activeObservation: RegistryObservation = { lookup: CurrentPath, registeredId: 1, observedId: 1,
  rowActive: true, manifestActive: true, retirement: NotRetired, restriction: Clear, flags: NotFlagged }
pure val oValues = Set(activeObservation, { ...activeObservation, observedId: 2 },
  { ...activeObservation, lookup: AliasOnly }, { ...activeObservation, lookup: NoRow, registeredId: 0 },
  { ...activeObservation, rowActive: false }, { ...activeObservation, manifestActive: false },
  { ...activeObservation, retirement: OwnerRetired }, { ...activeObservation, retirement: RestrictionRetired },
  { ...activeObservation, retirement: RetirementProofUnavailable }, { ...activeObservation, restriction: Banned },
  { ...activeObservation, restriction: RestrictionUnknown }, { ...activeObservation, flags: Flagged },
  { ...activeObservation, flags: FlagUnknown })
pure val activeInstall: I::Installation = { ...I::initial, known: true, sourceTime: 1 }
pure val fullAuthority: Authority = { scope: Contributor, install: activeInstall, tokenReadsRepository: true,
  visibility: PublicRepo }
pure val aValues = Set(fullAuthority, { ...fullAuthority, scope: Unregistered },
  { ...fullAuthority, scope: SecurityOnly }, { ...fullAuthority, scope: ReversalOnly },
  { ...fullAuthority, install: { ...activeInstall, suspended: true } }, { ...fullAuthority, install: I::initial },
  { ...fullAuthority, tokenReadsRepository: false }, { ...fullAuthority, visibility: PrivateRepo },
  { ...fullAuthority, visibility: VisibilityUnknown })
```
