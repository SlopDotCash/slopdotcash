# Private artifact execution

This service implements the disposable Cloudflare runner required by PRD
sections 8 and 11. It runs one exact artifact in a new sandbox. It has no
public Worker URL or route. The authenticated vetting service must reach it
through a private service binding.

The service checks the artifact digest before sending its bytes to the
sandbox. It supplies no provider key, signing key, storage binding or user
session to the sandbox. Internet access is disabled on the sandbox class.
The artifact runs as UID/GID 65534, with no supplementary groups, no new
privileges and an explicit environment. An inherited seccomp filter blocks
socket creation and io_uring even when the local Docker network is available.
If that filter cannot load, the artifact does not start. CPU, process, file and output limits
bound the execution. The sandbox is destroyed after each request, including
failed requests. A cleanup failure must not be counted as a completed run.

The response is private execution evidence. Standard output and error are
base64-encoded exact bytes, bounded to 64 KiB each. An output limit or timeout
is explicit and does not establish complete coverage. An unsupported executable
or unavailable loader returns `not-executable`, not a retryable service outage.
A failure to establish isolation still fails the service request. No response declares
an artifact safe, releases quarantine, grants project clearance or makes a
moderator decision. Preserve the response in the existing private evidence
store before relying on it.

Supported commands are fixed: shell, Python, Node.js or a native executable.
The service does not accept shell fragments, extra arguments, URLs, arbitrary
paths or environment variables. Missing dependencies and blocked network
requests are execution failures or coverage gaps, not clean results.

SDK 0.12.14 is pinned to work with the repository's Wrangler 4.129.1.
The new native Container execution API needs a newer Wrangler; adopting it
would require a separate release-toolchain change. The 0.x API remains
published in the vendor's SDK documentation.

The Pages route `/api/v1/vetting/sandbox` uses the existing Ed25519 request
signature. GET reads the private Worker's health; POST forwards only the
verified body. Credentials and cookies are not forwarded. `workers/vetting/sandbox.ts` signs
controller requests, verifies the returned artifact identity and output limits,
and returns the exact response bytes for private evidence retention. Production and
staging bind different Worker names. Preview deployments have no binding.
The checked-in release workflow deploys the selected Worker before Pages.
It builds and uploads the image, reads its registry digest, and deploys that
immutable digest with the same digest in the Worker environment. Results carry
the image digest, source revision, run ID and execution times. Local developer
runs leave image and source identity null; they cannot prove a deployed image.
The isolated-artifact CI job sets the locally built image ID and checkout SHA
so that the scan controller workflow can bind them. These values identify that
CI runner only.
The release script rejects local, pull-request and mismatched checkouts.

To run the local integration workflow, start the Worker with
`bunx wrangler dev --config workers/vetting-sandbox/wrangler.toml --port 8896`.
Then run `SLOP_SANDBOX_TEST_URL=http://127.0.0.1:8896 bun run test:vetting:sandbox`.
Docker must be running. The workflow sends signed requests through the real
Pages handler and executes harmless probes in disposable containers. It checks
authorization, digests, identity, filesystem isolation, network blocking,
output limits and timeout cleanup. Local Docker results are not proof of the
Cloudflare production boundary. The full workflow requires native Linux
seccomp support; x86 emulation on an ARM host can reject the filter, in which
case the runner must refuse execution. The native Linux CI job must pass.
The existing release quality gate requires this job before staging or production
can deploy.

The same Linux job checks whether the canonical Git merge reconstruction helper
can reproduce public Network pull requests 97 and 117 in a test-only derivative.
The unchanged sandbox image contains Git 2.34.1, which cannot run the helper's
`merge-tree --write-tree` operation (added in Git 2.38). The derivative builds
Git 2.50.1 from its checksum-pinned kernel.org source. It copies only that Git
installation into the same sandbox image. The existing sandbox and controller
tests still use the original image. Both image IDs and the Git dependency are
recorded; this does not qualify the currently deployed image for reconstruction.
A compact fixture retains only the fields that helper reads and immutable expected trees,
paths and patch hashes. The host fetches the pinned public Git objects without
credentials; the unprivileged container has no network, secrets or writable host
input. It checks the complete bundle and ordered parents, reconstructs the merge,
and refuses wrong parents and missing objects. Only safe hashes, sizes, runtime
versions, resource measurements and cleanup results are retained.

