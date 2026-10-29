# Escrow payment account and dispatch

The account API reuses the existing GitHub-only browser session. Numeric GitHub
actor IDs select obligations and append-only wallet claims. It never treats a
wallet as a login method. An account can exist after an award is reserved even
if that actor has never signed in.

`GET /api/v1/payments/me` returns gross awards, deducted fees, net amounts,
finalized payment transactions, current wallet claims, and unpaid net balances.
No failed query returns a fabricated zero balance. Every amount is base-unit
integer text (`grossBase`, `feeBase`, `netBase`) of the award's vault asset,
named by `assetAddress` and scaled by `assetDecimals`. One balance row exists
per network and asset. Amounts of different assets are never summed and are
never labelled as dollars.

Browsers opt into disclosed-history pages with `x-slop-direct-history: paged`.
The public project/actor `direct-transfers` routes then return at most 100
transfers, a frozen rowid `through`, a `next` cursor, a frozen `total` count,
and `totalMicro` for that page. Follow `?after=<next>&through=<through>` until
`next` is null and verify the complete count before displaying the history.
Legacy callers without the header retain the complete-list response.
On authenticated `GET /me`, the same header omits the inline disclosed list
and sets `directTransfersPaged: true`; the browser loads that actor's public
history separately. Wallets, balances and award states retain their single
database snapshot. The browser keeps its existing 1 MiB per-response limit.

`POST /wallets/register` takes `chain` and `address` using the existing GitHub
session. It writes the same canonical claim and atomic audit as the legacy
wallet API; concurrent successor changes return a conflict.

A current authenticated registry claim must be explicitly authorized for
automatic payments. `POST /wallets/challenge` takes `claimId` and returns a
15-minute message. Sign that exact message with `personal_sign` on Base or
Robinhood Chain, or Solana Ed25519 `signMessage`. `POST /wallets/authorize`
takes `claimId`, `challengeId`,
and `signature` (Base hex r/s/v; Solana padded base64). The challenge binds
actor, chain, address, claim, audience, and nonce; it can be used once. Contract
wallets and off-curve Solana destinations need a separately reviewed recovery
path; they cannot skip signature verification. Legacy claim semantics remain
unchanged.

The repository owner approved this replacement and recovery policy directly
in the 27 October 2026 review. Registration alone never displaces an authorized
wallet. The derived
`effective_payment_wallet_claims` view keeps the last authorized claim active
through any unsigned successors, and exposes the pending leaf only before the
first authorization. Challenges and registration still use the raw claim leaf.
Apply migration 0100 before deploying these readers. Payment attempts, signed
binding attempts and their reconciliation/cancellation limits remain intact.

For wallet recovery, email the operator, then complete the existing signed
self-service flow. The unused admin wallet-proposal endpoint is removed;
historical proposal rows and their immutable migrations remain preserved.

Apply migration `0011_payments.sql` after prior migrations. Run the account and
queue integration workflow with:

```
bun backend/payments/evm.integration.ts
```

The EVM vertical workflow deploys real local contracts on two Anvil chains
(31337 as Base, 46630 as Robinhood Chain Testnet), reserves a walletless
award, refunds free funds with the withdrawal fee, authorizes a late wallet,
dispatches a payment, and indexes its finalized receipt into the account ledger.
It checks actual contributor, fee, and refund token balances. It uses an isolated
Anvil test signer, not a deployed production signing service. The EVM adapter
also has a separate Anvil integration workflow in `contracts/evm`.

`workers/payments/index.ts` has no public fetch route. Its scheduled entry scans
finalized EVM logs (Base, Robinhood Chain) and Solana signature history, then
reconciles submitted or
uncertain attempts and dispatches ready obligations. Cursors advance only after
every recognized event is verified and indexed. Base starts from the reviewed
deployment transaction. EVM checkpoints cannot decrease when overlapping runs
finish out of order; a failed page retains the last completed block. Run
`node workers/payments/scanner-progress.workflow.mjs` for the native D1/public
coverage regression. Solana stores one finalized signature page per run in a durable discovery
interval. After it reaches the preceding cursor, it indexes that interval
oldest first, at most 100 transactions per run. Migration `0012` adds the pending
pages and generation/revision checkpoints. Indexing verifies only this project's
escrow instructions. Cursor advancement and removal of verified page entries
share an atomic checkpoint; stale overlapping runs cannot rewind it. Restarted
runs retain every fully verified transaction rather than replaying a whole
interrupted chunk. A transaction interrupted during indexing may reverify an
event through the existing idempotent ledger. New arrivals
wait for the next interval, and verified pages are removed. A failed or
unavailable RPC never advances coverage past that transaction. A failure in one
deployment or step is reported but does not stop the other deployments, recovery, reconciliation, or
dispatch. Queue ingestion remains available for faster event delivery and uses
the same verification.

