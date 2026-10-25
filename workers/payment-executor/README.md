# Restricted test payout execution

These private Workers perform the missing signing and broadcast step. They are
separate from the public account API and the scheduled payment dispatcher. They
accept an approved obligation and wallet-claim reference, never caller-supplied
calldata, amounts, tokens, programs, or arbitrary destinations.

Deploy a separate Worker for each test network, isolated database, and role. The identity attester has only
that chain's test identity key. The gas relayer has only its own test gas key.
Each Worker has its own SQLite Durable Object journal. On EVM networks the
relayer reaches the attester through a private service binding. Both roles
independently read the current wallet authorization from D1, reconstruct the
exact signed consent, verify the wallet signature, check its GitHub actor and
immutable claim digest, and inspect the finalized obligation. This trusts the
GitHub session admission and reviewed deployment registry. It does not make
GitHub identity verifiable without the identity authority.

The attester cannot bind on its own: every destination binding also carries
the destination wallet's signature (PAY-05, escrow review H-1). On Base the
contributor signs an EIP-712 `DestinationBinding` for the exact chain, vault,
actor, destination, expected version, claim digest and expiry through the
account API (`/wallets/bind-challenge`, then `/wallets/bind-authorize`), which
takes the chain ID from the reviewed deployment, stores the signature in the
low-s, 27-or-28 encoding the vault accepts, and appends it to
`payment_binding_authorizations`. A renewal with a new expiry is a new row, so
an expired authorization never blocks the claim. The attester reads the stored
signature with the latest expiry for the on-chain version it is about to bind,
verifies it again, and submits it unchanged; with no stored signature it
refuses, and the award waits for the contributor. On a test stack the
relayer requests the binding. A mainnet has no Slop relayer (PAY-04), so the
production EVM attester's own five-minute cron run requests it
(`/v1/bind-destinations` on its journal, reached only from `scheduled`).
The production EVM attester refuses `/v1/pay`, so this run is its only
binding path. Each run first passes the stack, network and preflight
checks of every pinned vault. After the run indexes the finalized vault
events, it reads from D1 each reserved award on a pinned vault whose
contributor has a current signed wallet authorization and a stored binding
signature that is valid for at least 10 more minutes, one per contributor
and vault. It reads the key only when there is work. It checks at most 10
candidates per run, the least recently checked first. For each candidate
it does the same checks as `/v1/pay` without a payout attempt: the GitHub
actor, the claim digest and the wallet signature of the named current
claim, the finalized unpaid award, the identity signer, the successor
lineage for a rotation, and the stored binding signature for the current
on-chain version. A binding that is already current needs nothing. Its
journal key names the vault, actor, claim and finalized binding version,
so an unknown send retains the same signed bytes. Every signed binding stays
on a pending list until its canonical receipt is finalized or a finalized
revert proof retires it. Each run reads pending receipts first, even after a
wallet changes. Before any broadcast, it verifies the exact signed intent
against the current D1 claim, wallet authorization, unpaid award, on-chain
version and unexpired stored consent. An obsolete or unprovable attempt stays
held with its bytes, hash and nonce unchanged. This safety boundary alone does
not resolve a held nonce that blocks the identity key's later transactions. A rejected or held candidate makes the run
fail in the Worker logs; the other candidates continue. A binding that the
project owner cancelled fails the same way until an identity review. The
payout `pay`
stays permissionless: the project owner or any wallet submits it, with no
Slop key (`contracts/DEPLOY-MAINNET.md` section 3.6). On Solana the destination keypair must sign
the same transaction: `POST /v1/pay` on the attester prepares, half-signs and
journals the `bind_wallet` transaction and returns its bytes; the contributor's
wallet signs them; `POST /v1/complete-bind` checks that the bytes, the identity
signature and the wallet signature all match before broadcasting. The signed-in
contributor reaches both through the account API
(`/wallets/solana-bind/prepare`, then `/wallets/solana-bind/complete`), which
selects the contributor's current claim and payout attempt and calls the
attester through its service binding. The
transaction must be completed inside its blockhash lifetime, so a Solana
binding is always an interactive step; the relayer reports a missing binding
and never requests one.

