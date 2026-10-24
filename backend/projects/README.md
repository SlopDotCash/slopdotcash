# Project registry API

The D1 database `slop-private` is the only project inventory. Projects are
added on slop.cash, not by pull request. This module serves the registry and
runs self-service setup: owners create projects and publish revisions
without routine admin approval (PRD section 4). Admins keep the exception
paths: revisions owners cannot publish, restrictions and disputes. It runs
in the Pages Function `functions/api/v1/[[path]].ts` before the payments,
points, Slopbot and private trace APIs.

## Tables

Migrations `0019_project_registry.sql`,
`0020_project_application_github_check.sql`,
`0023_project_enforcements.sql` and
`0027_project_enforcement_owner_appeals.sql` create:

- `project_applications`: applications submitted before self-service setup,
  with applicant identity, referrer (PRJ-05, migration
  `0055_project_referrer.sql`), status, decision and admin email outcome.
  No route creates one now. A pending application is published by its own
  applicant (see Migration below); decided ones stay as history.
- `project_revisions`: the append-only manifest history. Triggers refuse
  update and delete.
- `projects`: the current pointer to the newest revision, plus the referrer
  recorded once at creation (or copied from a published application).
  Triggers require a matching appended revision for every insert and
  update, refuse delete, and refuse any change to the referrer.
- `project_repositories`: makes each repository unique across the registry.
- `project_enforcements`: the append-only ADM-06 record of each Quarantine,
  Ban, reinstatement request and appeal decision, with the ADM-05 audit
  fields (actor, role, reason, evidence reference, before and after revision,
  decision source, result). Triggers refuse update, delete and a gap in the
  per-project sequence.

The registry starts empty. Projects listed before it were removed; their ids
and repository ids survive only in `src/lib/legacy-projects.json` so contributor
points and profiles still validate.

## Routes

| Route | Access | Purpose |
|---|---|---|
| `GET /api/v1/projects` | public, edge cached | Current manifests |
| `GET /api/v1/projects/:id` | public, edge cached | One current manifest, revision and digest |
| `POST /api/v1/projects` | session, current authority | Creates a paused project at once (`manifest`, optional `referrer`), queues its first scan and returns the setup status |
| `PUT /api/v1/projects/:id` | session, current authority | Publishes an owner revision (`manifest`, `expectedRevision`, optional `reason`) and returns the classified changes and setup status |
| `GET /api/v1/project-setup` | session | The account's projects and its pending stored applications |
| `POST /api/v1/project-setup/:id/check` | session | Runs every setup check, queues a needed scan, activates a project that passes (optional `requestScan` after an incomplete scan) |
| `GET /api/v1/project-revisions` | public, edge cached | Full revision history with SHA-256 digests |
| `GET /api/v1/project-account-bans` | public, edge cached | GitHub ID and earliest start time of each active account ban, for the score generator; no reason, evidence, project or login |
| `GET /api/v1/project-github/owned-repositories` | session | The signed-in maintainer's public repositories |
| `GET /api/v1/project-vaults/:id` | session, current authority | Lists served setup networks and the current revision |
| `POST /api/v1/project-vaults/:id` | session, current authority, confirmed wallet | Reviews an unsigned ordinary-vault creation or registers its finalized transaction |
| `GET /api/v1/project-github/repositories/:owner/:name` | session | Public repository facts for `/projects/new` |
| `GET /api/v1/project-revisions/:id/:revision` | public, immutable | One revision's exact stored `manifestText` and digest, for generated-skill installers |
| `GET /api/v1/project-session` | public | GitHub identity and admin flag, or `null` when signed out |
| `GET /api/v1/project-applications/mine` | session | The account's stored applications, as history |
| `POST /api/v1/project-applications/:id/publish` | session, its applicant | Publishes a pending stored application without entering it again |
| `GET /api/v1/admin/projects` | admin | Registry with revisions |
| `PUT /api/v1/admin/projects/:id/manifest` | admin | Appends an exception revision (`manifest`, `expectedRevision`, `reason`) |
| `POST /api/v1/admin/projects/:id/enforcement-preview` | moderator | Plans an enforcement action and writes nothing |
| `POST /api/v1/admin/projects/:id/enforcement` | moderator | Records the previewed action (`action`, `reason`, `evidenceReference`, `expectedRevision`, `expectedSequence`) |

