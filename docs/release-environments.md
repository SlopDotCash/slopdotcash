# Staging and production releases

PRD section 11 ("Release workflow") defines this flow. Issue #534 records the
maintainer's request for separate staging login and writes.

For containment, preserved journals and recovery verification, use the
[production incident runbook](incident-response.md). Its outstanding operator
assignments and alert checks remain launch prerequisites.

| Branch | Website | Pages project | Database | Identity Worker |
| --- | --- | --- | --- | --- |
| `development` | `https://staging.slop.cash` | `slop-staging` | `slop-staging` | `slop-identity-staging` |
| `main` | `https://slop.cash` | `eliza-computer` | `slop-private` | `slop-identity` |

Use a feature branch and a pull request into `development`. After staging
acceptance, open a promotion pull request from `development` into `main`.
Both branches require the full build, browser, and policy checks. A failed check
must prevent publication. Never publish a local build or a pull-request build.

Trusted branch preparation keeps its running revision when another run starts.
The newest pending revision replaces earlier pending work. Superseded pull
request checks may still cancel. The combined quality gate skips cancelled
prerequisites; failed or skipped checks still prevent publication. Production
publication continues to require current-main equivalence and the shared
publication lock.

Owner decision, 25 October 2026: branch protections and rulesets are not
release requirements. Do not add or restore them during release work unless
the owner asks. Continue the reviewed pull-request flow and the workflow
quality checks described here.

Staging publishes fully checked revisions in Git ancestry order. A newer push
may queue while an older revision completes; it does not by itself invalidate
that checked ancestor. The serialized `slop-staging` job checks that the candidate
remains an ancestor of current `development` and that every recorded staging
attempt is its ancestor or the same revision. A newer or divergent attempt blocks
publication, including a failed attempt that may already have changed a Worker
or database. Missing, unreadable, malformed or oversized history blocks publication
and requires review. Keep the GitHub deployment history: deleting it removes
ordering evidence. All staging publishers must use this concurrency lock and
environment; this gate cannot coordinate an out-of-band manual deployment.
This changes no production publication or acceptance rule.

The approved referral Worker follows the normal checked `main` release. Its
reviewed configuration starts Off and requires no manual Worker shell or
separate release flag. Deployment verifies one active version tagged with the
tested source. Live posting remains separate from deployment and requires the
token, funded distributor and operating controls in PRD section 11. Owner
decision, 27 October 2026: referrals are deferred from launch. Keep mode Off
and the program flag false until separate owner reactivation approval;
referral setup and qualification do not block launch. Preserve the Worker
and its history.

Staging uses separate private storage and keys. Its API is on the staging
website origin. Its identity origin is `https://identity-staging.slop.cash`.
Production continues to use `https://api.slop.cash` and
`https://identity.slop.cash`. A staging credential does not authenticate a
production session. Public ledger snapshots remain public reference data;
staging account and wallet writes are test records, not payout instructions.

Points generation reads the branch's own published history. Production
reconciles its D1 checkpoint and Pages journal. Staging retains its existing
Pages journal when its own API explicitly reports `points_not_published`,
because earlier staging releases published Points without a D1 checkpoint.
Unavailable checkpoints, missing shards, bad digests and invalid awards still
stop the build. Never import new production Points into staging's separate
project inventory or discard an existing staging journal to start again.

## Setup

The `slop-staging` GitHub environment permits only `development`. Store these
secrets there, never in a file committed to Git:

- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`: the deployment account and
  a token with Pages, Workers Scripts, D1, and R2 permissions for staging.
- `SLOP_GITHUB_CLIENT_ID` and `SLOP_GITHUB_CLIENT_SECRET`: a separate GitHub OAuth
  application for staging. Use `https://staging.slop.cash` as its homepage and
  `https://identity-staging.slop.cash/v1/oauth/callback` as its callback.
- `IDENTITY_STATE_KEY`, `IDENTITY_ASSERTION_KEY`, and `TRACE_AUTH_SECRET`:
  independent random staging secrets. Do not reuse production values.

Staging project setup also uses `SLOPBOT_APP_ID` and
`SLOPBOT_APP_PRIVATE_KEY` from this environment for the existing slopdotcash
GitHub App. The workflow stores them only on `slop-repository-access-staging`.
This private Worker reuses the bot's installation and permission lookup. It has
no webhook, queue or scheduled handler. Its named services use only staging D1
for historical intake and cached reporting readiness; historical reconstruction
uses the staging merge verifier. Pages reaches installation lookup through its
`SLOPBOT` binding. Do not bind staging Pages to the production bot.

The workflow installs these application secrets on the staging Worker and Pages
project. It applies the versioned database migrations before publishing the
verified bundle. Preview branches have no database, bucket, or identity binding.
No operator identity is assigned by the staging deployment.

Associate `staging.slop.cash` with the staging Pages project. Its proxied DNS
CNAME must target `slop-staging.pages.dev`. The identity Worker uses its own
custom domain, `identity-staging.slop.cash`. The production environment branch
allowlist and the production Pages branch are `main`. Production retains its
existing storage and secrets. Do not change those IDs.

Before the first staging publication, verify in Cloudflare that `slop-staging`
has no Pages deployment. Run the checked-in `slop.cash` workflow manually on
`development` with `bootstrap_staging_profiles` set to `true`. This one-time
option uses the reviewed profile seed as the previous census while it collects
fresh GitHub records. It does not copy production account data. The option is
rejected outside a manual `development` run. Leave it `false` after staging has
published: ordinary releases must read the prior staging census and fail if
that history cannot be fetched. Never use this option to recover from an outage
or a failed refresh of an existing staging site.

## Acceptance and recovery

Run `bun run verify` and `bun run test:e2e` at the proposed source revision.
Build and test staging with `VITE_SLOP_ENVIRONMENT=staging`. Production uses the
default production build. The browser checks use the same tier as the build.

After each deployment, verify the immutable deployment URL, commit metadata,
custom-domain served files, TLS, and security headers. Test GitHub login,
returning login, logout, and a staging account change. Confirm the change in the
staging database and confirm production has no corresponding test write. Keep
all credentials and session identifiers out of evidence. Verify that a
production browser origin cannot use the staging identity flow, and vice versa.
Optional X connection requires a separate configured provider application.

Revert a faulty source change through a reviewed pull request, then release the
new verified revision. Do not copy production storage to make a failed staging
check pass. Existing installed skill receipts
retain their format; new installer authorization reads canonical `main`.
