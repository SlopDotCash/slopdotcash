# Squads execution tracking

This read-only integration tracks one reviewed execution plan against one
external Squads v4 proposal: a single VaultTransaction or a bounded Batch with
immutable child messages. It does not authorize, sign, broadcast, retire, or
create independently payable replacement plans. Payment policy remains
unchanged. `plan-matched` is not `paid`, available funding, or permission to carry.

## Canonical artifacts and app integration

`funding/executions/ledger.json` is the complete canonical JSON array of
`SquadsExecutionBinding` records, followed by one newline. It starts empty.
Every row binds the project, cycle, exact execution-plan SHA-256, multisig,
vault/index, external transaction index, proposal PDA and vault-transaction PDA.
The index is a canonical positive decimal u64 string. URLs and submitted
transaction signatures cannot establish a binding.

`scripts/check-squads-execution-transitions.ts` is invoked by the existing
**Trusted unsafe destination transition gate**. That `pull_request_target` job
checks out the exact base, fetches and verifies the exact PR head only as Git
objects, and runs the checker with `bun --no-install`. No head module or
contributor dependency is executed. The named protected check remains unchanged.

The checker calls `assertSquadsBindingTransition(base, next)`, preserves the
unchanged ledger prefix, and rejects duplicate plans, project/cycles, proposal
identities and reused account addresses across projects. Existing bound
allocation and plan blobs must retain their exact object IDs. New bindings are
validated against exact head allocation/plan bytes using base-owned schemas and
project registry. Ledger deletion, symlinks, executable blobs, malformed UTF-8,
duplicate JSON keys (including escaped aliases), nested data beyond 64 levels,
blobs over 8 MiB and total decoded input over 32 MiB fail closed. Git replace
objects are disabled. Dirty worktree bytes cannot substitute for committed data.

An absent base ledger permits only an empty head ledger: land this gate before
adding bindings. The initial landing does not retroactively make the new checker
part of older trusted bases. Once merged, subsequent binding PRs run through the
existing required transition job. Repository protection must continue requiring
that named check. This introduces no payment activation or approval authority.

`scripts/sync-squads-execution-registry.ts`, invoked by `prepare-site.mjs`, validates
every registered monthly-pool binding against its canonical
`cycles/<project>/<month>/allocation.json` and `execution-plan.json`. It hashes
their exact bytes, validates the approved allocation, frozen instrument and
canonical vault, and refuses missing or substituted artifacts. Symlink paths
and oversized files fail. It publishes only:

```ts
// /data/squads-executions.json
{ schemaVersion: 1, executions: PublishedSquadsExecution[] }
```

Published entries contain artifact hashes, their binding, and the canonical observation URL. The same builder compiles exact approved artifact bytes into the backend registry. It publishes no cached success observation. Build validation is not review,
payment activation, live verification, or proof of append-only Git history.

`backend/trace/execution-verification.ts` resolves a requested project/cycle
from the compiled canonical registry and rehashes its exact allocation and plan
bytes. It passes
the complete accepted ledger as both `baseLedger` and `ledger` to
`verifySquadsExecution({ projectId, allocationBytes, planBytes, baseLedger, ledger })`
from `src/lib/squads-execution-verifier.ts`. Do not accept these bytes, ledger
history, account addresses, or RPC authorities from the request. An unbound cycle
is distinct from an unavailable verification. The endpoint returns a raw
observation with `no-store`: HTTP 200 for verified instructions, 503 for unresolved
verification, and 404 for an unbound cycle. Public endpoint rate limits remain
independent of payment authority.

The verifier module has no Node filesystem, Buffer, signing, or broadcast
dependency. It uses Web Crypto, Fetch, bounded streaming, and the repository's
existing Noble curve implementation for PDA derivation. The Node CLI wrapper is
`scripts/verify-squads-execution.ts`:

```sh
bun scripts/verify-squads-execution.ts --project <project-id> \
  --allocation <allocation.json> --plan <execution-plan.json> \
  --base-ledger <trusted-ledger.json> --ledger <candidate-ledger.json>
```

It writes observations to stdout. Exit 0 means exact supported instruction
match, 2 means verification unresolved, and 1 means invalid input. None means
payment approval or settlement.

For the UI, validate the static index with `assertSquadsExecutionIndex`; validate the raw live response against the selected entry's binding using
`assertSquadsExecutionObservation`. Compare the entry's allocation and plan
digests against the displayed cycle before fetching. `squadsExecutionTrackerLabel` distinguishes
unverified contents, proposal approval, and execution with settlement still
unverified. At five minutes the observation is stale; future timestamps are
not current evidence. Loading, missing binding, request error and stale states
must remain distinct. A structurally valid uploaded JSON report is not an
authenticated backend observation.

