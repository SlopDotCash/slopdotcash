# Escrow payment account and dispatch

The account API reuses the existing GitHub-only browser session. Numeric GitHub
actor IDs select obligations and append-only wallet claims. It never treats a
wallet as a login method. An account can exist after an award is reserved even
if that actor has never signed in.

`GET /api/v1/payments/me` returns gross awards, deducted fees, net amounts,
finalized payment transactions, current wallet claims, and unpaid net balances.
No failed query returns a fabricated zero balance.

`POST /wallets/register` takes `chain` and `address` using the existing GitHub
session. It writes the same canonical claim and atomic audit as the legacy
wallet API; concurrent successor changes return a conflict.

A current authenticated registry claim must be explicitly authorized for
automatic payments. `POST /wallets/challenge` takes `claimId` and returns a
15-minute message. Sign that exact message with Base `personal_sign` or Solana
Ed25519 `signMessage`. `POST /wallets/authorize` takes `claimId`, `challengeId`,
and `signature` (Base hex r/s/v; Solana padded base64). The challenge binds
actor, chain, address, claim, audience, and nonce; it can be used once. Contract
wallets and off-curve Solana destinations need a separately reviewed recovery
path; they cannot skip signature verification. Legacy claim semantics remain
unchanged.

Admin wallet proposals are append-only pending records. The same GitHub session must match the trusted numeric `operatorIds` allowlist,
provided by Pages `OPERATOR_GITHUB_IDS`; no public request header grants this
capability.
A proposal cannot authorize a destination. The contributor must independently
register and sign their destination.

Apply migration `0011_payments.sql` after prior migrations. Run the account and
queue integration workflow with:

```
bun backend/payments/base.integration.ts
```

The Base vertical workflow deploys real local contracts, reserves a walletless
award, refunds free funds with the withdrawal fee, authorizes a late wallet,
dispatches a payment, and indexes its finalized receipt into the account ledger.
It checks actual contributor, fee, and refund token balances. It uses an isolated
Anvil test signer, not a deployed production signing service. The EVM adapter
also has a separate Anvil integration workflow in `contracts/evm`.

`workers/payments/index.ts` has no public fetch route. Its scheduled entry scans
finalized Base logs and Solana signature history, then reconciles submitted or
uncertain attempts and dispatches ready obligations. Cursors advance only after
every recognized event is verified and indexed. Base starts from the reviewed
deployment transaction. Solana stores one finalized signature page per run in a durable discovery
interval. After it reaches the preceding cursor, it indexes that interval
oldest first, at most 100 transactions per run. Migration `0012` adds the pending
pages and generation/revision checkpoints. Indexing verifies only this project's
escrow instructions. Cursor advancement and removal of verified page entries
share an atomic checkpoint; stale overlapping runs cannot rewind it. Restarted
runs may reverify an event through the existing idempotent ledger. New arrivals
wait for the next interval, and verified pages are removed. A failed or
unavailable RPC never advances coverage. A failure in one deployment or step is
reported but does not stop the other deployments, recovery, reconciliation, or
dispatch. Queue ingestion remains available for faster event delivery and uses
the same verification.

The ledger records `paid` only when the payout destination is one of the
contributor's authorized wallets. Any other destination means the identity
authority was misused, so indexing fails closed for investigation. Executors
never sign a payment for a pending, cancelled, or vetoed binding. A successor
wallet waits 24 hours even where the escrow has no earlier binding for that
contributor. A Base bind transaction can be retired only after its revert is finalized
and its receipt matches the canonical block. The journal keeps that proof
before a fresh bind can replace it. Pending and ambiguous results remain held.

Derive `PAYMENT_DEPLOYMENTS` from reviewed project manifests. Resolve private
RPC URLs through `PAYMENT_RPC_URLS`, keyed by network; do not publish them in
manifest output. Solana additionally needs `PAYMENT_SOLANA_GENESIS` trust roots.
The manifest supplies its program, project PDA, token vault, network domain,
and asset. Both chain adapters fetch actual finalized evidence independently.

`BASE_PAYMENT_EXECUTOR` and `SOLANA_PAYMENT_EXECUTOR` are separate internal
service bindings, not public URLs. The scoped signing implementations live in
`workers/payment-executor`. Neither relayer key may approve awards or withdraw
funds. A separate attester signs only a verified destination binding. Keys are
runtime secrets; no production credentials are read by the local tests.

An ambiguous submission retains its attempt and idempotency key. The scheduler
can recover a persisted transaction hash through the relayer's read-only journal
status API even after a wallet change. Missing receipts remain uncertain. Only
proved finalized reverts permit a fresh payment attempt; the failure evidence is
retained. Successful transactions become paid only through the finalized event
scanner. Destination changes cannot start a competing transfer while an earlier
attempt is uncertain; successor binding rotation waits 24 hours after the later claim/consent time
and requires a proved ancestor claim with no unresolved old-wallet attempts.

`GET /api/v1/payments/projects/<id>/totals` publishes net contributor payments,
payout fees, and unpaid award reserves from verified events, plus cursor coverage
and sync time. These fields are not a vault balance, deposit total, or refund
ledger. Missing index coverage is explicit. Account `deliveryState` distinguishes
needs-wallet, awaiting-binding, submitted, held, and paid; only `state=paid`
represents finalized chain payment.

For browser QA, `bun backend/payments/base.integration.ts --serve` starts a local
HTTP fixture on port 18548 with a seeded GitHub session, real migrated SQLite,
and an isolated Anvil chain. It exposes `/fixture`, the account login read, and
the actual payments API. Wallet registration and signing trigger real local
binding, payout, and finality indexing. This is local product evidence, not a
real GitHub OAuth or public testnet deployment result.