`GET /api/v1/projects` also returns `restrictions`: the project id, state,
appeal state and start time of every quarantined or banned project, and
`sourceProjectId`, the project whose records hold the restriction. A reader
treats those projects as paused and retired. `GET /api/v1/projects/:id`
answers HTTP 410 for a restricted project.

Deeper `/api/v1/projects/:id/...` paths belong to the private trace API.

The site catch-all Function (`functions/[[path]].ts`, `skill-publication.ts`)
serves these public artifacts from the current D1 revision:

| Path | Content |
|---|---|
| `/.well-known/slop/projects.json` | Repository-to-project routing for every project that publishes skills |
| `/projects/:id/terms.json` | Steward, authority and terms of the current revision |
| `/projects/:id/skill.md` (alias `SKILL.md`) | Generated contributor skill |
| `/projects/:id/review-skill.md` (alias `review/SKILL.md`) | Generated reviewer skill |
| `/projects/:id/[review-]{mission,codex,claude,claude-code,manual}.md` | Workflow and per-client install guides |
| `/projects/:id/[review-]skill-manifest.json` | Template revision, registry binding, guide renderer and archive routing |
| `/projects/:id/downloads/<skill>.skill` and `.skill.sha256` | Deterministic skill archive and checksum |

## Self-service setup

A project starts without routine admin approval after complete setup,
Slopbot installation, current GitHub authority and a clean security scan
(PRD section 4). `backend/projects/setup.ts` derives one status per project:
the result, one next action, and the installation, authority and scan
checks. Funding is reported separately; a project works without it.

- **Authority.** The manifest's repository and steward must match public
  GitHub facts, or the request is refused with `422 invalid_manifest`.
  These facts never grant authority. The Slopbot installation read is the
  one authority path (owner decision D11 of 24 October 2026): the
  installation reads the account's exact base permission
  (`GET /repos/:owner/:repo/collaborators/:login/permission`), and write
  (which includes maintain) or admin is required. Create, publish and
  revise all need it. Without an installation the request is
  `409 slopbot_required`, and the page links the installation; with less
  than write access it is `403 authority_required`. A failed GitHub or
  Slopbot answer is HTTP 503 `github_unavailable` or a `retry` status:
  try again, never an admin task.
- **Installation.** The Pages Function asks the Slopbot Worker over the
  `SLOPBOT` service binding (`https://slopbot.internal/v1/repository-access`,
  `workers/slopbot/repository-access.ts`). The Worker asks GitHub for the
  repository's installation with its App JWT and checks the repository id.
  Without the binding the check reports `retry`.
- **Scan.** Creation, a changed skill input, and a setup check of an
  unscanned or stale revision queue a scan through the existing vetting
  queue (`vettingScanRequester`, the same assessment row and live pin as
  the operator route). Without the service key the scan is `unavailable`.
- **Activation.** `POST /api/v1/project-setup/:id/check` appends the active
  revision, by status alone, when every check passes for the account that
  runs it. The revision reason records the permission, installation and
  clean scan. An unrestricted paused project that was not delisted is
  eligible; a restriction is lifted only by its moderator path. To hold a
  project, an admin uses quarantine: a plain paused admin revision is
  activated again by the owner's next passing setup check (owner decision
  D11).

Owner revisions (`PUT /api/v1/projects/:id`) publish at once against
`expectedRevision`; a changed base returns `409`. The server keeps status
and listing tier, then classifies the change (`src/lib/project-revision-changes.ts`):