## Exact verification boundary

The verifier queries three fixed mainnet RPC authorities at finalized
commitment and requires two to agree on proposal, transaction, lookup-table and
token-account evidence. It checks the Squads program owner, account
discriminators, full Borsh layout, multisig, transaction index, canonical PDAs,
vault index/bump, and proposal status. Unknown layouts, malformed vectors,
trailing transaction bytes and unsupported instructions fail closed.

The instruction decoder follows the official Squads v4 Rust layout at
`af94153ff77a28b6effe46b9c94baaa93742b48c`. It is source-derived, not the installed
SDK. The SDK 2.1.4 dependency audit found affected bigint-buffer, stream-json and
uuid transitive packages; no package or lockfile change was made.

Supported messages contain exactly the plan's ordered legacy SPL USDC transfers,
including its fee transfer. `Transfer` and `TransferChecked` require exact
amounts, source vault authority and canonical source/destination ATAs; checked
transfers additionally pin the USDC mint and six decimals in the instruction.
Existing token accounts must be initialized legacy SPL accounts with the exact
mint and owner, so a reassigned ATA does not pass merely by address.

Optional ATA `Create`/`CreateIdempotent` instructions must precede the affected
transfer, target only a planned recipient's canonical USDC ATA, and use the vault
as rent payer with exact system/token programs and privileges. No arbitrary SOL
transfer is allowed. ATA creation consumes rent in SOL outside the USDC plan;
this verifier does not promise rent balance or execution feasibility. A missing
destination is allowed only when its permitted creation precedes transfer and
the proposal has not been observed executed.

All existing plans up to `MAX_TRANSFERS_PER_PLAN` (200 including fee) are
supported by the reader without truncation or automatic splitting. Lookup tables
are resolved from program-owned finalized accounts; deactivated tables, entries
extended in the observed slot, duplicate/out-of-range resolved keys and more
than 256 message account keys are rejected. Lookup tables may contain at most
256 addresses each, with at most 32 tables. Ephemeral signers, extra signers,
Token-2022, non-ATA token accounts, memos, arbitrary programs and unused accounts
are outside this first exact-message format.

RPC reads contain at most 100 accounts. Every token-account chunk rechecks the
same proposal/transaction bytes and uses a nondecreasing minimum context slot.
These are bounded observations across slots, not an atomic bank snapshot.
Quorum includes token and lookup evidence bytes. Changed evidence requires a
fresh verification; missing/closed accounts never imply paid or retired.

The single-transaction format remains bound to one proposal. A large message can match yet be
unexecutable because of current packet, account-lock, compute, rent or funding
limits. External clients must construct an executable proposal. Supporting
multiple independently executed payment subsets uses the explicit Batch format
below; the original reservation still covers the entire parent plan.

## Bounded Batch and external handoff

Existing `schemaVersion: "1"` single bindings remain unchanged. The new binding
has `schemaVersion: "2"`, `kind: "squads-batch-execution-binding"`, the same
project/cycle/plan/multisig/vault/index/proposal fields, `batchAccount` instead of
`vaultTransactionAccount`, and `children` with:

```ts
{ transactionIndex: number; transactionAccount: string;
  messageSha256: string; transferIndexes: number[] }
```

Child indices start at one. Transfer indices start at zero and, concatenated,
must equal every parent transfer index in order, including its fee exactly once.
There are at most five transfers per child and 40 children (200 transfers).
Each message hash covers the complete stored VaultTransactionMessage Borsh bytes.
Base-owned build/gate validation reconstructs those exact messages from the
approved parent plan: canonical idempotent recipient ATA creation followed by
TransferChecked with six decimals and exact u64 micro-units. No child ALT,
buffer, arbitrary program, ephemeral signer, extra transfer, omitted fee or
independently editable amount is accepted. All child identities and hashes are
part of the same immutable ledger row and global replay checks.

RPC verification checks official Batch and VaultBatchTransaction layouts,
canonical child PDAs/bumps, parent vault, total child count, every child hash and
decoded transfer, and the serial executed index. Every quorum hashes the Batch
and ordered child account evidence together in `vaultTransactionSha256` (the
legacy field name is retained). Missing/closed children fail unresolved. Token
accounts for observed executed children must exist. `batchProgress` is present
only for Batch observations, either `{totalChildren, executedChildren}` after
exact verification or `null` when unresolved. Even 12/12 is not paid; finalized
settlement still reconciles each immutable parent intent and fee.