The ledger records `paid` only when the payout destination is one of the
contributor's authorized wallets. Any other destination means the identity
authority was misused, so indexing fails closed for investigation. Executors
never sign a payment for a pending, cancelled, or vetoed binding. A verified successor wallet activates immediately once earlier payment attempts
are reconciled. A Base bind transaction can be retired only after its revert is finalized
and its receipt matches the canonical block. The journal keeps that proof
before a fresh bind can replace it. Pending and ambiguous results remain held.

The payments Worker finds its vaults in the D1 project registry. On every
run it reads the current revision of each project, validates its escrow
policy with `assertEscrowPolicy`, and keeps the deployments of the networks
named in `PAYMENT_NETWORKS` (a JSON array of registry network names, for
example `["base-sepolia"]`). A vault that an admin revision records is read on
the next run; no Worker variable lists projects or vaults. A paused project
keeps its vault and funded obligations, so it stays in scope. One invalid
manifest is reported as a run failure and never hides other vaults. A served
network with no vault in the registry is also a run failure. A missing,
empty, unknown or repeated network name stops the run. The Worker reads the
registry through a separate `REGISTRY_DB` binding to the Pages `SLOP_DB`
database (`slop-private` in `wrangler.toml`) and only reads it. Its payment
tables stay in `PAYMENTS_DB`. An isolated payment database has an empty
`projects` table, so it can never stand in for the registry.

The account API (`functions/api/v1/[[path]].ts`) finds binding vaults the same
way. For `/wallets/bind-challenge` and `/wallets/bind-authorize` it reads the
registry deployments of the networks in its own Pages variable
`PAYMENT_NETWORKS` from `SLOP_DB`. Unset or invalid `PAYMENT_NETWORKS`, or a
failed registry read, returns `503 payment_deployments_unavailable`. A vault of
a network that is not served returns `400 unknown_deployment`. Add a network
to the Pages variable through a reviewed change only when its payment stack is
configured.

Resolve private RPC URLs through `PAYMENT_RPC_URLS`, keyed by network; do not
publish them in manifest output. Each endpoint must serve the finalized tag
(EVM) or the finalized commitment (Solana): the vault counters, the event
scan and the reconciler read only finalized state. Solana additionally needs
`PAYMENT_SOLANA_GENESIS` trust roots, which must equal the cluster genesis
hash in `src/lib/escrow-policy.mjs`. The manifest supplies its program,
project PDA, token vault, network domain, and asset. Both chain adapters fetch
actual finalized evidence independently.

The signer roles do not read the registry at run time. Their
`PAYMENT_DEPLOYMENTS` variable pins the reviewed deployments when the stack is
configured, so a D1 write alone cannot widen what a key signs for. A vault
that the dispatcher finds but a signer does not pin is refused by the signer.

Each EVM deployment record also carries `gasCeiling` (executor gas units) and
`scanPageBlocks` (blocks per `eth_getLogs` page, inclusive), copied from the
network registry by `paymentDeploymentRecord` in `src/lib/escrow-policy.mjs`,
which the payments Worker, `scripts/prepare-payment-deployments.ts` and
`workers/payment-executor/configure.mjs` all use. A record missing either value
is refused; no worker substitutes a default.

`bun run payments:readiness` reports, for each registry network, whether the
factory address, the identity attester, the finalized RPC endpoint and the
executor are configured. See `contracts/DEPLOY-MAINNET.md`, section 3.

