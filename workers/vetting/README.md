# Project security vetting worker

PRD section 8 requires a scan of submitted project code for malicious
behavior before contributors install or run it: wallet drainers, password
and credential theft, secret exfiltration, harmful installation scripts and
agent prompt injection. The result binds the checked revision. Outside the permanent
existing-project exemption, one successful admission scan persists for routine
later changes to the same immutable repository (PRD section 8,
27 October 2026). Explicit investigations and fresh reinstatement scans still use
this complete pipeline; later content is never relabelled as scanned. A scan is not
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
| `installScripts` | Package lifecycle hooks, `setup.py`, `build.rs`, Makefiles and `GNUmakefile`, container and CI build recipes (`Dockerfile`, `Dockerfile.<suffix>`, `<name>.Dockerfile`, `Containerfile`, `Jenkinsfile`), other build systems (`CMakeLists.txt`, `<name>.cmake`, `meson.build`, `Earthfile`, `SConstruct`, `SConscript`, `wscript`, `Makefile.am`, `Makefile.in`, `GNUmakefile.in`, `configure.ac`, `build.sbt`, `<name>.sbt`, `BUILD.bazel`, `MODULE.bazel`, `WORKSPACE`, `<name>.bzl`, `build.boot`, `build`, `wscript_build`, `docker-bake.hcl`, `docker-bake.override.hcl`), `Vagrantfile`, `Rakefile`, `Brewfile`, `Procfile`, `.husky`, `.devcontainer`, `.vscode` tasks, install and bootstrap scripts, and previously unclassified files whose first two bytes are `#!` (an interpreter script such as `configure`) |
| `downloads` | URLs that install-time content downloads, and committed binaries or archives |
| `agentInstructions` | `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `CONTRIBUTING.md`, README, `SKILL.md`, `WARP.md`, `llms.txt`, Cursor, Claude, Copilot (`.github/instructions`, `.github/chatmodes`), Windsurf, JetBrains Junie (`.junie`), Project IDX (`.idx`), Goose, Continue, Zed `.rules` and similar rule files |

A build, install or provisioning recipe is recognized by its name, so the
same bytes are classified the same way whether they sit in a `Makefile`, a
`Dockerfile`, a `Containerfile` or a `Jenkinsfile`. Each keeps its
`installScripts` coverage, its install-time download extraction and its place
in the reviewed inventory, so changing a recipe invalidates clean-scan reuse.

Each surface is checked for the five threats: `wallet-drainer`,
`credential-theft`, `secret-exfiltration`, `unsafe-execution` and
`prompt-injection`. The deterministic rules in `bounded-scan.ts` are
indicators, never confirmations. A match marks the check `flagged`.
Textual instruction-override and secret-transmission matches are medium-severity
indicators that require independent contextual specialist review. API documentation
and injection-defense tests can contain that wording without directing an attack.
The matches remain in the report; incomplete reviews and high or critical findings
still block clearance.

The flow for one queued assessment:

1. `acquire.ts` and `queue.ts` fetch the exact queued commit (one shallow Git
   fetch, [ACQUISITION.md](ACQUISITION.md)) and template inputs without
   execution. There is no repository size limit (owner decision, 28 October
   2026). `readAcquiredSource` rereads every stored object by its SHA-256 and
   carries acquisition gaps (submodules, links, LFS) into the scan.
2. `inspectRepository` sorts files into surfaces and runs every deterministic
   check over the whole of every file, whatever its size. It is pure and
   deterministic. A text file over 256 KiB is reviewed in consecutive parts.
   Content that does not decode or was not acquired is a visibility gap,
   never a silent skip. When the inventory exceeds one review call (1 MiB or
   1,024 items), bulk content (dependency locks, data JSON, generated
   bundles, vendored copies; never install scripts, agent instructions or
   manifests) is covered by the deterministic checks instead of the model.
   It is bound into the inventory by digest, and every rule match or
   obfuscation signal in it is sent to the model in context as
   `<path>#signals`.
