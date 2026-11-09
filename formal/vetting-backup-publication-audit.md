# Vetting backup publication and recovery

This source-only refinement covers PRD section 8's private scanner backup and
restoration flow. No runtime defect requiring a source change was confirmed
under the documented single-consumer queue contract. It replaces the former
five-scenario `vetting_backup_chain` abstraction with 21 named scenarios,
preserving all five original names. No test, parser, checker, application,
service or release script was executed for this review. Only source metadata
inventories are regenerated. No remote service or private record was accessed.

## Source boundaries

`workers/vetting-backup/core.ts` deliberately has several commit boundaries:

| Boundary | Source | Recovery state |
| --- | --- | --- |
| Admit one active cycle | `startDailyBackup`, lines 98–105; migration `0068_vetting_storage_cycles.sql` | D1 can contain a backup-phase cycle before its start receipt or first queue message exists. A later cron resumes that cycle. |
| Publish and verify bytes | `immutable`, lines 64–77; `verifiedPart`, `backend/vetting/evidence-chunks.ts` lines 81–125 | A conditional R2 put may commit before an error or failed reread. Presence alone is not a verified copy or successful call. |
| Publish a page and continue | `backupPage`, lines 165–245 | Verified object copies may exist before the page. The page may exist before the next message is accepted. Replay verifies and reuses that exact page, then resends its continuation. |
| Complete snapshot and enter cleanup | `backupPage`, lines 247–262; `finishBackup`, lines 275–281 | The completion object can exist while D1 still says backup; D1 can say cleanup before its cleanup message is accepted. Cron or message retry resumes from those durable states. |
| Finish a queue attempt | queue handler, lines 521–534 | Successful work is acknowledged after the core operation. Failure requests retry. Lost continuation/acknowledgement can leave both an existing successor message and a duplicate predecessor. |
| Restore a selected object | `restoreCheck`, lines 448–502 | The completion, chain, counts, selected-object uniqueness and selected bytes are checked before a create-only destination put. Destination bytes can exist even when post-put verification fails. |

The source preserves these intermediate objects; it does not roll them back.
An exact retry can reuse them. Existing conflicting destination bytes are not
overwritten and cannot become a successful restore through another create-only
put. The core has no public read or restore endpoint; `fetch` returns 404.

A complete receipt is historical publication evidence, not proof that every
current backup object remains readable. Restore rereads the chain and selected
bytes. Cleanup checks the completion receipt and verifies every selected
inventory part before deleting source bytes. A missing completion receipt leaves
the cleanup cycle incomplete. Source deletion, shared-reference claims and
permanent-admission policy remain in `vetting_retention` and
`vetting_object_lifecycle`; this refinement does not duplicate those models.

The assessment result-once trigger in migration
`0025_community_security_vetting.sql` prevents an already-finished, expired
exception assessment from changing into a new permanent clean result during
cleanup. New shared registrations compete with the durable digest cleanup claim
through migration `0107_vetting_content_addressed_evidence.sql`. These existing
guards were read; no new permanent-evidence race was confirmed here.

## Refined model

The model has one day, two pages with one object each, six queue deliveries,
two explicit duplicate deliveries and three restore attempts in one fixed
private check namespace, with one destination key per source object. A cleanup message
has its own identity. Pending membership records whether work exists; it does
not preserve a queue's complete ordering or duplicate multiplicity. The
configured `max_concurrency = 1` and `max_batch_size = 1` remain assumptions,
as do jobs originating from the core's own cursor/predecessor/count chain.

Object presence, exact current bytes, verified-copy history, current page
presence, page history, completion publication, D1 phase and acknowledgment are
separate state. Page history is retained after external loss of a page: the
source can hold its verified predecessor digest even if that earlier object is
subsequently lost. Such a later completion does not make restoration succeed.
Similarly, destination presence is separate from a confirmed restore result.

The scenarios retain success, duplicate refusal, incomplete-snapshot refusal,
single-cycle exclusion and replay without page advancement. New traces cover
committed copy/page/start objects followed by lost responses, continuation sent
before predecessor retry, completion before the D1 phase transition, cleanup
enqueue failure, D1 phase-update failure with retained receipt and exact retry,
stale delivery after completion, destination write before
failed restore verification, exact restore retry, conflicting destination,
missing/corrupt selected bytes, missing pages and missing completion during
cleanup. A captured completion read can authorize the D1 phase transition even
if that receipt is lost before the update; the cleanup attempt rereads it and
refuses. A committed cleanup phase also survives lost acknowledgement. No
failed attempt is treated as acknowledged.

The model's `chainMatches`, `totalsMatch` and `uniqueObject` values stand for
the corresponding source checks; cryptographic and JSON implementation details
are not reimplemented. A restoration result means the destination was verified
for that call, not that it can never later expire or be modified externally.
Loss transitions represent external corruption or lifecycle loss, not an
application deletion endpoint.

## Existing authored evidence and limits

No new executable regression was added. The reviewed existing definitions are:

- `workers/vetting-backup/workflow.mjs`: actual local queue completion and
  cycle observation at lines 120–161; exact restore at 164–183; changed bytes
  refused before destination creation at 185–200; interrupted retention and
  retry at 375–418.
- `workers/vetting-backup/qualification.ts`: exact object/fixture-database
  restoration and final database digest at lines 306–355; chunk reconstruction
  at 357–375; changed-copy and missing-page refusal at 422–465.
- `workers/vetting-backup/qualification-retention.ts`: missing/corrupt backup
  refusal and partial deletion at lines 205–245; immutable deletion replay and
  exact restoration at 296–336.

Those definitions do not individually exercise every newly modeled boundary,
especially a committed destination whose reread fails, continuation accepted
with a lost response, and R2 completion publication followed by D1 failure.
Their earlier execution records remain historical evidence; this source-only
refinement does not rerun or renew them.

The fixture database restoration in `qualification.ts` inserts rows into a
separate disposable database and checks the final snapshot digest. It is not
an atomic production D1 restore API. Coordinated production D1/R2 recovery,
hosted scheduling, queue/provider behavior, lifecycle policy, operational
permissions, arbitrary page counts, malformed external jobs and unlimited
retries are not proved by this finite model. The release script was read only
as a deployment boundary and was not invoked.
