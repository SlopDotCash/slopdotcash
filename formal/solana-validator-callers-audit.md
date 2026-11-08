# Validator caller lifecycle

`contracts/solana/scripts/test-e2e.sh` now starts the shared pinned validator
wrapper. Each of its two stages gets a new receipt path. An open RPC port or a
previous stage's stopped receipt cannot admit the next stage. The caller waits
for the owned ready receipt, and its stop and exit paths wait for the wrapper
and require the stopped receipt. A cleanup failure cannot replace an earlier
test's nonzero exit code with success.

The shell preserves the public program, legacy, monthly and Token-2022 genesis
accounts. Each account file becomes an absolute, explicit read-only mount.
The parent `.local` directory and its payer key are not mounted. Protocol
flags, stage commands and test assertions are preserved; local paths become
absolute. Startup waits up to 120 seconds for the wrapper's stronger receipt.

`scripts/escrow-acceptance/local.ts` preserves its program ID, upgrade
authority, production program artifact and acceptance scenarios. It declares
only the program file as a read-only mount and awaits owned shutdown before
removing the host ledger directory. An unconfirmed shutdown retains the ledger
and reports the wrapper's cleanup error. If acceptance and cleanup both fail, the original
acceptance error remains the reported failure and cleanup is logged.

`solana_validator_callers.qnt` covers one acceptance stage or two shell stages,
current and stale receipts, foreign RPC availability, public fixture mounts,
test failure, confirmed stop, cleanup failure and final exit status. The model
has ten named scenarios and 328 reachable states (1,902 generated). Type
checking, scenarios, 500 seeded traces of at most 60 steps and exhaustive TLC
verification pass. The seed is `20261107`. The recorded model and mapped source
hashes match this review checkpoint.

`solana_container_lifecycle.qnt` owns the shared wrapper's image, RPC identity,
container ownership, cancellation and receipt publication details. The caller
model treats those guarantees as its interface. File-system access and the
container engine remain external dependencies; the model does not establish
source refinement, operating-system fairness or unconditional cleanup success.

Live qualification remains separate from those finite checks. In the isolated
caller worktree, the native SBF driver failed before validator startup while
parsing preexisting tool-cache directory names. The shared cache and source
checks were preserved. A local adapter runs the actual SBF build command in
the pinned CI image for the shell workflow; no paired CI manifest is invented.
The acceptance workflow uses the existing audited ELF only after matching all
six tracked Rust, Cargo and Anchor inputs and its recorded SHA-256
`494c90f36301640c1b791da1ba5e0e8efc238fd97d9f72982b56af6c5850e737`.
Full run logs and terminal ownership receipts are kept as ignored evidence;
the model results do not substitute for those runs.
