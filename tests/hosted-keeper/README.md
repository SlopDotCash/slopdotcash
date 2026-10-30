# Hosted keeper interruption qualification

This is the test-only controller required by #904 and
`workers/operator-keeper/README.md`. It imports the real keeper and its store.
No production module imports it. It does not create a vault, award, wallet
claim or monthly authorization.

The controller is limited to one reviewed EVM test network, its fixed `hosted-*`
staging projects and one award. It refuses mainnet networks and non-staging API
origins. It never accepts SQL, calldata, keys, amounts, destinations, network
selection or keeper configuration from a request.

## Before any hosted operation

An operator reviews the exact source, existing testnet Worker name, account,
Durable Object class/namespace and signer. Use the existing test keeper's
namespace and `idFromName(JSON.stringify([network, lowercaseSigner]))`.
Changing the namespace while reusing its signer loses nonce and budget history
and is not permitted. Only a separately approved new test signer and funding
plan permits a new namespace.

Preserve the existing key, configuration, network, RPC and gas limits. Check
that the selected test award is the only payable work a dry run can reach.
The selected project must be a test
project in the live staging registry, with the expected vault, asset and code.
Verify chain ID, roles, fees, balance, current nonce, unresolved attempts and
liabilities before signing. Stop rather than raising a gas limit or altering
an existing reserve. Do not run another sender with the same key.

This module exports its test subclass as `OperatorKeeper`. For the controlled
deployment, retain that **existing** Durable Object class name. Use the existing
binding and migration history. Do not create a new migration, new namespace
or reset storage. The Worker entrypoint is this separate file;
there is no production fault switch. Disable the test Worker's cron during
this run and restore its prior code/configuration afterwards. A new version
of this module does not change the persisted qualification's source binding.

The temporary Worker endpoint must be accessible only with its independent
256-bit `QUALIFICATION_CONTROL_TOKEN`. Store that as a Worker secret; never put
it in URLs, logs, source or evidence. No anonymous route succeeds. The Worker
has no broad readback or signing endpoint. Before installing the token the
controller answers only 404.

Fixed deployment variables:

- `QUALIFICATION_RUN`: `keeper-` followed by a unique lowercase run label.
- `QUALIFICATION_SOURCE`: exact reviewed commit, 40 lowercase hexadecimal
  characters. Commit the source before preparing a hosted deployment.
- `QUALIFICATION_AWARD_ID`: exact existing test award, `0x` plus 64 lowercase
  hexadecimal characters.
- Existing `KEEPER_CONFIG`: staging API, fixed matching `hosted-*` projects,
  selected testnet, lowercase test signer, RPC and approved gas limits.
- Existing `KEEPER_EVM_PRIVATE_KEY`: dedicated test keeper key only.
- `KEEPER_MODE=execute` for this explicitly approved controlled test.

Do not modify the owner, identity-attester, registrar or fee recipient keys.
Do not use a production project, production database or real-value asset.
The controller stores its run/source/award/configuration binding in the same
SQLite database and refuses to reinterpret that row as another run.

## Narrow control protocol

Send `POST /qualification`, `Authorization: Bearer <control token>`, and
exactly `{ "command": "..." }`. The four accepted commands are:

1. `status`: read fixed metadata and hashes only. Confirm the expected run,
   source and configuration digest. The first phase must be `idle`.
2. `arm`: accepted once from `idle`. Start one `tick` request asynchronously.
   The real keeper proceeds normally until the selected payment reaches its
   first `eth_sendRawTransaction`. The controller verifies that its exact raw
   bytes, transaction ID, nonce record and unpaid gas liability are already
   durable. It records their hashes and waits **without forwarding the send**.
3. `status`: poll until `paused`. Verify the selected transaction is absent
   from the public node and record the fixed hashes/signature count. A wrong
   award, missing journal or missing gas reservation fails before broadcast.
4. `abort`: accepted only from `paused`. It persists `resume`, flushes storage,
   then calls Cloudflare `DurableObjectState.abort`. The in-flight tick must
   fail; a graceful code deployment is not used as an interruption substitute.
5. `status`: the instance identifier must change while all persisted hashes,
   run/source/award/configuration and the signature count remain the same.
6. `tick`: resumes through the actual keeper using the same namespace and
   key. Verify the signature count does not rise for that retained payment.
   The response only records the returned HTTP status. It is not a paid claim.
7. Independently verify the exact finalized transaction, recipient and fee
   deltas, event/award identity, API totals and UI. The selected payment must
   occur once. Preserve the partial/error state if it does not finalize.

Cloudflare documents `abort` as an immediate Durable Object reset:
https://developers.cloudflare.com/durable-objects/api/state/#abort
It does not erase committed storage. This test never calls `deleteAll`,
`deleteDatabase`, drops production tables or resets the keeper journal.

## Current verification boundary

`node tests/hosted-keeper/control.workflow.mjs` runs the controller in native
Workerd. It proves authentication, refusal of arbitrary commands/fields,
pre-broadcast hold, actual `abort`, a new object instance in the same namespace,
and preservation of journal/nonce/gas hashes. It seeds synthetic rows and sends
zero transactions. It is **control-plane validation**, not keeper, public-chain
or hosted acceptance. The full keeper-to-node path and independent finalized
receipt checks remain required before this qualifies #904.

The generic `escrow:acceptance --suite extended` already has all seven public
chain scenario groups. It uses local SQLite and in-process handlers, so rerunning
it cannot substitute for the remaining hosted API/keeper tests. Its existing
completed evidence must not be replayed with a new source or directory.

The two-recipient case can use the existing staged TestDollar vault, with its
recorded non-stablecoin limitation. Use two separate actor/wallet proofs, block
one recipient only, and preserve the earlier walletless award. The other must
pay in the same scheduled run; then the original failed award must pay once
when unblocked. The controller above addresses the separate interruption case;
it does not supply synthetic identity authority or create those awards.

Monthly acceptance must use the existing hosted account/coordinator and keeper
routes with a reviewed earlier test schedule, record that schedule deviation,
and preserve the production November schedule. Solana devnet needs a reviewed
staging registry deployment and its test signer before the normal staging
release publishes its attester. Neither change is performed by this module.
