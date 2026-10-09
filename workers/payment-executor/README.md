# Restricted test payout execution

These private Workers perform the missing signing and broadcast step. They are
separate from the public account API and the scheduled payment dispatcher. They
accept an approved obligation and wallet-claim reference, never caller-supplied
calldata, amounts, tokens, programs, or arbitrary destinations.

Deploy a separate Worker for each test network, isolated database, and role. The identity attester has only
that chain's test identity key. The gas relayer has only its own test gas key.
Each Worker has its own SQLite Durable Object journal. The relayer reaches the
attester through a private service binding. Both roles independently read the
current wallet authorization from D1, reconstruct the exact signed consent,
verify the wallet signature, check its GitHub actor and immutable claim digest,
and inspect the finalized obligation. This trusts the GitHub session admission
and reviewed deployment registry. It does not make GitHub identity verifiable
without the identity authority.

The hosted wrapper checks the configured test network and the RPC's chain or
genesis identity before reading the signer secret. Base mainnet and Solana
mainnet are rejected. The local integration override exists only in the core
APIs and is not forwarded by the hosted wrapper.

## Durability and retries

Base nonce allocation, transaction signing, and persistence of signed bytes,
transaction hash, immutable operation identity, and next nonce occur inside one
Durable Object storage transaction. RPC calls happen outside that transaction.
Concurrent fetch handlers can interleave; the storage transaction serializes
nonce allocation and rechecks existing attempts. The signed transaction exists
in durable storage before its first broadcast. A retry uses the same bytes and
checks the known transaction first. It never starts another payment merely
because an RPC response was lost.

The Solana executor journals the signed wire transaction, signature, blockhash
expiry, and generation before broadcast. Its replacement path requires finalized
expiry and a fresh finalized obligation check. It creates destination associated
token accounts idempotently and pays through the version-bound escrow instruction.

`POST /v1/pay` returns a submitted transaction identity. It does not mark a
payment paid; the independent scanner and verifier must prove finality first.
A missing finalized wallet binding requests the separate attester and remains
retryable until binding finality. A successor wallet activates only after 24 hours have passed since both its
registration and signed authorization. The previous on-chain claim must occur
in the same actor/chain predecessor lineage, and all older-wallet payment
attempts must be reconciled. An operator cannot bypass this path.

`POST /v1/attempt-status` returns a persisted payment transaction identity or
null. It checks the original database attempt and journal identity, and does
not sign, broadcast, read a secret, or require the wallet claim still to be
current. This lets the dispatcher reconcile a lost response even after the
contributor has replaced the wallet. Signed transaction bytes are never returned.

`POST /v1/cancel-unsubmitted` retires an old-wallet attempt only after a signed
successor exists. Its journal transaction either finds a previously signed
transaction and returns that identity, or writes a retirement tombstone. Every
signer transaction checks the tombstone before signing. The dispatcher may mark
the old attempt failed only after confirmed retirement; a null lookup alone is
never proof that signing cannot race the lookup.

Signer keys must be dedicated to these Workers. Manual external transactions
using the same keys would invalidate the nonce ownership assumption. A Base
transaction stuck due to fee pricing requires operator reconciliation; there
is no automatic gas-price replacement in this version. Base signing limits gas
to 500,000 and max gas price to 10 gwei. Never delete or restore an old journal
snapshot to clear an error. A restore must preserve every signed attempt and
reconcile the chain before resuming.

## Configuration

`configure.mjs` generates private test-only Wrangler configurations from the
reviewed deployment registry and an explicitly supplied isolated D1 identity:

```sh
node workers/payment-executor/configure.mjs \
  --network "$TEST_NETWORK" \
  --database-id "$TEST_D1_DATABASE_ID" \
  --database-name "$TEST_D1_DATABASE_NAME" \
  --deployments "$REVIEWED_TEST_DEPLOYMENTS_FILE" \
  --output workers/payment-executor/.generated
```

This command does not create resources or deploy. Generated configuration has
`workers_dev: false`, `preview_urls: false`, no routes, and the SQLite Durable
Object migration. It emits an attester, relayer, and five-minute scheduled dispatcher
for exactly one network. Every deployment must byte-for-structure match its canonical
project manifest; empty, invented, mixed-network, and duplicate-project entries fail.
Use database names `slop-payments-NETWORK` with an optional lowercase suffix, at most
43 characters. Worker/service names include the complete database name, so separate
Solana clusters and repeated isolated stacks cannot share keys or journals.

Create a dedicated empty test D1 database using pinned Wrangler `d1 create`, then pass
its returned ID and name to this command. Never supply a production database ID.
Inspect the generated JSON and `apply-test-backend.sh` before running it. The apply
script first bundles all Workers, checks each remote Worker using pinned Wrangler `deployments list --json` and
an explicit `CLOUDFLARE_ACCOUNT_ID`, and refuses any existing stack. Wrangler reuses
its existing OAuth session or release authentication; no new API token is required.
Only Worker-not-found code 10007 for the exact account/name endpoint proves absence.
Authentication, network, permission, timeout, and other API errors stop the installer;
raw provider output and credentials are never printed. Temporary configs cannot inherit
source configuration or local environment files. It then applies all repository D1 migrations, deploys the private signers,
prompts for each role's separate secrets, and creates an inactive dispatcher before
installing its RPC secrets. The last deploy enables the cron. Failed or partial runs
must be reconciled explicitly: rerunning will fail closed once a Worker exists.
This is a fresh-stack installer, not an updater or journal reset tool. Coordinate a
single release operator to prevent concurrent provisioning races.