The hosted wrapper checks the configured network and the RPC's chain or
genesis identity before reading the signer secret. Every registry test network
is accepted (Base Sepolia, Robinhood Chain Testnet, Ethereum Sepolia, Solana
Devnet and Testnet); each network's chain and chain id come from
`src/lib/escrow-policy.mjs`. A mainnet network (Base, Ethereum, Robinhood
Chain, Solana) is accepted only when its value in `mainnet-execution.mjs` is
`true`. Only `base-mainnet` is `true` (owner activation of 24 October 2026,
`contracts/DEPLOY-MAINNET.md` section 3.6); every other value is `false`. Only
a reviewed pull request that records that network's production activation can
change one. The local integration
override exists only in the core APIs and is not forwarded by the hosted
wrapper. `assert-fresh-test-stack.mjs` accepts only registry test networks.

Each signer belongs to one stack (`SIGNER_STACK`, see `signer-stacks.mjs`). A
`test` stack (also when the variable is absent, as in stacks generated before
it existed) signs for registry test networks only and reads
`TEST_SIGNER_PRIVATE_KEY` or `TEST_SOLANA_SIGNER_SEED`, with the journal
`dedicated-test-signer-v1`. A `production` stack signs for registry mainnets
only and reads `SIGNER_PRIVATE_KEY` or `SOLANA_SIGNER_SEED`, with the journal
`production-signer-v1`, and it is the identity attester only: the wrapper
refuses the relayer role on it (PRD PAY-04). The wrapper checks the stack and
the network, then the preflight, before it reads a secret, so a test key
never signs for a mainnet and a production key never signs while
`MAINNET_EXECUTION` is off.
Any other `SIGNER_STACK` value stops the signer.

## Private bounty bindings

The protected main release also prepares absent Solana, Ethereum and Robinhood
attester services through `prepare-inactive.mjs`. It creates only empty,
execution-disabled services with no public endpoint or cron. Existing services
are left unchanged. A network with reviewed vault pins or enabled execution
requires its separate network release. This preparation reads no signing key
and installs no secrets; the existing matching credentials can be entered after
the exact private service deployment is verified. It does not activate payments.

One production attester serves a network's ordinary and bounty vaults. The
configuration generator derives both pin lists from the checked registry.
`PAYMENT_DEPLOYMENTS` selects ordinary vaults; `SECURITY_PAYMENT_DEPLOYMENTS`
selects private vaults. Both scopes share the same Durable Object, identity
key and nonce journal, because the factory supplies one identity authority.
Do not run separate signing services with that same key on the same network.

Its five-minute schedule indexes finalized events into each scope's separate
ledger. On EVM it submits only bindings with current account and wallet
consent, using the existing reconciliation rules. Private internal requests
use `/v1/security/`. Solana wallet co-signing remains interactive through the
private account route; its `SECURITY_SOLANA_IDENTITY_ATTESTER` binding points
to the same network attester, with that private path.

The private scope never signs a monthly allocation or submits an award
payment. The owner still decides each bounty and the project or a permissionless
executor submits its payment. Private amounts and case records stay out of
ordinary balances and notices. Generated configuration is not a deployed
service; use the reviewed main release before owner-authorized key installation.

## Monthly allocation execution

The ordinary attester publishes only the eligible entries of the immutable funded
monthly snapshot. Its scheduled job prepares and signs the allocation through
`/v1/monthly-authorization`; it does not execute payments. The public authorization
endpoint is documented in `backend/payments/README.md`.

