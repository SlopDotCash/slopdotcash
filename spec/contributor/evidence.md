# Optional contributor evidence: decision, exact selection and signed receipt

This model covers PRD sections 4 and 9 and CLAUDE.md "Private traces" and
"Installer and attribution". It is the abstract contributor-side view of one
optional private trace, and the only trace decision machine: the
[client retry machine](./runEvidence.md) refines it, so its consent,
inspection, exact-selection and stored-digest rules hold of every reachable
retry state. Submitting the pull request belongs to the
[work model](./workflow.md), whose `submit` reads no evidence state, so
declining, failing or never deciding evidence never blocks a contribution. The server records that accept, reserve, attach and
finalize the bytes are the [server trace run](./traceServer.md). This unit
holds no trace bytes, assertion, token or capability.

Trace bodies are never readable: no transition here or in the server unit
returns a body, and the read refusal for every role is
`security/privacy.md` `alwaysNoTraceRead` (composition obligation). Token and
trace evidence are diagnostic only: no rule here produces a score, rank,
share or payment, and the points area must not read this state (composition
obligation).

## Story: Submit optional private evidence without blocking a contribution

A contributor may decline evidence collection, declare a human-only
contribution, or inspect and redact one local snapshot and upload exactly
those bytes. The contributor's client (sender `contributorClient`) decides;
the Slop server's authenticated replies (sender `slopServer`) report the run
and the stored digest.

### Evidence state is separate from ordinary submission

```quint
import localReceipt as LR from "./localReceipt"
type EvidencePhase = Undecided | Declined | HumanOnly | Selected | Stored | UploadFailed
type MediaType = PlainText | NdjsonText
type ServerStage = NoServerRun | AwaitingTrace | TraceUploaded | TraceFinalized
type Snapshot = { digest: str, size: int, media: MediaType, inspected: bool, disclosed: bool, consent: bool }
type RunReply = { serverRun: str, stage: ServerStage, storedDigest: str }
type UploadReply = { serverRun: str, digest: str, stage: ServerStage }
type SignedReceipt = { signed: bool, runDigest: str, traceDigest: str, deviceKey: str,
  provider: str, model: str, client: str }
type Evidence = { phase: EvidencePhase, digest: str, size: int, storedDigest: str, receipt: SignedReceipt }
pure val maxTraceBytes = 8388608
pure val signatureVerifier = -1
pure val slopServer = -2
pure val contributorClient = 1
pure val noSnapshot: Snapshot = { digest: "", size: 0, media: PlainText, inspected: false, disclosed: false, consent: false }
pure val noReceipt: SignedReceipt = { signed: false, runDigest: "", traceDigest: "", deviceKey: "",
  provider: "", model: "", client: "" }
pure val initial: Evidence = { phase: Undecided, digest: "", size: 0, storedDigest: "", receipt: noReceipt }
pure def canDecline(e: Evidence, by: int): bool = by == contributorClient
  and (e.phase == Undecided or e.phase == Selected or e.phase == UploadFailed)
pure def decline(e: Evidence, by: int): Evidence = { ...e, phase: Declined }
```

### A human-only contribution uploads no agent trace and signs no agent receipt

