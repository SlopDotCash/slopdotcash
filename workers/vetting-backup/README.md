# Private scanner byte backups

This Worker implements the daily raw-byte backup part of the approved scanner
evidence policy in issue #909 and PRD section 8. It has no HTTP read route. It
does not touch contributor traces or declare the
external evidence controls operational.

At 02:17 UTC, the scheduled handler starts one snapshot for that UTC date.
The queue copies `vetting/` objects that existed at the snapshot start. A page
contains at most 32 objects. Each stored object is at most the existing 8 MiB
evidence-part limit. Large logical evidence files already use several parts.
Copies retain each original R2 key and the observed byte SHA-256 in private
page receipts. The Worker hashes the actual bounded body rather than trusting
its evidence metadata. This preserves corrupt old targets for recovery without
claiming that they match the declared evidence. Missing or unreadable bodies
fail the page. Canonical retirement markers are verified and skipped; they
contain no original evidence. A completion receipt follows every successful page.

The start receipt, page receipts and byte copies are create-only. Duplicate
delivery reuses the verified page and continues from its cursor. A failed
page is retried five times and then moves to the private failure queue. A
failure queue entry or a missing daily `complete.json` needs investigation;
neither is a successful backup. D1 permits only one active storage cycle.
The single-consumer queue completes copying before it enters cleanup. A later
cron resumes that cycle instead of starting an overlapping snapshot. A stuck
cycle blocks deletion; investigate and replay its failed queue work.

The backup bucket must have the approved 30-day lifecycle rule. Each day uses
a separate prefix, so deleting an original does not make an older backup live
longer than that rule. A raw-byte backup does not back up D1 assessment,
inventory, policy or audit rows. Coordinated D1/R2 recovery and hosted
recovery verification remain separate required controls.

`restoreCheck` verifies the completion receipt and page hash chain, plus any
selected retirement supplement bound to that snapshot. It reads the copied
bytes and restores them under a separate `restore-checks/`
prefix in a supplied private destination. It checks the restored bytes too.
It cannot replace a live evidence key. Use an isolated destination with its
own disposal policy for a live restoration exercise; this source does not
claim that exercise has occurred.

## Raw-evidence retention