`EVM_PAYMENT_EXECUTOR` and `SOLANA_PAYMENT_EXECUTOR` are separate internal
service bindings, not public URLs. The dispatcher picks one by the
deployment's execution family from the network registry
(`src/lib/escrow-policy.mjs`), never by the literal chain name. The scoped
signing implementations live in
`workers/payment-executor`. Neither relayer key may approve awards or withdraw
funds. A separate attester signs only a verified destination binding. Keys are
runtime secrets; no production credentials are read by the local tests.

Each dispatch lease uses the current clock after prior executor calls, so a
slow batch does not give later work an already-expired lease.

An ambiguous submission retains its attempt and idempotency key. The scheduler
can recover a persisted transaction hash through the relayer's read-only journal
status API even after a wallet change. Missing receipts remain uncertain. Only
proved finalized reverts permit a fresh payment attempt; the failure evidence is
retained. Successful transactions become paid only through the finalized event
scanner. Destination changes cannot start a competing transfer while an earlier
attempt is uncertain; successor binding rotation requires a proved ancestor claim with no unresolved old-wallet attempts.

`GET /api/v1/payments/projects/<id>/totals` publishes net contributor payments,
payout fees, and unpaid award reserves from verified events, one `assets` row
per network and asset, plus cursor coverage and sync time. These fields are not
a vault balance, deposit total, or refund ledger. Missing index coverage is explicit. Account `deliveryState` names the PRD
section 6 payment state of a reserved award: `needs_wallet` (awaiting
wallet), `ready` (an authorized wallet is queued for payment), `submitted`,
`held`, and `paid`; only `state=paid` represents finalized chain payment.
Account `monthlyAwards` lists the contributor's approved monthly awards that
are frozen but not yet reserved in the vault (PRD sections 3 and 6), with the
owner view's state: `underfunded` until the coordinator creates the month's
obligations, then `awaiting-reservation`. A reserved award leaves this list
and appears in `payments` under the same source digest. A proposal that is
still under the owner's private review is never returned to the contributor,
and `monthlyAwards` never adds to `balances`.

Migration `0021` changes `payment_obligations` to `asset_address`,
`asset_decimals`, `gross_base` and `fee_base`. It copies each earlier row as
the reviewed asset of its network (all 6 decimals). A row on a network with
no reviewed asset fails the migration; no asset is guessed. It adds `ethereum`
to the chain constraint of `wallet_claims`, `payment_obligations` and
`payment_wallet_proposals`, and adds `vault_snapshots`.

The scheduled worker first reads each reviewed vault's counters at the
finalized block (EVM `finalized` tag, after `verifyEvmDeployment`; Solana
`finalized` commitment) through the adapters' `readVaultTotals`, and upserts
one `vault_snapshots` row per project vault: asset, decimals, every counter as
integer text, the block or slot, its block time and `observed_at`. A counter
that a vault type does not have is NULL. A read that names another vault or
asset, changes the decimals, or lowers a cumulative counter fails and the
stored row stays. An older block never replaces a newer one. The ledger then
takes each award's asset and decimals from that row, so an award is indexed
only after its vault was read.

`GET /api/v1/payments/projects/<id>/vault` serves these rows with
`staleAfterMs` (30 minutes). A page view reads D1 or the edge cache
(`caches.default`, 60 seconds), never a chain RPC. The project page shows
deposited, paid out, payout fees, withdrawn, withdrawal fees, free and
reserved amounts in the vault asset, with the block time ("as of") and a stale
warning past `staleAfterMs`. It shows "not reported" for a NULL counter and no
totals before the first read, never zero. An open page reads the route again
when a snapshot passes `staleAfterMs` (then once per `staleAfterMs`), when the
reader returns to the tab at least 60 seconds after the last read, and after a
finalized wallet action. A failed read keeps the last totals, marked stale.

`POST /api/v1/payments/projects/<id>/solana-funding` reviews or checks a
wallet funding action. It needs no Slop session: the depositor or owner signs
in their wallet. A `review` request names `network`, `vault`, `wallet`,
`operation` (`deposit` or `withdraw`) and decimal `amount`. The service reads
mint precision, verifies the current deployment and balances, simulates the
unsigned transaction, and returns its review and blockhash lifetime. A `check`
request instead supplies base-unit `gross`, the reviewed `blockhash`, and
`transactionId`. It verifies the wallet signature over the finalized message
and requires the reviewed instructions, accounts, privileges and token deltas.
Solana vault creation and deposits also accept a wallet-added compute-budget
prefix and the bounded Lighthouse payer assertion implemented in
`contracts/solana/wallet-transactions.ts`. The assertion may access only the
System-owned, empty-data payer and make no inner calls. Extra actions, accounts,
signers or privilege changes are refused. Token receipt indices come from the
verified finalized message. Withdrawals and award actions keep exact message
matching. This verifier never signs, sends,
changes an award or writes payment state.

