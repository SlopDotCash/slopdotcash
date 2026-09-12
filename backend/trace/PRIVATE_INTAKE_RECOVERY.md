# Optional trace intake recovery

GitHub contribution never depends on trace intake. When the public endpoint
returns unavailable, contributors can submit normal attribution and finish
receipts without trace arguments. Never invent a successful upload.

The `slop-identity` Worker renews the singleton D1 observation on its existing
hourly cron trigger (`renewPrivateIntakeStatus` in `workers/identity/index.ts`).
It reads GitHub's public private-vulnerability-reporting status without any
token and writes through the Worker's own `IDENTITY_DB` binding, so renewal
needs no website deployment and no GitHub-held Cloudflare credential. The
runtime accepts observations for 24 hours. Disabled reporting stops collection
at the next read; an unreachable, rate-limited, or malformed GitHub answer
leaves the previous observation in place so that it expires on schedule rather
than being refreshed on bad evidence. A code release also renews the
observation once, immediately after applying migrations, using the release
credentials.

The hourly `Private intake health watch` workflow only reads
`https://api.slop.cash/api/v1/private-request-intake`. It fails when the
endpoint is not 200, when `enabled` is not true, or when `verifiedAt` is older
than three hours, which means the Worker cron has missed at least two
renewals. It holds no secrets and mutates nothing.

To recover, check the Worker cron first: the release verifies the live
schedule against `workers/identity/wrangler.toml`, and Cloudflare Workers Logs
show `slop private intake renewal skipped` (GitHub did not answer) or
`slop private intake renewal failed` (the D1 write failed). Missing schema or
permissions must produce a failed renewal, not an enabled result. Migration
`0006_private_intake_status.sql` is applied by the approved code release before
the first renewal. If the endpoint must be renewed before the next cron, run
`node scripts/renew-private-intake.mjs` locally with a Cloudflare token that
can execute against the `slop-private` D1 database; never put a contributor
token into automation.

A healthy response is HTTP 200 with `enabled: true`,
`source: github-public-status`, and a `verifiedAt` within the last hour. No
trace contents or user authorization are needed for this check.

Data refreshes use the currently deployed approved revision. A code release
awaiting review does not hold the publication lock. An obsolete refresh is
rejected if production advances before it obtains that lock.
