# Contained validator callers

Reviewed from `47f8b4c13` with the pinned shared launcher. Agave 2.1.21's
RPC/PubSub listeners bind an unspecified address even with `--bind-address`
set. The earlier native-listener evidence and official-source reference are
in `formal/solana-container-audit.md`. These changes use the same 2.1.21 binary
in the reviewed Linux amd64 image and publish only the two host loopback ports.
They do not upgrade the validator or change payment/contract assertions.

## Scope and ownership

- `tests/e2e/solana-vault-actions.spec.ts`: retains the real program, canonical
  devnet mint account, upgrade authority, RPC/faucet/dynamic ports, and every
  browser assertion. The program path resolves through the fixture symlink.
  Only that exact program and the generated mint file are mounted, read-only.
  The mint is staged under a unique shared-home directory, not the temporary
  copied application or the shared program directory. The host ledger argument
  is replaced by the launcher's ephemeral container ledger. The old native
  identity-file readiness loop is replaced by the launcher's owned-container,
  loopback-publication, exact-version and binary-digest checks. The receipt is
  retained in Playwright's output. `afterAll` waits for verified cleanup before
  removing inputs. An unavailable handle or uncertain cleanup retains them for
  diagnosis instead of deleting mounted input.
- `backend/security/direct-solana.integration.ts`: keeps the native,
  SPL and Token-2022 transfers, exact amount/destination/refusal checks and
  finalized evidence. The shared launcher replaces only process creation and
  shutdown. There are no input mounts: accounts are created through RPC.
- `backend/security/direct-solana-api.integration.ts`: keeps the real private
  award, consent, expiry, wallet-replacement, recovery and receipt scenarios.
  Its history proxy and log are also closed when startup rejects. Normal
  cleanup waits for the owned validator. Both direct suites retain receipts
  next to their existing temporary logs.

Other reviewed callers have separate owners: `contracts/solana/scripts/test-e2e.sh`
and `scripts/escrow-acceptance/local.ts` (backend lane), and
`workers/fee-converter/solana-local.integration.ts` (fee lane). The shell's
generated account paths require explicit read-only mounts and owned readiness;
the acceptance script must await validator removal before deleting its ledger;
the fee lane must preserve its exact captured public route and account inputs.
Their migration and results are not claimed by this audit.

Root's CI commit `62471d206` pulls the exact validator image before the Solana
job and expands the existing source selector. The local engine/image must
already be available; there is no native-process or mutable-image fallback.
The launcher checks Docker's local Unix context or a local Podman connection.
No VM sharing settings or host firewall settings are changed.

## Model boundaries

`solana_vault_fixture` covers the caller's input staging, launch promise,
qualified ready state, setup/test failure, awaited shutdown, and retention when
cleanup is uncertain. `solana_direct_fixture` covers opening local resources,
launch refusal, the three direct asset families or three API scenarios, reported
assertion completion, and cleanup. Shared engine mutation/cancellation ordering
remains in `solana_container_lifecycle`. Transaction parsing, accounting,
signature mathematics, RPC truth, native program behavior and UI layout remain
the real workflows and their existing domain models; these small caller models
do not claim to prove those behaviors. An assertion-success log before `finally`
is not a successful process result if cleanup fails.

## Recovery discrepancy found by the real browser

The contained browser run reached the existing pasted-signature check. Its
all-ones signature is syntactically valid but has no transaction. The actual
adapter correctly returns pending instead of claiming it mismatches a known
transaction. `VaultActions` then stored that candidate as if the wallet had
returned it and removed the editor. A second real-browser probe confirmed the
editor was still absent after reload. Both failures and their video/trace
artifacts are retained under `evidence/formal/solana-callers/`.

`VaultActions` now records whether an ID came from the wallet or was supplied
for recovery. Recovery candidates stay editable and survive a successful
storage write plus reload. Old records without that marker remain editable;
they are not assumed to be wallet output. Invalid marker values keep the
existing unreadable-record refusal. The pending intent continues to block a
new send, and retained or nonempty recovery evidence does not offer the
not-sent reset. A failed storage write retains the candidate in memory and
asks the user to keep its ID. No reload durability is claimed when browser
storage cannot write. Existing explicit user confirmation for unreadable or
truly unsent local records remains a separate boundary.

The strict mismatch regression now uses a real unrelated finalized airdrop
transaction. The same browser workflow additionally checks nonexistent
candidate -> pending -> reload -> correction -> exact finalized deposit,
without a second send, plus legacy records, malformed markers and a quota
failure. It checks keyboard focus, accessibility and 200% text in the recovery
state. The shared EVM path is included in the existing Anvil browser suite.
`ui_vault_recovery` adds twelve scenarios for these states. It models settled
checks and local storage, not unmounted/obsolete callback composition or
arbitrary browser storage durability. Signature truth remains external.
In particular, a candidate write failure followed by reload can restore the
earlier empty-hash intent. The existing explicit "wallet confirms nothing was
sent" action can then clear it. Clearing an unreadable record likewise rests
on the user's assertion, not chain evidence. Both paths and failed clears are
modeled; they do not establish unconditional absence of duplicate sends. The
fix blocks a blind retry while an intent remains pending, and preserves the
existing human recovery policy rather than converting it into a chain proof.

## Validation record at the integration checkpoint

The first browser attempt was rejected during collection because its new hook
parameter did not use Playwright's required destructuring syntax. It launched
no validator and is retained separately. The final hook uses the actual
`browserName` fixture to name its receipt. A second attempt found that the
child environment dropped the selected Podman runtime. Root's
`4475212c1` fixes that propagation; this branch includes it as `119c9c8da`.

Pinned Bun 1.3.14 / Node 24.15.0 typechecking and Biome pass. Both unchanged
direct integration suites completed successfully against the migrated
launcher: native/SPL/Token-2022 exact transfers and three private award/API
scenarios. Their receipts confirm the exact 2.1.21 binary and stopped owned
containers. The two caller models pass scenarios and 500x60 sampled traces;
TLC completed 28 vault-caller states and 90 direct-caller states. The recovery
model's final twelve-scenario user-reset refinement passes 500x60 traces and
TLC's complete 1,240-state graph (27,065 generated states, depth 13). It records
the explicit user-assertion boundary rather than treating a reset as finality.

The first combined **14-case Solana/Anvil matrix finished with four failures
and ten cases not run**. Both desktop and mobile completed the recovery,
deposit and withdrawal checks, then failed the same later fixture assumption:
the test expected September 2026 without selecting it, while the actual
November clock correctly opened October. The unchanged Anvil workflow reached
the same calendar assertion. These failures are retained separately.

Both tests now use the shared `tests/e2e/award-month.ts` helper to select their
recorded September fixture with actual previous/next month buttons. Each click
waits for a changed month, with a finite 120-click bound. No clock is mocked and
the existing commitment assertions remain. The recovery check also submits the
strict unrelated-signature check with Tab and Enter. A subsequent complete
matrix is pending; no full-matrix pass is claimed at this checkpoint. Source
hashes and exact results are recorded under ignored
`evidence/formal/solana-callers/`; this document does not replace the run receipt.

No production handler, economic policy, signing authority, chain identifier,
program bytes or expected transaction result was changed. Local synthetic-chain
evidence is not public-network availability, deployment or production funding.
