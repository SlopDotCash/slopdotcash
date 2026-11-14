# Publish only an exact extension of the Points journal

PRD sections 2, 7 and 12 require public history to follow the append-only
journal. This model incorporates the `journal_publication` scenarios at
legacy main commit `8d14a9692b998ee3f4479725b6323125f11f11be`.

The [Points journal](./journal.md) supplies the authoritative records. The
publication service observes verified snapshots of that journal and has no
permission to write it. Each snapshot record binds its immutable identity and
a digest of its complete canonical bytes. Actual digest verification, object
publication and atomic compare-and-publish need storage conformance.

## Story: Keep published history stable when imports race or fail

### A publisher stages a candidate without changing what readers see

```quint
type PublishedRecord = { id: int, digest: str }
type PublicationPhase = Idle | Staged | Rejected | Interrupted | Published
type Publication = { phase: PublicationPhase, canonical: List[PublishedRecord], visible: List[PublishedRecord], staged: List[PublishedRecord],
  revision: int, preparedAt: int }
type PrefixCheck = { offset: int, exact: bool }
pure val firstRecord: PublishedRecord = { id: 1, digest: "first" }
pure val secondRecord: PublishedRecord = { id: 2, digest: "second" }
pure val thirdRecord: PublishedRecord = { id: 3, digest: "third" }
pure val absentRecord: PublishedRecord = { id: 0, digest: "" }
pure val initial: Publication = { phase: Idle, canonical: List(firstRecord), visible: List(firstRecord), staged: List(), revision: 1, preparedAt: 0 }
pure def canStage(p: Publication): bool = p.phase != Staged
pure def stage(p: Publication, candidate: List[PublishedRecord]): Publication =
  { ...p, phase: Staged, staged: candidate, preparedAt: p.revision }
```

### An admissible candidate preserves every public record in exact order

A shorter, reordered, duplicate or changed public history is rejected. A
candidate must also be an exact prefix of the observed canonical journal.
The same already-published bytes are a valid no-op. A candidate that races an
intervening publication must prepare again against the current revision.

```quint
pure def exactPrefix(prefix: List[PublishedRecord], full: List[PublishedRecord]): bool =
  val checked = prefix.foldl({ offset: 0, exact: true }, (acc, row) =>
    { offset: acc.offset + 1, exact: acc.exact and row == full.nthOr(acc.offset, absentRecord) })
  prefix.length() <= full.length() and checked.exact
pure def uniqueRecords(records: List[PublishedRecord]): bool = records.every(record =>
  record.id > 0 and record.digest != "" and records.select(other => other.id == record.id).length() == 1)
pure def admissiblePublication(p: Publication, candidate: List[PublishedRecord]): bool =
  exactPrefix(p.visible, candidate) and exactPrefix(candidate, p.canonical) and uniqueRecords(candidate)
pure def canObserveCanonical(p: Publication, snapshot: List[PublishedRecord], verified: bool): bool =
  verified and exactPrefix(p.canonical, snapshot) and uniqueRecords(snapshot)
pure def observeCanonical(p: Publication, snapshot: List[PublishedRecord], verified: bool): Publication =
  { ...p, canonical: snapshot }
pure def canPublish(p: Publication): bool = p.phase == Staged and p.preparedAt == p.revision
  and admissiblePublication(p, p.staged)
pure def publish(p: Publication): Publication = { ...p, phase: Published, visible: p.staged, staged: List(),
  revision: if (p.visible == p.staged) p.revision else p.revision + 1, preparedAt: 0 }
pure def canPublishConcurrent(p: Publication, candidate: List[PublishedRecord]): bool = admissiblePublication(p, candidate)
  and candidate.length() > p.visible.length()
pure def publishConcurrent(p: Publication, candidate: List[PublishedRecord]): Publication =
  { ...p, visible: candidate, revision: p.revision + 1 }
```

### Refusal and interruption leave the public history untouched

```quint
pure def canReject(p: Publication): bool = p.phase == Staged and not(canPublish(p))
pure def reject(p: Publication): Publication = { ...p, phase: Rejected, staged: List(), preparedAt: 0 }
pure def canInterrupt(p: Publication): bool = p.phase == Staged
pure def interrupt(p: Publication): Publication = { ...p, phase: Interrupted, staged: List(), preparedAt: 0 }
pure def alwaysUniqueVisible(p: Publication): bool = uniqueRecords(p.visible)
pure def alwaysCanonicalVisible(p: Publication): bool = exactPrefix(p.visible, p.canonical)
pure def stepCanonicalObservationsOnly(before: Publication, via: str, after: Publication): bool =
  via != "observeCanonical" implies before.canonical == after.canonical
pure def stepExactHistory(before: Publication, after: Publication): bool = exactPrefix(before.visible, after.visible)
pure def stepOnlyPublicationChangesHistory(before: Publication, via: str, after: Publication): bool =
  (via != "publish" and via != "publishConcurrent") implies before.visible == after.visible
pure def sometimesExtended(p: Publication): bool = p.phase == Published and p.visible.length() > 1
pure def sometimesRejected(p: Publication): bool = p.phase == Rejected
pure def sometimesInterrupted(p: Publication): bool = p.phase == Interrupted
pure def sometimesStale(p: Publication): bool = p.phase == Staged and p.preparedAt < p.revision and not(canPublish(p))
```

### Directed witnesses exercise the exact-prefix and publication race guards

```quint
pure val snapshotValues = Set(List(firstRecord), List(firstRecord, secondRecord), List(firstRecord, secondRecord, thirdRecord), List(secondRecord))
pure val candidateValues = Set(List(firstRecord), List(firstRecord, secondRecord),
  List(secondRecord, firstRecord), List(firstRecord, thirdRecord), List(firstRecord, firstRecord),
  List({ id: 1, digest: "changed" }, secondRecord))
pure def lawRejectReorder(recordId: int): bool = (recordId > 0 and recordId != firstRecord.id) implies
  not(admissiblePublication(initial, List({ id: recordId, digest: "other" }, firstRecord)))
pure def lawRejectDuplicate(digest: str): bool = not(admissiblePublication(initial,
  List(firstRecord, { id: firstRecord.id, digest: digest })))
pure def lawRejectChanged(digest: str): bool = digest != firstRecord.digest implies
  not(admissiblePublication(initial, List({ id: firstRecord.id, digest: digest }, secondRecord)))
pure def lawStalePrepared(recordId: int): bool = recordId == secondRecord.id implies
  not(canPublish(publishConcurrent(stage(observeCanonical(initial, List(firstRecord, secondRecord), true),
    List(firstRecord)), List(firstRecord, secondRecord))))
pure def lawRejectUncommitted(recordId: int): bool = recordId == secondRecord.id implies
  not(admissiblePublication(initial, List(firstRecord, secondRecord)))
pure val recordIdValues = Set(1, 2, 3)
```