`POST /v1/commit-monthly` accepts that authorization on a test relayer. It verifies
the pinned deployment, allocation root and attestation before admission. Legacy
EVM commits the full entry list. EVM V2 reserves the whole remaining gross first,
then examines at most 16 proven leaves per call under the existing gas limit.
A finalized cursor bounds repeated work when another keeper committed a prefix.
The economic snapshot stays fixed; source changes before admission append a new
immutable execution authorization. The original V1 authorization remains
available when an older transaction is pending. The executor reconciles that
exact transaction before any V2 replacement and accepts its finalized root if
it wins. It never drops an uncertain send to choose a newer authorization.

Solana submits `commit_monthly` with the signed
`frozenAt` and then up to 16 Merkle-proven leaves per call, so all leaves settle
soon after admission. Finalized on-chain counters determine completion. A leaf
releases only as `release_monthly_award` allows: zero actor, a source that another
month paid to the same actor for at least the same gross, or a source committed by
hand before `frozenAt`. A source consumed by hand after `frozenAt` stays reserved
and reports a reconciliation error. It does not mark the month complete. Valid leaves
remain funded without an expiry, including after opt-out or authority rotation.
`?admit=false` resumes admitted EVM V2 and Solana allocations without creating a new month;
an absent month returns `notAdmitted: true`. The scheduler uses this for older
months and opted-out projects. No response marks an award paid: the finalized
scanner remains authoritative.

The separately operated [payment keeper](../../scripts/payment-keeper/README.md)
uses these same commitment builders and signed journals. It reads public
authorizations and finalized contract wallet bindings, without private D1
account access. The hosted production role remains attester-only.

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
On a Base test stack a missing finalized wallet binding requests the separate attester and
remains retryable until binding finality; on Solana it waits for the
contributor's co-signed binding. A verified successor wallet activates immediately after registration, signed
authorization, and reconciliation of earlier payment attempts. The previous on-chain claim must occur
in the same actor/chain predecessor lineage, and all older-wallet payment
attempts for unpaid awards must be reconciled. An award whose finalized payout
is indexed is settled, even when an older attempt never recorded that
transaction. An operator cannot bypass this path.

`POST /v1/attempt-status` returns a persisted payment transaction identity or
null. It checks the original database attempt and journal identity, and does
not sign, broadcast, read a secret, or require the wallet claim still to be
current. This lets the dispatcher reconcile a lost response even after the
contributor has replaced the wallet. For a stored Solana signature it also
reports whether the reviewed chain has observed that signature. A preflight
refusal leaves the attempt retryable. Recovery also reopens an older row that
incorrectly marked an unobserved signature submitted. The journal keeps its
signed bytes; only the existing finalized-expiry checks permit a replacement.
Signed transaction bytes are never returned.

Deploy the executor before, or together with, the payments Worker when adding
this observation field. The updated payments Worker refuses an older executor
response that lacks it; it does not guess submission or start another send.

`POST /v1/cancel-unsubmitted` retires an old-wallet attempt only after a signed
successor exists. Its journal transaction either finds a previously signed
transaction and returns that identity, or writes a retirement tombstone. Every
signer transaction checks the tombstone before signing. The dispatcher may mark
the old attempt failed only after confirmed retirement; a null lookup alone is
never proof that signing cannot race the lookup.

Signer keys must be dedicated to these Workers. An EVM transaction stuck due
to fee pricing requires operator reconciliation; there is no automatic
replacement or cancellation authority in this version.

A designated operator may reconcile one previously authorized external recovery
transaction through `POST /api/v1/operator/wallet-bindings/reconcile`. The request
uses the current same-origin site session and live `OPERATOR_GITHUB_IDS`, with
`scope` (`ordinary` or `security-bounty`), `network`, `vault`,
`originalTransactionId`, `winnerTransactionId`, and an 8–500-character `reason`.
This observes a transaction which a human or owner-authorized agent already
submitted. It does not authorize, construct, sign, or broadcast that transaction.

Pages receives only the named `BindingRecovery` entrypoint. The normal protected
production release installs its Base binding only after it releases and verifies
the attester at that source. An existing zero-pin attester stays unchanged and
Pages recovery remains unavailable for that release. Staging and preview do not
receive the production binding. No separate mode or project inventory is used.

