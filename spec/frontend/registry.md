# Project registry freshness

PRD section 9: a failed refresh shows the last good value labelled stale, never
zero. Before the application renders, the browser reads the project registry
once. Each page then decides from its own registry policy whether it can be
shown with what was read.

## Story: Keep browsing on the last published registry when the live read fails

> As a visitor, I want the site to keep showing projects from the last
> published registry, clearly marked as possibly outdated, when the live
> registry cannot be read, and a page that changes a project to refuse until
> it has current data.

### A failed live registry read installs the last published registry labelled stale with its sync time, and both failing shows the error

The live read is `GET /api/v1/projects`, same-origin, bounded to 4 MiB. It is
valid only with `schemaVersion` "1", a `projects` array and a `restrictions`
array (absent counts as empty) whose entries each name a `projectId`; each
restricted project is installed paused and retired. When that read fails or is
invalid, the browser reads the registry the build published at
`/data/project-registry.json`, also bounded to 4 MiB, valid only with
`schemaVersion` "1", a parseable `syncedAt` and a non-empty `projects` array,
and installs it labelled stale with that `syncedAt`. When both fail it installs
no projects and the error "Projects unavailable", and account pages stay
available. A failed application chunk is a separate error, not a registry
outage: the boot screen says "Slop could not load." with Reload (development
`src/main.tsx` at `67fd54fd4`).

```quint
import navigation as N from "./navigation"
type PublishedRead = PublishedRegistry({ syncedAt: str, projectCount: int }) | PublishedUnavailable
type RegistryFreshness = RegistryCurrent | RegistryStale({ syncedAt: str }) | RegistryFailed
pure def bootRegistry(liveValid: bool, published: PublishedRead): RegistryFreshness =
  if (liveValid) RegistryCurrent
  else match published {
    | PublishedRegistry(p) => if (p.syncedAt != "" and p.projectCount > 0) RegistryStale({ syncedAt: p.syncedAt }) else RegistryFailed
    | _ => RegistryFailed
  }
pure def registryHasProjects(freshness: RegistryFreshness): bool = freshness != RegistryFailed
pure def lawLiveRegistryWins(published: PublishedRead): bool = bootRegistry(true, published) == RegistryCurrent
pure def lawFallbackKeepsItsSyncTime(syncedAt: str): bool =
  syncedAt != "" implies bootRegistry(false, PublishedRegistry({ syncedAt: syncedAt, projectCount: 1 })) == RegistryStale({ syncedAt: syncedAt })
pure def lawBothFailingIsAnError(syncedAt: str): bool =
  bootRegistry(false, PublishedUnavailable) == RegistryFailed and
    bootRegistry(false, PublishedRegistry({ syncedAt: syncedAt, projectCount: 0 })) == RegistryFailed
pure val publishedValues = Set(PublishedRegistry({ syncedAt: "2026-11-15T00:00:00Z", projectCount: 2 }),
  PublishedRegistry({ syncedAt: "", projectCount: 2 }), PublishedRegistry({ syncedAt: "2026-11-15T00:00:00Z", projectCount: 0 }), PublishedUnavailable)
pure val syncedAtValues = Set("", "2026-11-15T00:00:00Z")
```

### A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale

Each route has one registry policy. Independent pages never read it: How it
works, Settings, Log in, Payouts, Inbox, Administration, Add a project, private
vetting evidence, security cases and the two pay pages, which find the pull
request's repository in the registry built into the page (development
`src/SubmissionFeePage.tsx` `feeRepository` at `8660a6121`). Pages that act on a manifest need the
current registry: Manage project and the security program with its report
form. Every other page may show the last good registry. A page is blocked,
with "Projects are unavailable", the reason and Try again, when its policy is
not independent and the registry failed, or when it needs the current registry
and has only a stale one ("This page needs current project data."). An
unblocked page that uses the registry shows the banner "Projects stale ·
<sync time>" with an icon button "Try again" when the registry is stale
(development `src/App.tsx` at `67fd54fd4`).

```quint
type RegistryPolicy = RegistryIndependent | RegistryNeedsCurrent | RegistryCached
pure def registryPolicy(page: N::Page): RegistryPolicy =
  val routed = N::routedPage(page)
  if (routed == N::HowItWorks or routed == N::Settings or routed == N::Login or routed == N::Payouts or
      routed == N::Inbox or routed == N::Administration or routed == N::AddProject or
      routed == N::VettingEvidence or routed == N::SecurityCases or routed == N::SubmissionFee
      or routed == N::ReportDeposit) RegistryIndependent
  else if (routed == N::ManageProject or routed == N::SecurityProgram) RegistryNeedsCurrent
  else RegistryCached
pure def registryStale(freshness: RegistryFreshness): bool = match freshness {
  | RegistryStale(s) => true
  | _ => false
}
pure def registryBlocked(policy: RegistryPolicy, freshness: RegistryFreshness): bool =
  policy != RegistryIndependent and (freshness == RegistryFailed or (registryStale(freshness) and policy == RegistryNeedsCurrent))
pure def staleBannerShown(policy: RegistryPolicy, freshness: RegistryFreshness): bool =
  registryStale(freshness) and policy != RegistryIndependent and not(registryBlocked(policy, freshness))
pure def lawIndependentPagesAreNeverBlocked(freshness: RegistryFreshness): bool =
  not(registryBlocked(RegistryIndependent, freshness))
pure def lawManifestActionsNeedCurrentRegistry(freshness: RegistryFreshness): bool =
  not(registryBlocked(RegistryNeedsCurrent, freshness)) implies freshness == RegistryCurrent
pure def lawStaleRegistryIsLabelledNeverCurrent(policy: RegistryPolicy, freshness: RegistryFreshness): bool =
  (registryStale(freshness) and not(registryBlocked(policy, freshness)) and policy != RegistryIndependent)
    implies staleBannerShown(policy, freshness)
pure def lawPrivatePagesNeedNoRegistry(page: N::Page): bool =
  (N::privatePage(page) and N::routedPage(page) != N::ManageProject and page != N::Report) implies registryPolicy(page) == RegistryIndependent
pure val freshnessValues = Set(RegistryCurrent, RegistryStale({ syncedAt: "2026-11-15T00:00:00Z" }), RegistryFailed)
```
