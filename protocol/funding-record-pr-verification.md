# Trusted funding-record verification

`Trusted funding record verification` produces read-only evidence for a narrow
subset of funding PRs. It does not approve reviews, enable auto-merge, merge a
PR, or invoke a deployment environment. Repository maintainers and repository
rules retain merge authority.

## Scope and evidence

The `pull_request_target` workflow checks out the immutable base commit and
executes only its checker and verifier modules. The PR head is fetched as Git
objects and checked against the event's exact SHA. Its tree is never checked
out, its code never runs, and its dependencies are never installed. The head
must descend from the trusted base. A newer base or head requires a new
decision; this artifact is not a transferable approval.

The complete base-to-head diff must contain 1–20 added regular `100644` files
at `funding/<project>/<network>/<transaction>/<record-id>.json`. Mixed changes,
modified or deleted files, renames, executable files, symlinks, and commitments
go to human review. There is no path-filter shortcut that could conceal another
file in the same PR.

For the automatic-verification subset:

- Each record must be canonical UTF-8 JSON: lexicographically sorted object
  keys, two-space indentation, and one final newline. The checker compares the
  actual bytes, rejecting duplicate keys and alternate encodings instead of
  silently rewriting a proposed record. `canonicalFundingDecisionBytes` in
  `scripts/check-funding-record-pr.ts` implements this serialization.
- Every record must be `verified-on-chain`, anonymous, and have `supersedes:
  null`. Self-reported, disputed, corrected, and GitHub-attributed records
  require human review. A chain verifier cannot establish a donor's GitHub
  attribution or permission to publish it.
- The project must exist in the trusted base inventory. The record's manifest
  revision must already be an ancestor of that base. Its recipient must be
  active at chain inclusion and observation under that immutable manifest,
  and at observation under the trusted base's current address history. An old
  manifest cannot revive a route after maintainers replace it. Observations
  before replacement remain eligible; already-accepted historical records are
  not reclassified by this new-record check. A manifest commit present only in
  a PR or fork is insufficient. Future observations or verification timestamps
  are rejected.
- Transaction identity and record IDs must not repeat within the proposal or
  the complete existing non-commitment funding inventory, including across
  projects. Any correction-chain ambiguity remains outside this subset.
- The applicable existing Solana, Base, Ethereum, or Bitcoin verifier receives
  the exact recipient, amount in integer minor units, and transaction identity.
  Only the verifier's fixed read-only mainnet endpoints are used; records cannot
  select RPC URLs or executable commands. Network errors and verifier failures
  fail closed.
- Every successful output must contain a bounded integer inclusion block time.
  Solana supplies `blockTime`; Bitcoin supplies `status.block_time`; EVM supplies
  the timestamp of the canonical receipt block. EVM and Bitcoin authorities must
  agree on that timestamp as well as the block identity. Missing timestamps,
  future inclusion, observations before inclusion, and verification checks before
  inclusion fail closed. This proves temporal consistency with inclusion, not the
  historical instant that finality was reached; finality is independently rechecked.
- The new output must match the record's state, transaction, verifier version,
  evidence URL, and finality exactly. The fresh check may occur later than the
  recorded check. An increased EVM or Bitcoin confirmation count is therefore
  an explicit finality mismatch requiring a refreshed record or human review;
  it is not silently substituted into the proposed bytes.

The decision artifact binds the exact PR number, base SHA, head SHA, checker
revision and version, and check time. Each processed record binds its immutable
Git blob ID and SHA-256 of its raw bytes. Each attempted verification names the
verifier version and exact input; successful verifier returns also retain the
canonical output bytes and their SHA-256, even if the subsequent finality
comparison refuses the record. A verifier that throws has no fabricated output
or output hash.

## Decisions and merge authority

`verified-records` means every proposed record passed this bounded verification.
`verification-failed` produces a failing job. `human-review-required` means the
proposal is outside the unattended subset; it completes without treating the
PR as verified. Consumers must inspect the decision and its exact SHA bindings,
not infer approval from a green job or the presence of an artifact.

Every decision currently says `mergeAuthorized: false`. The workflow token has
only `contents: read`; there is no review-approval call, merge call, signing
material, or deployment reviewer in this path. Artifacts are retained for 30
days and are evidence, not permanent settlement records.

The #302 unattended approver was disclosed as an external service acting as a
named deployment reviewer. Its observed `slop-approver:` decisions approve only
scheduled re-deployments of a previously human-approved revision. Deployment
reviewer membership does not grant this checker PR merge authority, and that
service's private credentials or source are not available in this repository.

The implementation-time read-only repository audit found auto-merge disabled,
default Actions workflow permissions set to read, no returned rulesets, and no
classic protection on `develop`. The permission to create PR reviews does not
establish a safe merge policy. Enabling autonomous merges requires an explicit
maintainer-controlled identity and ruleset design, including exact-head checks,
required review/check policy, and revocation. This checker does not create or
infer that authority. The no-human-merge acceptance criterion in #368 therefore
remains unfulfilled by this verification-only implementation.

Merge the trusted checker before relying on its workflow for new proposals.
Repository publication and on-chain verification do not prove private-key
control, legal authority, or permission to send funds. Nothing in this path
signs, broadcasts, transfers funds, or marks a platform payout as paid.
