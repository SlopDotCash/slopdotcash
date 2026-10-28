# Signed queue and template acquisition

PRD VET-01, VET-07 and MVP-12 require the service to inspect the exact revision
assigned by the queue. `readPendingAssessments` signs the GET request with the
shared `signedServiceHeaders` helper. `acquireQueuedAssessment` re-reads that
queue and accepts only an assessment id, not caller-selected source pins.

The service connection supplies its explicit HTTPS origin and Ed25519 key
pair. The private key is used only for the queue request signature. It is not
sent to GitHub, stored with source, or passed to any executable artifact. The
helper signs the exact method, canonical path, UTC time and body digest used
by the existing backend contract.

The acquisition function verifies the stored manifest text against the queued
digest and validates the project schema. It checks the current GitHub repository
id and node id against the manifest, so a reused repository name is refused. A recorded rename is read and acquired
under its current `githubUrl` name, because GitHub redirects the former name. It supports the same single-repository
scope as the queue. Source acquisition uses the assigned commit. The function
then checks the template index against the assigned input digest, reconstructs
that digest, and downloads the exact contributor, reviewer and renderer bytes.
Changed or uncommitted template inputs fail closed. It follows no redirects.
The index and each template file have a 1 MiB limit; template content has a
32 MiB total limit. These pinned-input reads have a 180-second limit. Source
acquisition is one shallow Git fetch of the assigned commit with no size limit
and its own 45-minute operational guard ([ACQUISITION.md](ACQUISITION.md)); it
sends no credential.

A successful call returns the private directory and SHA-256 of
`queued-inputs.json`. That file binds the assessment, exact manifest text,
source-inventory digest, template inputs and quarantined object digests. Source
and template content stay in read-only `objects/<sha256>` files. A failed
acquisition removes only the new directory it created.

The queued bundle directly includes all source inventory visibility gaps. Only
the missing-template gap is removed after this function verifies every template
input. A future reconciliation step must combine those gaps with artifact
analysis, runtime collectors and both model reviews. This
component still reports unacquired rendered skills and execution dependencies,
and missing runtime and model review. It cannot establish full scan coverage.

There is no claim, result POST or assessment update in this component. Missing
configuration, stale templates, unavailable providers or acquisition errors do
not consume the pending assessment. Operational readiness must be established
before an execution runner starts a scan or a publisher is authorized.

## Workflow evidence

```sh
bun test scripts/vetting-queue.test.ts
```

The workflows use a real HTTP listener, the existing signed backend handler,
SQLite with the real migrations, a real local Git repository and harmless
static template files. The signed queue and public revision routes are the
actual handlers. Changed manifest/template bytes and a wrong signing key fail.
After success and failure, the assessment remains pending and every request is
GET. These tests prove acquisition behavior, not a deployed queue, secure VM,
actual model run or full admission acceptance.
