# Project registry API

The D1 database `slop-private` is the only project inventory. Projects are
added on slop.cash, not by pull request. This module serves the registry,
takes applications, and lets admins review them. It runs in the Pages
Function `functions/api/v1/[[path]].ts` before the payments, points, Slopbot
and private trace APIs.

## Tables

Migrations `0019_project_registry.sql` and
`0020_project_application_github_check.sql` create:

- `project_applications`: submitted manifests, applicant GitHub identity,
  review status, decision, and admin email outcome. One pending application
  per project id and per repository.
- `project_revisions`: the append-only manifest history. Triggers refuse
  update and delete.
- `projects`: the current pointer to the newest revision. Triggers require a
  matching appended revision for every insert and update, and refuse delete.
- `project_repositories`: makes each repository unique across the registry.

The registry starts empty. Projects listed before it were removed; their ids
and repository ids survive only in `src/lib/legacy-projects.json` so contributor
points and profiles still validate.

## Routes

| Route | Access | Purpose |
|---|---|---|
| `GET /api/v1/projects` | public | Current manifests |
| `GET /api/v1/project-revisions` | public | Full revision history with SHA-256 digests |
| `GET /api/v1/project-revisions/:id/:revision` | public | One approved revision's exact stored `manifestText` and digest, for generated-skill installers |
| `GET /api/v1/project-session` | public | GitHub identity and admin flag, or `null` when signed out |
| `POST /api/v1/project-applications` | session | Submits a manifest, records the GitHub check, and emails the admins |
| `GET /api/v1/project-applications/mine` | session | The applicant's own applications |
| `GET /api/v1/admin/project-applications?status=` | admin | Review queue |
| `POST /api/v1/admin/project-applications/:id/approve` | admin | Lists the project as paused (optional `reason`) |
| `POST /api/v1/admin/project-applications/:id/reject` | admin | Rejects with a required `reason` |
| `GET /api/v1/admin/projects` | admin | Registry with revisions |
| `PUT /api/v1/admin/projects/:id/manifest` | admin | Appends a revision (`manifest`, `expectedRevision`, `reason`) |

Deeper `/api/v1/projects/:id/...` paths belong to the private trace API.

## Trust rules

- A session is the site sign-in cookie that `/login` creates through the
  identity Worker (`backend/points/handler.ts`). The registry mints no session
  of its own.
- Writes must carry this site's `Origin` and a JSON content type, so a
  cross-site form cannot submit one.
- Admins are the GitHub actor IDs in the `ADMIN_GITHUB_IDS` Pages variable.
  Admin status is checked on every request, never stored.
- An application must be a paused, unverified, unfunded community project with
  payments disabled, no funding addresses or commitments, no escrow deployment,
  no root skill publication, generated skills from the canonical templates,
  and the maintainer-authored `contribution` fields. Authority, terms, money,
  listing tier, and activation are added only by admin revisions.
- The API reads public GitHub facts once per submission
  (`SLOP_GITHUB_READ_TOKEN` is optional). The repository id, node id, name,
  and owner must match the manifest, or the application is refused. Whether
  the applicant owns the user repository, or is a public member of the owning
  organization, is stored as `githubCheck` for the admin. Every application
  waits for an admin (PRD PRJ-02). One account may submit 5 projects per day
  and keep 3 waiting.
- `/admin` previews the exact generated contributor and reviewer skills before
  an admin approves or activates a revision.
- An admin delists a project by appending a paused, `retired` revision.
- Every revision must pass `assertProjectPolicyTransition`, the review-budget
  rule, and the registry uniqueness checks. A revision that makes a project
  active requires both skill folders on `SlopDotCash/slopdotcash`
  `development`.
- A stale `expectedRevision` fails with HTTP 409 instead of overwriting.
- The application is stored before the admin email. A failed or missing
  notifier is recorded as `adminNotification: "failed"` and shown in the admin
  queue.

## Publication

Generated skills: `scripts/prepare-site.mjs` renders each project's skills
from `skills/project-contributor-template`, `skills/project-reviewer-template`
and the newest approved revision with `src/lib/project-skill.mjs`. The
archive's `PROVENANCE.json` binds the template revision and the registry
revision digest. The installer fetches the revision from
`/api/v1/project-revisions/:id/:revision`, checks the digest, renders the same
bytes in Python, and refuses any difference (PRD SKL-03/04).

The public site is a static build. Every non-PR deploy runs `bun run
projects:sync` against its own origin (`https://slop.cash` or
`https://staging.slop.cash`) and embeds that snapshot; an origin that does not
serve the registry API yet keeps the committed snapshot. The build publishes
the revisions it used at `/data/project-revisions.json`. Every 10 minutes
`.github/workflows/registry-publish.yml` compares that file with the live
`/api/v1/project-revisions` and, when they differ and no deploy is running,
dispatches `deploy.yml` with the built-in `GITHUB_TOKEN`. No secret or
repository variable is needed. GitHub runs scheduled workflows from the
default branch (`development`), which dispatches both environments.
Production still waits for its protected-environment approval.
`bun run projects:check` proves the committed snapshot is canonical and that every active project names skills in this tree.
A paused project without skill folders is listed but publishes no skill.
