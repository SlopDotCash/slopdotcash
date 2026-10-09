# Staging and production releases

DEP-01 in the product requirements and MVP-11 define this split. Issue #534
records the maintainer's request for separate staging login and writes.

| Branch | Website | Pages project | Database | Identity Worker |
| --- | --- | --- | --- | --- |
| `development` | `https://staging.slop.cash` | `slop-staging` | `slop-staging` | `slop-identity-staging` |
| `main` | `https://slop.cash` | `eliza-computer` | `slop-private` | `slop-identity` |

Use a feature branch and a pull request into `development`. After staging
acceptance, open a promotion pull request from `development` into `main`.
Both branches require the full build, browser, and policy checks. A failed check
must prevent publication. Never publish a local build or a pull-request build.
The temporary `develop` branch has no publication authority after migration.

Staging uses separate private storage and keys. Its API is on the staging
website origin. Its identity origin is `https://identity-staging.slop.cash`.
Production continues to use `https://api.slop.cash` and
`https://identity.slop.cash`. A staging credential does not authenticate a
production session. Public ledger snapshots remain public reference data;
staging account and wallet writes are test records, not payout instructions.

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

The workflow installs these application secrets on the staging Worker and Pages
project. It applies the versioned database migrations before publishing the
verified bundle. Preview branches have no database, bucket, or identity binding.
No operator identity is assigned by the staging deployment.

Associate `staging.slop.cash` with the staging Pages project. Its proxied DNS
CNAME must target `slop-staging.pages.dev`. The identity Worker uses its own
custom domain, `identity-staging.slop.cash`. Configure production environment
branch allowlists and the production Pages branch to `main` during cutover.
Production retains its existing storage and secrets. Do not change those IDs.

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
new verified revision. Do not change branch protections or copy production
storage to make a failed staging check pass. Existing installed skill receipts
retain their format; new installer authorization reads canonical `main`.

During migration, keep the default branch and live production release policy on
`develop` until the migration pull request passes. Change the default branch to
`main` only after the release workflow and operational workflows are present
there. Scheduled production refreshes must run from the new default branch.
