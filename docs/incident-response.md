# Production incident response

This runbook collects the existing stop and recovery procedures for PRD
sections 6, 8, 9 and 11. It does not activate a service, authorize a transaction,
or establish that monitoring and recovery have been qualified. Record those
results separately on the release issue.

## Ownership and first response

Owner assignment, 26 October 2026: **lalalune is the primary responder** and
**drew-dot-com is the backup responder**. Private contact routes and a
successful test alert still need to be verified. Owner decision, 26 October 2026:
there are no automatic acknowledgement or escalation deadlines. Responders
coordinate the response directly; this does not disable failure alerts.

The responder should:

1. Identify the affected environment, service, deployed source SHA and version,
   first observed failure, and whether signatures or external writes occurred.
2. Preserve private logs, transaction journals, pending attempts, receipt hashes,
   observed chain heights and the last known good data. Put only sanitized
   metadata in a public incident or release issue. Never attach keys, cookies,
   private reports, evidence bytes, or access-bearing URLs.
3. Use the matching containment procedure below. A repository release variable
   prevents a future deployment; it does not stop an already deployed Worker or
   an invocation already in progress. A disabled schedule does not undo a signed
   transaction. Verify the actual deployed configuration after containment.
4. Reconcile uncertain external writes before retrying. An RPC timeout, missing
   receipt, or failed job is not proof that a transaction or report was rejected.
5. Record the impact and remaining uncertainty. Resume only after the owning
   procedure's checks pass and any required owner approval is recorded.

Production code and configuration changes use the reviewed `development` to
`main` flow and the checked-in release workflow. Do not deploy a local incident
checkout. Owner-controlled contract actions need their exact reviewed plan and
transaction approval; this document grants neither.

## Containment by subsystem

