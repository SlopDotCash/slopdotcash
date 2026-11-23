# Requested repos

PRD section 11, "Requested repos" (operator decision, 22 November 2026;
`docs/slop-product-requirements.md` line 957). Sources at development
`f3f2725e0`, byte-identical on main `b2aa3f920`:
`backend/referrals/repo-requests.ts`, `src/lib/repo-requests.ts`,
`migrations/0147_repo_requests.sql` and
`formal/models/referrals/repo_request.qnt`. A signed-in member with merged
work on Slop flags a public GitHub repository that is not on Slop as one they
would work on. `GET /api/v1/repo-requests` is the public board; `POST` on the
same path flags, renews or withdraws one flag. Any other path falls through to
the next route.

Slop reads the repository once on GitHub per flag and never writes to
GitHub. Flagging earns nothing and records no referrer: a pitch on the board
carries the viewer's own referral link, and the capture rules of
[the public referred project list](./referralProjects.md) and project
registration are unchanged. The contributor skill
(`skills/project-contributor-template/SKILL.md`, "Suggest a repo") may give
its operator one `/requested?flag=<owner>/<name>` link a session; the agent
never flags, comments, opens an issue or pull request, or mentions Slop on
that repository.

## Story: Flag a repository a member would work on

> As a member with merged work on Slop, I want to flag a public repository
> that is not on Slop so that its maintainers see that contributors would
> work on it.

### Only a member with merged work flags a public, original, unarchived repository that is not theirs and not on Slop

The shell computes every fact of `FlagFacts`; none is a request field.
`merged` is true when a head Points revision (one with no successor) of the
member's `points_members` row awards a `merged-pull-request` of positive
amount. `team` is true for the configured administrator and moderator GitHub
ids. `read` is the shell's one GitHub read of `/repos/<owner>/<name>`, in the
handler's order: a read that throws (GitHub down, rate limited, an error
status or an unreadable body) is `RepoUnreachable`; a 404 or an answer whose
`private` is not `false` is `RepoMissing`; an `id` that is not a positive
safe integer, a `full_name` that is not a valid `owner/name`, a `fork` or
`archived` that is not boolean, or an owner without a safe-integer id and a
string login is `RepoIncomplete`; then a fork is `RepoForked` and an archived
repository `RepoArchived`. `repoId` and `fullName` are GitHub's `id` and
`full_name` from that read. `listed` is true when a project of the registry
holds the repository by GitHub id or by its lower-cased listed name. `own` is
true when the GitHub owner id equals the member's GitHub id or the owner
login equals the member's login, ignoring case. `heldByName` is true when
one of the member's active flags has a `lower(full_name)` equal to the
lower-cased requested `owner/name` (lines 190-198).

The decision follows the handler (`repo-requests.ts` lines 177-251) in
exactly this order: a team account; no merged work; the limit of ten active
flags before GitHub is read, unless the requested name is one of the
member's active flags (so a renewal at the limit of a repository GitHub has
renamed since is refused here); the GitHub read; a listed repository; the
member's own repository; then the limit again by repository id, in the same
statement as the insert, counting the member's other active flags (a renewal
of an active flag is never refused by it).