The original finalized canonical binding receipt takes priority. Otherwise,
recovery accepts only a finalized canonical type-2 transaction from the original
identity signer, at the original nonce, to its own plain EOA, with zero value,
empty data/access list, and exactly 21,000 gas consumed and supplied. Its signed
bytes are reconstructed and its signature and hash verified. Missing, changed,
nonfinal, or unsupported winners remain held. Current reviewed deployment and
identity pins must still match; a rotated-away identity requires separate review.

The journal atomically archives the exact original attempt and observed proof,
then retires only that pending entry. Repeating the same request is idempotent;
a changed winner refuses. It never resets the shared nonce, changes a wallet or
consent, marks a payment paid, or releases a reserve. A durable private request
audit precedes the call; a lost response is recorded as unknown and must be
retried with the same input. Future ordinary bindings still use their own current
authorization. Keeper gas budgets and Solana recovery are not changed.

EVM signing limits gas to the deployment record's `gasCeiling`, copied from the
network registry, and max gas price to 10 gwei; a record without a ceiling is
refused.

| Network | `gasCeiling` | Why |
| --- | --- | --- |
| Base (`base-sepolia`, `base-mainnet`) | 500,000 | Plain L2 execution gas |
| Robinhood Chain (`robinhood-testnet`, `robinhood-mainnet`) | 2,000,000 | `eth_estimateGas` on Arbitrum Nitro folds the Ethereum data-posting fee into the returned units |

Never delete or restore an old journal
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
project manifest in the D1 registry snapshot; empty, invented, mixed-network, and duplicate-project entries fail.
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

### Production stack definition

`--stack production` generates the identity attester Worker for one registry
mainnet. The following commands require registered vaults and serve
`contracts/DEPLOY-MAINNET.md` section 3.2. For the first Base vault, use that
runbook's empty-capable setup in section 3.6. The owner or an authorized agent
prepares the configuration:

```sh
bun run projects:sync
bun run payments:deployments mainnet "$NETWORK" > "$PINNED_DEPLOYMENTS_FILE"
node workers/payment-executor/configure.mjs --stack production \
  --network "$NETWORK" \
  --deployments "$PINNED_DEPLOYMENTS_FILE" \
  --output workers/payment-executor/.generated
```

The production release uses the registry snapshot from its verified build.
The prepare job validates and uploads both generated registry files and records
their SHA-256 digests. The deploy job checks those digests before it loads the
snapshot. Pin derivation and this command then read the same registry and revision
history. A new D1 vault registration does not need a source commit or a second
registry fetch during deployment. This handoff does not enable another network.

The command does not create resources, read keys or deploy. It refuses a test
network and any `--database-id` or `--database-name`. The production stack
has no relayer and no dispatcher: under PRD PAY-04 the project or a
permissionless executor holds the relayer key, and Slop runs no service or
scheduled job that starts a payment. The PAY-05 attester is the only Slop-held
payment key. The Worker name is `slop-payments-NETWORK-attester`. Its
`PAYMENTS_DB` is the registry database (`SLOP_DB` in `wrangler.toml`),
because the account API stores wallet claims and binding authorizations
there; the Pages release migrates it, so this configuration has no migrations
directory. The attester has `SIGNER_STACK=production`, takes the production
secret name above, and refuses the network while its `MAINNET_EXECUTION`
value is `false`. The hosted signer refuses `SIGNER_ROLE=relayer` and the
relayer endpoints on a production stack. The generated
`apply-production-stack.sh` lists the dry run, the attester deploy and its
secret prompts for review. Do not run its local deployment commands for
production; use the protected `main` release workflow.

An empty production input list is valid only when the checked registry has
no deployment for that network and scope. The shared attester has no cron
only when both generated pin lists, ordinary and private, are empty. In that
state, every signing request is refused before reading an RPC or signing key.
Test stacks still require reviewed deployments.