Pages resolves the vault from the current D1 registry and `PAYMENT_NETWORKS`.
Its `PAYMENT_RPC_URLS` binding supplies HTTPS RPC endpoints for those networks;
keep this private if a URL includes a provider credential. No RPC URL is
accepted from a request or returned in the plan. Missing configuration fails
closed. Passive page views still use the cached snapshot route above. A wallet
rejection, unconfirmed transaction and finalized failure are separate states;
an uncertain send must be reconciled before another send.

Migration `0014` adds `payment_direct_transfers`: transfers that a project
creator sent outside escrow, imported from the reviewed `disclosures/*.json`
records. Each deploy runs `scripts/prepare-payments-import.ts` after the
migrations. It writes nothing unless every disclosure reproduces from its
frozen preparation. Rows are permanent, and a disclosure that contradicts an
imported transaction fails the import. Direct transfers never become an
obligation or `state=paid`, and project totals never add them to verified
payouts. `GET /me` returns them as `directTransfers`.
`GET /api/v1/payments/projects/<id>/direct-transfers` and
`GET /api/v1/payments/actors/<numeric-github-id>/direct-transfers` publish
the same disclosed facts.

Migration `0015` adds `wallet_observations`: legacy Solana addresses that a
contributor published in a GitHub profile README and that a reviewed
preparation or cycle proposal froze at an immutable commit. The same import
writes them with proof level `profile_readme` (PRD WAL-01). They are history
only. They never become `wallet_claims`, payment authorizations, or payout
destinations. `GET /me` returns them as `walletObservations`, and the payouts
page asks the contributor to connect and confirm a wallet. Registry-sourced
frozen wallets are already D1 claims and are not imported again.

For browser QA, `bun backend/payments/evm.integration.ts --serve` starts a local
HTTP fixture on port 18548 with a seeded GitHub session, real migrated SQLite,
and an isolated Anvil chain. It exposes `/fixture`, the account login read, and
the actual payments API. Wallet registration and signing trigger real local
binding, payout, and finality indexing. This is local product evidence, not a
real GitHub OAuth or public testnet deployment result.

### Monthly allocations and the automatic monthly coordinator

Automatic monthly payment is the PRD default for a funded project (PRD
sections 6 and 7). Migration `0062` adds its private records.

1. **Proposal.** The trusted `monthly-rewards.yml` workflow runs on the first
   three days of each month, on `main` for `slop-private` and on
   `development` for `slop-staging`. It freezes the complete ledger of the
   closed UTC month and runs `bun run rewards:propose-month -- --cycle
   YYYY-MM --sql <file>`. For each active, verified monthly-pool project whose
   escrow policy is effective for the month and whose monthly amount is
   positive, it stores one `monthly_reward_bases` row with the exact D1
   revision bytes and one `monthly_reward_base_rows` row per scored
   contributor: integer base units by largest remainder of the shared pool,
   plus any committed review line. A month's proposal is written once; a later
   run never adds or replaces rows. Unfunded projects and private bounty
   programs get no proposal. No cycle file, public decision or review PR is
   created.
2. **Private changes.** The owner, with current GitHub write, maintain or
   admin permission on the immutable repository, changes amounts through
   `GET /api/v1/payments/projects/:projectId/monthly/:YYYY-MM` and
   `POST .../monthly/:YYYY-MM/allocations` (`githubUserId`, `grossBase`,
   `expectedSequence`). The month's total never exceeds its monthly amount, so
   unallocated funds never raise a later month. Nobody changes their own
   allocation. Each change is an append-only `monthly_allocation_changes` row
   kept only for dispute handling and reconciliation; no route returns it and
   no public reason exists. `POST .../monthly-settings` (`automatic`) turns
   the automatic default off or on again.
