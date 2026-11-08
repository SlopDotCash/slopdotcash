# Project publication receipts and restriction admission

This source-only change was authored without tests, parsers, type/lint/format
checks, simulations, verifiers, applications or browsers. All new regression
and model scenarios remain unexecuted.

## Committed revision receipt

`appendRevision` formerly committed revision N, then read the mutable project
head. Owner publication read that head once more after setup work. A second
writer could commit N+1 before either read. The first caller then received
N+1 alongside its own change summary. The editor treats this result as the
published revision and rebases edits typed during the request onto it. Those
edits were made without seeing the second writer's changes; a following save
could therefore use N+1 as its expected revision and overwrite those changes.

The helper now returns the exact manifest, digest, revision and timestamp of
its successful append, with immutable project metadata from the checked base.
Owner publication returns that receipt instead of a later head read. Its
other callers are automatic setup activation, verified owner vault registration
and administrator manifest revision. Each receives its own committed revision;
none needs a later unrelated revision to describe its write. Setup status is
still computed after publication and is not claimed to be one atomic snapshot
with every later external authority read.

The real persistence regression source appends an independent revision before
the first append returns. It requires receipt revision 2 while the registry
head is 3, then submits the draft typed during that save with expected revision
2 and requires a stale-revision refusal. No concurrent author's fields are
silently adopted as the first request's acknowledgement.

`api_project_revision_receipt` has four scenarios, one initiated publication,
one competing publication, revision bounds 1..3 and two local draft values.
It separates commit, later head advance and response delivery. Authority,
schema validation and transaction execution are external predicates.

## First-publication restriction race

Creation and publication of a previously saved new-project application checked
maintainer bans and repository restrictions before awaiting GitHub authority.
Their transactions had no condition tying them to that enforcement snapshot.
A moderator ban could therefore commit before the new project's INSERTs.

Both handlers now capture the enforcement generation before reading the
restriction records. Both persistence methods require that generation and
guard all their writes with it. Refusal creates neither a revision nor project
nor repository alias; a stored application remains pending. Existing owner,
repository, signature, policy and uniqueness checks remain in place. The
existing `registry_conflict` response also describes changed restrictions.

Only `CloudflareProjectPersistence` implements these methods. Direct trusted
test seeds now explicitly supply their current generation; production create
and stored-application routes supply the generation used for their policy
check. No optional unfenced production path was introduced.

The two additional real-handler regression definitions insert a genuine
maintainer-ban history after the restriction read but during the authority
check. They require no target project/history/alias writes and a pending saved
application, then require the fresh retry to report the maintainer ban.

`api_project_registry` adds one scenario (three total) for creation invalidated
by a later restriction. `api_registry_alias_transaction` adds one (seven total)
for first application publication invalidated by a later restriction. Their
finite actor/authority abstractions do not prove arbitrary GitHub changes,
every project policy or D1 transaction semantics. The generation fence is
deliberately conservative: any new enforcement record can require a retry.

## First-publication setup owns revision 1

Creation and publication of a stored new-project application formerly read
the mutable registry head after the first transaction committed. Their
previously checked authority could then be passed to queue/setup work for a
later writer's manifest. Both paths now build the `ProjectRecord` for their
own committed revision 1 from the exact input, digest, timestamp, referrer and
source application. No extra persistence metadata is required: these fields
are already known when the transaction succeeds. The application's submitted
manifest is retained by the existing application contract.

Queue and setup use that captured record. Automatic activation still passes
its revision through `appendRevision` and the existing SQL compare-and-set.
A concurrent revision 2 therefore refuses activation of revision 1 rather
than letting old authority activate the new manifest. This is a post-commit
409: the project, initial immutable revision, aliases and any application
approval stay committed. A subsequent new-create attempt conflicts; a stored
application retry reports `already_decided`. Neither response rolls back
the accepted publication. Queue failures retain the existing unavailable
setup result and also do not undo creation.

Two additional real-handler regression definitions wrap only the first
persistence commit, append a real independent revision 2, then resume the
request. They require queue revision 1, activation refusal, retained initial
manifest bytes and, for the stored path, retained approval. The existing
`setup activates a project only with installation write access and a clean
scan` workflow supplies the ordinary activation and unavailable-queue source
case. None of these definitions was executed for this change.

`api_project_creation_completion` has five scenarios. It bounds the system to
one first publication, one later revision, head revisions 0..2, one captured
receipt and queued/unavailable scan outcomes. It separates durable commit,
queue, activation, response and retry; eligibility and external scan outcomes
are input branches. `api_project_revision_receipt` separately models the
owner editor's stale-base retry, with one competing writer and revisions
1..3. These models do not prove D1 atomicity, current external GitHub facts,
arbitrary manifest grammar, service delivery or implementation refinement.

The total added runtime regression definitions are five cases: one owner
receipt race, two first-publication enforcement races and two post-commit
setup races. Four models are affected: the two new models (four and five
scenarios), plus the existing registry and alias models (three and seven
scenarios). No runtime or formal validation is claimed.