The generated `pages-bindings.json` is an integration fragment for an isolated test
Pages environment, not permission to change an existing staging deployment. Bind its
`SLOP_DB` to the exact same test D1 as the dispatcher; only one network/database may
be selected for one frontend environment. Test identity is configured separately as
below. Never add a public route to a payment signer or dispatcher.

Set secret bindings only through the approved isolated test release process:

- `PAYMENT_RPC_URLS`: private JSON mapping of network names to authenticated RPC
  endpoints. Do not place RPC credentials in public manifests.
- Base Worker: `TEST_SIGNER_PRIVATE_KEY`, dedicated test key in hex form.
- Solana Worker: `TEST_SOLANA_SIGNER_SEED`, dedicated test seed as 64 hex digits.

Supply only the one signer secret for the Worker's chain and role. The
`PAYMENT_DEPLOYMENTS` public configuration is generated from reviewed project
manifests; it is not a second editable project inventory. Both roles use
`PAYMENTS_DB`; the executor code reads authorization data and does not create
wallet authorizations or approve awards. Journal storage contains sensitive
operational material and has no read route other than transaction-ID lookup.

## Validation boundaries

`bun backend/payments/base.integration.ts` executes the account API, signed
wallet consent, finalized reservation scanner, real separate EIP1559 signers,
payment dispatch, disk-backed journal recovery after a deliberately lost RPC
response, and finalized payout indexing against actual Anvil contracts. It
checks the net 98-USDC balance from a 100-USDC gross award, rejects a substituted
destination, verifies scanner replay, rejects an early successor, and executes
the successor payment after a simulated 25-hour delay. It also proves signed
attempt discovery after wallet replacement and prevents retirement of signed
transactions. The deterministic Anvil mnemonic is a
public test fixture, not a user secret.

Local execution is not public testnet evidence. Public-chain acceptance still
needs isolated D1 and service bindings, dedicated funded gas/identity signers,
reviewed deployed escrow identities, actual test USDC, real GitHub OAuth, hosted
private Worker deployment, and finalized public receipts. Mainnet enablement,
production signing operations, lost-identity recovery, donation accounting,
and independent security review remain separate gates.

## Isolated GitHub login without production identity changes

Use `node workers/identity/configure-test.mjs --public-origin "$TEST_IDENTITY_ORIGIN"
--database-id "$TEST_IDENTITY_D1_ID" --database-name slop-identity-test
--output evidence/test-identity`. The origin must be the account's exact
`https://slop-identity-test.<account-subdomain>.workers.dev` URL. Use a separate
identity D1 database and dedicated test secrets. No DNS or custom-domain changes are
needed. This script creates configuration and an exact `oauth-registration.json`;
it performs no remote operations.

The remaining human registration is a dedicated GitHub OAuth application (or separate
GitHub App OAuth client) with homepage `https://slop-staging.pages.dev` and callback
`$TEST_IDENTITY_ORIGIN/v1/oauth/callback`. The existing protocol uses PKCE. Supply its client ID and
secret as `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`; independently generate
`IDENTITY_STATE_KEY` and `IDENTITY_ASSERTION_KEY` using the existing identity key
requirements. Never copy production OAuth credentials. With the generated identity
config, use pinned Wrangler to dry-run, apply D1 migrations remotely, deploy, and set
those four secrets. The single shared test identity uses the exact database name `slop-identity-test`.
Its hourly cron cleans expired identity state only and cannot renew production
private-intake status. Invocation logs are disabled to avoid logging OAuth query data.

Build the isolated frontend with `VITE_IDENTITY_PUBLIC_ORIGIN` set to the same origin.
Run the identity config generator again with `--frontend-directory <isolated-dist>`
after the build to replace the generated CSP's identity connect destination with that
exact origin; source `public/_headers` remains unchanged. Bind test Pages
`SLOP_IDENTITY` to `slop-identity-test`, set `PAYMENTS_ALLOWED_ORIGIN` to
`https://slop-staging.pages.dev`, and supply a dedicated `TRACE_AUTH_SECRET` of at least
32 characters for the login rate limiter. Set `OPERATOR_GITHUB_IDS` only if an operator
admin test is needed. Production hosts ignore the test frontend override. Test identity
accepts browser start/poll only from the exact supported staging hosts; production
identity continues to reject them.

Existing `slop-staging.pages.dev` is owned by another task: coordinate before changing
its Pages bindings or deploying the isolated artifact. No live OAuth or hosted session
claim is made until real GitHub sign-in, one-use assertion consumption, same-host cookie,
wallet control signature, and finalized payout pass there. Use the new login/earnings
flow; the legacy standalone wallet registration continues to use production identity.
