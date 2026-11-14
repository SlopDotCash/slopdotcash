# Optional contributor evidence: decision, exact selection and signed receipt

This model covers PRD sections 4 and 9 and CLAUDE.md "Private traces" and
"Installer and attribution". It is the abstract contributor-side view of one
optional private trace. The [client retry machine](./runEvidence.md) refines
it, so its consent, exact-selection and stored-digest rules hold of every
reachable retry state. The server records that accept, reserve, attach and
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
contribution, or inspect one local snapshot and upload exactly those bytes.
Submitting the pull request is independent of every evidence state.

### Evidence state is separate from ordinary submission

```quint
type EvidencePhase = Undecided | Declined | HumanOnly | Selected | Stored | UploadFailed
type MediaType = PlainText | NdjsonText
type ServerStage = NoServerRun | AwaitingTrace | TraceUploaded | TraceFinalized
type Snapshot = { digest: str, size: int, media: MediaType, disclosed: bool, consent: bool }
type RunReply = { serverRun: str, stage: ServerStage, storedDigest: str }
type UploadReply = { serverRun: str, digest: str, stage: ServerStage }
type SignedReceipt = { signed: bool, runDigest: str, traceDigest: str, deviceKey: str,
  provider: str, model: str, client: str }
type Evidence = { phase: EvidencePhase, digest: str, size: int, storedDigest: str,
  prSubmitted: bool, receipt: SignedReceipt }
pure val maxTraceBytes = 8388608
pure val noSnapshot: Snapshot = { digest: "", size: 0, media: PlainText, disclosed: false, consent: false }
pure val noReceipt: SignedReceipt = { signed: false, runDigest: "", traceDigest: "", deviceKey: "",
  provider: "", model: "", client: "" }
pure val initial: Evidence = { phase: Undecided, digest: "", size: 0, storedDigest: "",
  prSubmitted: false, receipt: noReceipt }
pure def canSubmitPR(e: Evidence): bool = not(e.prSubmitted)
pure def submitPR(e: Evidence): Evidence = { ...e, prSubmitted: true }
pure def canDecline(e: Evidence): bool = e.phase == Undecided or e.phase == Selected or e.phase == UploadFailed
pure def decline(e: Evidence): Evidence = { ...e, phase: Declined }
```

### A human-only contribution uploads no agent trace and signs no agent receipt

```quint
pure def canDeclareHumanOnly(e: Evidence): bool = e.phase == Undecided and not(e.receipt.signed)
pure def declareHumanOnly(e: Evidence): Evidence = { ...e, phase: HumanOnly }
pure def alwaysHumanOnlyHasNoTrace(e: Evidence): bool = (e.phase == HumanOnly implies
  e.digest == "" and e.storedDigest == "" and not(e.receipt.signed))
  and (e.phase == Undecided implies e.digest == "" and e.storedDigest == "")
```

### Only one disclosed, consented snapshot of bounded size can be selected

The command opens the file once, reads one snapshot, and shows its path, byte
count, media type and SHA-256 digest before authorization. The uploader
performs no redaction: the selected bytes are the retained bytes. A changed
file is a new selection with a new digest. Selection is refused after a
human-only declaration.

```quint
pure def validSnapshot(snapshot: Snapshot): bool = snapshot.digest != "" and 1 <= snapshot.size
  and snapshot.size <= maxTraceBytes and snapshot.disclosed and snapshot.consent
pure def canSelectTrace(e: Evidence, snapshot: Snapshot): bool = validSnapshot(snapshot) and
  (e.phase == Undecided or e.phase == Declined or e.phase == UploadFailed or e.phase == Stored)
pure def selectTrace(e: Evidence, snapshot: Snapshot): Evidence =
  { ...e, phase: Selected, digest: snapshot.digest, size: snapshot.size }
pure def alwaysSelection(e: Evidence): bool = (e.phase == Selected or e.phase == Stored) implies
  e.digest != "" and 1 <= e.size and e.size <= maxTraceBytes
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
pure def canRegister(e: Evidence, runReply: RunReply): bool = e.phase == Selected and consistentRun(runReply)
  and (e.storedDigest == "" or runReply.storedDigest == e.storedDigest)
pure def register(e: Evidence, runReply: RunReply): Evidence =
  { ...e, storedDigest: if (e.storedDigest == "") runReply.storedDigest else e.storedDigest }
pure def canStore(e: Evidence, uploadReply: UploadReply): bool = e.phase == Selected and e.storedDigest == ""
  and uploadReply.serverRun != "" and uploadReply.digest == e.digest and uploadReply.stage == TraceUploaded
pure def store(e: Evidence, uploadReply: UploadReply): Evidence = { ...e, phase: Stored, storedDigest: uploadReply.digest }
pure def canReuse(e: Evidence): bool = e.phase == Selected and e.storedDigest != "" and e.storedDigest == e.digest
pure def reuse(e: Evidence): Evidence = { ...e, phase: Stored }
pure def canRefuseDifferentSelection(e: Evidence): bool = e.phase == Selected and e.storedDigest != "" and e.storedDigest != e.digest
pure def refuseDifferentSelection(e: Evidence): Evidence = { ...e, phase: UploadFailed }
pure def canStopAttempt(e: Evidence): bool = e.phase == Selected or e.phase == Stored
pure def stopAttempt(e: Evidence): Evidence =
  { ...e, phase: if (e.storedDigest != "" and e.storedDigest == e.digest) Stored else UploadFailed }
pure def alwaysStoredExact(e: Evidence): bool = e.phase == Stored implies e.storedDigest == e.digest and e.digest != ""
pure def stepStoredDigestImmutable(before: Evidence, after: Evidence): bool =
  before.storedDigest != "" implies after.storedDigest == before.storedDigest
```

