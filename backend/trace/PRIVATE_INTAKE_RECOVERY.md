# Private intake renewal and recovery

The private-trace API accepts uploads only while the deployed public-intake
attestation is valid. The attestation is bound to one tested `develop` revision
and expires 49 hours after `verifiedAt`. Expiry is intentionally fail-closed:
`GET https://api.slop.cash/api/v1/private-request-intake` returns HTTP 503 with
`{"error":"private_intake_unavailable"}` until a reviewed production deployment
publishes a fresh attestation.

This procedure does not extend the freshness window, bypass environment review,
or let automation approve its own deployment.

## Normal renewal

1. Open the newest `slop.cash` workflow run for `develop` at
   <https://github.com/SlopDotCash/slopdotcash/actions/workflows/deploy.yml>.
2. Confirm `Skill, data, build, and browser checks` succeeded for the current
   `develop` SHA. Do not approve a run from a pull request, fork, tag, stale SHA,
   or a run whose quality job failed.
3. A designated `eliza-army-production` reviewer inspects and approves the
   waiting `Deploy trusted production bundle` job.
4. Wait for that exact run to finish successfully. A merge, successful quality
   job, or environment approval alone is not deployment evidence.
5. Run the verification sequence below and record the workflow run URL, tested
   SHA, `verifiedAt`, and verification time on the operations issue.

The scheduled deployment runs every six hours. The hourly freshness watch
fails when fewer than nine hours remain, so at least one reviewed scheduled
run is available inside the renewal window before expiry.

## Designated reviewer unavailable

GitHub environment protection is the release authority. Contributors and
automation must not impersonate the reviewer, use administrator bypass, change
the deployment payload, change the reviewed 49-hour window, or publish an
attestation from a local checkout.

If no configured reviewer can respond before expiry:

1. Leave intake fail-closed and open or update the public operations issue with
   the waiting workflow-run URL and expiry time. Do not include credentials or
   private trace contents.
2. Ask another repository administrator to verify the current `develop` run and
   the existing environment policy. If the organization has an independently
   authorized backup reviewer, the administrator may add that human or team to
   `eliza-army-production` through GitHub environment settings and record the
   policy change on the issue before approval.
3. Keep `Prevent administrators from bypassing required reviewers` enabled.
   Do not remove the original reviewer merely to make a pending run pass.
4. The newly authorized reviewer approves the newest clean `develop` run. Run
   the complete verification sequence; do not treat the settings change or
   approval click as recovery.

If no independently authorized backup exists, wait for the designated reviewer.
Availability is less important than preserving the human release boundary.

## Complete renewal-cycle verification

After the deployment reports success:

1. Fetch `https://slop.cash/data/private-intake-attestation.json` without cache.
   Require exactly `enabled: true`, `source: "github-public-status"`, a
   40-character lowercase-hex `revision` equal to the deployed `develop` SHA,
   and an ISO `verifiedAt` no more than 49 hours old and not future-dated.
2. Fetch `https://api.slop.cash/api/v1/private-request-intake` without cache.
   Require HTTP 200 and exactly `enabled: true`,
   `source: "github-public-status"`, and the same `verifiedAt` as the bundle.
3. Run one minimized private-trace upload through the ordinary contributor
   client. Require intent creation, immutable object upload, attachment, and
   finalization to succeed. Never use a private trace containing test secrets.
4. Confirm the next hourly `Private intake freshness watch` succeeds and prints
   the calculated expiry time.

Any mismatch, non-200 API result, stale timestamp, failed trace finalization, or
failed freshness watch means recovery is incomplete. Keep intake fail-closed,
preserve the failed run, and diagnose the exact deployment or API boundary.

## Rollback and incident handling

Do not edit the deployed attestation or roll back to an older attestation: an
older revision or timestamp must remain rejected. Correct the defect on a new
reviewed branch, merge through the normal repository rules, and deploy the new
exact `develop` SHA through the protected environment. Security-sensitive
details go through GitHub private vulnerability reporting; ordinary expiry and
availability incidents stay on the public operations issue.
