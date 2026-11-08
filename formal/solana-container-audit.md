# Disposable Solana validator lifecycle

`scripts/local-solana-validator.mjs` starts the pinned Agave 2.1.21 Linux
validator through a local Docker or Podman connection. Its caller supplies the
validator arguments and any explicit read-only fixture mounts. The host ledger
path is replaced with an ephemeral container path. The receipt records the
original and effective arguments, declared mounts, image identity, generated
container identity, and lifecycle outcome.

The native 2.1.21 validator's `--bind-address` does not bind its RPC and PubSub
listeners. The [pinned upstream source](https://github.com/anza-xyz/agave/blob/v2.1.21/test-validator/src/lib.rs#L934-L942)
sets those listeners to the unspecified address. The container keeps that
internal wildcard listener and publishes only RPC and WebSocket ports at host
`127.0.0.1`. This is containment, not a claim that the native binary binds only
loopback. No validator upgrade, firewall change, VM sharing change, or real
wallet is involved.

The reviewed image is
`docker.io/anzaxyz/agave@sha256:45eee2ce535d1c72e68637172ea506ac33a7178c86cd6453159e6d7cede13b6f`,
Linux amd64, with validator binary SHA-256
`06b6f43f0705e01dd34a5569b1ef08cee8e902db5f77b0fe04b721ad5e71fff0`.
Its observed version is `2.1.21`, source `8a085eeb`, feature set `1416569292`.
The image was checked against the official [image repository](https://hub.docker.com/r/anzaxyz/agave)
and [release manifest](https://github.com/anza-xyz/agave/releases/download/v2.1.21/solana-release-x86_64-unknown-linux-gnu.yml).
The launcher requires the image already installed and checks its actual binary
version and digest before returning ready.

The isolated Solana CI job now prepares that same digest before its callers
run. The image reference is imported from the launcher, so the workflow does
not maintain a second mutable version. A failed image download stops setup;
the launcher has no native or unpinned fallback. The job's selector includes
the shared launcher, Solana browser fixtures and fee-converter sources.
`ci_coverage` models selection and the existing real Git/selector regression
exercises those changed paths. A hosted run remains required to establish
Linux image preparation and caller execution together.

The first vault-browser attempt with an explicitly selected Podman runtime
instead attempted the unavailable default Docker engine. The browser launcher
had projected away `SLOP_SOLANA_CONTAINER_RUNTIME`. That non-secret selection
now survives `childEnvironment`; its existing real-subprocess regression checks
the observed engine selection together with credential exclusion and forced
telemetry/update settings. Per-instance receipt paths remain explicit caller
arguments rather than a shared inherited output path.

## Cancellation ordering

The first implementation started an asynchronous `run` request and inspected
for a container during cancellation. A delayed real Podman request reproduced
the race: cancellation observed no container, wrote `stopped`, and exited;
releasing the queued request then created a running container. The failure and
cleanup are retained under ignored `evidence/formal/solana-cancel/before`.

The implementation now awaits a tracked `create` operation, checks cancellation,
then awaits a tracked `start` operation and attaches to the existing container.
Cancellation waits for any outstanding operation. A canceled create is removed
without start. Each cleanup checks the generated ownership label before touching
the container, removes only that instance, and verifies both host ports closed.
An engine timeout or error that leaves request completion uncertain records
`cleanup-unknown`; observing absence once cannot convert it to `stopped`.
Errors include the generated container name and ownership label even when no
receipt path was supplied. SIGKILL or a lost VM can still leave a container, so
those events are explicit external recovery boundaries.

`solana_container_lifecycle.qnt` models one container, one pending mutation,
create/start acknowledgement, cancellation, port and binary refusal, receipt
failure, removal, and unknown/abrupt outcomes. Eight named scenarios and 1,000
sampled traces of 30 steps pass. These checks do not prove engine behavior or
implementation refinement. The real `tests/solana-container-cancel.workflow.mjs`
delays actual create and start calls, sends SIGTERM, confirms the launcher stays
alive until acknowledgement, then verifies absence and closed ports. Both
phases pass with the local Podman runtime.

A second real-engine regression pauses the final ready receipt write and sends
SIGTERM. Before correction, startup resolved with an instance already stopping.
Startup now checks cancellation after that write, and per-instance receipt
writes execute in order so an earlier ready write cannot overwrite a later
cleanup state. `tests/solana-container-receipt.workflow.mjs` controls only that
filesystem delay; the engine and cleanup remain real. The corrected trace
does not return an instance and retains the final stopped receipt.

## Observed host and file boundaries

The create/start/attach path reached ready with the pinned binary. Native host
listener inspection showed only `127.0.0.1` for both published ports; a real
`getVersion` request and WebSocket `slotSubscribe` succeeded. Catchable cleanup
removed the instance. Existing unrelated containers were preserved.

A declared file under the repository's existing shared-home path was mounted
read-only through the real Podman engine. Reading returned its exact bytes; an
attempted write failed and a second read was unchanged. This qualifies that
path, not arbitrary Darwin temporary directories: remote Podman bind mounts
refer to the VM's filesystem, and inaccessible declared paths can fail startup.
No additional host directories are shared implicitly by this launcher. Explicit
clone arguments retain their upstream read-only RPC behavior; this wrapper
does not claim to restrict outbound network access. Full contract fixture
replays with their own mount paths remain separate from this small check.

The initial contained browser lane exercised real native-SOL submission and
recovery. Desktop passed; mobile reached exact paid finality and then failed a
200% text-width assertion. Its failure is retained separately and is not a
successful whole-lane result. Final application, browser and native workflow
validation use their own source-bound receipts.

The corrected contained lane at application-source commit `76a37544e` then
passed both Chromium desktop and mobile cases with zero unexpected, flaky or
skipped results. It used real wallet registration/challenge/authorization for
rotation, exercised uncertain submission recovery, reconciled exact finalized
balances, and checked accessibility and 200% text reflow. The source hashes
were unchanged during the run. Teardown left the owned container absent, both
host listeners closed, and all 18 pre-existing containers retained. Its ignored
receipt and videos are under `evidence/formal/bounty-solana-ui-final/`. These
are isolated local-chain results, not hosted, production or native-zoom proof.
