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
requires exact prior facts. The instance owns a frozen copy of the primitive
run fields; later mutation of the caller's argument cannot retarget it. Each
tick also requires its network/RPC/genesis environment to match that copy.
Database triggers forbid updates and deletion;
a declaration batch commits together or rolls back.

The section 21 caller waits for its last committed award to finalize before
its first local tick. A confirmed creation is not sufficient: the fresh native
run reproduced a project created at slot 365 while the finalized read was
still at slot 341, returning null and terminating as `Invalid RPC object`.
`chain.waitFinalized` now uses the existing resumable `Waiting` path, preserving
all signed steps if the wait budget ends. No adapter gate is relaxed.

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

`local_solana_acceptance.qnt` models two declarations and two ticks. Its fourteen
named scenarios cover local admission, remote/public refusal, changed run or
declaration, changed live genesis, invalid program, successful delegation and
partial failures. It proves only the bounded harness-level invariant that
work is delegated after local run/deployment admission and that declarations
are immutable. It does not prove the chain engines or every RPC interleaving.
Container startup/cleanup is modeled separately in
`solana_validator_callers.qnt`; durable payment and wallet protocols retain
their separate models.

The real SQLite/HTTP regression in
`scripts/escrow-acceptance/solana-local.test.ts` has three cases and 25
assertions: refusal occurs before schema creation for a public network,
public genesis or remote RPC; resume and mutation preserve stored facts; a
changed live genesis produces one read-only RPC and no ledger/executor access.
The genesis case also mutates the caller's object and rejects mismatched
executor environment maps before any RPC. The full local section 21 run is the implementation conformance evidence for
native signing, scanning, payment, replay and reconciliation. The prior
pre-repair refusal, its stopped-container receipt, and the repaired run are
kept in separate ignored evidence directories.

The pre-finality-correction checkpoint passed three regression cases (25
assertions), TypeScript, Biome, twelve named scenarios, 500 samples of up to 60
steps at seed 20261107, and 7,865 distinct TLC states (36,707 generated).
The finality correction passes the same 3 regression cases and 25 assertions,
TypeScript and Biome. All 14 named scenarios and 500 samples of up to 60 steps
pass at seed 20261107. Quint 0.33.1 with the server-free Apalache 0.62.4 / Java 21
translator explores 12,185 distinct states (59,971 generated), with no invariant
violation and unchanged model/source hashes. The fresh-ELF native section 21
run was stopped at the user's request to skip remaining checks and focus on
pushing. On commit `00ff32498`, ELF SHA-256
`4331645f37edfbe260c182bad3fc6a02930ce71980ab8746a9986366f9af6eed`
passed the full 6-decimal asset workflow, including both payments, replay,
withdrawal, fee claim and finalized reconciliation. The 9-decimal registered
payment passed; its walletless payment and remaining checks were pending.
The run reproduced the new waiting/resume transition with no recorded error.
The owned validator reported `stopped`; its container and processes were
absent after cleanup. Raw evidence remains under ignored
`evidence/validator-callers/acceptance-finality-fixed/`, with a separate
`interruption.json` so the interrupted `running` record cannot be mistaken for
a complete pass. The earlier pre-fix failure and exact null-account RPC stack
remain under `acceptance-fresh-rpc/`. No full native pass is claimed. No local result is public-devnet, production-registry, deployment, or
live settlement evidence. RPC identity may change after a read; the actual
executor and chain adapters retain their own fresh checks. An arbitrary injected executor implementation or concurrent mutation of the
environment is not constrained by this harness; its owned service wiring uses
the same admitted maps and real executor. Malicious local
filesystem/SQLite mutation and cloud D1 semantics are outside this local
fixture model.
