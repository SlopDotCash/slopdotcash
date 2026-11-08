# Local Solana acceptance composition

The section 21 local runner stopped before its first project because the
production registry correctly rejects `solana-localnet`. Adding that name to
the public registry or labeling a local validator as devnet would weaken the
production boundary. The local runner now composes the existing payment
components through a separate test-only entry point.

`LocalSolanaAcceptance` stores immutable run-scoped deployment declarations
in the run's existing SQLite projection. The public facts come from
`openSolanaRun` and each initialized project: run identity, loopback RPC,
genesis, program bytes, Config and payer/owner authorities, project, asset,
and initialization transaction. This is neither a project inventory nor a
manifest admission path. It does not add production project metadata. Resume
requires exact prior facts. Database triggers forbid updates and deletion;
a declaration batch commits together or rolls back.

Each local tick rechecks the exact genesis and verifies every declared
program and project before delegating. It calls the existing
`refreshVaultSnapshots`, `readDeploymentVaultTotals`, `scanSolanaPayments`,
`ingestPaymentEvent`, `recoverUncertainAttempts`, `reconcileFailedAttempts`,
and `dispatchPayment`. Existing executor engines retain transaction journals,
wallet signatures, binding delays, and chain verification. Snapshot, scan,
recovery, reconciliation and dispatch failures remain explicit; one failed
step does not fabricate success. Final native balance, receipt, and cached
counter comparisons in section 21 remain unchanged.

The public devnet route still uses `AcceptanceRegistry` and the production
`runPaymentsCron`. No production handler, registry parser, network table or
signer policy changes. The extended local suite remains explicitly limited
to key recovery. Its monthly and fault-scenario acceptance is still open.

## Model and conformance

`local_solana_acceptance.qnt` models two declarations and two ticks. Its ten
named scenarios cover local admission, remote/public refusal, changed run or
declaration, changed live genesis, invalid program, successful delegation and
partial failures. It proves only the bounded harness-level invariant that
work is delegated after local run/deployment admission and that declarations
are immutable. It does not prove the chain engines or every RPC interleaving.
Container startup/cleanup is modeled separately in
`solana_validator_callers.qnt`; durable payment and wallet protocols retain
their separate models.

The real SQLite/HTTP regression in
`scripts/escrow-acceptance/solana-local.test.ts` has three cases and 21
assertions: refusal occurs before schema creation for a public network,
public genesis or remote RPC; resume and mutation preserve stored facts; a
changed live genesis produces one read-only RPC and no ledger/executor access.
The full local section 21 run is the implementation conformance evidence for
native signing, scanning, payment, replay and reconciliation. The prior
pre-repair refusal, its stopped-container receipt, and the repaired run are
kept in separate ignored evidence directories.

Pinned Bun 1.3.14 / Node 24.15.0: the three regression cases pass (21
assertions), TypeScript and Biome pass. Quint 0.33.1 with the server-free
Apalache 0.62.4 / Java 21 translator explores 2,365 distinct states (8,635
generated); the invariant holds and all source hashes stay fixed. Ten named
scenarios and 500 samples of up to 60 steps use seed 20261107. The full native
section 21 run is still in progress; no passing native result is claimed here. No local result is public-devnet, production-registry, deployment, or
live settlement evidence. RPC identity may change after a read; the actual
executor and chain adapters retain their own fresh checks. Malicious local
filesystem/SQLite mutation and cloud D1 semantics are outside this local
fixture model.