3. `reviewInventory` (`review-plan.ts`) runs the primary model review. An
   inventory within one call is read by exactly one `reviewScan` call
   (`scanners.ts`, prompt `slop-scan-review-1`), with the same bytes as
   before. A larger one is split into batches of at most 150,000 estimated
   tokens: install, CI, container, agent-instruction, manifest and
   risk-signal content first, then source grouped by directory, then tests,
   docs and locks. Identical bytes are reviewed once. One synthesis call
   (`slop-scan-synthesis-1`) then reads the deterministic pre-pass and every
   batch result. The combined review is complete only if every call
   completed; its coverage is the weakest of any call. Risk is read from the
   review itself: any suspected malice or high finding is `high`; any other
   finding or partial coverage is `ambiguous`; otherwise `low`. No score
   threshold is used.
4. A second model or specialist review runs only when the result is
   ambiguous or high risk: a non-low primary review, a flagged check, a
   medium or worse finding, or an unreleased binary or download.
   `composeScanResult` reports `needsSpecialist`.
5. `composeScanResult` derives the disposition. A separate trusted reviewer's
   confirmation makes it `malicious`; a model label never does. Otherwise it
   is `clean` only if the intake rules accept clean, and `incomplete` in every
   other case.
6. Retain the private report, inventory, dependency locks and every named
   artifact under the scan run (any size: objects above 8 MiB go as ordered
   8 MiB parts and are finalized, and digests the store reports as already
   `stored` are referenced rather than uploaded again) in the restricted
   evidence store
   ([EVIDENCE.md](../../backend/vetting/EVIDENCE.md)), then publish once with
   `publishResult` ([PUBLICATION.md](PUBLICATION.md)).

### Scan service

`run.ts` runs this flow automatically. One pass:

1. calls the signed `POST /api/v1/vetting/refresh`, so Slop queues initial
   admission and required flag recovery;
2. reads the signed queue;
3. for each pending assessment, in queue order, acquires the exact inputs
   (`acquireQueuedAssessment`), inspects the repository source and the queued
   skill template. Before fresh execution, it asks the signed private
   `POST /api/v1/vetting/reuse` route about the deterministic acquired-input
   inventory digest. An original clean scan with retained evidence of the same
   project, repository, source inventory, template and policy can supply the
   result for the new queued revision and commit. Reused scans cannot form a reuse chain;
   contributor-flag pauses require a fresh scan. A cache miss completes the
   required isolated inspection, then runs the primary review and, only when
   `composeScanResult` reports `needsSpecialist`, the specialist review;
4. registers and uploads the private report, the reviewed inventory, every
   dependency lock and every named artifact under the scan run through the
   signed evidence routes;
5. publishes the result once with `publishResult`.

Model coverage describes the bounded static review of the supplied evidence,
not a full runtime audit. Reviewers must preserve concrete visibility gaps and
findings. Missing runtime execution alone does not make a completed static
review partial. The primary and synthesis prompt revisions record this scope.
Findings must identify a concrete defined threat or missing required evidence,
not merely describe a permitted feature. The prompts supply the approved
canonical-template commit policy as trusted context; they do not grant trust
to template contents or excuse hidden behavior, consent bypasses, wrong
origins, or byte mismatches.

A completed incomplete assessment is not pending work. After correcting its
cause, an administrator can queue a fresh scan from the project's security
vetting panel. Older pending rows remain in history but do not hide that action
after a newer assessment has finished. A current pending assessment still
blocks a duplicate request. Earlier results and evidence remain unchanged.

