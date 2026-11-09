# Trace intent admission at the current run state

This source-only correction follows `3d5104b00`. No tests, parsers, format/type
checks, simulations, model verifiers, applications or services were run. The
six authored regression cases and fourteen model scenarios are unexecuted.
No private trace or live storage was read.

`createTraceIntent` reads an owned, non-finalized run before body parsing and
capability derivation. Previously, new-intent INSERT and expired-intent renewal
UPDATE checked only participation restrictions. A parallel request could
finalize the already-attached run during those awaits, after which the delayed
request inserted or renewed an intent and returned an upload URL. Similarly,
a competing attachment could choose another digest before the intent write.
The later upload route already refused finalized or incompatible runs before
reserving or writing R2 bytes. This was a stale intent-admission defect, not a
trace disclosure or finalized-body overwrite.

Both writes now share a SQL predicate requiring the current run ID, the current
owner, a non-finalized state and a null or matching attached digest. The guard
executes with the INSERT or UPDATE; it is not another earlier preflight read.
Existing intent reads and renewal readback use that same predicate and the ban
predicate in one joined lookup. This also refuses a replay when finalization
committed before the lookup, without an intervening separate ban-read await.
A refused operation is reported using the current run state (`run_finalized`
or `trace_conflict`) when applicable; ordinary
metadata/idempotency conflicts keep their existing error.

Exact existing-key replay is unchanged: an unexpired intent returns its same
capability, only an expired unconsumed intent may renew, and a consumed intent
returns its original receipt without restoring use or extending expiry. A
read-only replay may finish after finalization that follows its authorized
atomic lookup, without changing intent metadata. New or renewed metadata cannot
commit after finalization. A renewal committed before finalization remains
stored even if the subsequent authorized readback refuses to return it.
The response and lookup are not a transaction with other HTTP requests; the
model retains this normal snapshot boundary. The existing run, upload,
attachment and R2 integrity rules remain unchanged. No authentication, token
lifetime, intake or body-validation policy was
changed.

`api_trace_intent_admission.qnt` models one run, one owner and a second actor,
two request keys, two digest/size/media-type representatives, and creation plus
one renewal per key. It separates handler admission, intent read and mutation,
permits concurrent attachment/finalization/ban, and distinguishes read-only
replay and post-renewal readback. Its finalization invariant freezes the mutation
count. Fourteen scenarios cover both delayed writes, both digest conflicts,
owner refusal, exact replay,
renewal, consumed replay, metadata conflict, a ban, refused late replay and
retained read-only replay after an authorized lookup, and committed renewal
whose later readback refuses after finalization.
Cryptography, upload body/R2 behavior, full timestamp arithmetic and unbounded
renewal are outside this model; `api_trace` retains the upload/read boundary.

`scripts/trace-upload-attachable.test.ts` adds four definitions using the actual
handler and migrated SQLite persistence. Each pauses the new INSERT or renewal
UPDATE immediately before execution, completes a real attachment or finalization
through the handler, and then requires a refusal with unchanged intent rows and
no other trace bytes in the local R2 fixture. A fifth holds the existing-intent
lookup across finalization; a sixth retains exact replay, renewal and
consumed-capability behavior. It does not access remote R2, send a
message or claim runtime conformance before those tests are executed.
