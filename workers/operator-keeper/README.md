# Operator-owned Cloudflare keeper

This Worker runs the [existing payment keeper](../../scripts/payment-keeper/README.md)
on an operator's Cloudflare account. It reads public Slop records and pays only
through the reviewed permissionless contract functions. The operator supplies
its dedicated gas wallet, RPC and spending limits. Slop does not receive that
key or gain a payment role.

The template is off and has no cron schedule. It has no public route. It is not
part of Slop's site or Worker release workflow. No deployment or live payment
is part of the source qualification.

## Storage and execution

One SQLite Durable Object owns one network and gas wallet. EVM address case,
project selection and registry changes cannot select a new object. The stored
registry identity must still match. Run only one keeper namespace for this
wallet. Do not also use the CLI or another signer process. Do not rename the
class, replace its namespace, or delete its data to retry a payment.

The Worker reuses `runKeeper`, the transaction builders, finalized receipt
checks, scanner, gas limits and journal schema. It replaces only the host's
SQLite and secret access. The same transaction stores the gas liability,
signed bytes and nonce before a broadcast. Read-only RPC calls and local
signing can occur inside an asynchronous storage transaction. A failed
transaction rolls back those writes. Broadcasting occurs after the transaction
commits.

Overlapping ticks share one active run. A restarted object reads its durable
journal. It reconciles an uncertain send before replacement and retains its
gas liability. The full tick does not hold a storage transaction or a timed
lease. SQLite scanner batches use a synchronous transaction; signing uses the
asynchronous transaction API. No callback with `await` runs in
`transactionSync`.

Cloudflare limits still apply. A Durable Object storage critical section can
reset after 30 seconds. A Cron invocation has a finite runtime. An interrupted
run must resume from the journal; it is not proof of payment. Use the existing
`perRun` bound and the operator's spending limits. A provider failure or missing
receipt remains unavailable work.

## Local durability qualification

Run the actual keeper against Anvil and a native Workerd SQLite Durable Object:

```sh
SLOP_KEEPER_RUNTIME=cloudflare bun --no-env-file scripts/payment-keeper/evm.integration.ts
```

This uses generated local keys and loopback RPC only. In addition to the
rollback, duplicate, fee-budget and failed-recipient cases, it holds a payment
at the RPC transport after the journal commits but before the node receives
the signed bytes. It verifies the durable attempt, nonce and gas reservation,
then kills the fixture's entire process group with `SIGKILL`. A fresh process
opens the same storage and submits the exact retained transaction once. The
other recipient stays reserved until its transfer restriction is removed.
The escrow CI runs this native case as well as the Bun SQLite variant.

This is local runtime proof, not hosted-service acceptance. The remaining
hosted qualification needs a separately reviewed test-only interruption
controller, the same deployed keeper namespace before and after interruption,
dedicated testnet keys and budgets, and independent finalized public receipts.
A graceful deployment during a running tick is not that interruption. Never
deploy the local fixture's inspection routes, load production keys into it,
reset a keeper namespace, or add a fault switch to the production entrypoint.

## Operator installation

These are instructions for the operator. They have not been run against an
account. Use a reviewed source revision and the pinned repository dependencies.

Run the commands below from the repository root.

1. Select a Cloudflare account controlled by the operator, a Worker name, one
   network, a dedicated gas wallet, project IDs, RPC and spending limits. Do
   not use a project owner, fee, identity or upgrade key as the gas wallet.
2. Copy `workers/operator-keeper/wrangler.toml` to
   `workers/operator-keeper/wrangler.operator.toml`. Set the
   operator's `name` and `account_id`. Keep `KEEPER_MODE = "off"`, no routes and
   the `OperatorKeeper` SQLite binding. This local file is ignored by Git.
3. On the operator's machine, deploy that off configuration with the pinned
   Wrangler: `bunx wrangler deploy --config workers/operator-keeper/wrangler.operator.toml`.
   This creates the operator's namespace. It does not change Slop's deployment.
4. Prepare the JSON fields in the keeper README. Store that JSON with
   `bunx wrangler secret put KEEPER_CONFIG --config workers/operator-keeper/wrangler.operator.toml`.
   Use the prompt. An RPC URL can contain credentials. Do not put it in an issue,
   a public configuration, or a command argument.
5. Set `KEEPER_MODE = "dry_run"` and the operator-selected cron schedule, then
   deploy the same configuration. Inspect scheduled invocation status. This
   mode reads chain evidence and records local state, but does not load a key,
   sign or send. A successful dry run is not a transaction simulation.
6. After the operator approves execution, install only the matching
   `KEEPER_EVM_PRIVATE_KEY` or `KEEPER_SOLANA_SIGNER_SEED` through Wrangler's
   secret prompt. Stop any other keeper using this wallet. Set
   `KEEPER_MODE = "execute"` and deploy the same Worker and namespace.

Secret changes create a Worker version. Keep the mode off or dry-run while
installing them. A key is read only when an approved operation reaches signing,
and its address must match the configuration. Never print or commit a secret.
For a temporary stop, deploy `KEEPER_MODE = "off"` with the same namespace.
This stops new work without deleting unknown transactions or funded awards.

## Runtime references

Cloudflare's [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
provides the asynchronous transaction used by the journal and the synchronous
transaction used by scanner batches. Its [state API](https://developers.cloudflare.com/durable-objects/api/state/)
describes the critical-section timeout. [Cron scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
await the scheduled operation; [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
still apply. The [Worker filesystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
is not a persistent Bun SQLite volume, which is why this adapter uses Durable
Objects. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
belong to the operator's Worker.
