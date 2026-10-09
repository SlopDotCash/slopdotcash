# Reviewed fresh-cycle payments

This opt-in protocol creates reviewable reservations and releases exact unsigned
plans. It grants no approval, holds no keys, broadcasts nothing, and does not
establish payment. Existing projects remain disabled. A funded balance alone
never makes public funding accessibility true.

## Operator prerequisites

Deploy the trusted reservation workflow and verifier before activation. Configure
classic protection on canonical `SlopDotCash/slopdotcash` `main`: strict
up-to-date PR checks requiring `Trusted payment reservation gate` from the verified
GitHub Actions app, required pull requests (no approving review count is
required), resolved conversations, admin enforcement, no pull-request bypass,
force push or deletion.
The loader verifies these through GitHub REST; it never changes settings.
Ruleset-only protection is not implemented by this bounded verifier.

Review a complete canonical checkpoint with the workflow installed, an empty
`funding/payment-reservations.json`, and no fresh-cycle policies. Pin its exact
commit in `PAYMENT_BOOTSTRAP_CHECKPOINT` in `scripts/payment-admission.ts` through
review and deploy the updated verifier. The selected bootstrap is canonical
PR #425 merge
`614d983be2ae703ea4d5b4240191ce84be5d244a`. Its full Git history is retained,
its reservation ledger and migration descriptor chain are empty, and its four
projects have no fresh-cycle policies and remain payment-disabled. This source
pin requires operator review and deployment of the updated verifier; it does not
configure branch protection, select fee wallets or instruments, or activate
payments.
The checkpoint is a reviewed trust root in verifier code, never a CLI argument,
candidate manifest, or environment assertion.

The loader rejects shallow history, requires continuous two-parent canonical merges
since that checkpoint, and replays every policy/allocation/reservation transition.
Current merges target `main`. Historical `develop` merges are accepted only
when they are ancestors of the immutable branch-migration checkpoint
`2b1ec5089d03d2b6413ce5475cbccaab63005daf`.
For each merge it also verifies the actual successful `pull_request_target` run
with a receipt bound to the exact first-parent base, the pinned workflow bytes, successful named job,
and a digest-checked workflow receipt binding PR number, base, head, run and attempt.
A context name and shared Actions app ID alone are insufficient provenance.
GitHub can report the PR head in run `head_sha` and an empty `pull_requests`
list. Lookup checks both exact base and head revisions; the digest-checked receipt
supplies the base/head/PR binding. Unrelated runs on the same base cannot admit a
merge or hide a later matching receipt. Missing or expired evidence after the latest reviewed checkpoint
fails release closed. Workflow receipts currently have 90-day retention. The
checkpoint migration below preserves verified admission through a later revision,
including nonempty permanent reservations, so earlier receipt expiry does not
permanently block future monthly payments. Reservations themselves never expire.

## Periodic checkpoint migration

Before the oldest receipt still needed after the deployed checkpoint expires,
run the deployed verifier with read access to canonical GitHub contents, PRs,
Actions runs and artifacts:

```sh
bun scripts/prepare-payment-checkpoint.ts --output-dir /tmp/payment-checkpoint-review
```

The command verifies live canonical protection and all admission evidence since
the previously deployed checkpoint. It writes two review artifacts only:
`payment-checkpoints.json` and `<canonical-revision>.json`. Copy the first to
`scripts/payment-checkpoints.json` and the second to
`protocol/payment-checkpoints/<canonical-revision>.json`, then open a normal PR.
Never remove prior descriptors or snapshots. The command refuses to prepare
another migration when the deployed and canonical chains differ: deploy the
already accepted chain first.

The trusted base gate permits one descriptor append and reruns admission through
the proposed revision using only the previous trusted chain. It checks exact
snapshot bytes and ancestry, and rejects missing or expired evidence. Merge and
deploy the reviewed chain before expiry; generation alone does not migrate trust.
Schedule this operator review with margin, for example monthly. Missing the window
blocks new release and migration until authentic evidence is recovered; there is
no skip-verification, backdated approval, or automatic reset path.

Each descriptor binds the preceding descriptor (or original bootstrap), revision,
workflow, exact reservation ledger, historical project policy versions, and
historical obligation versions, and the authenticated complete signer-history
digest with SHA-256. The snapshot retains every distinct
accepted JSON version under `cycles/` and `funding/`, including deleted records and
signer reports, together with its path, original revision and byte hash. Every
historical project manifest is retained too. Signer authentication replays accepted trees from the Git root even after
checkpoint migration, rejecting deletion, mutation, or delete-and-restore of a
loss report. The required payment gate also runs the existing unsafe-destination
authentication and preservation guard. Runtime replays that guard across accepted
cycle history, including the checkpointed interval, so a checkpoint cannot erase
unsafe-wallet reports or revive an accepted held destination. Full canonical Git history remains
required; this is an admission checkpoint, not history pruning.

Runtime uses the chain bundled with the reviewed deployed verifier. It reconstructs
and verifies all pinned snapshots against complete first-parent history, retaining
the permanent ledger, then checks live receipts only after the latest checkpoint.
Migration cannot omit obligations, drop reservations, change principal/fees or
existing plan bytes, reprice allocations, retire money, or reuse issued vaults.
The initial empty bootstrap remains the original trust root. The bootstrap pin
above does not add a migration descriptor or snapshot, and does not activate a
project.

## Exact cycle activation and release