A reused result preserves the original run, review and report evidence rather
than claiming another provider call. Its normal result publication revalidates
the original scan, current restrictions and retained evidence, so a flag pause
or lost evidence between lookup and publication still refuses clearance. A
failed or malformed lookup leaves the assessment pending without calling the
provider. Reuse never normalizes source content or changes inventory budgets.
New results retain `assessed.sourceInventorySha256` separately from
`assessed.inputManifestSha256`, the exact final inventory the model reviewed.
The private v2 scan report binds both inventories and every execution report.
The source bytes, final bytes, execution outputs and original dates remain
unchanged on reuse. Retention checks prove the final inventory contains the
complete source inventory followed by the exact retained execution items.
Clean execution reports use the same bounded validator as fresh execution,
bind the requested artifacts and recorded image, and preserve disabled
internet access. Every requested artifact needs its own byte-identity coverage.
Old text-only results retain their final-digest reuse path. An old native
result without a retained source binding cannot reuse; it needs a fresh scan.
Deploy the API reuse route before updating the scanner service. A missing
route (404), unavailable service (503), or invalid lookup response leaves the
assignment pending at the reuse step; the scanner does not bypass the lookup
or spend provider tokens as a deployment fallback.

A service failure publishes nothing: an unavailable source or a failed
primary or specialist review leaves the assessment pending, and the next pass
retries it. Repository size is never a refusal. A policy refusal of the bound
assignment, such as an invalid tree path or a repository identity mismatch,
instead publishes an incomplete result and notifies each owner once. It
records the fixed refusal reason. Every
surface is unsupported, every threat check is not run, and the configured
primary review is explicitly not started; no source inspection or model call
is claimed. This does not establish clearance or confirm malice. A clean
result is never published without its retained evidence;
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

The scheduled controller records its publication journal through the signed
service route `POST /api/v1/vetting/journal`, so the scan job holds no
Cloudflare credential of its own. Migration `0074_vetting_publication_journal.sql` stores
only assessment identity, result digest, disposition and receipt metadata.
The intent is reserved atomically before submission and cannot be changed or
deleted. Restarting a job does not forget an accepted, rejected or uncertain
attempt. An uncertain attempt remains an explicit reconciliation exception.
The local CLI retains its filesystem journal.

Before activation, supply the existing scanner key as
`SLOP_VETTING_SIGNING_JWK` and the existing provider key as `SURPLUS_API_KEY`
in each protected environment. Set its `VETTING_RATE_CARDS` variable to an object with `primary` and
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
clean scan may cite that result. Before isolated inspection, the controller
uses the signed lookup; lookup and intake check that the cited original is
a clean, non-reused scan of the same project, repository, source inventory,
template, policy, run and report, with all original evidence retained. The
final review inventory remains separately bound, including original native
execution evidence. A flag-only pause
cannot reuse that scan. In an explicitly requested scan, changed executable
content produces a new digest and cannot reuse the old result.

The signed service calls `POST /api/v1/vetting/refresh` before reading the
queue. Slop then queues, for the project steward, an initial admission scan
for each listed repository without admission, and one fresh scan per
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
workerd R2, a real local Git repository fetched through the Git transport,
and a local server that answers in the Surplus Anthropic Messages and
OpenAI Responses formats. It proves that a provider outage leaves the scan
pending and publishes nothing, that the next pass clears the project with one
primary review and lets activation proceed, that an ambiguous primary review
runs the specialist once, that a failed specialist publishes nothing, that a
clean result waits for its evidence while an incomplete one is published
without it, that risky new content escalates to the specialist and stays
quarantined, and that a two-flag pause is reinstated after the service's
clean fresh scan. It also proves that a repository beyond every former
acquisition limit (1,100 files and a 9 MiB data file) gets a complete batched
review, clears and activates. `workers/vetting/review-plan.test.ts` proves
that batches stay within their budget, include every reviewed item exactly
once, put risky content first, combine coverage at its weakest, fail when any
call fails, and resume from the optional cache without repeating calls.

## Batched review cost

