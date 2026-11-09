# Owner bounty funding parent

The later source correction and `ui_owner_private_requests` refinement are
recorded in `owner-private-requests-audit.md`. They replace this original
review's assumed response/session association with explicit pre/post actor
observations. The historical validation below does not certify those changes.

This focused review starts from `80e6de887`. It adds a parent-state model for
`src/OwnerBountyVault.tsx`; the generic transaction model did not represent its
private read, refresh error, capability or child lifetime. No production code
was changed and no new application defect was established.

## Identity and mount boundary

The apparent cross-project risk from the effect's retained ready state does
not occur at the reviewed call sites:

- `App.tsx` keys `ProjectBountyFunding` by immutable project ID. Its
  `useProjectMaintainer` check uses project ID plus the current session actor.
  The private owner subtree is absent while that check is pending or refused.
- `ProjectSecuritySettings.tsx` renders its editor only after the current
  actor/project permission check. The editor key is `project.id:githubId`, and
  its `OwnerBountyVault` key is the project ID. `SecurityBounty.tsx` also keys
  these settings by project ID. A project/actor change remounts the private
  parent instead of reusing another identity's ready balance.
- A same-project revision or manual balance refresh can reuse the parent.
  An overlapping effect invalidates its predecessor through the `active`
  cleanup flag. Its later result cannot update the current view.

The model represents that existing caller composition, not arbitrary direct
use of the exported component without those keys. It assumes the authenticated
server response belongs to its requested project/session; it does not prove
the response parser, backend authorization, or arbitrary React scheduling.

## Read and child states

Initial reads show loading. Initial failure shows error and mounts no wallet
child. A successful `funds: null` is a ready state with no finalized balance,
not a fabricated zero balance; existing deployment actions can still mount.

A ready parent remains ready while a refresh is pending. A network/status-0
or 5xx failure preserves its last balance and child, sets `canSetup: false`,
and shows a stale warning. The null-balance variant says it retained verified
vault information. Deposits are disabled; withdrawal controls remain available
subject to the child's real wallet-owner and transaction checks. A successful
refresh restores the returned capability and keeps pending/finalized child
state when the network/vault key is unchanged.

Other failures, including 403, remove the private balance and child. Later
successful reads mount a fresh child. Its separate session-storage recovery
can restore an outstanding wallet intent; unmounting is not cancellation or
proof that a transaction failed. Leaving the funding route unmounts the view.

## Same-project revisions and cached balance

A valid revision cannot replace or remove an existing network/vault identity.
`ownerSecurityProgram` in `backend/projects/handler.ts` refuses owner changes
to a bound settlement or its asset. Admin revisions also pass
`assertSecurityBountyTransition` and `assertEscrowTransition`: existing vault
identities are immutable, although reviewed upgrade metadata can change and
an additional distinct network deployment can be appended. The owner setup
route refuses a second registration once a deployment exists. An appended
network keeps the old keyed child and mounts a new child; it does not erase
the old child's pending/finalized state. The first draft of this focused model
treated that as a replacement; this revision corrects that model overreach.

During the effect's new private read, the parent retains the last returned
balance, its visible `snapshotAt`, and `canSetup`. There is no new pending
refresh label and `canSetup` is not immediately invalidated. That is the
source's cache behavior, not a proof that either value is current. The stale
warning and disabled deposit state start on a transient failure. A successful
read replaces the aggregate balance/capability. `readSecurityProgramFunds`
selects the largest current finalized eligible vault snapshot, rather than
summing all deployments. The returned figure is a project-level availability
projection; it is not a separate verified balance for each rendered child.

This review did not reproduce a product defect or a cross-identity disclosure.
The backend reads the current project and repository authority for each private
funds request. Its Solana funding review checks that the requested network/vault
still exists and checks current restrictions before deposit review. The cached
parent capability is therefore presentation state, not payment authority.
Current write checks, chain identity and finality remain separate backend and
wallet-model obligations. No claim is made that an arbitrary cached button or
balance proves current write authorization.

`ui_owner_bounty_funds` bounds this composition to two projects, two actors,
two simultaneously keyed deployments and three reads. Each child's memory
has empty, pending and finalized classes. It does not sign, broadcast or
determine wallet authority.
Explicit caller-key transitions are part of the model; they are not inferred
from every rerender. Fifteen named scenarios exercise loading/error, null
balance, transient retention, recovery, refusal, identity changes, overlapping
reads, same-project cached capability and retained/fresh children after an
appended network. Backend policy and funds sources are mapped for these narrow
composition facts, not whole-file verification.

## Conformance and verification

The existing real Anvil and Solana workflows in
`tests/e2e/vault-actions.spec.ts` and `tests/e2e/solana-vault-actions.spec.ts`
already check the affected parent through actual private API reads: funded
balances, 503 retention, disabled deposit controls, available withdrawal,
successful refresh without losing finalized feedback, and 403 removal of
private amounts and the child. Those tests retain separate network/chain
evidence. This model-only pass does not add a redundant component test or
claim that a still-running combined wallet suite passed.

The original twelve-scenario model passed its bounded checks, but that receipt
does not certify the refined second-child composition. The refined model
passed all **15 named scenarios**, typechecking and **500 seeded traces of up
to 60 steps**. Safe local-translation TLC completed **5,304 distinct states**,
**584,257 generated states**, **depth 17**, with an empty queue and no violation
in 3.4 seconds. All mapped source hashes stayed unchanged. The refined model
SHA-256 is
`a6ea79ce4ceba94c5c2f910b84ca3f2e3c2f10290f62948a5906d0060e04a157`.
Results are retained in `evidence/formal/owner-bounty-state/` and the standard
per-model JSON receipts, using pinned Node 24.15.0 and Java 21.0.10.
The global inventory remains the current source-hash authority. A mapping and
finite model pass do not prove all implementation states or external services.
