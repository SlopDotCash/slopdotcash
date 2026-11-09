# Trace upload reservation, storage and attachment

This model-only refinement follows source commit `e38b05ae8`. No tests,
parsers, formatters, type checks, simulations, verifiers, applications or
services were run. All twenty-one authored scenarios in the revised `api_trace`
are unexecuted. No private trace, remote bucket or production database was
read. Runtime code is unchanged.

## Source correspondence

The previous model's `reserve` action issued a live capability but did not
represent the separate permanent reservation named by the backend audit. The
new model distinguishes these boundaries:

| Model action | Source operation and retained boundary |
| --- | --- |
| `issueIntent` | An owned, compatible, non-finalized run receives a capability. Exact creation, idempotent replay, expiry renewal and delayed readback remain in `api_trace_intent_admission`. |
| `dispatch`, `readCapability` | `uploadTraceCapability` captures `authorizedAt` before `getUploadIntent`. The lookup and eventual consumption compare expiry to that captured value. Another request may consume the capability while this request waits. |
| `validateUpload` | The handler checks participation, private-intake availability, normalized media type, bounded UTF-8 body, exact length and digest before reservation. Exact parser/crypto behavior is an external predicate in this model. |
| `reserveInsert`, `readReservation` | `reserveTraceWrite` inserts the first immutable run/digest/metadata reservation, then separately reads it with current run-state and ban predicates. A losing digest or a later ban/finalization refuses readback; it does not erase the first reservation. |
| `putBytes`, `verifyObject` | `putTraceBytes` either finds the immutable key or attempts conditional creation, then checks metadata and exact body digest. A thrown write can still leave bytes, so storage outcome and verification are separate. No failure removes a retained object. |
| `attach` | `attachTrace` batches capability consumption, object metadata, upload identity, run state and the attachment commit witness. Migration `0005` aborts the transaction if any join is missing. Failed or refused attachment changes none of those D1 families; R2 and the earlier reservation remain. |
| `reply` | The post-commit `getRun` may observe concurrent finalization. Returning that state does not undo the accepted attachment. |
| `loseAttachmentReply` | A committed batch can lose its response; its consumed-capability readback or caller observes failure while all committed rows remain. Reusing that capability does not repeat the attachment. |
| `event`, `finalize`, `removedRoute` | Event insertion and finalization retain their current SQL ban/owner/state guards. Finalization preserves its first event boundary. Former grant/read routes remain unavailable and retain historical rows. |

`api_trace` maps the handler, persistence, contracts, auth and validation sources
and migrations `0001`, `0005`, `0006` and `0058`. Mapping is a review pointer,
not a claim that every statement or schema migration is proved by this model.
The run is already created and belongs to the caller at initialization;
signature validation, role filtering and creation idempotency remain outside
this upload composition. The run owner cannot change through the modeled API.
Event actions represent new event writes, not read-only idempotent replays;
their current-state SQL check is atomic here, without the earlier handler read.
The initial object/receipt sets are empty. Shared-digest reuse by other runs
and actors is outside this single-run composition.

## Preserved behavior and corrected abstraction

An upload admitted before capability expiry may finish after the wall clock
passes expiry. Both `getUploadIntent` and the consuming UPDATE use the request's
captured `authorizedAt`; this change does not tighten that runtime policy.
The former `orphanTest` incorrectly treated expiry after R2 writing as sufficient
to prevent the already-admitted attachment. Its name is retained, but its
witness now uses failed object verification. The separate expiry scenarios
distinguish admission before expiry from a request dispatched after expiry.

The permanent reservation is not a successful upload. Failed storage can leave
no object, or can leave bytes whose response/verification was lost. A later
same-capability, same-byte request can reuse the reservation while it remains
unconsumed and unexpired. A different digest cannot replace it. The README now
states that distinction instead of saying every failed capability is unusable.

A successful reservation readback authorizes the R2 attempt. A later ban may
leave permanent bytes, but the attachment SQL refuses and does not consume the
capability or create D1 attachment metadata. A ban between reservation INSERT
and readback leaves only the reservation. These are different partial states.

Two overlapping requests can observe one live capability, but only one may
commit its consumption. Two different capability keys for the same digest
can both commit before finalization; they produce separate immutable upload
receipts and one run digest. A later finalization prevents another attachment
and event insertion without deleting earlier receipts.

## Bounds, scenarios and evidence

The finite domain has one already-created run, one fixed owner, two capability
keys, two digest/size/media-type equivalence classes, and two overlapping HTTP
request slots. Each slot dispatches at most twice. There are at most two event
appends and two requests to retired routes. Expiry, bans, reinstatement and
private-intake availability use finite observations. Intent renewal belongs
to the separate intent model; the upload model has no renewal transition.

The twenty-one scenarios cover the original success/orphan/retired-route names,
competing digests, absent and retained R2 failures with same-byte retry, bans
before reservation/between reservation and readback/after readback, both expiry
orders, same-capability races, separate same-digest capabilities, a late
attachment after finalization, atomic-batch failure and retry, invalid bytes,
unavailable intake, finalization before response, lost attachment response,
immutable event boundary and post-attachment ban. The invariant joins consumed
capabilities to upload and commit receipts, requires verified attachment
metadata and retained bytes
before a run is complete, preserves the reserved digest, freezes finalized
events and forbids an application body read.

Existing source regression definitions in
`scripts/trace-upload-attachable.test.ts` include:

- `overlapping different uploads retain only the reserved trace`;
- `a failed storage write retains its reservation and permits a same-byte retry`;
- `an intent issued before another trace attached cannot write its bytes`;
- `an intent issued before finalization cannot write its bytes afterwards`;
- `a stale or disabled private intake observation refuses a capability upload before any bytes are kept`;
- `an account ban stops trace intents, capability uploads and finalization on existing runs without retaining R2 bytes, while preserving wallet claims`;
- `a ban landing concurrently with trace intent creation, capability upload or finalization refuses the write`.

These definitions exercise the actual handler, migrated SQLite adapter and a
local create-only R2 fixture. They were read, not executed for this refinement.
They do not by their names establish every new modeled interleaving: captured
expiry after dispatch, two simultaneous requests sharing one capability,
lost R2 response followed by verification, every D1 rollback failure and
post-attachment response timing/loss still need exact-source runtime evidence
if that evidence is required. No new runtime test was authored for this
model/documentation-only change.

The model does not establish Cloudflare D1/R2 implementation guarantees,
durability across provider failure, cryptographic collision resistance,
arbitrary UTF-8/NDJSON parsing, storage corruption behavior, unlimited retries
or renewal, migration correctness, or eventual success. Atomic D1 batches and
create-only R2 behavior are assumptions at this boundary. Retained bytes are
represented by digest, not trace contents. No privacy disclosure, overwrite,
extra storage write after a refused reservation, or absence of all trace
state errors is claimed.