- presentation (`name`, `eyebrow`, `headline`, `description`, `links`)
  publishes as it is and keeps the scan clearance;
- executable content (`contribution`; `repositories`, `skill` and
  `reviewSkill` never change by owner revision) pauses an active project
  and queues a new scan; a clean result reactivates it on the next setup
  check;
- financial policy applies from the next UTC calendar month: a new monthly
  amount pins every month from the reward start through the open UTC cycle
  that has no `reward.cycleCaps` entry to the previous amount, so a closed
  month whose proposal has not run yet keeps its amount too; an unfunded project may change its network and asset
  (the open cycle then has no pool, because amounts do not carry over
  between assets), a funded project keeps them, and no separate review
  budget can be added. An owner revision never adds or changes an
  `escrow.deployments` record: this API reads no chain state, so it cannot
  verify the vault, and the funding page offers a deposit for every recorded
  vault. Owners use the separate vault setup route below.

`reward.payoutExclusions` lists owners, funded employees and related parties
who receive no payout (PRD section 7). Each entry names the immutable GitHub
`actorId` and `nodeId`, the login, the `relationship` and the UTC months it
covers, from `fromCycle` until `untilCycle` (exclusive, or null). The person
keeps the public score; the weight leaves the pool, so it does not reduce
other contributors' shares, and an owner cannot allocate them a private
amount in an excluded month. Every revision path (owner, admin and stored
application) refuses a change to who is excluded in the open UTC month or
earlier (`assertPayoutExclusionTransition`), so a change starts with the next
month.

Monthly amounts are stored in the reward asset's integer base units (owner
decision D11). Every reviewed stablecoin has 6 decimals, so its base units
are the cent-precise micro-units and its display stays in dollars. A token
amount displays with its own symbol, for example `1,000.5 OPEN`. The setup
form sends `monthlyAmount`, a decimal number of whole asset units, with
`POST /api/v1/projects` and `PUT /api/v1/projects/:id`. The server converts
it with the decimals that it reads from chain for a new token, so the
browser never guesses a token's decimals.

Steward, authority, terms, status, listing tier and other fields return
`422 owner_field_restricted`; they stay with the admin exception path.

### Migration of stored applications

Applications submitted before self-service setup are not re-entered.
`GET /api/v1/project-setup` lists the account's pending ones, and
`POST /api/v1/project-applications/:id/publish` publishes one after the
same identity, authority, restriction and registry checks as a new
project: a new application becomes revision 1 of a paused project
(keeping its referrer and any pledged review budget it was submitted
with), and a stored update publishes as an owner revision against its
stored base revision. No approval notice is written.

## Caching

Public reads and artifacts use the Workers Cache API with a 30 second TTL
(`edge-cache.ts`). A creation or a revision deletes every key of that project
in the writing colo; other colos expire within the TTL. Each public project
request also reads one enforcement generation counter from D1 and keys the
cache on it, so a Quarantine or a Ban replaces every cached list, skill and
archive in every colo on the next request. Admin and session routes are never
cached. Page views never read a chain. For a project with a security scan,
the public project read, the skill artifacts and discovery read the
integration-branch head on GitHub once per cache miss, to compare it with the
scanned commit (`backend/vetting/README.md`).

## Generated skills

Each project's contributor and reviewer skills come from the canonical
templates `skills/project-contributor-template/` and
`skills/project-reviewer-template/` and the manifest's maintainer-authored
`contribution` fields: approved scope, contribution guide, supported tasks,
required tests, review expectations, security contact, closure policy and
maintainer notes. `src/lib/project-skill.mjs` renders them: `SKILL.md` gets
four strictly validated identifiers (skill name, project id, repository,
integration branch), and the maintainer text goes only into the generated
`project.json` as data, so it never becomes part of the instructions.
`src/lib/project-skill-publication.mjs` builds the raw skill, mission, guides,
`skill-manifest.json`, `PROVENANCE.json` and a deterministic stored-ZIP
archive from that output. The build publishes the template bytes with their
SHA-256 digests, the renderer source digests, the commit and the
`templateSha256` input digest at `/skill-templates/index.json`; the Function
refuses a file whose digest differs.

