# Optional receipts and private trace upload

This model covers PRD sections 4 and 9 and legacy trace intake and transport
models. It retains only safe metadata. Trace bytes reside permanently in
private R2 and no body-read transition exists. Exact-byte transport, digest
verification, authentication, and durable R2 writes need integration evidence.

## Story: Submit optional private evidence without blocking a contribution

A contributor may decline evidence collection, inspect and redact a selected
file, and upload its exact bytes through the write-only authenticated route.

### Trace collection state is separate from ordinary submission

```quint
type UploadPhase = Undecided | Declined | Selected | Uploading | Stored | UploadFailed
type Evidence = { phase: UploadPhase, actor: int, consent: bool,
  inspected: bool, digest: str, byteCount: int, requestCurrent: bool,
  uploadAuthorized: bool, storedDigest: str, receiptSigned: bool,
  prSubmitted: bool, traceReadable: bool, scoreBonus: int }
pure val initial: Evidence = { phase: Undecided, actor: 1, consent: false,
  inspected: false, digest: "", byteCount: 0, requestCurrent: false,
  uploadAuthorized: false, storedDigest: "", receiptSigned: false,
  prSubmitted: false, traceReadable: false, scoreBonus: 0 }
pure def alwaysPrivateBodies(e: Evidence): bool = not(e.traceReadable)
pure def alwaysDiagnosticOnly(e: Evidence): bool = e.scoreBonus == 0
pure def alwaysTraceSize(e: Evidence): bool = e.byteCount >= 0
pure def submitPR(e: Evidence): Evidence = { ...e, prSubmitted: true }
pure def canDecline(e: Evidence): bool = e.phase == Undecided or e.phase == Selected
pure def decline(e: Evidence): Evidence = { ...e, phase: Declined, consent: false }
```

### Only contributor-inspected exact bytes can enter an authorized bounded upload

The uploader performs no automatic redaction. The private-request health
status is independently renewed and gates optional trace collection alone.

```quint
pure def canSelectFile(e: Evidence, by: int, digest: str, bytes: int, inspected: bool, consent: bool): bool =
  by == e.actor and digest != "" and bytes >= 0 and inspected and consent and
  (e.phase == Undecided or e.phase == Declined or e.phase == UploadFailed)
pure def selectFile(e: Evidence, by: int, digest: str, bytes: int, inspected: bool, consent: bool): Evidence =
  { ...e, phase: Selected, digest: digest, byteCount: bytes, inspected: true, consent: true }
pure def renewRequest(e: Evidence, requestCurrent: bool): Evidence = { ...e, requestCurrent: requestCurrent }
pure def canBeginUpload(e: Evidence, by: int, configuredLimit: int, authenticated: bool, exactChecksum: bool): bool =
  by == e.actor and e.phase == Selected and e.consent and e.inspected and e.requestCurrent and
  authenticated and exactChecksum and configuredLimit > 0 and e.byteCount <= configuredLimit
pure def beginUpload(e: Evidence, by: int, configuredLimit: int, authenticated: bool, exactChecksum: bool): Evidence =
  { ...e, phase: Uploading, uploadAuthorized: true }
pure def canPersist(e: Evidence, durableObject: bool, digest: str): bool =
  e.phase == Uploading and e.uploadAuthorized and durableObject and digest == e.digest
pure def persist(e: Evidence, durableObject: bool, digest: str): Evidence =
  { ...e, phase: Stored, storedDigest: digest }
pure def canFailUpload(e: Evidence): bool = e.phase == Uploading
pure def failUpload(e: Evidence): Evidence = { ...e, phase: UploadFailed }
pure def alwaysStoredExact(e: Evidence): bool = e.phase == Stored implies
  e.storedDigest == e.digest and e.digest != "" and e.uploadAuthorized and e.consent and e.inspected
```

### A signed receipt binds available evidence without inventing provider billing truth

The signature verifier checks receipt schema, device key, and byte continuity.
Missing evidence contributes no trace bonus. Receipt signing is optional.

```quint
pure def canSignReceipt(e: Evidence, schemaValid: bool, signatureVerified: bool): bool = schemaValid and signatureVerified
pure def signReceipt(e: Evidence, schemaValid: bool, signatureVerified: bool): Evidence = { ...e, receiptSigned: true }
pure def sometimesDeclinedAndSubmitted(e: Evidence): bool = e.phase == Declined and e.prSubmitted
pure def sometimesStored(e: Evidence): bool = e.phase == Stored
pure def sometimesFailedAndSubmitted(e: Evidence): bool = e.phase == UploadFailed and e.prSubmitted
```

### Simulation samples exercise missing, matching and conflicting evidence

These input sets bound simulation only. The generated guards accept every
value allowed by their declared types and product rules.

```quint
pure val byValues = Set(0, 1, 2)
pure val bytesValues = Set(0, 1, 2)
pure val configuredLimitValues = Set(0, 1, 2)
pure val digestValues = Set("", "a", "b")
```