```quint
pure val flagLimit = 10
pure val flagDays = 90
pure val dayMs = 86400000
pure val flagLife = flagDays * dayMs
pure val boardLimit = 200
type RepoRead = RepoReadable | RepoMissing | RepoUnreachable | RepoIncomplete | RepoForked | RepoArchived
type FlagFacts = { merged: bool, team: bool, heldByName: bool, read: RepoRead, listed: bool, own: bool }
type RepoFlag = { repoId: str, account: str, fullName: str, createdAt: int, flaggedAt: int, expiresAt: int, withdrawn: bool }
type RepoRequests = { now: int, flags: List[RepoFlag] }
pure val initial: RepoRequests = { now: 0, flags: List() }
type FlagChoice = Flagged | TeamRefused | NoMergedWork | AtFlagLimit | GitHubDown | NoPublicRepo | ForkRefused | ArchivedRefused | AlreadyListed | OwnRepoRefused
pure val noFlag: RepoFlag = { repoId: "", account: "", fullName: "", createdAt: 0, flaggedAt: 0, expiresAt: 0, withdrawn: true }
pure def live(f: RepoFlag, now: int): bool = not(f.withdrawn) and f.expiresAt > now
pure def hasRow(s: RepoRequests, repoId: str, account: str): bool =
  s.flags.some(f => f.repoId == repoId and f.account == account)
pure def flagOf(s: RepoRequests, repoId: str, account: str): RepoFlag =
  s.flags.select(f => f.repoId == repoId and f.account == account).nthOr(0, noFlag)
pure def active(s: RepoRequests, repoId: str, account: str): bool =
  s.flags.some(f => f.repoId == repoId and f.account == account and live(f, s.now))
pure def held(s: RepoRequests, account: str): int =
  s.flags.select(f => f.account == account and live(f, s.now)).length()
pure def flagChoice(s: RepoRequests, repoId: str, facts: FlagFacts, account: str): FlagChoice =
  if (facts.team) TeamRefused
  else if (not(facts.merged)) NoMergedWork
  else if (not(facts.heldByName) and held(s, account) >= flagLimit) AtFlagLimit
  else if (facts.read == RepoUnreachable or facts.read == RepoIncomplete) GitHubDown
  else if (facts.read == RepoMissing) NoPublicRepo
  else if (facts.read == RepoForked) ForkRefused
  else if (facts.read == RepoArchived) ArchivedRefused
  else if (facts.listed) AlreadyListed
  else if (facts.own) OwnRepoRefused
  else if (not(active(s, repoId, account)) and held(s, account) >= flagLimit) AtFlagLimit
  else Flagged
pure def lawTeamNeverFlags(s: RepoRequests, repoId: str, facts: FlagFacts, account: str): bool =
  facts.team implies flagChoice(s, repoId, facts, account) != Flagged
pure def lawNoMergedWorkNeverFlags(s: RepoRequests, repoId: str, facts: FlagFacts, account: str): bool =
  not(facts.merged) implies flagChoice(s, repoId, facts, account) != Flagged
pure def lawAtLimitRefusesANewRepository(s: RepoRequests, repoId: str, facts: FlagFacts, account: str): bool =
  (not(active(s, repoId, account)) and held(s, account) >= flagLimit) implies flagChoice(s, repoId, facts, account) != Flagged
pure def lawAtLimitRefusesAnUnheldNameBeforeTheRead(s: RepoRequests, repoId: str, facts: FlagFacts, account: str): bool =
  (facts.merged and not(facts.team) and not(facts.heldByName) and held(s, account) >= flagLimit)
    implies flagChoice(s, repoId, facts, account) == AtFlagLimit
pure def lawOnlyAReadableUnlistedOtherRepositoryFlags(s: RepoRequests, repoId: str, facts: FlagFacts, account: str): bool =
  flagChoice(s, repoId, facts, account) == Flagged implies
    (facts.read == RepoReadable and not(facts.listed) and not(facts.own) and facts.merged and not(facts.team))
pure def activeRow(repoId: str): RepoFlag =
  { repoId: repoId, account: "900000101", fullName: "acme/widgets", createdAt: 0, flaggedAt: 0, expiresAt: flagLife, withdrawn: false }
pure val sValues = Set(initial).union(Set({ now: 0, flags: List(activeRow("501")) })).union(Set({ now: 0, flags: List(
  activeRow("601"), activeRow("602"), activeRow("603"), activeRow("604"), activeRow("605"),
  activeRow("606"), activeRow("607"), activeRow("608"), activeRow("609"), activeRow("610")) }))
pure val accountValues = Set("900000101", "900000102")
pure val readableFacts: FlagFacts = { merged: true, team: false, heldByName: false, read: RepoReadable, listed: false, own: false }
pure val factsValues = Set(readableFacts)
  .union(Set({ merged: true, team: false, heldByName: false, read: RepoMissing, listed: false, own: false }))
  .union(Set({ merged: true, team: false, heldByName: false, read: RepoUnreachable, listed: false, own: false }))
  .union(Set({ merged: true, team: false, heldByName: false, read: RepoIncomplete, listed: false, own: false }))
  .union(Set({ merged: true, team: false, heldByName: false, read: RepoForked, listed: false, own: false }))
  .union(Set({ merged: true, team: false, heldByName: false, read: RepoArchived, listed: false, own: false }))
  .union(Set({ merged: false, team: false, heldByName: false, read: RepoReadable, listed: false, own: false }))
  .union(Set({ merged: true, team: true, heldByName: false, read: RepoReadable, listed: false, own: false }))
  .union(Set({ merged: true, team: false, heldByName: false, read: RepoReadable, listed: true, own: false }))
  .union(Set({ merged: true, team: false, heldByName: false, read: RepoReadable, listed: false, own: true }))
  .union(Set({ merged: true, team: false, heldByName: true, read: RepoReadable, listed: false, own: false }))
  .union(Set({ merged: true, team: false, heldByName: true, read: RepoForked, listed: false, own: false }))
```

