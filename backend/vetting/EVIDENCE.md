# Restricted vetting evidence

VET-03 uses a separate private `VETTING_EVIDENCE` R2 binding. It does not use
contributor traces, their permanent storage rule, or contributor read grants.
D1 migrations 0034 through 0036 store immutable object receipts, run policy snapshots,
chunk layouts, completion records, grants and access audit records. Raw bytes remain outside Git and public responses.

The service is inactive without the bucket. The evidence terms are fixed in
source as `EVIDENCE_POLICY` in `evidence.ts`; there is no deployment policy
setting and no operator attestation. Changing the owner, readers, durations or
limits is a reviewed code change. The policy owner is `18633264`, and the
readers are exactly `18633264` and `202660855` (see
[the approved policy](#approved-production-policy)). Each run stores a copy of
the terms it used.

`readGrantDurationSeconds` (900, the approved 15-minute operator grant) controls
the read token, database expiry and download cookie only.
`postClosureRetentionSeconds` is 7776000 (90 days) for other cases. Successful
bounded admission-scan evidence is retained permanently, including original
evidence behind a reused result (owner decision, 27 October 2026,
[#1467](https://github.com/SlopDotCash/slopdotcash/issues/1467#issuecomment-6438784205)).
This classification affects retention only. It never turns an incomplete or
historical metadata-only result into valid clearance. Migration 0066 records
an immutable case closure when a clean scan is accepted, in the same transaction.
Existing clean assessments receive their original completion time as closure.
Incomplete and malicious assessments stay open until the policy owner calls
`POST /api/v1/operator/vetting-evidence/:assessment/close` with a nonempty
`reason`. This requires the policy owner's authenticated session and same-origin
JSON. Another evidence operator cannot close the case. Repeating closure returns
the original date and cannot restart the clock. Closure does not release a
quarantined project, change a scan result, or change awards.

Evidence remains readable while the case is open. The operator overview returns
`expiresAt: null` while open or for permanent admission evidence, and otherwise
the closure time plus 90 days afterward. At that
boundary new grants and reads are refused. The old upload-based `expires_at`
column stays in immutable run history but no longer determines current access.

The backup worker implements separately gated R2 deletion after its snapshot
completes, plus one-year audit retention. See
[the storage workflow](../../workers/vetting-backup/README.md).

## Approved production policy

The owner approved the [operator designation](https://github.com/SlopDotCash/slopdotcash/issues/909#issuecomment-6379712530)
and [retention and recovery terms](https://github.com/SlopDotCash/slopdotcash/issues/909#issuecomment-6379714982):

- The evidence operators are `lalalune` (18633264) and `drew-dot-com`
  (202660855). `lalalune` is the policy authority. This access is separate
  from the moderator role.
- Each audited read grant lasts 15 minutes.
- Keep successful bounded admission-scan evidence permanently. Keep other raw
  evidence while its case is open and for 90 days after closure.
- Make daily private backups. Keep each backup for 30 days. Deleted evidence
  can therefore remain in backups for up to 30 additional days.
- Keep access logs for one year.
- Prove restoration before production activation.

These terms apply only to scanner evidence. They do not change permanent
contributor-trace storage. Keep production and staging stores separate;
preview deployments have no evidence-store binding.

## Write and inspect exact bytes

The existing signed vetting service registers an immutable object inventory at
`POST /api/v1/vetting/evidence/:assessment/:run`. The body contains `traceSha256`
and `objects`, each with `sha256`, `sizeBytes`, `kind`, `label`, and `contentType`.
The assessment must already exist. The run is the exact `environment.runId` of
the result. Each body is then uploaded to the same path plus `/:sha256` with PUT.
The signed method, path, timestamp and body prevent cross-route replay. Repeating
the same inventory is safe; changing it under the same run identity is refused.
The object write is create-only. The server reads back complete bytes and checks
the digest and length before it records success.

This inventory is a storage receipt, not another scan or assembly format. Bind
`assemblySha256` to the exact existing `slop-evidence-assembly-v1` manifest. The
manifest must itself be a registered manifest object. This optional field allows
incomplete raw evidence to be stored before assembly; its absence never permits
clean admission. Existing receipts remain immutable and receive no inferred
assembly. A new receipt uses a new run identity.

The store keeps the canonical manifest parser of the retired secure-VM
assembler (owner decision, 29 October 2026, #1467 item 3.10(b)), so
historical manifests stay verifiable. Closure verifies
all declared captured-evidence file digests and lengths, the exact review input,
source and dependency object references, artifact lineage, and the captured VM
receipt/overlay/serial/disk-map references. An optional guest receipt must bind
the captured source, profile and VM, and its trace, output and post-collector
output must remain retained even if a submitted file list tries to omit them.
The exact assessment must agree with D1 and the retained queue input from
authenticated acquisition. Review input must preserve the assembly's
visibility gaps. Both existing serial variants (with and without the optional
guest collector) are supported. Missing, changed or unregistered referenced
bytes prevent verified retention. Every registered object is reread and hashed.

This is closure of canonical captured evidence, not retention of every runtime
input. Receipts also pin base disks, seed images, firmware, host toolchain
executables, the guest collector and kernel policy. Those operator-controlled
provenance inputs remain external; their
large bytes are not implicitly copied into this capture store. The UI
states this boundary. The storage run immutably binds the assembly and captured
VM digests; the current VM format does not independently assert a run ID.

Retention and scan readiness are separate. The ordinary bounded scan uses
`slop-vetting-result-v2`. Its retained evidence must include the exact report,
input inventory, dependency locks and every named artifact. The service rereads
and verifies their bytes before accepting the result. The
[bounded scan rules](../../workers/vetting/README.md#bounded-malicious-code-scan)
also govern coverage, model review and clearance; storage alone cannot pass a scan.

Historical v1 results keep the original assembly rule. That assembler was
explicitly incomplete and authorized no provider calls or publication. Retention
cannot remove its gaps or turn a legacy metadata-only claim into clearance.
Unknown assembly states are refused. Incomplete evidence and malicious findings
can still be recorded without permitting activation, skills or reinstatement.

Dynamic skills, discovery and public clearance use no-store, so a prior cache
entry cannot bypass the gate. Unrelated raw registry lists and revision caches
retain their existing behavior. Public responses never contain captured source,
private paths or URLs. Parse failures in the private overview return a fixed
message rather than an excerpt of malformed raw evidence.

Owner decision, 28 October 2026: scanner evidence has no object or run size
limit (the former 64 MiB cap is removed). Only each request is bounded: every
upload, read and backup step handles at most one 8 MiB part, and the signed
1 MiB registration declares at most 1,024 objects, about 9,000 declared
parts. Storage is not the binding limit, though: registration, finalization,
intake and every clearance check reread and hash an object's whole bytes
inside one Worker request, so the practical ceiling per object is that
request's CPU budget; the maximum depends on the runtime and evidence
layout. If verification cannot finish, a clean result stays pending rather
than clearing. Oversize parts are refused, and
evidence is never shortened or silently omitted to obtain clearance.

Evidence is identified by its SHA-256 and shared within an active physical
storage generation. Migration 0119 binds every new run object immutably to
that generation. D1 keeps the run manifest, generation, declared layout,
reserved targets and the current target for each exact part. Physical keys
use `vetting/generations/<generation>/<target>`. `object_key` remains the
unique historical identity of the run's object.

Each physical body is written create-only after its input digest is checked,
then read back and verified. An observed valid current target is reused. A
missing or corrupt target is repaired into a newly reserved key; publication
compares the expected prior pointer and requires an active generation. A lost
write or publication reply does not erase the reservation. Every candidate,
including failed and unpublished candidates, remains in the retirement
inventory. Unknown read failures do not authorize a repair. ETags do not define
generations or authorize overwriting generated body keys.

Rows from migration 0107 through 0118 keep their shared digest keys. Earlier
rows keep their run-scoped keys. These legacy rows remain readable, but the
collector holds them without a deletion receipt: an already-admitted old
writer cannot be fenced retroactively. Legacy corruption repair still uses
the observed ETag; a missing copy retries create-only. New registrations do
not attach to a legacy key or reuse any retired generated key.

Registration's `stored` response contains digests whose declared parts were
observed intact through that run's immutable binding. This is only a hint.
Chunked objects still require their own finalization, which verifies the
ordered whole-file digest. A missing, corrupt, expired or partly uploaded
object never supplies clearance.

The collector freezes a generation only when no current retained reference
requires it. No target reservation or pointer publication can commit after
that transition. It visits every reserved target, including alternate declared
layouts and failed repair candidates. Existing bytes require verified backup
before replacement by a permanent non-evidence retirement marker. An absent
target is fenced create-only, so a late writer either loses or must be backed
up before replacement. The marker stays permanently; ordinary reads refuse it.
A new run after retirement selects a new physical generation.

Retirement of physical targets and complete backup of a run are different
outcomes. Missing declared parts keep a `retention-missing` audit and never
receive a complete deletion receipt. Legacy and currently shared generations
keep a `retention-held` audit. Changed raw bytes are backed up under their observed digest and remain
distinct from valid declared evidence. They never satisfy a complete per-run
evidence deletion receipt. Unreadable bytes, failed storage operations and
unknown outcomes remain incomplete and retryable.
See the [backup worker](../../workers/vetting-backup/README.md) for the bounded
collector, supplemental backup receipts and restoration contract.

Apply migration 0119 before the new API and collector. Its guards refuse old
registration code and prevent an old collector from inventing a new-generation
deletion receipt. This source change does not deploy or activate retention.
Legacy writer quiescence, exact-head tests, backup/restore qualification and
production release remain separate acceptance work.

The intake parses a scan report or inventory whole; one larger than 32 MiB
cannot be parsed in a Worker request and is refused as not retained. This bounds
those JSON documents only, never artifacts or total evidence.

Objects above 8 MiB declare `chunks` in their immutable object receipt. Each entry
has `index`, `sha256` and `sizeBytes`. Indices start at zero, parts are exactly
8 MiB except the final remainder, and the total equals the original object size.
This is a transport layout, not a new evidence format. The original whole-file
SHA-256 remains authoritative. Upload each part with a signed PUT to
`/:sha256/chunks/:index`; retrying exact bytes is safe. An existing conflicting
part is never overwritten. POST the signed exact body `{}` to
`/:sha256/finalize`. Finalization reads parts sequentially, verifies each, and
hashes their original bytes in order with the pinned incremental SHA-256 code.
It never substitutes a hash of hashes or an R2 ETag. The completion record and
its audit commit in one D1 transaction. An interrupted upload or a missing,
changed or wrong-whole-digest part cannot produce completion. Retry the same
immutable upload/finalization; a different layout requires a new run.

Verification and download hold at most one 8 MiB part buffer at a time. Download
backpressure controls part reads. Current authorization and access expiry are
checked again as each part is read. Complete clearance rechecks retained bytes;
a completion receipt alone is not evidence that R2 objects still exist.

Only an authenticated WebSession whose immutable GitHub actor ID appears in the
current operator allowlist may inspect `/vetting-evidence`. Admin, applicant and
project-owner roles do not grant access. The admin assessment links to this
separate console. A reason is required for each object read. The server issues a
single-use grant with the configured read duration (at most 900 seconds) bound to that actor, assessment, run and object.
Operator authorization, policy currency, expiry and complete bytes are checked
again at read time. Audit rows retain the actor, reason and action. Grants and
bodies use no-store; bodies use attachment, nosniff and a restrictive CSP. Text
is escaped. Binary downloads never execute.
Buffered responses refresh retention and recheck the same current operator
after storage and the read audit complete. A read audit records verified bytes
prepared for access, not proof that the client received them.

Large downloads use a dedicated JSON POST `/:sha256/download-grant`. It returns
no token in JSON or a URL. The server sets `__Secure-vetting-read-grant` as a
Secure, HttpOnly, SameSite=Strict, host-only cookie with the exact native download
path and the same configured read-grant lifetime. The browser follows `/:sha256/download` as an
attachment. GET requires `Sec-Fetch-Site: same-origin`, current session/operator
policy and the actor/object-bound single-use grant. Duplicate grant cookies,
ranges and HEAD are refused. Download responses do not change the grant cookie:
a delayed response must not clear a newer same-object grant. The spent cookie
may remain until its original 900-second expiry or a later grant overwrites it;
the consumed D1 row prevents reuse.
The site's CSP stays unchanged. Small text inspection keeps the existing header
grant and bounded client digest check.

Audit distinguishes download authorization, start, server stream finish,
cancellation and failure. Server finish does not prove the browser saved the
file. Failure to record the final audit errors the stream; it never hangs or
silently succeeds. A cancelled or failed transfer needs a new reason and grant.
The UI reports that a download was requested, not that the browser saved it.

The registration and operator console work with incomplete assessments. Missing,
corrupt, oversize and expired bodies remain explicit failures. Harmless paused
applications and queue registration remain available without storage; signed
queue acquisition fails closed before work starts if evidence storage is not bound.
Production binding, policy approval, external controls, actual collector/provider
integration and live acceptance are not performed by this source change.

The local retained-assembly workflow that replayed secure-VM outputs was
retired with that pipeline; no new assembly is produced. The built console uses
the same handler and store with an isolated operator-session adapter; the Pages
browser suite separately checks routing and session behavior. No response data
is substituted in the console.

Console evidence checks keyboard access, accessibility, a 320 CSS-pixel mobile
layout with 200% text enlargement, and 200% desktop zoom. A 390-pixel viewport at CSS zoom 2 has only 195 CSS
pixels and exceeds the site's existing 320-pixel minimum; that case is not
claimed to pass. Captures and raw input bytes stay outside Git.


Legacy cleanup claims and their existing receipts stay in the database as
history. The new collector does not use those claims as a fence for generated
storage and does not delete legacy bytes. The old late-write and omitted-layout
counterexamples remain documented in the historical models; the new generation
models cover reservation, publication and permanent retirement markers. No
source model or passing bounded check alone proves implementation refinement
or that deployed legacy writers are stopped.
