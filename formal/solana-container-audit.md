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
failure, removal, and unknown/abrupt outcomes. Seven named scenarios and 1,000
sampled traces of 30 steps pass. These checks do not prove engine behavior or
implementation refinement. The real `tests/solana-container-cancel.workflow.mjs`
delays actual create and start calls, sends SIGTERM, confirms the launcher stays
alive until acknowledgement, then verifies absence and closed ports. Both
phases pass with the local Podman runtime.

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