3. **Execution snapshot.** `POST .../monthly/:YYYY-MM/finalize`
   (`expectedSequence`) freezes the current allocations now. Otherwise the
   payments Worker's scheduled coordinator freezes them at the cutoff,
   unless the owner turned the default off, the project is restricted or
   paused, or its vault network is not served. The cutoff is
   `MONTHLY_PAYMENT_SCHEDULE`, `{"firstPeriod":"YYYY-MM",
   "cutoffSecondsAfterPeriodEnd":N}`, counted from 00:00 UTC on the next
   1st. Owner decision D1 (24 October 2026) sets the calendar UTC month,
   `{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}`: the
   first automatic month is November 2026 and the cutoff is 72 hours after
   the month ends. The value lives once in the `[vars]` of `wrangler.toml`
   and `wrangler.staging.toml`; `workers/payment-executor/configure.mjs`
   copies it to the ordinary dispatcher. Earlier months are never frozen
   automatically. Without the value nothing is frozen automatically, and a
   malformed value fails the run. While the automatic default is on, the
   allocations cannot change after the cutoff. Either path writes the single
   `monthly_payment_runs` row of that month; a frozen month accepts no
   further change.
   A banned account cannot change allocations or automatic-payment settings,
   or finalize a month. Each write checks the account ban again to refuse a
   concurrent ban. Reading awards and preparing an existing funded obligation
   remain available, subject to the existing authority and project checks.
4. **Obligations.** The coordinator creates one `monthly_payment_obligations`
   row per positive award once, only when the vault's finalized free balance
   (a `vault_snapshots` row newer than 30 minutes) covers the month together
   with every earlier obligation of the same vault that is still unreserved.
   An underfunded month waits for a deposit and creates nothing. The steward
   gets one Inbox payout exception for that month (key
   `monthly-underfunded:PROJECT:YYYY-MM`), however often the coordinator
   retries. Before it creates new obligations, the coordinator excludes accounts
   with an active moderator ban. It records the exact ban in
   `monthly_payment_exclusions` and keeps the original frozen snapshot. Excluded
   amounts do not delay other recipients or become their extra awards. A ban
   during the write forces a retry. Previously funded obligations remain valid.
   The owner sees excluded entries with zero payable amounts; they cannot obtain
   a reservation plan for those entries.
5. **Authorization and execution.** The ordinary attester's scheduled job
   refreshes the finalized vault projection, runs the coordinator, and signs
   each funded month's eligible allocation. The Durable Object records the
   first intent before signing and keeps the frozen economic allocation fixed.
   Funding-time exclusions are omitted; later bans preserve funded awards.
   A later project revision does not block the frozen month unless it changes
   the chain, effective month, fees, vault or asset that sized its proposal.
   The first authorization is immutable in `monthly_payment_authorizations`.
   EVM V2 signs the remaining sources at one finalized block. A source change
   before admission invalidates that attempt. A retry appends a signed attempt
   in `monthly_payment_authorization_attempts`; it never changes the snapshot,
   whole allocation amount, or prior signature. Once the chain admits a root,
   no new attempt is signed. Legacy EVM and Solana keep their original intent.
   A reviewed EVM upgrade can add a V2 attempt to a legacy publication. Its
   public response also retains the original signature, so an uncertain legacy
   transaction can be reconciled if it wins admission.
   `GET /api/v1/payments/projects/:projectId/monthly/:YYYY-MM/authorization/:network`
   returns the latest signed execution attempt and its publication time, without
   calling a signer or RPC. It exposes no private adjustment history.
   Publication is not a reservation or payment. A project-operated or
   permissionless executor must still submit the bounded commitment and
   reconcile finalized results. The payments scheduler sends published allocations
   to the configured executor's `/v1/commit-monthly` service. Its 50 fair-retry
   candidates include any omitted current-period EVM V2 roots needed before
   their older leaves, at most 50 extra calls. These roots run first; a failed
   prerequisite does not block the original candidates. Hosted relayers
   accept this only on the test stack; production requires a separately operated
   executor. Legacy EVM reserves its awards in one transaction. EVM V2 reserves
   the remaining total, then commits bounded proven leaves. An admitted month
   remains resumable after opt-out or its admission window; only finalized
   completion retires it. Solana signs `solanaMonthlyMessage` v3. Before it
   signs, the attester reads every included source's `origin` and
   `monthly-source` account at one finalized slot, refuses the month if any
   exists, and signs that slot's block time as `frozenAt`. The journal keeps this
   `frozenAt`, so an interrupted signer signs the same bytes. The attester also
   refuses a source that appears in another published month of the same vault.
   Solana admits the total, then the executor commits or releases up to 16
   proven leaves per invocation. A zero actor, a source that another month paid
   to the same actor, or a source committed by hand before `frozenAt` releases its
   leaf. A source committed by hand after `frozenAt` stays reserved and is never
   refunded; the executor reports it as `stranded`. Valid funded awards never
   expire. An admitted Solana month continues after opt-out or its admission
   window closes. `monthly_payment_execution` tracks fair retries and completed
   execution, not public payment state. Signed transactions are journaled before
   broadcast and reused after an uncertain response.
   The owner can still prepare individual awards through the Awards page.
   `POST .../monthly/:YYYY-MM/commitment` and
   `.../solana-commitment` recheck the steward, repository authority, project
   revision, enforcement state, served network, execution snapshot digest and
   funded obligation, and return an unsigned plan for that award. Each source
   digest is fixed per project, month and actor, independent of amount, so the
   contract refuses a second reservation of the same award. The existing
   dispatcher and executor then pay reserved awards one recipient at a time;
   a walletless award stays reserved until its contributor binds a wallet.
   Award states come from the finalized chain projection.

