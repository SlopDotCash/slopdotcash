# Cycle output publication and recovery

This source-only follow-up starts at `babfc97f6`. The former
`cycle_snapshot_publication` model accurately described destructive publication:
promotion bytes were written first, then the public tree was removed before
the replacement rename. A failed rename could leave no public tree, while an
earlier staging failure could leave new promotion bytes beside an old tree.

No test, parser, formatter, simulator, verifier, application or service ran for
this change. Only metadata inventories are regenerated. The 23 revised model
scenarios and eight added native regression definitions are unexecuted.

## Implementation

The existing `syncCycleIndex` still builds and validates the same index,
promotion values and immutable cycle files. Check mode still compares source
history with the promotion module; it does not attest the public tree.

Write mode now creates a publication guard and unique staging paths. It stages
all public files, the index and promotion bytes before moving either current
output. Each group's launched writes settle before failure cleanup. It moves
the prior tree and promotion into retained paths, activates the new tree, then
activates the promotion. Only that final rename completes publication.

If a caught error occurs before completion, it moves an activated new tree
back to staging and restores the prior promotion and public tree. It attempts
both restorations. If any restoration fails, it retains staging, backups and
the guard and reports all failures for operator recovery. Cleanup never erases
the only retained old version after a failed restoration.

If publication completed but cleanup fails, the new pair remains published and
the error says so. A cleanup failure does not claim that activation was refused.
Failure to remove the guard blocks another writer. A stale guard is not removed
automatically: all publishers must stop and the retained outputs must be
reconciled before operator recovery.

The existing evidence transaction was considered for reuse. It publishes a
single directory and has no companion-file commit, asynchronous write draining
or publisher guard. Using it unchanged would not protect this pair. The cycle
generator retains one explicit transaction using its existing domain types;
it does not introduce a general transaction framework or change reward policy.

## Model and native definitions

`cycle_snapshot_publication` models one old pair, one proposed pair, two sibling
writes and up to two attempts. It separates staging, each backup and activation,
new-tree retraction, each restoration, cleanup, guard release and return status.
One scenario starts without a public tree and another without promotion. Failed
restoration retains recovery state; a restored failure can retry in new staging
paths while old cleanup debris remains. The previous
`failedRenameCanRemoveOldTreeTest` is replaced by
`failedRenameRestoresOldTreeTest` because destructive removal is no longer an
intended transition.

`scripts/cycle-index-publication.test.ts` copies the actual checkout and frozen
cycle fixtures and invokes the real validator/publisher in an isolated Bun
child. It uses [Bun module mocks](https://bun.sh/docs/test/mocks) only at the
filesystem boundary; it does not replace domain validation or publication code.
Each fixture starts with a valid empty old pair and real nonempty source cycles.
The definitions cover:

- failed promotion staging and successful retry;
- a rejected file write with a still-pending sibling, draining before cleanup;
- tree activation failure with both old outputs restored;
- promotion activation failure with the new tree retracted;
- failed restoration retaining backups/guard and refusing another writer;
- post-commit backup cleanup failure with a valid new pair;
- two concurrent publisher calls using the same guard;
- guard cleanup failure retaining the new pair and refusing automatic retry.

Successful retry checks the real index schema, timestamp, nonempty cycle list,
matching promotion entries and removal of the old-only artifact. These are test
definitions, not observed execution results.

## Boundaries

The guard serializes cooperating output publishers. Collection and validation
occur before guard acquisition, so it does not establish source-snapshot
freshness or serialize external edits to Git-backed cycle inputs. Readers that
do not take the guard can observe missing or mixed paths between renames. A
process crash in that window is explicit in the model and requires retained
state recovery; this is not an atomic two-path filesystem commit.

The model assumes ordinary local rename outcomes, not arbitrary remote
filesystem or power-loss semantics. It does not prove all JSON/money validators,
full browser rendering, every file count or every cleanup-failure combination.
Model mapping does not establish implementation refinement. The existing
evidence-bundle publisher and project-registry pair publication have separate
contracts and still require their own continuation review.
