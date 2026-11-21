# Historical implementation Points corrections

PRD section 7, owner decision of 13 November 2026, keeps each accepted PR or
grouped work unit's value and divides its implementation Points by additions
plus deletions in unique accepted primary-author commits. Opening, recreating
or merging a PR earns no separate implementation share. Synchronization merges
and commits already accepted elsewhere do not create another share.

The normal collector covers a rolling 35-day window. It cannot repair older
awards. `points-implementation-corrections.yml` is the manual, trusted-main path
for those historical allocations. It does not reevaluate old work, replace the
legacy scoring rules, move money, or alter historical settlements.

For the October 2026 owner decision, set `october_original_credit=true` when
collecting a reviewed payout project. This selects October pools for correction
and still checks ownership across the repository census. A verified replacement
receives the ordinary pool's full implementation credit for its original
contributor. The proof binds an accepted commit to the original and checks
immutable identities across the original and carried work. A carrier's commit
inside the original PR requires an exact Git parent path from an original
contributor commit. The collector checks those edges against immutable GitHub
commit reads. Distinct contributors, missing parent evidence and ambiguous
accepted copies require review. A legacy collection or rolling
snapshot retains an already recorded October original-contributor allocation.
For a native integration containing several original PRs, each reviewed work
unit retains the complete integration census and binds only its exact claim IDs
to one original. Exact shared Git objects establish the original source without
a description reference. Unlinked commits retain their null author metadata and
use the authenticated original PR creator as the fallback. Every selected carrier
follow-up must descend from that original head. Other work units retain their
own attribution.

A fresh authenticated GitHub review may bind an earlier original PR revision
that its current commit list has replaced. The review must pin the exact head,
and every retained commit must form its complete selected native chain with the
same linked primary author and verified first acceptance. The complete current
PR stays in the proof. Disconnected reviewed revisions use separate native
bindings, with disjoint claims and one verified recipient for the unchanged unit.
Missing revision evidence retains the hold.

For native merges with three or more parents, the fixed Git collector retains
an ordered combined-parent delta. It binds every parent and result tree, path,
mode and blob identity. Only lines added or removed against every parent count
as new merge work. Inherited lines remain with their earlier sources. Missing,
truncated, binary, newly added or deleted path evidence stays held when this
profile cannot represent all parent snapshots. The representation contains no
synthetic automatic merge tree. It supplies evidence for valuation and ordinary
attribution, while contributor and payout decisions keep their existing gates.

Run the preview and reconcile value and duplicate work before recording.

## Collection and review

Select the project by its current D1 registry ID. The collector inventories
every current positive implementation pool, including its zero-valued prior
recipients. The campaign freezes that journal prefix, registry and collection
time. It collects the complete repository ownership census in monthly pieces
and reconstructs cached results from retained raw GitHub responses on resume.
A partial census never supplies a complete first-accepted-owner proof.
When GitHub search omits a recorded positive pool, the collector checks the
immutable PR directly before assigning first acceptance. It binds those raw
observations to the census digest. A verified distinct squash SHA prevents
duplicate credit in later PRs without adding line weights to the earlier pool.
Unavailable evidence holds the source and any proven conflicting later claim.

An ordinary PR uses its accepted commit changes. A grouped work unit requires
the exact retained valuation decision and claim paths. A retained-copy fallback
requires the canonical verified original-source binding; a description link
alone does not qualify. Missing identities, missing multi-author line counts,
missing grouped evidence and overlapping scopes retain an explicit held
disposition. Complete zero-line evidence splits equally, using immutable actor
IDs for largest-remainder ties. A sole verified recipient needs no line ratio.