1. Review a project manifest with optional `funding.freshCyclePaymentPolicy`:
   `schemaVersion: "1"`, `kind: "fresh-cycle-payment-policy"`, `projectId`, exact
   `cycleId`, truthful UTC `effectiveAt`, bounded UTC `planningExpiresAt`,
   `instrumentSha256`, and the fixed reviewed `feeRecipient`. On Solana,
   `feeRecipient` must be Slop's published Solana fee recipient
   `9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY` (owner decision, 9 October
   2026). The schema refuses any other address. The instrument hash
   is SHA-256 of compact JSON of the strict normalized reviewed Squads instrument.
   Enable the monthly pool only with this policy and its exact active instrument.
   Additive review budgets are outside this mode.
2. Merge policy review **before the first monetary proposal is generated**.
   Contributions may already have happened: August work can be funded in September.
   Existing monetary proposals cannot be repriced. An instrument with any historical
   monetary proposal, allocation or issued plan in any project cannot be reused.
   Zero carry is mandatory. No v1 retirement or imported principal is supported.
3. Generate and review the normal proposal for 14 days, then finalize its exact
   allocation. Existing proposal/wallet review and adjustment rules still apply.
4. From the deployed verifier, draft a ledger-only candidate:

   ```sh
   bun scripts/prepare-payment-reservation.ts --project PROJECT --cycle YYYY-MM --output /tmp/reservation-candidate.json
   ```

   Optional `--reserved-at` fixes the timestamp explicitly; otherwise current UTC
   is used. Canonical protected inputs are reread, never local allocation edits.
   The output is the complete proposed global ledger, not unsigned plan bytes.
   Review its single append in a PR modifying `funding/payment-reservations.json`.
   The trusted base gate checks exact policy/instrument/allocation/source identity,
   principal, fee, intents and fixed plan hash. The PR must merge before release.
   A competing PR must rebase; overwriting the winner or retaining both conflicting
   reservations fails. An already accepted selection returns its existing row.
5. Run `rewards:plan-settlement` with project/cycle and the policy's source/fee-wallet
   assertions. It reconstructs the stored timestamp and exact reserved bytes,
   verifies canonical admission and the complete authenticated signer ledger,
   checks fresh finalized quorum observations of configuration and token balance,
   and requires principal plus fee coverage. Both members vote; collectively they
   must also be able to propose and execute. Permissions 3/6 or 7/2 suffice.
   On a `squads-project-vault` the plan carries no fee transfer and coverage is
   principal only; the fee is the creator's separate transfer (RFC #500 s.8).
   Its observation also carries the creator multisig, the shape must be masks
   7/2/6 at threshold 2 with the manifest's time lock and no config authority,
   and the current signers are the creator and the independent signer
   (`funding/README.md`, "Signer capability on a project vault").
   Local output creation is exclusive; identical bytes are an idempotent retry,
   conflicting bytes cannot be overwritten. No new intent is generated on retry.

### Base streams (RFC #472)

On 8 October 2026 the repository owner approved Base as a settlement network
and chose this release policy. A project with `reward.chain: "base"` uses the
same four steps with a Base Sablier Lockup v4 stream instead of a Squads vault:

- The policy's instrument is the one active monthly Base stream. It must name
  a reviewed `recipientGithub` (actor ID, node ID, login) for its `recipient`.
  `instrumentSha256` binds that normalized stream object.
- `feeRecipient` must be Slop's published Base fee recipient
  `0x8f77c37d8650776bfe73c9b12b15209ee15d9b86` (lowercase canonical form). The
  schema refuses any other Base address. On 9 October 2026 the owner replaced
  the 8 October recipient `0xb7b0d5e45016d6d31629d9ab375df770fd2aaf77`. That
  address is retired.
- The reservation `instrumentId` is `sablier-lockup-v4:base:<contract>:<stream>`.
  The reserved plan is a `base-usdc-transfer-plan` whose source is the stream
  recipient. The fee is a separate transfer in the same plan.
- The only signer role is `recipient`. It must be current, with an EIP-191
  proof (`protocol/signer-access-attestations.md`). Loss blocks new plans.
- Release readiness queries the three fixed Base RPC authorities. Two must
  agree, at their finalized blocks, that the stream uses Base USDC, pays the
  exact recipient, is non-cancelable and was not canceled; that the recipient
  has no contract code; and that the recipient's USDC balance covers principal
  plus fee. The canonical verified commitment ledger must also cover principal
  plus fee.
- `rewards:verify-settlement` proves each Base transaction hash through the
  same quorum (12 confirmations) and accepts only exact deltas. Hashes cannot
  be reused across cycles.

The owner accepted that a Base reservation is bookkeeping only once the
recipient withdraws the funds: a single key then controls them, and Slop cannot
stop that key from spending elsewhere. A contract recipient (for example a
Safe) is refused until a separate reviewed proof method exists. No project uses
Base today and no payment is enabled.

Distinct monthly instruments keep truthful later replacement timestamps. Window
overlap remains forbidden within the same exact month. Retired unscoped
instruments may remain as historical evidence only when their active intervals
do not overlap monthly instruments. Their balances never back a current monthly claim. A later fresh month needs its own distinct reviewed policy
and unused instrument; the prior cycle policy cannot be rewritten to reprice it.
Historical ledger and issued plan records remain immutable. Switching the current
policy does not authorize releasing the older instrument again.

Signer loss, policy expiry, insufficient balance, changed configuration, missing
provenance or protection loss blocks release. Issued principal remains reserved
indefinitely. An unsigned plan is not a timelock on external wallet holders; Slop
cannot prevent independent onchain withdrawals or revoke externally held bytes.
Finalized exact execution evidence remains necessary to report payment.

Observed operator prerequisite at review: GitHub REST reported `Branch not
protected` (HTTP 404), branch `protected:false`, and effective rules `[]` for
`develop`. This was a real configuration response, not unsupported `gh` syntax.
No settings were changed. Live release remains unverified until protection,
checkpoint, reviewed real policy and complete financial evidence are configured.