The private trace contract (`backend/trace/README.md`, "Private trace
privacy contract") lets a human who did not use an agent declare a
human-only contribution; that contributor uploads no agent trace. Selection
is refused afterwards.

```quint
pure def canDeclareHumanOnly(e: Evidence, by: int): bool = by == contributorClient and e.phase == Undecided
  and not(e.receipt.signed)
pure def declareHumanOnly(e: Evidence, by: int): Evidence = { ...e, phase: HumanOnly }
pure def alwaysHumanOnlyHasNoTrace(e: Evidence): bool = e.phase == HumanOnly implies
  e.digest == "" and e.storedDigest == "" and not(e.receipt.signed)
pure def sometimesHumanOnly(e: Evidence): bool = e.phase == HumanOnly
```

### Only one inspected, disclosed, consented snapshot of bounded size can be selected

The contributor inspects and redacts the selected file first (CLAUDE.md
"Private traces"). The command then opens it once, reads one snapshot, and
shows its path, byte count, media type and SHA-256 digest before
authorization. The uploader performs no redaction and stores the exact
selected bytes: the selected bytes are the retained bytes. A changed file is
a new selection with a new digest. Selection is refused after a human-only
declaration.

```quint
pure def validSnapshot(snapshot: Snapshot): bool = snapshot.digest != "" and 1 <= snapshot.size
  and snapshot.size <= maxTraceBytes and snapshot.inspected and snapshot.disclosed and snapshot.consent
pure def canSelectTrace(e: Evidence, by: int, snapshot: Snapshot): bool = by == contributorClient and validSnapshot(snapshot) and
  (e.phase == Undecided or e.phase == Declined or e.phase == UploadFailed or e.phase == Stored)
pure def selectTrace(e: Evidence, by: int, snapshot: Snapshot): Evidence =
  { ...e, phase: Selected, digest: snapshot.digest, size: snapshot.size }
pure def alwaysSelection(e: Evidence): bool = ((e.phase == Selected or e.phase == Stored) implies
  e.digest != "" and 1 <= e.size and e.size <= maxTraceBytes)
  and (e.phase == Undecided implies e.digest == "" and e.storedDigest == "")
```

### The server's retained digest is learned once and never replaced

A registration reply may reveal that the server already holds an uploaded or
finalized trace for this run, for instance after a lost upload reply. An
upload reply stores the exact selected digest. A different selection against
a retained digest fails; choosing different bytes needs a new run. A stopped
attempt keeps whatever the server retained.

```quint
pure def consistentRun(reply: RunReply): bool = reply.serverRun != "" and reply.stage != NoServerRun
  and ((reply.stage == AwaitingTrace) iff (reply.storedDigest == ""))
pure def canRegister(e: Evidence, by: int, runReply: RunReply): bool = by == slopServer and e.phase == Selected
  and consistentRun(runReply)
  and (e.storedDigest == "" or runReply.storedDigest == e.storedDigest)
pure def register(e: Evidence, by: int, runReply: RunReply): Evidence =
  { ...e, storedDigest: if (e.storedDigest == "") runReply.storedDigest else e.storedDigest }
pure def canStore(e: Evidence, by: int, uploadReply: UploadReply): bool = by == slopServer and e.phase == Selected
  and e.storedDigest == ""
  and uploadReply.serverRun != "" and uploadReply.digest == e.digest and uploadReply.stage == TraceUploaded
pure def store(e: Evidence, by: int, uploadReply: UploadReply): Evidence = { ...e, phase: Stored, storedDigest: uploadReply.digest }
pure def canReuse(e: Evidence, by: int): bool = by == contributorClient and e.phase == Selected and e.storedDigest != "" and e.storedDigest == e.digest
pure def reuse(e: Evidence, by: int): Evidence = { ...e, phase: Stored }
pure def canRefuseDifferentSelection(e: Evidence, by: int): bool = by == contributorClient and e.phase == Selected and e.storedDigest != "" and e.storedDigest != e.digest
pure def refuseDifferentSelection(e: Evidence, by: int): Evidence = { ...e, phase: UploadFailed }
pure def canStopAttempt(e: Evidence, by: int): bool = by == contributorClient and (e.phase == Selected or e.phase == Stored)
pure def stopAttempt(e: Evidence, by: int): Evidence =
  { ...e, phase: if (e.storedDigest != "" and e.storedDigest == e.digest) Stored else UploadFailed }
pure def alwaysStoredExact(e: Evidence): bool = e.phase == Stored implies e.storedDigest == e.digest and e.digest != ""
pure def stepStoredDigestImmutable(before: Evidence, after: Evidence): bool =
  before.storedDigest != "" implies after.storedDigest == before.storedDigest
```

### A signed receipt binds the exact disclosure and either no trace or the stored trace

Only the signature verifier (sender `signatureVerifier`) records a signed
receipt, after it checks the receipt schema, the device key and byte
continuity; a device signature proves continuity, not provider billing truth.
The receipt must name the completed [local receipt](./localReceipt.md) of
this run: its published completion digest and its exactly declared provider,
model and client, on a local record that satisfies every local receipt rule.
It names the stored trace digest or none. It is signed once and never
rebound. That the shell supplies the actual stored local receipt is a
composition obligation. Missing evidence earns no trace bonus: only a
finalized server run whose attached digest equals the receipt's trace digest
can support one (composition obligation on the points area).

```quint
pure def receiptComplete(receipt: SignedReceipt): bool = receipt.signed and receipt.runDigest != ""
  and receipt.deviceKey != "" and receipt.provider != "" and receipt.model != "" and receipt.client != ""
pure def receiptMatchesRun(receipt: SignedReceipt, local: LR::LocalReceipt): bool = LR::consistentReceipt(local)
  and local.completed.valid and receipt.runDigest == local.completed.digest
  and receipt.provider == local.declared.provider and receipt.model == local.declared.model
  and receipt.client == local.declared.client
pure def canSignReceipt(e: Evidence, by: int, receipt: SignedReceipt, local: LR::LocalReceipt): bool =
  by == signatureVerifier and not(e.receipt.signed) and e.phase != HumanOnly
  and receiptComplete(receipt) and receiptMatchesRun(receipt, local)
  and (receipt.traceDigest == "" or (e.phase == Stored and receipt.traceDigest == e.storedDigest))
pure def signReceipt(e: Evidence, by: int, receipt: SignedReceipt, local: LR::LocalReceipt): Evidence = { ...e, receipt: receipt }
pure def alwaysReceiptBindsEvidence(e: Evidence): bool = e.receipt.signed implies receiptComplete(e.receipt)
  and (e.receipt.traceDigest == "" or e.receipt.traceDigest == e.storedDigest)
pure def stepReceiptImmutable(before: Evidence, after: Evidence): bool =
  before.receipt.signed implies after.receipt == before.receipt
pure def sometimesDeclined(e: Evidence): bool = e.phase == Declined and e.digest != ""
pure def sometimesUploadFailed(e: Evidence): bool = e.phase == UploadFailed
pure def sometimesStored(e: Evidence): bool = e.phase == Stored
pure def sometimesReceiptWithoutTrace(e: Evidence): bool = e.receipt.signed and e.receipt.traceDigest == ""
pure def sometimesReceiptBindsTrace(e: Evidence): bool = e.receipt.signed and e.receipt.traceDigest != ""
pure def sometimesChangedSelectionRefused(e: Evidence): bool = e.phase == UploadFailed and e.storedDigest != "" and e.storedDigest != e.digest
```

### A receipt verifies only under its exact published schema version, signing payload and Ed25519 device key

This is what the signature verifier checks before `signReceipt`
(legacy `src/lib/run-receipts.ts` and `scripts/run-receipt-crypto.ts`;
historical receipts in production ingestion data verify under the same
rules). The marker object has exactly the keys `provider`, `model`,
`client`, `skill_revision` and `run`; `run` has exactly `schema_version`,
`run_id` (`run_` and 26 Crockford base-32 characters), `project`,
`repository`, `started_at`, `completed_at`, `skill_sha256`, `usage` (exactly
`source`, `confidence`, `input_tokens`, `output_tokens`,
`cache_creation_tokens`, `cache_read_tokens`, `total_tokens`,
`cost_micro_usd`, `session_count`), `trajectory_sha256`,
`signature_algorithm`, `device_public_key`, `device_key_id` and
`device_signature`, plus `policy_acknowledgement` exactly when the schema
version is `"2"` and an optional `trace_upload`. Version `"1"` carries no
acknowledgement; no other version is accepted. The project must be
registered, the repository must belong to it, the skill revision must name
the project's skill source, and completion may not precede start. The
signing payload is `JSON.stringify` of `{ provider, model, client,
skill_revision, run }` in that key order with `device_signature` removed
from `run`; the signature algorithm is `ed25519`, `device_key_id` is the
SHA-256 hex of the DER SPKI public key, and the Ed25519 signature verifies
over the payload's UTF-8 bytes. The policy join resolves the project's
policy at the receipt's own immutable skill revision: a version 1 receipt
completed at or after the project's receipt-policy activation is refused; a
version 2 receipt must acknowledge the current policy revision and its
license, inbound-terms and prize-rules digests while no policy is active,
and once one is, must start at or after the activation and match the first
pinned binding of its acknowledged revision, starting at or after that
binding's activation. A version 2 acknowledgement's `acknowledged_at` must
fall within the run, at or after `started_at` and at or before
`completed_at`. Usage must be consistent: its source is `ccusage-session-v20`
or `none` and its confidence `bounded`, `exact` or `unavailable`;
`unavailable` usage carries zero in every count and cost, available usage
needs source `ccusage-session-v20`, a nonzero `total_tokens` and a nonzero
`session_count`, and source `none` requires confidence `unavailable`. A
`trace_upload` has exactly `authority`, `object_id`, `server_run_id` and
`sha256`, its authority is `https://api.slop.cash`, its `object_id` is
`sha256:` followed by its `sha256`, and that digest equals the run's
`trajectory_sha256`. A valid signature proves byte and key continuity, not
that the usage it reports is true. The exact keys and bytes are the
receipt's `//@` contract; this rule states the decision.

```quint
type ReceiptSchemaVersion = ReceiptV1 | ReceiptV2 | ReceiptOtherVersion
type ReceiptShape = { version: ReceiptSchemaVersion, exactKeys: bool, acknowledged: bool, ackRevision: str, ackDigests: str,
  algorithm: str, keyIdMatches: bool, signatureValid: bool, startedAt: int, completedAt: int,
  projectRegistered: bool, repositoryOfProject: bool, skillOfProject: bool, ackWithinRun: bool, usageConsistent: bool,
  traceUploadMatches: bool }
type PolicyPin = { pinRevision: str, pinActivatedAt: int, pinDigests: str }
type ReceiptPolicy = { policyActive: bool, activatedAt: int, currentRevision: str, currentDigests: str, pins: List[PolicyPin] }
pure val noPin: PolicyPin = { pinRevision: "", pinActivatedAt: 0, pinDigests: "" }
pure def receiptVerifies(shape: ReceiptShape): bool = shape.exactKeys and shape.projectRegistered
  and shape.repositoryOfProject and shape.skillOfProject and shape.completedAt >= shape.startedAt
  and ((shape.version == ReceiptV1 and not(shape.acknowledged)) or (shape.version == ReceiptV2 and shape.acknowledged))
  and shape.algorithm == "ed25519" and shape.keyIdMatches and shape.signatureValid
  and (shape.version == ReceiptV2 implies shape.ackWithinRun) and shape.usageConsistent and shape.traceUploadMatches
pure def receiptPolicyJoins(shape: ReceiptShape, policy: ReceiptPolicy): bool =
  val pinned = policy.pins.select(x => x.pinRevision == shape.ackRevision)
  val pin = pinned.nthOr(0, noPin)
  if (shape.version == ReceiptV1) not(policy.policyActive and shape.completedAt >= policy.activatedAt)
  else if (not(policy.policyActive)) shape.acknowledged and shape.ackRevision == policy.currentRevision
    and shape.ackDigests == policy.currentDigests
  else shape.acknowledged and shape.startedAt >= policy.activatedAt and pinned.length() > 0
    and shape.startedAt >= pin.pinActivatedAt and shape.ackDigests == pin.pinDigests
pure def lawVerifiedReceiptIsEd25519(shape: ReceiptShape): bool =
  receiptVerifies(shape) implies shape.algorithm == "ed25519" and shape.keyIdMatches and shape.signatureValid
pure def lawVerifiedReceiptIsConsistent(shape: ReceiptShape): bool =
  receiptVerifies(shape) implies shape.usageConsistent and shape.traceUploadMatches
    and (shape.version == ReceiptV2 implies shape.ackWithinRun)
pure def lawAcknowledgementMatchesSchema(shape: ReceiptShape): bool =
  receiptVerifies(shape) implies (shape.acknowledged iff shape.version == ReceiptV2) and shape.version != ReceiptOtherVersion
pure def lawV1RefusedAfterActivation(shape: ReceiptShape, policy: ReceiptPolicy): bool =
  (shape.version == ReceiptV1 and policy.policyActive and shape.completedAt >= policy.activatedAt)
    implies not(receiptPolicyJoins(shape, policy))
pure def lawV2NeedsItsPinnedPolicy(shape: ReceiptShape, policy: ReceiptPolicy): bool =
  (shape.version == ReceiptV2 and policy.policyActive and receiptPolicyJoins(shape, policy)) implies
    policy.pins.some(x => x.pinRevision == shape.ackRevision) and shape.startedAt >= policy.activatedAt
pure val shapeA: ReceiptShape = { version: ReceiptV2, exactKeys: true, acknowledged: true, ackRevision: "r1", ackDigests: "d",
  algorithm: "ed25519", keyIdMatches: true, signatureValid: true, startedAt: 10, completedAt: 20,
  projectRegistered: true, repositoryOfProject: true, skillOfProject: true, ackWithinRun: true, usageConsistent: true,
  traceUploadMatches: true }
pure val shapeValues = Set(shapeA, { ...shapeA, version: ReceiptV1, acknowledged: false }, { ...shapeA, version: ReceiptV1 },
  { ...shapeA, algorithm: "rsa" }, { ...shapeA, ackRevision: "r2" }, { ...shapeA, completedAt: 5 },
  { ...shapeA, ackWithinRun: false }, { ...shapeA, usageConsistent: false }, { ...shapeA, traceUploadMatches: false },
  { ...shapeA, version: ReceiptOtherVersion })
pure val policyA: ReceiptPolicy = { policyActive: true, activatedAt: 15, currentRevision: "r1", currentDigests: "d",
  pins: List({ pinRevision: "r1", pinActivatedAt: 0, pinDigests: "d" }) }
pure val policyValues = Set(policyA, { ...policyA, activatedAt: 0 }, { ...policyA, policyActive: false },
  { ...policyA, activatedAt: 0, pins: List() })
```

### Simulation samples cover uninspected, unconsented, empty and changed snapshots and each receipt binding

```quint
pure val snapA: Snapshot = { digest: "d1", size: 2, media: NdjsonText, inspected: true, disclosed: true, consent: true }
pure val snapshotValues = Set(snapA, { ...snapA, digest: "d2" }, { ...snapA, consent: false }, { ...snapA, size: 0 },
  { ...snapA, inspected: false })
pure val runReplyValues = Set({ serverRun: "r1", stage: AwaitingTrace, storedDigest: "" },
  { serverRun: "r1", stage: TraceUploaded, storedDigest: "d1" })
pure val uploadReplyValues = Set({ serverRun: "r1", digest: "d1", stage: TraceUploaded })
pure val receiptA: SignedReceipt = { signed: true, runDigest: "run", traceDigest: "", deviceKey: "key",
  provider: "p", model: "m", client: "c" }
pure val receiptValues = Set(receiptA, { ...receiptA, traceDigest: "d1" }, { ...receiptA, provider: "" })
pure val byValues = Set(contributorClient, 2, signatureVerifier, slopServer)
pure val completedLocal: LR::LocalReceipt = { ...LR::initial, started: true, active: false, startedAt: 1,
  declared: { provider: "p", model: "m", client: "c", lane: LR::ContributionLane }, result: LR::Succeeded,
  installed: { template: "0123456789abcdef0123456789abcdef01234567", revision: 1, digest: "m1" },
  completed: { digest: "run", completionAt: 2, valid: true }, candidate: { digest: "run", completionAt: 2, valid: true } }
pure val localValues = Set(completedLocal, { ...completedLocal, completed: { digest: "other", completionAt: 2, valid: true } }, LR::initial)
pure val weight_selectTrace = 6
pure val weight_register = 6
pure val weight_store = 6
```