Use the workflow's default `apply=false` to collect and preview. `month` limits
one census piece; `candidate_month` limits which pools get new proofs without
removing the rest from the inventory. Blank month collects the complete census.
Collect month pieces in calendar order: a repository's later month reuses the
commit statistics its earlier months loaded, so the collector refuses a later
month while an earlier month of that repository has no piece.
Bounded month runs collect and preview only. Apply once from the complete resumed
historical scope, without either month filter. The workflow leaves time to upload checkpoints before its job limit. Resume
with `resume_run` from this repository's same manual workflow on main. The
source commit must be the current main commit or one of its ancestors. The
current collector reconstructs cached bytes and proofs again, so a reviewed
collector repair can retain compatible source evidence from an earlier run.
A full read-only preview can reuse a manifest from an official successful
collector attempt after checking its project, cutoff, original-credit rule,
complete census receipt, frozen journal, inventory and current registry.
Incomplete or incompatible archives fall back to the normal reconstruction.
An apply always rebuilds the evidence.
The frozen journal prefix and campaign scope must still match. If another
project changes the registry, the collector reconstructs the frozen registry
from immutable revisions and verifies its full digest. It also checks that
the selected project definitions, revisions, restrictions and repository plans
still match. An archive without a verifiable frozen registry needs a new
campaign. Applying corrections requires the current main checkout, a complete
verified collection and fresh authority and financial checks.

The optional `graphql_discussions=true` input reduces REST comment requests
for new retained-copy discovery. GitHub's REST PR and reviews still anchor
the evidence. Before using a GraphQL discussion, the collector checks the PR
identity and reconciles every comment count with REST. Missing pages, count
mismatches, and ambiguous references fall back to the original REST reads.
The retained-copy proof checks the original and accepted patches before
allocating Points. Resuming a campaign reuses its recorded discussion reads.

An exact copied edit can retain a verified linked primary author without a
merger acknowledgement. Both complete source records must name that same
eligible primary author, and the earlier closed source must have an immutable
resolved reference from the accepted PR. This does not transfer credit through
an unlinked author or a PR creator fallback. When an intermediate PR carries
the identical native original commit, two independently complete copy bindings
retain the earlier source whose creator is that linked author. The intermediate
source and its own follow-up commits remain in the evidence.

## Private eligibility and recording

The reconcile job uses the production environment and publication lock. It
binds the complete collection receipt and manifest to the current registry.
Positive awards for work accepted on or after the recipient's existing account
ban stay held; work accepted before that ban keeps its eligibility. It
reads the same private project/month protection predicate used by `pointsSql`:
monthly payment runs, allocation changes, direct transfers and unmapped legacy
obligations. Missing, extra, duplicate or malformed query rows refuse the run.
The private mask stays in memory and is never uploaded or printed. Public
reports give aggregate dispositions, without source-specific financial reasons.

`apply=true` appends only eligible allocation changes. Each whole-Point pool,
original date, source identity, value provenance and every existing revision
remain intact. Displaced recipients receive zero-valued successor revisions.
The domain validator checks actual Points projections as well as raw pool
totals and refuses stale or incomplete connected pools.

Immediately before a write the runner verifies it still uses current main and
rechecks the selected project registry and current account restrictions.
The unchanged atomic import guard checks private protection again, covering
changes after the preflight. A pending public receipt is retained before import.
Success requires the exact D1 batch digest, revision count and empty staging,
followed by the full corrected public journal prefix. An uncertain response is
reconciled before an idempotent retry. Replaying an applied manifest cannot
overwrite a subsequent correction or revocation.

## Publication and completion evidence

An imported journal and a deployed Points projection are separate evidence.
After a recorded correction, use the ordinary reviewed production release to
publish Points shards and verify their bytes against D1. Coordinate any already
prepared releases. The production preimport guard requires its candidate to
retain the current complete journal prefix and coverage, so a previously
prepared older artifact cannot replace the new projection even if its SQL
batch is already known. A stale release must be prepared again.
Never call a preview, partial collection, passing source tests or a pending
import a completed public rebalance.

Retain the campaign manifest, raw response digests, complete source inventory,
aggregate reconciliation receipt and verified deployment identity. Report held
and protected coverage separately from changed allocations; neither means a
contributor received the revised Points.

For a routine fresh release that reaches its collection deadline, wait for the
run to finish and confirm it retained a `leaderboard-discussions-<attempt>`
artifact. Dispatch `deploy.yml` on current main with
`discussion_resume_run=<run-id>` and `use_published_data=false`. Checkpoints
expire after two days. This input is for live leaderboard collection only;
use `resume_run` in the historical workflow for the frozen campaign above.