Generate the concrete, unsigned external handoff from released exact artifacts:

```sh
bun scripts/prepare-squads-batch.ts --allocation <allocation.json> \
  --plan <execution-plan.json> --multisig <reviewed-multisig> \
  --vault-index <reviewed-index> --transaction-index <external-next-index> \
  --member <external-member-public-key> > handoff.json
```

This command accepts no keypair and makes no network requests. It emits the
binding candidate, per-child compact Squads input bytes and stored-message
hashes, exact integer/decimal CSV, and explicit instruction manifests for setup,
activation and serial execution. It measures full legacy packet bytes with the
declared member as payer, one signature, and a 400,000-unit compute-budget
instruction. Every packet must fit 1,232 bytes and 64 accounts. Each operation
also contains a read-only `simulateTransaction` request with signature checking
disabled and a replacement recent blockhash. `simulation: "not-run"` is literal:
generating this request is not simulation evidence. Zero signature/blockhash
templates are not broadcastable signed transactions.

The 55-recipient plus distinct-fee synthetic case yields 12 children. Measured
maxima are 1,053 bytes for setup, 878 bytes for execution, and 23 execution
accounts; these are packet-fit measurements, not proof of mainnet execution or
of the final August wallet list. The exact released August plan must be measured
again. There is currently no approved August artifact in this checkout.

External operator procedure (outside Slop):

1. Read the reviewed multisig, vault and member permissions. Select its current
   next transaction index; generate the handoff. Reserve the whole parent plan
   through the canonical payment process before release, never each child as a
   separate plan. If the external index is taken before creation, stop and
   regenerate an unaccepted binding candidate; do not replace accepted bindings.
2. In an independently operated wallet/SDK client, convert each exported
   instruction manifest to TransactionInstruction objects. Use the fixed account
   flags and base64 data bytes directly; do not recalculate money with Number.
   Process each setup operation separately and in order: Batch create, draft
   proposal create, then all children. Supply a fresh blockhash, simulate against
   current state, inspect errors and units, then sign and submit externally.
   If proposer and executor permissions belong to different members, generate
   the same handoff again with the executor's public key and use only its
   execution operations later. Confirm the binding and child message hashes are
   identical. The member changes outer transaction authority, not the reserved
   recipients, amounts, or child messages; do not recreate the Batch or children.
3. Read back the full draft Batch using Slop's exact verifier, and submit the
   binding for canonical GitHub review. The complete draft must match before
   activation. A partially constructed draft is unresolved, not a smaller plan.
4. After accepted binding review, the external creator activates the proposal.
   Members approve using their external Squads interface. Timelock, signer
   capability, SOL rent/fees and USDC balance must hold at execution time.
5. For each child in order, externally simulate its exported execution operation
   in the now-approved current state. Require no simulation error and consumed
   units below the requested limit, then sign/submit externally. Re-read the
   Batch executed index after uncertain confirmation; never create a new child
   or parent reservation as a retry. Failed children leave the unpaid remainder
   held. Submit finalized transaction evidence to the existing settlement path.

This is an external instruction manifest, **not an advertised Squads UI JSON
import**. Squads UI approval/display and the chosen external client's ability to
consume these operations need operator validation. The official Squads CSV
example uses Batch children but converts amounts through Number and is not the
exact-money importer for this handoff. Source contracts:
[Batch state](https://github.com/Squads-Protocol/v4/blob/af94153ff77a28b6effe46b9c94baaa93742b48c/programs/squads_multisig_program/src/state/batch.rs),
[Batch execution](https://github.com/Squads-Protocol/v4/blob/af94153ff77a28b6effe46b9c94baaa93742b48c/programs/squads_multisig_program/src/instructions/batch_execute_transaction.rs),
[compact message format](https://github.com/Squads-Protocol/v4/blob/af94153ff77a28b6effe46b9c94baaa93742b48c/sdk/multisig/src/types.ts).

## What success does not establish

The result always has `paymentVerified: false` and `retirementVerified: false`.
Only the existing finalized balance-delta settlement verifier can establish paid
principal and fee reconciliation. Proposal `executed` is insufficient alone.
Signer availability, present balance, project authority, safe old-plan
retirement and successor carry remain separate existing contracts. Loss, expiry,
rejection or cancellation never silently creates a replacement payable plan.