The trust root is the pair (template revision on `main`, D1 revision digest)
(PRD SKL-04). `PROVENANCE.json` and the skill manifest bind the registry
revision and its manifest SHA-256. The installer (`src/lib/install-command.ts`)
and the skill's own run gate (`scripts/skill-kit/skill-authority.mjs`)
authorize the template revision under the GitHub rules, fetch
`/api/v1/project-revisions/:id/:revision`, check its digest, render the same
bytes again in Python, and refuse any difference or a move back to an older
revision.

## Reward asset

`rewardAsset` names one network (`base`, `solana`, `robinhood`, `ethereum`)
and either that network's stablecoin or one ERC-20 or classic SPL token. The
API reads a token's decimals (and an EVM symbol) once over RPC when the asset
is submitted or changed (`token-metadata.ts`), stores them in the manifest, and
keeps them on later revisions of the same asset. `REWARD_RPC_<NETWORK>` Pages
variables may replace the public RPC endpoints. A token, or a network outside
the Base and Solana USDC rail without a reviewed escrow, keeps payments
disabled; the asset is display metadata until a reviewed payout path exists.

## GitHub lookups

`/projects/new` reads repository facts through the same-origin
`project-github` routes, which need a site session. The server reads public
GitHub data, with the optional `SLOP_GITHUB_READ_TOKEN` secret for a higher
rate limit, and caches each answer for five minutes. The browser never calls
`api.github.com` for setup.

## Trust rules

- A session is the site sign-in cookie that `/login` creates through the
  identity Worker (`backend/points/handler.ts`). The registry mints no session
  of its own.
- Writes must carry this site's `Origin` and a JSON content type, so a
  cross-site form cannot submit one.
- Admins are the GitHub actor IDs in the `ADMIN_GITHUB_IDS` Pages variable.
  Admin status is checked on every request, never stored.
- A new project, and a stored application published by its applicant, must
  be a paused, unverified, unfunded community project with one repository, payments disabled, no funding routes or vault
  deployments, no root skill publication, generated skills from the
  canonical templates and complete maintainer-authored `contribution`
  fields. Repository receipt authority, terms activation, listing tier and
  money arrive through later revisions.
- The API reads public GitHub facts on every write
  (`SLOP_GITHUB_READ_TOKEN` is optional). The repository id, node id, name,
  and owner must match the manifest, or the request is refused. Every
  other repository and every alias of an older project must also be a
  public GitHub repository, and an alias must be a name of the repository
  it is listed under, with at most 5 names in all.
- `/projects/new` and `/admin` preview the exact generated contributor and
  reviewer skills.
- A revision activates, or changes its skill inputs while active, and its
  skills and discovery entry are served, only when a scan cleared its exact
  executable content at the live integration-branch head and skill
  template input digest. See
  `backend/vetting/README.md` (PRD VET-01).
- An admin delists a project by appending a paused, `retired` revision.
- Quarantine, Ban project and Request reinstatement (PRD ADM-06) need an admin
  who is also in the `PROJECT_MODERATOR_GITHUB_IDS` Pages variable. While that
  variable is unset, the actions are closed and `/admin` says so. Each action
  needs a reason, an evidence reference, the server preview and a
  confirmation bound to the previewed revision and record sequence.
- A Quarantine or a Ban records the enforcement and, in the same D1 batch,
  appends the paused, `retired` revision. When the current manifest cannot
  pass that revision, the record says `revision_pending`, the restriction
  still closes every public route, `/admin` shows the pending revision, and
  `bun run projects:sync` withholds that project and its revisions from the
  snapshot, with a warning, until an admin appends the paused, `retired`
  revision. Every other project still syncs.