A batch call's budget, parallel calls and an optional operator-private cache
are `review.batchTokens` (default 150,000, at least 100,000),
`review.concurrency` (default 4) and `review.cache` (`directory`,
`maxCallsPerPass`) in the service configuration. Without a cache every call
runs in one pass, bounded by the job time and a per-call timeout of 120 s
plus 1 ms per estimated input token (at most 10 minutes). With a cache, a
review larger than `maxCallsPerPass` keeps its completed calls and continues
on the next pass (`retry` at step `review-batches`); it is never published
partial. The scheduled controller runs on an ephemeral runner and sets no
cache, so it completes each review in one pass.

Estimated primary-review input at 3 bytes per token (real tokenizers report
fewer), measured on the real acquisitions of 28 October 2026:

| Repository    | Before: calls, outcome                                                                                       | After: reviewed text, bulk (deterministic only) | After: calls | After: est. input tokens |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- | ------------ | ------------------------ |
| Small (≤1 MiB inventory) | 1 call                                                                                                   | unchanged; identical bytes                        | 1            | unchanged                |
| delta-git     | 0: refused at 4,403 entries. Without the refusal, its 1.4 MiB inventory with 2,523 gaps exceeds one call   | 12.9 MB in 2,427 items; 133 files, 7.9 MB         | 34 + 1       | 4.68 M                   |
| fly.ai        | 0: refused at 2,247 entries and 137 MB                                                                      | 4.6 MB in 478 items; 404 files, 13.9 MB           | 12 + 1       | 1.65 M                   |

The specialist runs the same plan only for an ambiguous or high-risk result.
fly.ai commits 9 binaries and has deterministic high findings, so it needs
the specialist as well.

An agentic review inside the sandbox is not used. The pinned transports send
`tools: []` and the prompt forbids tools; the sandbox has no network and
holds no provider key, so the model cannot run there without breaking its
isolation. Tool-driven exploration would also decide for itself what to
read, which cannot prove that every reviewed item was read. Batches make
coverage a property of the plan instead.

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

## Retired secure-VM pipeline

The offline secure-VM pipeline is retired (owner decision, 29 October 2026,
#1467 item 3.10(b); #1411 Part G, C-19): the QEMU runner and guest collector,
the Bubblewrap archive inventory, controlled dependency capture, source and
release provenance comparison, syscall indexing and the evidence assembler.
It was never a prerequisite for an ordinary clean result, and the scan
service, controller and sandbox never called it. Its source remains in the
repository history.

Recorded `slop-vetting-result-v1` secure-VM results and their retained
evidence stay readable: `backend/vetting/result.ts` keeps their parser and
rules, and `backend/vetting/evidence.ts` still validates historical
`slop-evidence-assembly-v1` manifests through `assembly-manifest.ts`,
`filesystem-capture.ts` and `provenance-report.ts`. Old incomplete scans stay
incomplete; nothing reinterprets them as clean. Risky native artifacts run
only in the disposable Cloudflare sandbox described below.

## Deployment requirements and operator decisions

| Item | Requirement or decision |
| --- | --- |
| Scanner service deployment | `run.ts` is the service source; this source does not deploy it. It needs a private host, its Ed25519 key, the public key in `VETTING_RESULT_PUBLIC_KEYS`, `SURPLUS_API_KEY` and the in-source evidence policy (`EVIDENCE_POLICY` in `evidence.ts`). |
| Provider and model | Owner decision D16: Surplus `claude-opus-5.5` is the primary model and Surplus `gpt-6.1-sol` is the specialist, only for ambiguous or high-risk results. Scanner profiles accept only these two Surplus endpoint and model pairs (`PINNED_SCANNER_PROFILES` in `scanners.ts`) and fail closed on any other. The operator names both in the configuration file; the source has no default. |
| Isolated runner | Owner decision D16: Cloudflare Sandboxes/Containers, one disposable sandbox per risky artifact, with `enableInternet: false` set explicitly and no secrets. `workers/vetting-sandbox` implements it; see [Private artifact execution](#private-artifact-execution). |
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
