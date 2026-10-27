# Project security vetting worker

PRD section 8 requires a scan of submitted project code for malicious
behavior before contributors install or run it: wallet drainers, password
and credential theft, secret exfiltration, harmful installation scripts and
agent prompt injection. The result binds the checked revision. A scan is not
a guarantee of safety, and an incomplete scan never establishes clearance.
Issues #909 and #911; audit findings 8 and 9.

## Bounded malicious-code scan

`bounded-scan.ts` implements the ordinary scan. It produces a
`slop-vetting-result-v2` result (`backend/vetting/scan-result.ts`). "Scan
passed" (`clean`) means exactly that these defined checks passed on every
defined surface of the exact assessed commit and skill template. It does not
mean the code is free of all malware.

| Surface | What it reads |
| --- | --- |
| `source` | Code and configuration files of the executable inventory |
| `manifests` | `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` and similar |
| `dependencies` | Lockfiles; each lock digest is recorded |
| `installScripts` | Package lifecycle hooks, `setup.py`, `build.rs`, Makefiles, `.husky`, `.devcontainer`, `.vscode` tasks, install and bootstrap scripts |
| `downloads` | URLs that install-time content downloads, and committed binaries or archives |
| `agentInstructions` | `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, README, `SKILL.md`, Cursor, Claude, Copilot and similar rule files |

Each surface is checked for the five threats: `wallet-drainer`,
`credential-theft`, `secret-exfiltration`, `unsafe-execution` and
`prompt-injection`. The deterministic rules in `bounded-scan.ts` are
indicators, never confirmations. A match marks the check `flagged`.

The flow for one queued assessment:

1. `acquire.ts` and `queue.ts` fetch the exact queued commit and template
   inputs without execution. `readAcquiredSource` rereads every stored object
   by its SHA-256 and carries acquisition gaps (submodules, links, LFS) into
   the scan.
2. `inspectRepository` sorts files into surfaces and runs the checks. It is
   pure and deterministic. It builds one evidence bundle of at most 1 MiB and
   1,024 items. Content that does not fit, does not decode, exceeds 256 KiB or
   was not acquired is a visibility gap, never a silent skip.
3. `reviewScan` (`scanners.ts`, prompt `slop-scan-review-1`) runs one primary
   model review of that bundle. Its risk is read from the review itself: any
   suspected malice or high finding is `high`; any other finding or partial
   coverage is `ambiguous`; otherwise `low`. No score threshold is used.
4. A second model or specialist review runs only when the result is
   ambiguous or high risk: a non-low primary review, a flagged check, a
   medium or worse finding, or an unreleased binary or download.
   `composeScanResult` reports `needsSpecialist`.
5. `composeScanResult` derives the disposition. A separate trusted reviewer's
   confirmation makes it `malicious`; a model label never does. Otherwise it
   is `clean` only if the intake rules accept clean, and `incomplete` in every
   other case.
6. Retain the private report, inventory, dependency locks and every named
   artifact under the scan run in the restricted evidence store
   ([EVIDENCE.md](../../backend/vetting/EVIDENCE.md)), then publish once with
   `publishResult` ([PUBLICATION.md](PUBLICATION.md)).

### Scan service

`run.ts` runs this flow automatically. One pass:

1. calls the signed `POST /api/v1/vetting/refresh`, so Slop queues every
   changed project;
2. reads the signed queue;
3. for each pending assessment, in queue order, acquires the exact inputs
   (`acquireQueuedAssessment`), inspects the repository source and the queued
   skill template, runs the primary review and, only when
   `composeScanResult` reports `needsSpecialist`, the specialist review;
4. registers and uploads the private report, the reviewed inventory, every
   dependency lock and every named artifact under the scan run through the
   signed evidence routes;
5. publishes the result once with `publishResult`.

A service failure publishes nothing: an unavailable source or a failed
primary or specialist review leaves the assessment pending, and the next pass
retries it. A clean result is never published without its retained evidence;
a refused evidence upload leaves it pending too. An incomplete result is
published even when the evidence upload fails, because the intake needs
retained evidence only for a clean result: the quarantine is recorded and the
models are not called again on every pass. A published attempt is journaled, so a
later pass never sends it again; an uncertain or rejected attempt waits for
an operator. The pass removes the acquired bytes after each assessment. It
never executes repository content on its host, never confirms malice and never releases
a quarantined artifact.

The source-inventory gaps of the historical secure-VM contract that this scan
covers itself are not carried into the result: the skill template is read from
the queue, dependency manifests and lockfiles are checked, and the scan runs
its own model review. Submodule, link and LFS gaps still keep `source`
partial.

The operator runs it on a private host:

```sh
SURPLUS_API_KEY=... SLOP_VETTING_SIGNING_JWK='{"kty":"OKP","crv":"Ed25519","x":"...","d":"..."}' \
  bun workers/vetting/run.ts /private/scan-service.json --every 300