Raw deletion is separately disabled unless `EVIDENCE_RETENTION_MODE` is
`enabled`. After a complete snapshot, the same single-consumer queue selects
at most 16 objects whose case closed at least 90 days ago, using the D1 clock.
Open and recently closed cases are not eligible. Successful bounded admission-scan
evidence is permanent and is never selected for deletion, including original
evidence behind reused results (owner decision, 27 October 2026, #1467).
The admission gate still verifies all required retained bytes; retention is not
proof of a passed scan. Closure comes from migration
0066 and the policy-owner route in the evidence API.

Migration 0119 separates new content references into immutable storage
generations. Every writer reserves a fresh physical target before a create-only
PUT. A repair publishes a new target through a pointer compare-and-set; it never
overwrites an old target. Cleanup atomically freezes a generation only when all
its remaining references meet the retention predicate. New references, target
reservations and pointer publication then refuse for that generation.

The Worker processes every reserved target, including unpublished writes and
old layouts, in batches of 16. Existing bytes are copied and verified before a
permanent, non-evidence marker replaces them. Targets uploaded after the daily
snapshot receive supplemental byte copies and immutable receipts under
`daily/<day>/retirement/`, bound to the snapshot completion digest. Original
declared identity and observed byte identity remain separate. An exact copy is
`backed`; different observed bytes are `changed` and remain restorable for
investigation. Changed bytes never qualify the original declared slot as backed.

For an apparently missing target, cleanup first writes a create-only marker.
An earlier admitted PUT either wins first and is backed up, or loses to that
marker. Only a verified missing marker permits a `missing` receipt. Missing is
never backup evidence. Backed or changed paths publish their byte receipt before
the marker overwrite, so retries cannot infer a backup from an unbound orphan
payload. Lost replies retain committed copies, markers and receipts. The next
attempt verifies the same target and classification before proceeding.

The generation retires only after every reserved target has a verified marker
and D1 retirement record. A per-reference deletion receipt additionally requires
every declared full slot tuple to have a backed current head. Missing or changed
slots receive `retention-missing` instead. The cycle can advance past those gaps
without asserting complete evidence. Manifests, target history, heads, closures
and receipts remain. Marker objects must remain permanently present in the source
bucket; source lifecycle rules must not remove them. This safety argument assumes
all writers follow the new create-only protocol and no external actor removes or
overwrites markers. It is not an atomic transaction across D1 and R2.

Legacy null-generation references keep their existing locations and bytes.
They receive `retention-held` and no automatic deletion receipt. Old admitted
unconditional writers cannot be made safe retroactively; do not treat deploying
this source as evidence that such writers have drained. The historical DELETE
counterexamples remain documented in `vetting_retention`, while
`vetting_generation_retirement` models the new forward protocol.

Keep `max_concurrency = 1` and `max_batch_size = 1` on the queue. Do not call
backup or cleanup routines concurrently from another service. The active D1
cycle excludes a new scheduled snapshot until all cleanup messages finish.
The backup bucket's 30-day lifecycle still governs primary and supplemental
copies. Permanent markers are not backups. Keep retirement disabled until the
reviewed migration, writer rollout, hosted backup and restoration gates pass.

## Access-log retention

The same daily scheduled invocation removes scanner access audit entries older
than one calendar year, using the D1 clock. Migration 0067 replaces the blanket
no-delete trigger with a guard that still refuses deletion of newer or invalidly
dated records. Updates remain forbidden. A date index bounds the selection work.
The cleanup acts only on `vetting_evidence_audit`; it does not remove case closure,
assessment, contributor-trace or payment records. A cleanup failure fails the
scheduled invocation; it does not qualify as a completed retention run.

Both environments bind their existing private D1 database. Migrations must apply
before this Worker releases, as the checked-in deployment workflow requires.
The real local D1 workflow applies the migrations, refuses premature deletion,
keeps both records while disabled, and removes only an old entry when scheduled.
Hosted scheduling and retention still need release verification.

## Release

The checked-in workflow is the only deployment path. Production requires the
protected `main` release; staging uses `development`. Set the respective
`SLOP_VETTING_BACKUP_RELEASE` or `SLOP_VETTING_BACKUP_STAGING_RELEASE` repository
variable to `enabled` only after the private source/backup buckets, 30-day
backup lifecycle, work queue and failure queue exist. The release script
checks the workflow branch and commit, deploys that commit, and verifies that
100% of traffic is assigned to its tagged version. There are no new API keys. The separate
`SLOP_VETTING_RETENTION_RELEASE` and `SLOP_VETTING_RETENTION_STAGING_RELEASE`
variables enable raw deletion only through the reviewed release workflow.
The checked-in local configuration is off by default.

## Verification

Run `node workers/vetting-backup/workflow.mjs` from the repository root. It
uses local workerd R2 and a real queue consumer with 65 harmless objects. It
checks pagination, duplicate scheduling, restore integrity, source
preservation, exclusion of non-scanner objects, raw recovery of changed
source bytes, and refusal of corrupted backup copies. It does not prove hosted scheduling, lifecycle
deletion, D1 recovery or production access controls.

`generation-retirement.workflow.mjs` defines the new generation counterpart:
actual API registration/repair, migrated D1 and local R2; shared-reference hold;
all-target pagination; missing-target versus admitted PUT; zero-byte originals;
lost marker reply and interrupted retry; changed-byte recovery; corrupt or
unbound backup refusal; missing-head receipts; and a fresh successor generation.
These definitions and the new finite model were authored and manually reviewed
without executing tests, models, parsers or runtime checks in this change.

### Protected hosted recovery qualification

The same protected workflow also offers the isolated `flags` scope described
in [two-flag pause qualification](../vetting-flags/README.md). Its separate
entry and database use the full application migrations; this recovery scope
keeps its existing evidence-only schema and cases.

PRD sections 8 and 11 require restoration evidence before scanner activation.
`vetting-recovery-qualification.yml` is a manual `development` workflow in
the existing `slop-staging` environment. Its default `plan` mode makes no
remote request. After source review, choose `execute` to test harmless data
in new, run-specific resources. It reuses the existing Cloudflare credentials;
it needs no scanner, provider, wallet or temporary bearer key.

The queue-only qualification Worker imports this backup core. It uses two
temporary D1 databases, three private R2 buckets and a work/failure queue pair.
It does not bind the application databases or evidence buckets. There is no
HTTP read or control route, cron, model call or scan publication. The driver verifies private bindings and one queue consumer
before sending fixed fixture commands.

The test calls the actual Pages evidence handler internally with real D1 session
lookup and generated, synthetic operator sessions. Its fixed path and environment
allowlists contain only the disposable stores and a clearly marked fixture policy.
It refuses anonymous, expired, revoked, non-reader, cross-origin, wrong-object,
expired-grant and replay requests. Two simultaneous consumes must produce one
success. It verifies private response headers, exact single and chunked bytes,
scoped download cookies, completion/cancellation audit, policy-owner closure,
closure replay and access before/after the 90-day limit. It exposes no HTTP
adapter and makes no OAuth, provider or model request. No real operator is impersonated.

The test copies 73 harmless parts across multiple pages. It restores exact
bytes and a chunked file, rejects changed bytes and a missing page, preserves
the source, and repeats delivery without changing its completion. A synthetic
case snapshot restores the same inventory, policy, consumed grant, closure
and audit rows into the separate D1 database with their actual immutable-table
guards. This tests case identity recovery. It does not implement production
D1 backups or prove point-in-time recovery of the shared application database.

A separate fixed command runs the existing storage core on the same disposable
D1/R2 bindings with fixture-only retention enabled. Its sequential subjobs use a
controlled queue adapter for fault insertion; they do not claim hosted queue retry
evidence. The original backup phase still exercises real queue deliveries.
The legacy retention fixture records held references without deleting bytes or
issuing deletion receipts. Open and recent cases and the non-scanner sentinel
remain. Its backup/restore and corruption cases remain separate from the new
generation workflow's marker and retry cases. The actual scheduled handler
prunes only old audit fixtures; disabled
backup mode and the migration guards preserve current and invalid-date audit.
Timestamps are explicitly aged fixtures, not elapsed lifecycle observations.

The driver deletes only resources it created in that run, after checking
their exact IDs or creation identity. It first empties only its verified
fixture buckets. A nonempty bucket or changed identity stops deletion; the
safe report records incomplete cleanup. A failed or interrupted workflow
needs read-only inspection of that run's resource names before cleanup.
Never delete resources based only on a prefix or age.

Local preparation:

```sh
bun scripts/qualify-vetting-controls.ts
node workers/vetting-backup/qualification-workflow.mjs
```

The first command prints an offline plan. The second proves the same
qualification entry with local Workerd, D1, R2 and queues. `--execute` is
refused outside the exact protected workflow checkout. Hosted execution and
cleanup must be reviewed before dispatch. A passing harmless recovery test
does not enable retention deletion, the scanner controller or its schedule.
The report separates actual handler/session/core results from live OAuth and
operator-browser acceptance, production Pages bindings, elapsed 90-day retention,
and observed 30-day bucket expiry. Daily deployed scheduling and isolation
remain separate acceptance work. This controlled proof is not activation of production deletion.

Incomplete uploads can leave inventory without bytes. For new generations,
cleanup fences every reserved target and audits absent backed heads as
`retention-missing`; it does not fabricate a deletion receipt. A durable cleanup
cursor advances past these gaps. Missing evidence stays distinct from complete
retirement and cannot prevent later daily backups. Unreadable bytes, conflicting
copies, invalid receipts or an unconfirmed marker still stop that target's work.
