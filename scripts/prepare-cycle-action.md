# Exact-source cycle actions

`reward-cycle-actions.yml` runs on trusted `develop` and opens draft PRs. It never
signs or broadcasts a transaction. `propose` requires one project and a complete
snapshot whose exact SHA-256 matches that project's reviewed preparation. It
also requires enabled payments, a positive canonical cycle cap backed by the
verified commitment ledger, and current signer capability. Missing destinations
remain unclaimed under the existing proposal CLI.

## Source prerequisite

Actions needs the original `source-snapshot.json` in a same-repository Actions
artifact. Use the run ID, artifact name, and exact digest from the reviewed
preparation. Independently imported audits may have no Actions artifact; use the
local exact-source fallback below until their original bytes have been archived.
Never regenerate a snapshot as a substitute for a reviewed source. Retain source
artifacts before their Actions retention expires.

## Local exact-source fallback

Run in a clean, scoped checkout of current trusted `develop` with the exact source
file available. The local adapter uses the same gates and lifecycle CLI as the
workflow. It cannot bypass funding readiness, prior-cycle policy, or review rules.

From the repository root, after the prerequisites are satisfied:

```sh
CYCLE_ACTION=propose \
CYCLE_PROJECT=PROJECT \
CYCLE_MONTH=YYYY-MM \
CYCLE_SOURCE_SHA256=EXACT_SOURCE_SHA256 \
CYCLE_TRANSACTIONS_JSON='' \
bun scripts/prepare-cycle-action.ts \
  --snapshot /path/to/source-snapshot.json
```

`--snapshot` is supported only with `propose`; it does not ingest a new preparation
or rewrite its census, weights, source hash, or audit hash. The adapter validates
the exact supplied bytes against the requested hash and selected preparation and
passes the same file to `prepare-reward-cycle.ts`. It never calls the rolling
snapshot generator or the all-project monthly closer. Canonical proposal creation
uses the then-reviewed funding policy; it does not alter the audited preparation.

The local command writes new cycle artifacts plus `evidence/cycle-action/` with
exact sources and SHA256SUMS. It does not commit, push, or create a PR. Review the
new files and submit them through the repository's protected PR process. Existing
cycle artifacts and existing evidence directories are refused. A local result
is not a merged proposal, approval, or payment.

For Actions, upload and retain the exact original `source-snapshot.json`, then
supply `snapshot_run_id` and `snapshot_artifact` together with the same hash.
Actions still verifies the downloaded bytes against the reviewed preparation.
The command does not upload an artifact or dispatch a workflow.


## Reservation before plan release

After the approved allocation PR is merged, dispatch `reserve-settlement` for
its project/month and allocation SHA-256. The adapter calls
`prepare-payment-reservation.ts --project PROJECT --cycle YYYY-MM --output CANDIDATE`
and validates its temporary output before replacing the working-tree ledger. It stages
only `funding/payment-reservations.json`. The candidate must append exactly one
reservation for that allocation and preserve the previous global ledger prefix.
No canonical cycle file or execution plan may be created or changed by this step.
The draft PR includes exact allocation bytes and before/after ledger evidence.

Only after the trusted reservation gate passes and maintainers merge that PR on
canonical `develop` can `prepare-settlement` release the exact reserved plan in
its own PR. Both actions bind `source_sha256` to the approved allocation and accept
no caller-selected destination, fee wallet, timestamp or reservation override.
Neither action signs or sends a transaction.
