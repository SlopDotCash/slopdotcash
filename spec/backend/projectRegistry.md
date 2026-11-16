# Registry-wide repository identity and restriction binding

PRD sections 4 and 8. The D1 registry (`project_repositories`) makes each
repository's permanent GitHub id unique across every project, and a
restriction binds the repository id and every repository path it was listed
under (`restrictionForRepository` and `publicRestrictionOf` in
`backend/projects/enforcement.ts`). This machine holds those cross-project
facts; each project's own lifecycle is the [project registry](./projects.md).
The composition reads it as the `RegistryRead` of a repository, and the
listing, collection and Slopbot views read its `Closure` of a project.

Every event here is written by the project API inside the same D1 batch as
the project action that causes it: a claim with creation, publication or an
append; a restriction with a moderator quarantine or ban or a malicious
result; a release with a reinstatement. The shell supplies the sender `-1`
(`platform`) only inside such a batch, never for an HTTP request, so no
request can claim, restrict or release on its own (composition obligation in
the area report).

## Story: One repository belongs to one project and a restriction follows the repository

### Each permanent repository id and each path key belongs to at most one project

Paths are lowercase `owner/name` keys, including transfer aliases. A legacy
row from before the uniqueness index can still share a path with another
project; it is kept, never rewritten.

```quint
type Claim = { project: int, repository: int, path: int }
type Restriction = { project: int, episode: int }
type Repositories = { claims: List[Claim], restrictions: List[Restriction], released: List[Restriction] }
pure val platform = -1
pure val initial: Repositories = { claims: List({ project: 1, repository: 1, path: 10 }, { project: 2, repository: 2, path: 10 }),
  restrictions: List(), released: List() }
pure def repositoryListed(r: Repositories, repository: int): bool = r.claims.some(c => c.repository == repository)
pure def pathListed(r: Repositories, path: int): bool = r.claims.some(c => c.path == path)
pure def active(r: Repositories, x: Restriction): bool = not(r.released.includes(x))
pure def boundBy(r: Repositories, x: Restriction, c: Claim): bool = active(r, x) and c.project == x.project
pure def repositoryRestricted(r: Repositories, repository: int): bool =
  r.restrictions.some(x => r.claims.some(c => boundBy(r, x, c) and c.repository == repository))
pure def pathRestricted(r: Repositories, path: int): bool =
  r.restrictions.some(x => r.claims.some(c => boundBy(r, x, c) and c.path == path))
pure def alwaysRepositoryIdsUnique(r: Repositories): bool =
  r.claims.every(a => r.claims.every(b => a.repository == b.repository implies a.project == b.project))
pure def alwaysClaimsValid(r: Repositories): bool = r.claims.every(c => c.project > 0 and c.repository > 0 and c.path > 0)
```

### A new or appended repository must be unlisted and unrestricted by id and path

Creation, stored-application publication and appends refuse a repository id
or path that any project, this one included, already lists, and any that an
active restriction binds (`registry_conflict`).

```quint
pure def canClaim(r: Repositories, by: int, project: int, repository: int, path: int): bool =
  by == platform and project > 0 and repository > 0 and path > 0 and not(repositoryListed(r, repository)) and not(pathListed(r, path)) and
  not(repositoryRestricted(r, repository)) and not(pathRestricted(r, path)) and
  not(r.restrictions.some(x => active(r, x) and x.project == project))
pure def claim(r: Repositories, by: int, project: int, repository: int, path: int): Repositories =
  { ...r, claims: r.claims.append({ project: project, repository: repository, path: path }) }
pure val projectValues = Set(1, 2, 3)
pure val repositoryValues = Set(1, 2, 3)
pure val pathValues = Set(10, 11, 12)
```

### A restriction binds every claim of its project and closes any project sharing them

The restricted project is the source an appeal names. A restriction binds
every repository id and path its project claims; the project cannot append
while restricted. Another project listing the same repository or path closes
on public routes with it. Reinstatement of the source releases that episode;
the records stay. Each restriction episode is numbered, so a later
restriction of the same project is a new binding.

```quint
pure def canRestrict(r: Repositories, by: int, project: int): bool =
  by == platform and r.claims.some(c => c.project == project) and not(r.restrictions.some(x => active(r, x) and x.project == project))
pure def restrict(r: Repositories, by: int, project: int): Repositories =
  { ...r, restrictions: r.restrictions.append({ project: project, episode: r.restrictions.length() + 1 }) }
pure def canRelease(r: Repositories, by: int, project: int, episode: int): bool =
  by == platform and r.restrictions.includes({ project: project, episode: episode }) and active(r, { project: project, episode: episode })
pure def release(r: Repositories, by: int, project: int, episode: int): Repositories =
  { ...r, released: r.released.append({ project: project, episode: episode }) }
pure val episodeValues = Set(1, 2)
pure def closed(r: Repositories, project: int): bool =
  r.claims.some(c => c.project == project and (repositoryRestricted(r, c.repository) or pathRestricted(r, c.path)))
pure def sourceOf(r: Repositories, project: int): int =
  r.restrictions.foldl(0, (found, x) => if (found == 0 and r.claims.some(c => boundBy(r, x, c) and
    r.claims.some(d => d.project == project and (d.repository == c.repository or d.path == c.path)))) x.project else found)
type Closure = { project: int, source: int }
pure def closureOf(r: Repositories, project: int): Closure = { project: project, source: sourceOf(r, project) }
pure val byValues = Set(-1, 1)
pure def stepRecordsRetained(before: Repositories, after: Repositories): bool =
  before.claims.every(c => after.claims.includes(c)) and before.restrictions.every(x => after.restrictions.includes(x)) and
  before.released.every(x => after.released.includes(x))
pure def alwaysRestrictionsHaveClaims(r: Repositories): bool =
  r.restrictions.every(x => x.episode > 0 and x.episode <= r.restrictions.length() and r.claims.some(c => c.project == x.project))
pure def alwaysReleasedWereRestrictions(r: Repositories): bool = r.released.every(x => r.restrictions.includes(x))
pure def alwaysRestrictedProjectClosed(r: Repositories): bool =
  r.restrictions.every(x => active(r, x) implies closed(r, x.project))
pure def sometimesSharedPathClosed(r: Repositories): bool = closed(r, 2) and closureOf(r, 2).source == 1
pure def sometimesReleased(r: Repositories): bool = r.released.length() > 0 and not(closed(r, 1))
pure def sometimesAppendedClaim(r: Repositories): bool = r.claims.length() > 2
```
