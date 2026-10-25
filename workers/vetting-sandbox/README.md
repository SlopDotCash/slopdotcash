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

## Canonical merge reconstruction

The named `MergeVerifier` binding serves only the authenticated historical
publisher. It is not exposed through the artifact HTTP endpoint. The publisher
supplies fresh public GitHub identities and complete path inventories; the
uploaded bundle supplies immutable objects, never a trusted patch or command.
The service verifies the bundle hash, complete object closure, strict Git
integrity, exact ordered parents and ordinary changed paths. It then runs the
existing canonical merge collector in a fresh bare repository.

This fixed operation uses checksum-pinned Git 2.56.0. The 2.52 ort rename fixes
correct automatic trees for valid histories, and 2.56 adds corrupt-tree
refusals. Strict fsck remains required. The ordinary artifact operation keeps
its existing 2 MiB input, 8 MiB file and 64 KiB output limits.
Both build paths use Git 2.56's supported `NO_RUST` option; they do not require
an unprovisioned Cargo toolchain. The consumer build includes HTTPS support;
the offline sandbox build omits it.

The merge operation accepts at most 25 MiB of bundle bytes. Its trusted input
and complete result each have an 8 MiB bound. It retains the unprivileged,
no-network process, 20-second CPU, 30-second wall, 32-process, 64-descriptor
and 128 MiB Node heap limits. Its per-file limit is 128 MiB to admit the fixed
Git pack operation; stdout and stderr remain capped at 64 KiB. It refuses an
object inventory larger than 256 MiB before reconstruction and monitors the
owned work directory against 256 MiB while running. That monitor is not a hard
filesystem quota; the existing container disk ceiling is separate. Cleanup
must acknowledge success before the publisher can append any journal row.

Run `bun --no-env-file scripts/prepare-vetting-sandbox.mjs` from the repository
root before a direct container build. Normal Wrangler and release commands do
this preparation automatically. The image contains the bundled canonical
collector; it does not check out or run repository source files. Local native
Git or Workerd checks alone do not prove the deployed image, per-isolate memory
capacity or physical VM teardown.

The existing Linux sandbox job also runs `scripts/value-merge-sdk.workflow.mjs`
through the real bounded multipart handler, a test-only metadata publisher and
the actual named `MergeVerifier`. Pinned public Network 97/117 objects exercise
the complete merge, a second fresh sandbox, wrong parents, omitted paths,
corrupt bytes, the unchanged request cap and the expanded-object bound. No
subscription verdict enters CI. Real session, journal and Points consumption
need separate end-to-end evidence; this SDK control does not provide them.