- A restriction binds the GitHub repository id and every repository path. A
  restricted project cannot get a revision that is not paused and retired, and
  no project for the same repository can be created or published.
  Another project already listed for the same repository closes on public
  routes with it. Its restriction names the restricted project as
  `sourceProjectId`, and an appeal is filed on that project. The other project
  can only get a paused, retired revision that claims the same repositories.
- The project steward named in the manifest, or the account that listed the
  project (its applicant, or the creator of revision 1), may file the
  reinstatement request with
  `POST /api/v1/project-appeals` (`projectId`, `reason`,
  `evidenceReference`). The record names the role `project-steward` or
  `project-applicant` and the source `owner-request`
  (`0027_project_enforcement_owner_appeals.sql`). A moderator may also file
  it at `/admin`. An account named in the current project ban can use the same
  route even if it is no longer the owner and did not list the project. Its
  record uses `banned-account` and `account-request`. Filing does not lift a
  restriction or grant project access. Only a moderator decides the appeal.
- Reinstatement needs an open reinstatement request and a moderator who did
  not place the restriction. Both preview and confirmation require a clean
  scan of the current restricted revision, requested after the latest restriction,
  at the live integration-branch head and current skill template. Missing,
  stale or incomplete clearance returns `vetting_required`. For a confirmed
  malicious finding, the signed scanner result records a Ban through this same
  enforcement path. The issuer is the service signing-key digest and standing
  rule, never a fabricated GitHub account. A clean scan alone never removes that finding. The independent decision
  stores its exact clean scan and reviewed malicious scan IDs in
  `project_vetting_reinstatements`, atomically with the reinstatement. Later
  findings are not covered by that decision and block clearance again.
  It is refused with `revision_pending` while the
  paused, `retired` revision of the restriction is still pending. It appends a paused `community` revision only if
  the project was listed when the restriction began; it never restores
  featuring, activation or money. A denial keeps the restriction.
- A signed confirmed malicious Ban waits for a moderator decision (PRD
  sections 2 and 8). `/admin` lists the project first with "Moderator
  decision needed", with or without an owner appeal. The moderator either
  reinstates the project through the appeal path above, or chooses "Ban
  project and maintainer". That decision is a moderator `ban` record. In the
  same D1 batch it stores only the accounts that the moderator selected from
  the evidence in `project_maintainer_bans`. The API resolves each selected
  GitHub login to an immutable account ID; confirmation checks the previewed
  ID again. An empty selection bans only the project. Current stewardship
  and the original application do not select accounts automatically
  (`0066_project_maintainer_bans.sql`), and it closes an open appeal as
  denied. A moderator who placed the restriction cannot decide an open appeal
  this way. A plain denial is refused with `malicious_decision_required`
  until the decision is made. While the account ban holds, a banned
  maintainer cannot create a project, publish a stored application or publish
  an owner revision, as the actor or as the named steward
  (`maintainer_banned`). The steward, applicant, and explicitly banned accounts
  can appeal, including after ownership changes. A project reinstatement no
  longer lifts account bans. An independent moderator uses `reinstate_accounts`
  to select accounts cleared by the evidence. The decision leaves the project
  restriction and other accounts unchanged. Each release references its exact
  ban in `project_account_reinstatements`; the existing enforcement journal
  records its reason and evidence. Migration 0072 preserves releases already
  made under the former project-wide rule. Signed-in accounts can use
  `/account#appeals` without Points membership. `GET /api/v1/project-appeals`
  lists only the caller's active account bans and appeal state; it omits
  moderation reasons, evidence and other accounts. The form uses the existing
  authenticated appeal route and retains its status after reload.
  The ban does not erase an approved funded award. The trace API refuses new
  contribution runs and progress events. Bounty approval refuses new
  reservations for a banned researcher, including concurrent bans. Private
  intake refuses new submissions and sends, but keeps reconciliation of a
  report already received by GitHub. Banned accounts cannot file new project
  flags, including during a concurrent ban. They can read and withdraw
  existing flags. The score generator reads
  `GET /api/v1/project-account-bans` and gives a banned account no
  contribution or review credit for events at or after its ban start
  (`scripts/value-ingestion.ts`, `addScore` in `src/lib/leaderboard.ts`).
  Earlier credit stays. A feed outage keeps the last published snapshot.