The protected `main` release can create the absent Base attester in this
inactive state, so the owner can install its existing key and RPC secrets
before creating the first vault. No secret is required for that initial
inactive release. A zero-pin release leaves any existing Worker and its
journal unchanged; it never disables an already-served vault. Once the
checked registry contains real vault pins, the normal release requires the
exact `PAYMENT_RPC_URLS` and `SIGNER_PRIVATE_KEY` secret names and restores
the existing schedule. This does not enable another network, create a
payment dispatcher or authorize a transaction. Production deployment still
uses the reviewed main-only release workflow.

The generated `pages-bindings.json` is an integration fragment for an isolated test
Pages environment, not permission to change an existing staging deployment. Bind its
`SLOP_DB` to the exact same test D1 as the dispatcher; only one network/database may
be selected for one frontend environment. Test identity is configured separately as
below. Never add a public route to a payment signer or dispatcher.

Set secret bindings only through the approved isolated test release process:

- `PAYMENT_RPC_URLS`: private JSON mapping of network names to authenticated RPC
  endpoints. Do not place RPC credentials in public manifests.
- EVM Worker (Base or Robinhood Chain): `TEST_SIGNER_PRIVATE_KEY`, dedicated test
  key in hex form.
- Solana Worker: `TEST_SOLANA_SIGNER_SEED`, dedicated test seed as 64 hex digits.

Supply only the one signer secret for the Worker's chain and role. The
`PAYMENT_DEPLOYMENTS` public configuration of the two signer roles is
generated from the D1 project registry snapshot (`bun run projects:sync`); it
is not a second editable project inventory. The dispatcher has no deployment
list: it reads the vaults of its `PAYMENT_NETWORKS` on every run from
`REGISTRY_DB`, which `configure.mjs` binds to the `SLOP_DB` registry database
in `wrangler.toml` without a migrations directory. The generator refuses an
isolated payment database that is the registry database. Both roles use
`PAYMENTS_DB`; the executor code reads authorization data and does not create
wallet authorizations or approve awards. Journal storage contains sensitive
operational material and has no read route other than transaction-ID lookup.

## Validation boundaries

`bun backend/payments/evm.integration.ts` executes the account API, signed
wallet consent, finalized reservation scanner, real separate EIP1559 signers,
payment dispatch, disk-backed journal recovery after a deliberately lost RPC
response, and finalized payout indexing against actual Anvil contracts. It
checks the net 98-USDC balance from a 100-USDC gross award, rejects a substituted
destination, refuses to bind without the wallet's accepted binding, verifies
scanner replay, rejects an early successor, and executes the successor payment
after a simulated 25-hour delay with the successor wallet's own acceptance. It also proves signed
attempt discovery after wallet replacement and prevents retirement of signed
transactions. The deterministic Anvil mnemonic is a
public test fixture, not a user secret.

`bun workers/payment-executor/bind-trigger.integration.ts` runs the
production Base mainnet attester through its hosted entry point (`scheduled`
and the journal Durable Object, configured by `configure.mjs --stack
production`) against real contracts on Anvil with chain id 8453. An owner
creates the vault, deposits and commits a 10 USDC award; the contributor
confirms the wallet and signs the binding through the Pages account API; the
cron run binds it; an unrelated wallet calls `pay`; the contributor
receives 9.8 USDC, the award is indexed paid, `claimFees` moves 0.2 USDC to
the fee recipient and the owner withdraws the rest. It also shows that an
expired binding signature is never submitted, that a signature from
another GitHub actor is refused by the API and by the attester, and that a
binding whose broadcast is lost twice stays one journaled transaction with
one nonce until the same authorized bytes are broadcast. Signed consent that
expires or names a superseded claim is held without rebroadcast. The test also
covers a delayed original send, missing receipt and noncanonical receipt;
finalized receipt reconciliation remains possible after the claim changes.

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