### A flag counts for 90 days, renews in place and is withdrawn without being deleted

One row per repository and account, keyed by GitHub's permanent repository
id, so a flag survives a rename. A flag counts while it is not withdrawn and
its expiry is later than now. Flagging again renews the row in the same
statement (the migration's `ON CONFLICT (repo_id, github_id)` update): its
repository, account and creation time stay, and its name, flag time and
expiry are set as for a new flag, withdrawal cleared. A withdrawal marks only
that member's active row of the repository. The migration's triggers refuse
every delete and every change of a row's repository, account or creation
time. The sender `by` is the authenticated member's GitHub id. The shell
finds a withdrawal's repository id from the member's active row whose
`lower(full_name)` matches the requested name.

`observeClock` is the shell's clock: the codec sets `now` from Effect
`Clock` when it loads the state, which is this event with Clock's time; a
conformance driver sends it with its settable clock.

```quint
pure def canFlag(s: RepoRequests, repoId: str, fullName: str, facts: FlagFacts, by: str): bool =
  repoId != "" and fullName != "" and by != "" and flagChoice(s, repoId, facts, by) == Flagged
pure def flag(s: RepoRequests, repoId: str, fullName: str, facts: FlagFacts, by: str): RepoRequests =
  val renewed = { ...flagOf(s, repoId, by), fullName: fullName, flaggedAt: s.now, expiresAt: s.now + flagLife, withdrawn: false }
  if (hasRow(s, repoId, by))
    { ...s, flags: s.flags.listMap(f => if (f.repoId == repoId and f.account == by) renewed else f) }
  else
    { ...s, flags: s.flags.append({ repoId: repoId, account: by, fullName: fullName, createdAt: s.now,
      flaggedAt: s.now, expiresAt: s.now + flagLife, withdrawn: false }) }
pure def canWithdraw(s: RepoRequests, repoId: str, by: str): bool = active(s, repoId, by)
pure def withdraw(s: RepoRequests, repoId: str, by: str): RepoRequests =
  { ...s, flags: s.flags.listMap(f => if (f.repoId == repoId and f.account == by) { ...f, withdrawn: true } else f) }
pure def canObserveClock(s: RepoRequests, now: int): bool = now > s.now
pure def observeClock(s: RepoRequests, now: int): RepoRequests = { ...s, now: now }
pure def alwaysWithinFlagLimit(s: RepoRequests): bool = s.flags.every(f => held(s, f.account) <= flagLimit)
pure def alwaysOneRowPerRepoAndAccount(s: RepoRequests): bool =
  s.flags.every(f => f.repoId != "" and f.account != "" and f.fullName != ""
    and s.flags.select(g => g.repoId == f.repoId and g.account == f.account).length() == 1)
pure def alwaysExpiryWithinLife(s: RepoRequests): bool =
  s.flags.every(f => f.expiresAt > f.flaggedAt and f.expiresAt <= s.now + flagLife
    and f.expiresAt == f.flaggedAt + flagLife and f.createdAt <= f.flaggedAt and f.flaggedAt <= s.now)
pure def stepRowsAreNeverDeleted(before: RepoRequests, after: RepoRequests): bool =
  before.flags.every(f => after.flags.some(g => g.repoId == f.repoId and g.account == f.account and g.createdAt == f.createdAt))
pure def lawRefusedFlagChangesNothing(s: RepoRequests, repoId: str, fullName: str, facts: FlagFacts, account: str): bool =
  flagChoice(s, repoId, facts, account) != Flagged implies not(canFlag(s, repoId, fullName, facts, account))
pure def sometimesRenewedFlag(s: RepoRequests): bool = s.flags.some(f => f.flaggedAt > f.createdAt)
pure def sometimesWithdrawnFlag(s: RepoRequests): bool = s.flags.some(f => f.withdrawn)
pure def sometimesExpiredFlag(s: RepoRequests): bool = s.flags.some(f => not(f.withdrawn) and f.expiresAt <= s.now)
pure val repoIdValues = Set("501", "502")
pure val fullNameValues = Set("acme/widgets", "acme/widgets-two")
pure val byValues = Set("900000101", "900000102")
pure val nowValues = Set(86400000, 3888000000, 7862400000, 17280000000)
pure val eval_witness_sometimesRenewedFlag = (("flag", "501", "acme/widgets", readableFacts, "900000101"),
  ("observeClock", 3888000000, "900000101"), ("flag", "501", "acme/widgets-two", readableFacts, "900000101"))
pure val eval_witness_sometimesWithdrawnFlag = (("flag", "501", "acme/widgets", readableFacts, "900000101"),
  ("withdraw", "501", "900000101"))
pure val eval_witness_sometimesExpiredFlag = (("flag", "501", "acme/widgets", readableFacts, "900000101"),
  ("observeClock", 7862400000, "900000101"))
```

### A flag write is a same-origin JSON request naming exactly a repository and an action

GET and HEAD read the board. Every other request is admitted in this order:
a method other than POST, or a POST whose `Origin` is not the request's own
origin or whose content type is not `application/json`, answers 403
`{"error":"origin_forbidden"}` with no message; no signed-in session answers
401 `unauthorized` "Sign in with GitHub" (an `x-slop-expected-github-id`
header that is not a GitHub id answers 400 `invalid_expected_actor`, and one
naming another account 403 `actor_changed`); a body that is not a JSON object
of at most 1024 bytes answers 400 `invalid_request` "Request body must be a
JSON object"; keys other than exactly `repo` and `action` answer 400
`invalid_request` "Request body has unexpected fields"; an action other than
`flag` or `withdraw` answers 400 `invalid_request` "Action must be flag or
withdraw."; a `repo` that does not match
`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/(?!\.\.?$)[A-Za-z0-9_.-]{1,100}$`
answers 422 `invalid_repo` "Enter the repository as owner/name.".

An admitted flag answers by `flagRefusal`, with these messages:
`TeamRefused` "Slop team accounts cannot flag repos."; `NoMergedWork` "Flag a
repo after your first pull request is merged on a Slop project.";
`AtFlagLimit` "You already flag 10 repos. Withdraw one first.";
`GitHubDown` "GitHub did not answer. Try again." for `RepoUnreachable` and
"GitHub returned incomplete repository facts. Try again." for
`RepoIncomplete`; `NoPublicRepo` "GitHub has no public repository with that
name."; `ForkRefused` "That repository is a fork. Flag the original
repository."; `ArchivedRefused` "That repository is archived.";
`AlreadyListed` "<GitHub full_name> is already on Slop. See <request
origin>/projects/<project id>."; `OwnRepoRefused` "You cannot flag your own
repository.". A withdrawal with no active flag of that name answers 404
`not_flagged` "You do not flag that repository.". Only `github_unavailable`
shows its message among server errors. A success answers 200 with the
repository's GitHub name, its active count after the write, `flagged` and
the new expiry (`flagged: false` and no expiry for a withdrawal).

```quint
type WriteRequest = { post: bool, sameOriginJson: bool, signedIn: bool, jsonObject: bool, exactFields: bool,
  knownAction: bool, repoPath: bool }
type Admission = Admitted | OriginForbidden | SignInRequired | BodyNotObject | UnexpectedFields | UnknownAction | InvalidRepoPath
type FlagRefusal = { status: int, code: str }
pure def admission(request: WriteRequest): Admission =
  if (not(request.post) or not(request.sameOriginJson)) OriginForbidden
  else if (not(request.signedIn)) SignInRequired
  else if (not(request.jsonObject)) BodyNotObject
  else if (not(request.exactFields)) UnexpectedFields
  else if (not(request.knownAction)) UnknownAction
  else if (not(request.repoPath)) InvalidRepoPath
  else Admitted
pure def flagRefusal(choice: FlagChoice): FlagRefusal = match choice {
  | Flagged => { status: 200, code: "" }
  | TeamRefused => { status: 403, code: "team_account" }
  | NoMergedWork => { status: 403, code: "no_merged_work" }
  | AtFlagLimit => { status: 409, code: "request_limit" }
  | GitHubDown => { status: 503, code: "github_unavailable" }
  | NoPublicRepo => { status: 422, code: "not_found" }
  | ForkRefused => { status: 422, code: "fork" }
  | ArchivedRefused => { status: 422, code: "archived" }
  | AlreadyListed => { status: 409, code: "already_listed" }
  | OwnRepoRefused => { status: 409, code: "own_repo" }
}
pure def lawAdmittedWriteIsASignedInSameOriginPost(request: WriteRequest): bool =
  admission(request) == Admitted implies (request.post and request.sameOriginJson and request.signedIn
    and request.jsonObject and request.exactFields and request.knownAction and request.repoPath)
pure def lawOnlyAFlagSucceeds(choice: FlagChoice): bool =
  (flagRefusal(choice).status == 200) iff (choice == Flagged)
pure val requestValues = Set({ post: true, sameOriginJson: true, signedIn: true, jsonObject: true, exactFields: true,
  knownAction: true, repoPath: true })
  .union(Set({ post: false, sameOriginJson: true, signedIn: true, jsonObject: true, exactFields: true, knownAction: true, repoPath: true }))
  .union(Set({ post: true, sameOriginJson: false, signedIn: true, jsonObject: true, exactFields: true, knownAction: true, repoPath: true }))
  .union(Set({ post: true, sameOriginJson: true, signedIn: false, jsonObject: true, exactFields: true, knownAction: true, repoPath: true }))
  .union(Set({ post: true, sameOriginJson: true, signedIn: true, jsonObject: false, exactFields: true, knownAction: true, repoPath: true }))
  .union(Set({ post: true, sameOriginJson: true, signedIn: true, jsonObject: true, exactFields: false, knownAction: true, repoPath: true }))
  .union(Set({ post: true, sameOriginJson: true, signedIn: true, jsonObject: true, exactFields: true, knownAction: false, repoPath: true }))
  .union(Set({ post: true, sameOriginJson: true, signedIn: true, jsonObject: true, exactFields: true, knownAction: true, repoPath: false }))
```

## Story: See which repositories members would work on

> As anyone, I want to see the repositories members would work on and how
> many flag each, so that I can pitch their maintainers with my own referral
> link.

### The public board counts active flags per repository, never names who flagged, and leaves out a repository on Slop

`boardCount` is the number of active flags of one repository and `BoardRow`
has no account field: the board never says who flagged. The shell's query
(`repo-requests.ts` lines 291-343) groups the active rows by repository id,
orders them by count descending, newest flag time descending, then
repository id, and reads `boardLimit` rows plus the number of listed GitHub
ids; it then drops every repository the registry now holds, by GitHub id or
listed name, and keeps the first `boardLimit` (200). The name shown is the
`full_name` of the repository's newest flag, ties broken by GitHub id, among
all its rows. A repository listed on Slop later keeps its rows but leaves the
board. A signed-in viewer also gets their own active flags, newest first,
then by repository id, each with its name, expiry and `listedAs`, the project
id when the repository is now on Slop and otherwise null; a signed-out viewer
gets no list of their own. A signed-out answer is `public, max-age=300` and a
signed-in one `private, no-store`, both with `vary: cookie`.

```quint
type BoardRow = { repoId: str, count: int, newestAt: int }
pure def boardCount(s: RepoRequests, repoId: str): int =
  s.flags.select(f => f.repoId == repoId and live(f, s.now)).length()
pure def newestFlaggedAt(s: RepoRequests, repoId: str): int =
  s.flags.foldl(0, (newest, f) => if (f.repoId == repoId and live(f, s.now) and f.flaggedAt > newest) f.flaggedAt else newest)
pure def boardRow(s: RepoRequests, repoId: str): BoardRow =
  { repoId: repoId, count: boardCount(s, repoId), newestAt: newestFlaggedAt(s, repoId) }
pure def alwaysBoardCountsEveryActiveFlag(s: RepoRequests): bool =
  s.flags.every(f => live(f, s.now) implies (boardCount(s, f.repoId) >= 1 and newestFlaggedAt(s, f.repoId) >= f.flaggedAt))
pure def sometimesTwoAccountsFlagOneRepository(s: RepoRequests): bool = s.flags.some(f => boardCount(s, f.repoId) >= 2)
pure val eval_witness_sometimesTwoAccountsFlagOneRepository = (("flag", "501", "acme/widgets", readableFacts, "900000101"),
  ("flag", "501", "acme/widgets", readableFacts, "900000102"))
```