```

The configuration file names `origin`, `policyVersion`, `workDirectory`,
`journalDirectory`, and the `primary` and `specialist` profiles without
keys. Owner decision D16 pins the primary to the Surplus Anthropic Messages
endpoint with `claude-opus-5.5` and the specialist to the Surplus OpenAI
Responses endpoint with `gpt-6.1-sol`. Both use `SURPLUS_API_KEY`. The
service refuses to start, and a scan pass refuses to contact the queue or a
provider, when either profile names another endpoint, model or reviewer, so
the key never reaches any other endpoint. The output lists safe assessment
identities and states only.

### Protected scheduled controller

`.github/workflows/vetting-controller.yml` runs this same controller on an
ephemeral trusted GitHub runner. It dispatches the reviewed `main` and
`development` revisions to their existing protected environments. Source and
model responses stay in private temporary files and are deleted at the end of
the pass; no workflow artifact contains them. Risky artifacts still execute
only through the separate Cloudflare sandbox.

The scheduled controller uses the selected environment's D1 database for its
publication journal. Migration `0074_vetting_publication_journal.sql` stores
only assessment identity, result digest, disposition and receipt metadata.
The intent is reserved atomically before submission and cannot be changed or
deleted. Restarting a job does not forget an accepted, rejected or uncertain
attempt. An uncertain attempt remains an explicit reconciliation exception.
The local CLI retains its filesystem journal.

Before activation, supply the existing scanner key as
`SLOP_VETTING_SIGNING_JWK` and the existing provider key as `SURPLUS_API_KEY`
in each protected environment. Reuse its Cloudflare account ID and API token.
Set its `VETTING_RATE_CARDS` variable to an object with `primary` and
`specialist` rate cards, each containing the four nano-USD-per-token fields
from `ScannerProfile`. Verify those rates against the provider account; do not
copy test rates. The controller pins the approved Surplus models and endpoints.

Deploy the journal migration, Pages bridge and sandbox through the normal
release first. The controller refuses to scan until the signed sandbox health
response reports the same source revision and a real image digest. Set the
environment's `VETTING_CONTROLLER_RELEASE` to `enabled`, then dispatch the
workflow on that branch for qualification. Set the repository's
`VETTING_CONTROLLER_SCHEDULE` to `enabled` only after qualification. Scheduled
dispatch remains a 15-minute backstop. A successful same-repository
`slop.cash` release also dispatches its branch immediately, after confirming
that the branch still names that release's commit and its deployment job
succeeded. Pull-request runs cannot dispatch the controller. Both paths skip
a branch with an active controller run, or a head without a completed
deployment, because that head's sandbox is not deployed. The completion
trigger uses only GitHub metadata and never checks out release artifacts or
untrusted source. The activation switch still gates both paths; this change
does not activate scanning. A skip is a run notice, not a failed scan.

The workflow and journal source do not establish deployment or provider
acceptance. Verify the full scan, private evidence, publication and recovery
paths before recording the controller as operational.

### Cache and rescans

The inventory digest covers executable content and the digests of retained
binary, archive and quarantined artifacts. Documentation that is not an agent
instruction file does not change it. A later commit whose
executable inventory, skill template and scan policy are byte-identical to a
clean scan may cite that result; the intake checks that the cited original is
a clean, non-reused scan of the same repository, inventory, template, policy,
run and report. The controller does not produce such citations today: each
queued assessment gets a new scan. Any change to executable content produces
a new digest and a new scan.

The signed service calls `POST /api/v1/vetting/refresh` before reading the
queue. Slop then queues, for the project steward, a scan of every listed
project whose current content or live pin has no scan, and one fresh scan per
live pin for a project that contributor flags alone paused. Banned and
moderator-restricted projects wait for a moderator. An admin can still queue a
scan by hand.

### Isolated execution

Ordinary source needs no execution. When an install hook or download cannot
be judged from its bytes, an operator may retrieve it or run it in an isolated
runner and pass the retrieved bytes to `inspectRepository`, recording the run
in the result's `execution` field. The contract has no way to say that a
secret was provided: `secretsProvided` must be `false` and egress
`default-deny`. An unretrieved download keeps `downloads` partial, and an
unanalyzed binary stays quarantined, so the result stays incomplete until a
specialist or the isolated analysis releases it.

## Evidence

```sh
bun test scripts/vetting-scan-flags.test.ts
bun test scripts/vetting-scan-service.test.ts
```

`vetting-scan-service.test.ts` runs complete scan passes against the real
vetting, evidence and project handlers on the real migrations, with local
workerd R2, a real local Git repository served through the GitHub Git API
format, and a local server that answers in the Surplus Anthropic Messages and
OpenAI Responses formats. It proves that a provider outage leaves the scan
pending and publishes nothing, that the next pass clears the project with one
primary review and lets activation proceed, that an ambiguous primary review
runs the specialist once, that a failed specialist publishes nothing, that a
clean result waits for its evidence while an incomplete one is published
without it, that risky new content escalates to the specialist and stays
quarantined, and that a two-flag pause is reinstated after the service's
clean fresh scan.

The worker tests use harmless fixtures and a real local HTTP server that
answers in the Anthropic Messages format. They check surface coverage, threat
flags, gap handling, cache-digest stability, reuse refusal for changed
content, specialist escalation and composition into an accepted result. The
API workflow runs on the real migrations and handlers with an ephemeral
Ed25519 key and local workerd R2. It proves that a clean supported scan lets
activation proceed, reuse and automatic rescans, refusal without retained
evidence, and that incomplete results stay quarantined.

These tests do not prove a real provider review, the deployed scanner
service, an approved isolated runner or live acceptance. No real provider
call, key or project is used.

## Other components

These earlier components remain available. They are no longer a prerequisite
for an ordinary clean result:

- [Isolated artifact inventory](#isolated-artifact-inventory) (`artifacts.py`)
  for recursive archive inspection.
- [Offline VM evidence](VM.md), [assembly](ASSEMBLY.md),
  [dependencies](DEPENDENCIES.md), [provenance](PROVENANCE.md) and
  [events](EVENTS.md) for advanced detonation of risky artifacts.
- `slop-vetting-result-v1` secure-VM results keep their parser and rules.
  Old incomplete scans stay incomplete; nothing reinterprets them as clean.

### Isolated artifact inventory

`artifacts.py` inspects one supplied file recursively. It never executes or
releases input. Run it on an unprivileged, dedicated Linux analysis host with
Python 3.12 or later and Bubblewrap 0.9 or later:

```sh
python3 workers/vetting/artifacts.py /private/quarantine/object
python3 workers/vetting/artifacts_workflow_test.py
```

Treat stdout as private evidence. The launcher copies at most 32 MiB from a
regular file without following its final symlink, into separate user,
process, mount and network namespaces with no home mount, host network,
inherited environment or device passthrough. The parser reads ZIP and TAR
members in memory, rejects links, special files, encrypted members, duplicate
paths and traversal, and limits depth to 6, records to 1,024 and expanded
bytes to 64 MiB. Failure returns an `incomplete` result with no partial
inventory; every record stays `quarantined`. A host that blocks namespace
creation fails closed. A namespace isolates this parser; it is not a hardware
VM.

## Deployment requirements and operator decisions

| Item | Requirement or decision |
| --- | --- |
| Scanner service deployment | `run.ts` is the service source; this source does not deploy it. It needs a private host, its Ed25519 key, the public key in `VETTING_RESULT_PUBLIC_KEYS`, `SURPLUS_API_KEY` and the evidence store policy. |
| Provider and model | Owner decision D16: Surplus `claude-opus-5.5` is the primary model and Surplus `gpt-6.1-sol` is the specialist, only for ambiguous or high-risk results. Scanner profiles accept only these two Surplus endpoint and model pairs (`PINNED_SCANNER_PROFILES` in `scanners.ts`) and fail closed on any other. The operator names both in the configuration file; the source has no default. |
| Isolated runner | Owner decision D16: Cloudflare Sandboxes/Containers, one disposable sandbox per risky artifact, with `enableInternet: false` set explicitly and no secrets. Adapting this worker from the Bubblewrap host to that runner is follow-up work. |
| Specialist authority | Owner decision D3: moderators confirm malice and release quarantined artifacts. A model label alone cannot; a signed malicious result restricts the project until a moderator decides. |
| Live acceptance | Prove the clean, incomplete, malicious, flag and reinstatement paths on staging with the real services (PRD section 11). |

### Private artifact execution

The scan service sends acquired Linux x86-64 native artifacts to the signed
private sandbox route before model review. It requires a released image identity,
adds execution output to the bounded review inventory, and submits each exact
execution response to private evidence storage. Clean publication requires retained
evidence; an incomplete publication records a storage failure and stays quarantined.
A runner failure leaves the assessment pending. Unsupported artifacts and incomplete output remain explicit coverage
gaps. Execution does not release quarantine or confirm malice. The controller
never executes repository content on its host.

The disposable runner and release requirements are documented in
[the sandbox guide](../vetting-sandbox/README.md). Native Linux isolation and live
provider qualification remain required before production activation.