The public surface shows only final awards and payment evidence from the
chain. A paused project keeps its funded obligations.

The coordinator keeps its records in `PAYMENTS_DB` with `vault_snapshots` and
`payment_obligations`, and reads the registry from `REGISTRY_DB`. The Pages
API reads the same tables from `SLOP_DB`, so in each environment they are the
same database (`slop-private`, `slop-staging`).

Historical `cycles/<project>/<YYYY-MM>/escrow-v2/` records keep their original
publication, public-reason and related-party rules; `cycles:check` still
validates them. They are no longer an input to new commitments.

The EVM browser flow verifies the vault and free balance through the selected
owner wallet. The Solana flow's `review` step returns an unsigned, simulated
transaction for the award; `check` verifies the exact submitted signature and
finalized reservation. Solana RPC configuration comes only from the service.
The browser reconstructs the expected message before requesting the owner's
signature. Both flows save the pending request before the wallet call and
support recovery after reload without a second submission. A finalized
reservation is a commitment, not a payment.

## Public finalized payments

`GET /api/v1/payments/vault-payments` returns ordinary finalized payment
records for `/cycles`; `actors/<numeric GitHub ID>/vault-payments` and
`projects/<project ID>/vault-payments` narrow that same projection. Reads use
the retained D1 payment ledger, never live chain or GitHub requests. Security
payment tables are separate and are not selected. Private or closed memberships
do not appear in this projection; an actor-specific read for one returns the
same empty page as a public actor without payments, so it never reveals the
membership.

Each record carries the project, recorded contribution month (or `null` when
no matching monthly obligation exists), net base units, exact asset/decimals,
network and transaction. `indexedAt` is the indexing time, not a claimed block
time or work month. The projection reconciles the paid obligation against its
immutable finalized event before returning it. Reserved or submitted amounts
are not paid records, and invalid evidence or failed reads return unavailable.

`GET /api/v1/payments/received` returns all-time money received per public
contributor in one edge-cached response (60 seconds, then stale for up to ten
minutes while it refreshes). It sums every disclosed direct transfer and every
finalized ordinary vault payment whose asset is a six-decimal reference
stablecoin of its network, so the amount is in micro-dollars; testnet receipts
count only on staging. Other vault assets stay separate in `otherAssets` and
are never converted. Each contributor also carries the same amount by project.
Vault records pass the same evidence reconciliation as the projection above,
and one invalid record, or more than 20,000 records, fails the read. The home,
leaderboard and project standings read only this aggregate; a browser shows
its last good copy marked stale when a refresh fails, and never a zero total.

Pages return at most 100 records. Continue with the returned `next` as `after`
and the same `through` boundary; `total` applies to that boundary. The public
client checks page continuity, duplicates and completeness before display, and
keeps currencies separate. This read path creates no award or payment.