The referral procedure below is retained for any later reactivation. The
27 October 2026 owner decision keeps referrals Off with the program flag false;
referral setup and qualification are not launch requirements. See
[the recorded deferral](slop-product-requirements.md#referral-program).

| Symptom                                                          | Existing control and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Owning procedure                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity attester signing incorrectly, or its key is compromised | Stop new attestations by setting the affected network's `MAINNET_EXECUTION` value to `false` through the reviewed release. Keep the Worker and its journal. For Base, do this while a vault remains pinned: an empty pin snapshot leaves the existing Worker unchanged. Removing the signing secret breaks later releases and is not the stop procedure. A compromised key also needs registrar-controlled rotation under a separately approved plan; stopping Slop cannot prevent someone else using a stolen key. | [Mainnet stop procedure](../contracts/DEPLOY-MAINNET.md), section 3.6; [identity execution](../workers/payment-executor/README.md); [accepted compromise risk](security/red-team-2026-10-24.md) |
| Keeper sends fail, stall, or repeat                              | The keeper operator deploys `KEEPER_MODE = "off"` in the same Worker and Durable Object namespace. Retain unknown attempts and signed bytes. Do not replace its journal or create a second keeper using the same wallet. Restart with reconciliation before new execution.                                                                                                                                                                                                                                          | [Operator keeper](../workers/operator-keeper/README.md)                                                                                                                                         |
| Fee conversion or fee claims behave incorrectly                  | Release `FEE_CONVERTER_MODE = "off"`. The documented dashboard alternative is to disable future releases and remove the cron trigger; verify both actions and account for an in-flight invocation. Do not delete the journal. Reconcile existing attempts before resuming. This controls the fee wallet only, not contributor payments.                                                                                                                                                                             | [Fee converter](../workers/fee-converter/README.md), deployment and reconciliation                                                                                                              |
| Referral poster or root is compromised                           | Stop new posting, pause the distributor, then rotate the poster under the owner-approved plan. Void only the latest root, and only if no claim against it has succeeded. Confirm the root and claim counters before unpausing. A successful claim prevents voiding that root; paid tokens cannot be recovered. There is no guaranteed intervention window. The Worker key cannot perform these owner actions. Retain uncertain attempts and keep the program off until its watcher and activation requirements are satisfied. | [Referral incident procedure](referral-distributor-testnet-runbook.md#6-rehearse-one-epoch-end-to-end); [referral accrual](../workers/referral-accrual/README.md) |
| Scanner is producing invalid results or leaking evidence         | Disable `VETTING_CONTROLLER_SCHEDULE` and `VETTING_CONTROLLER_RELEASE` to block later scheduled dispatch and scan admission. Inspect already-running Actions separately; changing a variable does not cancel them. Preserve assessments, signed publication state and private evidence. Do not mark a failed or incomplete scan clean or silently reinstate a project.                                                                                                                                              | [Scanner](../workers/vetting/README.md); [controller workflow](../.github/workflows/vetting-controller.yml)                                                                                     |
| Backup or retention fails, or deletion cannot be justified       | Keep raw deletion disabled with `EVIDENCE_RETENTION_MODE = "off"` through the reviewed release. Preserve the active cycle, source bytes, private page receipts and failure queue. A missing daily completion receipt is a failed backup. Restore to an isolated destination and verify bytes before any production recovery.                                                                                                                                                                                        | [Backup and recovery](../workers/vetting-backup/README.md)                                                                                                                                      |
| Automatic Slopbot closure is incorrect                           | Keep or release `SLOPBOT_CLOSURE_ENABLED = "false"`. This controls automatic closure, not all review or assessment work. Preserve the verdict, consent and action evidence; use the existing appeal and maintainer reopening path. Do not reverse a ban or funded award as a workaround.                                                                                                                                                                                                                            | [Slopbot](../workers/slopbot/README.md)                                                                                                                                                         |
| Private-report submission is unavailable or unsafe               | Release `SLOP_PRIVATE_INTAKE_MODE = "off"` to close the automatic submission routes. Preserve drafts and uncertain submissions. Reconcile the original report reference against authorized GitHub advisory evidence before a resend; do not create a replacement report solely because the response was lost.                                                                                                                                                                                                       | [Private intake](../backend/security/README.md)                                                                                                                                                 |

Already signed transactions may still finalize after containment. Funded awards
remain reserved and permissionless payments can still execute. Do not cancel
payments or monthly commitments, withdraw reserved funds, delete obligations,
or erase evidence to make an incident appear resolved. The narrowly approved
obsolete EVM binding cancellation is governed by the attester procedure and
does not authorize other cancellations.

## Detection

The hourly [production watch](../.github/workflows/production-watch.yml) runs
`scripts/production-watch.ts` on `main`. It fails when `https://slop.cash/`,
the registry API (`GET /api/v1/projects`) or `https://slopbot.slop.cash/health`
returns a non-2xx status or does not answer within 20 seconds. It also fails
when any vault in the public registry has no cached snapshot, no observation
time, or a snapshot older than the `staleAfterMs` published by
`GET /api/v1/payments/projects/<id>/vault` (PRD sections 6 and 9). It does not
retry, uses no credentials and reads no chain RPC.

The same watch checks the identity Worker's existing
`GET https://identity.slop.cash/v1/oauth/authorize` route without parameters.
It expects HTTP 400 with `error: "invalid_request"`, the invalid-link refusal
returned before identity state is read or created. A timeout, another status,
or a different response fails the watch. This proves public-route availability,
not a completed GitHub sign-in or database/provider readiness.

It does not cover Worker cron failures that leave those answers healthy,
keeper, executor, fee, scanner or backup errors, or signed transactions. The
only notice is GitHub's failed-workflow email. Cloudflare Worker error
notifications and a confirmed delivery of that email to the primary and backup
responders remain owner steps. A stale vault failure points to the payments
Worker's scheduled snapshot refresh for that network.

## Recovery and verification

- Check the actual Worker version and source SHA, configuration, queue state,
  pending journal and canonical finalized receipts. Health responses and a green
  deployment alone do not prove recovery.
- Preserve the last good cached balance or snapshot with its observation time.
  An unavailable refresh must not become a zero balance, empty leaderboard or
  successful payment.
- For D1/R2 recovery, agree the maintenance window and exact source/destination
  first. Use an isolated restore, compare schema and records with their retained
  evidence, and verify foreign-key consistency and referenced object digests.
  An empty backup cycle does not prove recovery of real evidence. Cloudflare D1
  export can make the source unavailable while it runs; do not start a production
  export without the approved window.
- After repair, verify the affected end-to-end path, failure and retry behavior,
  and a real alert delivered to the assigned responder. Record exact revisions,
  environments, timestamps, results and any unresolved limits on the release
  issue. Redact private data before publication.

## Remaining operational acceptance

This runbook records the primary/backup assignment and the production watch but
does not supply an alert delivery receipt, production D1 restore drill, or real scanner evidence recovery. Track those separately from source completion. The live
network qualification and service activation gates remain in the PRD and
[mainnet runbook](../contracts/DEPLOY-MAINNET.md).