This is a feasibility check for PRD sections 5, 7 and 11. Its complete Git witness
uses a 256 MiB temporary filesystem, a 128 MiB file limit, 512 MiB memory and a
30-second wall limit. It does not use or widen the deployed artifact endpoint's
2 MiB input, 8 MiB file or 64 KiB output limits. It does not qualify standard value
intake, full claim attribution, copied-work credit, model output or assessment
publication. A different Git version remains visible even when trees and patch
bytes match. Failed reconstruction or cleanup fails the existing CI job.

The job also checks a proposed transport, without changing value intake. It
reuses that public bundle in a multipart request under the existing 25 MiB
request ceiling. A 15,546-byte harmless JSON control stands in for an assessment.
Both parts are files: text form fields normalize line endings. A test-only
Pages adapter calls the existing HTTP handler, then a named Worker RPC method
streams the bundle to the unchanged SDK's file API. The SDK reads the file back
and both hashes must match. It calls `destroy()` in `finally`. An acknowledged
destroy is not proof of Cloudflare VM teardown. The existing isolation probes
remain separate and unchanged.

For private local feasibility, `scripts/value-merge-transport.workflow.mjs`
accepts a retained bundle path, a private envelope path and a safe result path.
That mode uses native Workerd and a checksum sink, with no SDK container. It
does not import, validate, log or publish the assessment. The Linux SDK mode
requires `--transport-control` instead of a private envelope. Both modes check
JSON compatibility and refusal of a missing test role, wrong origin and excess
size. Their role is synthetic; this is not real-session acceptance. Host RSS
samples cover whole Workerd processes, not an isolate's 128 MiB memory limit.
The container's peak memory is reported separately. Neither test establishes
hosted capacity, full authenticated import, source validation or Points output.
Those remain required before the proposed transport can be production ready.

The same CI job then runs the complete scan pass for a harmless native Linux
program and an unsupported Windows executable. The controller sends the native
program through this runner, reviews its bounded output, retains the exact
response as private evidence and publishes an incomplete result. Both
artifacts stay quarantined and project activation is refused.

The service is deployed separately in staging and production. A deployment
does not prove the Cloudflare execution boundary; hosted qualification remains
required before scanner activation.
No new credential is needed: the bridge reuses `VETTING_RESULT_PUBLIC_KEYS`.
Keep scanned output private. Never use the local developer server to execute
untrusted artifacts; its Docker privileges differ from Cloudflare's isolated
VM boundary.


## Protected hosted qualification

`vetting-sandbox-qualification.yml` is a manual, staging-only workflow. Its
plan mode is offline. After the reviewed source is deployed, execute mode runs
the same harmless probes through the actual Pages signature check and private
sandbox binding. It checks the current Pages revision, Worker revision,
Container image and signed health before and after the probes. A changed or
unavailable deployment refuses qualification.

The normal protected release derives only the public part of that environment's
existing `SLOP_VETTING_SIGNING_JWK`. The private key stays in the dedicated CI
step; it is never written to Pages or an artifact. The public list is a plaintext
Pages variable, read back after deployment. A different existing list stops the
release rather than silently rotating keys. Existing unrelated variables and
preview isolation are preserved. Production uses its own credential and follows
the normal reviewed main promotion; the qualification workflow is staging only.

The shared probes verify unprivileged identity, minimal environment, Python and
Node, fresh filesystem, denied egress, output and time bounds, plus a fresh run
after timeout. Each successful response waits for the existing `destroy()` call
in the Worker's `finally` block. This proves successful destruction calls and
fresh subsequent state; it does not independently prove provider instance
inventory deletion. Unknown transport or cleanup failure cannot pass.

Only safe source/image/key digests and assertion results leave the CI process.
No request signature, run ID, output bytes, model call, scan result or stored
case evidence is published. This test does not install an evidence policy,
attest external controls, enable the controller or enable retention deletion.
No new key entry is required. To inspect its plan locally, run:

```sh
bun scripts/qualify-vetting-sandbox.ts
```

Hosted execution is refused outside the exact protected development workflow.