### A signed receipt binds the exact disclosure and either no trace or the stored trace

The signature verifier checks the receipt schema, the device key and byte
continuity; a device signature proves continuity, not provider billing truth.
A receipt names the exact provider, model and client, the local run digest,
and the stored trace digest or none. It is signed once and never rebound.
Missing evidence earns no trace bonus: only a finalized server run whose
attached digest equals the receipt's trace digest can support one
(composition obligation on the points area).

```quint
pure def receiptComplete(receipt: SignedReceipt): bool = receipt.signed and receipt.runDigest != ""
  and receipt.deviceKey != "" and receipt.provider != "" and receipt.model != "" and receipt.client != ""
pure def canSignReceipt(e: Evidence, receipt: SignedReceipt): bool = not(e.receipt.signed) and e.phase != HumanOnly
  and receiptComplete(receipt) and (receipt.traceDigest == "" or (e.phase == Stored and receipt.traceDigest == e.storedDigest))
pure def signReceipt(e: Evidence, receipt: SignedReceipt): Evidence = { ...e, receipt: receipt }
pure def alwaysReceiptBindsEvidence(e: Evidence): bool = e.receipt.signed implies receiptComplete(e.receipt)
  and (e.receipt.traceDigest == "" or e.receipt.traceDigest == e.storedDigest)
pure def stepReceiptImmutable(before: Evidence, after: Evidence): bool =
  before.receipt.signed implies after.receipt == before.receipt
pure def sometimesDeclinedAndSubmitted(e: Evidence): bool = e.phase == Declined and e.prSubmitted
pure def sometimesFailedAndSubmitted(e: Evidence): bool = e.phase == UploadFailed and e.prSubmitted
pure def sometimesHumanOnlySubmitted(e: Evidence): bool = e.phase == HumanOnly and e.prSubmitted
pure def sometimesStored(e: Evidence): bool = e.phase == Stored
pure def sometimesReceiptWithoutTrace(e: Evidence): bool = e.receipt.signed and e.receipt.traceDigest == ""
pure def sometimesReceiptBindsTrace(e: Evidence): bool = e.receipt.signed and e.receipt.traceDigest != ""
pure def sometimesChangedSelectionRefused(e: Evidence): bool = e.phase == UploadFailed and e.storedDigest != "" and e.storedDigest != e.digest
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val snapA: Snapshot = { digest: "d1", size: 2, media: NdjsonText, disclosed: true, consent: true }
pure val snapshotValues = Set(snapA, { ...snapA, digest: "d2" }, { ...snapA, consent: false }, { ...snapA, size: 0 })
pure val runReplyValues = Set({ serverRun: "r1", stage: AwaitingTrace, storedDigest: "" },
  { serverRun: "r1", stage: TraceUploaded, storedDigest: "d1" })
pure val uploadReplyValues = Set({ serverRun: "r1", digest: "d1", stage: TraceUploaded })
pure val receiptA: SignedReceipt = { signed: true, runDigest: "run", traceDigest: "", deviceKey: "key",
  provider: "p", model: "m", client: "c" }
pure val receiptValues = Set(receiptA, { ...receiptA, traceDigest: "d1" }, { ...receiptA, provider: "" })
pure val weight_selectTrace = 6
pure val weight_register = 6
pure val weight_store = 6
```
