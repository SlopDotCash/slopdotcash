# Optional trace intake recovery

GitHub contribution never depends on trace intake. When the public endpoint
returns unavailable, contributors can submit normal attribution and finish
receipts without trace arguments. Never invent a successful upload.

The hourly `Private intake health renewal` workflow authenticates GitHub's
private-reporting status and updates the singleton D1 observation. The runtime
accepts observations for 24 hours. Disabled reporting stops collection
immediately after renewal; unavailable or expired observations also stop it.
No website deployment is needed to renew status.

Run the checked-in health workflow on `develop` to recover. Its
`slop-data-refresh` environment requires `CLOUDFLARE_ACCOUNT_ID` and a scoped
`CLOUDFLARE_API_TOKEN` with access to the `slop-private` D1 database. Actions
supplies `GITHUB_TOKEN`; never put a contributor token into this job.
Migration `0006_private_intake_status.sql` is applied by the approved code
release before initial renewal. Missing schema or permissions must produce a
failed renewal, not an enabled result.

Confirm the workflow completed successfully and then read
`https://api.slop.cash/api/v1/private-request-intake`. A healthy response is
HTTP 200 with `enabled: true`, `source: github-public-status`, and the new
`verifiedAt`. No trace contents or user authorization are needed for this check.

Data refreshes use the currently deployed approved revision. A code release
awaiting review does not hold the publication lock. An obsolete refresh is
rejected if production advances before it obtains that lock.