- Two standing rules act without a moderator (PRD section 8; see
  `backend/vetting/README.md`). The second distinct active contributor flag
  appends a `quarantine` record whose issuer is `contributor-flags`, and a
  clean fresh scan requested at or after that flag-only pause appends a signed
  `vetting-service` reinstatement. Neither appends a revision. A moderator
  decides every other restriction, including a flag pause escalated by a
  confirmed malicious result.
- Each enforcement record adds, in the same D1 batch, one `/inbox` row for the
  account that listed the project and one for its GitHub steward (PRD
  NOT-01). A reinstatement request also adds a row for each moderator who
  did not place the restriction. No row carries the reason or the evidence
  reference.
- Every revision must pass `assertProjectPolicyTransition` and the registry
  uniqueness checks; an admin revision also passes the review-budget rule.
  A revision that makes a project
  active requires the generated templates and the `contribution` fields. Root
  skill publication is retired.
- A stale `expectedRevision` fails with HTTP 409 instead of overwriting.

## Publication

The site reads the registry from `GET /api/v1/projects` when a page loads
(`src/main.tsx`), so a created project or a saved revision appears within a
minute, without a build. Every non-PR deploy still runs `bun run
projects:sync` against its own origin for build-time ingestion, which decides
which active repositories to collect; an origin that does not serve the
registry API yet keeps the committed snapshot. `bun run projects:check` proves
the committed snapshot is canonical and that every active project carries its
contribution fields.

The sync also records its read time. The build publishes that synced snapshot
at `/data/project-registry.json` as the last good registry (PRD section 9).
When the live read fails, list, project, profile, and score pages show that
registry with a stale label, its sync time, and the failure. Funding,
management, owner-award, and security-program pages and escrow actions need
the current manifest, so they show the outage instead. A committed snapshot
that no sync wrote is not published; those builds show the outage on every
project route.

A clean scan result reruns setup for the recorded project creator. It reloads
current GitHub permission and checks the permanent actor ID, installation,
restrictions, and exact scan clearance before activation. No owner session or
admin action is needed for this check. A failed readiness check leaves the
project paused and returns an explicit retry state; the owner can retry from
the setup page. A scan result alone never grants repository authority.

### Owner vault setup

The funding page creates and registers an ordinary EVM vault, then uses the
existing deposit controls. The owner confirms a current wallet through the
payment wallet-claim route. Slop checks current GitHub authority and derives
the project digest, asset and cap from the current registry revision. The
wallet signs the exact creation; the server never signs or broadcasts.

Setup lists served networks with a factory record in D1. Before creation,
Slop verifies that factory's current code and compatibility. Registration
verifies the exact finalized transaction, project
digest, owner, asset, purpose, code and monthly setting before appending one
revision. Retry returns the registered vault. An unknown send stays pending
until the owner recovers its transaction hash; it never sends again by itself.
Default monthly payment and explicit opt-out use the atomic creation builder.

If the monthly amount changes while creation is pending, registration checks
that transaction against its original immutable revision. The current asset
and vault policy must still match. Registration keeps the current project
amount and shows both amounts. The owner can then apply the current amount
through the existing automatic payment control.

The creation verifier shares purpose handling with bounty vaults, but this
route only onboards ordinary vaults. Solana website creation and private-vault
onboarding require their own completed end-to-end acceptance. Mainnet setup
also requires the separately approved factory upgrade and network activation.
