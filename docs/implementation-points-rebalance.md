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

## Collection and review

Select the project by its current D1 registry ID. The collector inventories
every current positive implementation pool, including its zero-valued prior
recipients. The campaign freezes that journal prefix, registry and collection
time. It collects the complete repository ownership census in monthly pieces
and reconstructs cached results from retained raw GitHub responses on resume.
A partial census never supplies a complete first-accepted-owner proof.

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
Bounded month runs collect and preview only. Apply once from the complete resumed
historical scope, without either month filter. The workflow leaves time to upload checkpoints before its job limit. Resume
with `resume_run` from this repository's same manual workflow on main. The
source commit must be the current main commit or one of its ancestors. The
current collector reconstructs cached bytes and proofs again, so a reviewed
collector repair can retain compatible source evidence from an earlier run.
The frozen baseline, registry and campaign scope must still match. An uploaded
checkpoint is not its own evidence of completeness. Applying corrections still
requires the current main checkout and fresh authority and financial checks.

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

Immediately before a write the runner verifies it still uses current main
and that the registry and account restrictions have not changed since planning.
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
