// @source workers/slopbot/verified-source-ownership.ts
// @source workers/slopbot/verified-work-unit.ts
// @source workers/slopbot/value-consumer.ts
// @source workers/slopbot/value-group-collection.ts
// @source workers/slopbot/value-source-leases.ts
// @source workers/slopbot/value-processing.ts
// @source workers/slopbot/value-work-unit.ts
// @source workers/slopbot/value-work-unit-review.ts
// @source workers/slopbot/value-inference.ts
// @source workers/slopbot/value-publication-fence.ts
// @source workers/slopbot/value-work-unit-publication.ts
// @source workers/slopbot/value-work-unit-journal.ts
// @source migrations/0046_slopbot_work_unit_journal.sql
// @source migrations/0053_slopbot_value_source_leases.sql
// @source migrations/0054_slopbot_value_inference_results.sql
// Composed two-PR, one-shared-claim pipeline for one unchanged source key.
// Two request owners, two A generations, three provider calls and two clock
// ticks are bounds. Valid source/partition and provider bytes are abstracted;
// actual source collection, partition, retention and SQL replay this trace.
// State reduction: an earlier `last` field named the previous action. No guard,
// update, invariant or scenario read it, so dropping it maps each old state to
// one new state with the same enabled actions and successors on the remaining
// fields (a functional bisimulation). Invariants over those fields keep their
// truth value; only the distinct-state count shrinks. The conformance test
// (workers/slopbot/value-pipeline.test.ts) finds the tick by its clock change,
// which only `tick` makes.
module bot_value_pipeline {
  var s: { a: str, b: str, now: int, aUntil: int, bUntil: int, aGeneration: int,
    sourceOwner: int, aGroup: bool, bGroup: bool, aPartition: bool, bPartition: bool,
    calls: int, usage: bool, usageA: bool, usageB: bool, retained: bool, retainedBy: int,
    resultA: int, resultB: int, journalResult: int, journal: bool, writes: int,
    validWrite: bool }
  action init = s' = {a: "absent", b: "absent", now: 0, aUntil: 0, bUntil: 0, aGeneration: 0,
    sourceOwner: 0, aGroup: false, bGroup: false, aPartition: false, bPartition: false,
    calls: 0, usage: false, usageA: false, usageB: false, retained: false, retainedBy: 0,
    resultA: 0, resultB: 0, journalResult: 0, journal: false, writes: 0, validWrite: false}
  val aLive = s.aUntil > s.now and not(Set("complete", "waiting").contains(s.a))
  val bLive = s.bUntil > s.now and not(Set("complete", "waiting").contains(s.b))
  val aOwns = aLive and s.sourceOwner == 1
  val bOwns = bLive and s.sourceOwner == 2
  action startA = all { not(aLive), s.a != "complete", s.a != "waiting" or s.now > 0, s.aGeneration < 2, s.now < 2,
    s' = s.with("a", "claimed").with("aUntil", s.now + 1).with("aGeneration", s.aGeneration + 1)
      .with("aGroup", false).with("aPartition", false) }
  action startB = all { s.b == "absent" or (s.b == "waiting" and s.now > 0), s.now < 2,
    s' = s.with("b", "claimed").with("bUntil", s.now + 1) }
  action collectA = all { s.a == "claimed", aLive,
    s' = s.with("a", "collected").with("aGroup", true) }
  action collectB = all { s.b == "claimed", bLive,
    s' = s.with("b", "collected").with("bGroup", true) }
  action incompleteA = all { s.a == "claimed", aLive,
    s' = s.with("a", "waiting") }
  action holdA = all { s.a == "collected", aLive, not(bOwns),
    s' = s.with("a", "leased").with("sourceOwner", 1) }
  action holdB = all { s.b == "collected", bLive, not(aOwns),
    s' = s.with("b", "leased").with("sourceOwner", 2) }
  action busyB = all { s.b == "collected", bLive, aOwns,
    s' = s.with("b", "waiting") }
  action partitionA = all { s.a == "leased", aOwns, s.aGroup,
    s' = s.with("a", "prepared").with("aPartition", true) }
  action partitionB = all { s.b == "leased", bOwns, s.bGroup,
    s' = s.with("b", "prepared").with("bPartition", true) }
  // A remote installation check may yield after its initial ownership read.
  // Its final local read checks the current database execution clock and
  // must refuse the paid call when a lease expired, including a queued read.
  action beginPreCallA = all {s.a=="prepared",aOwns,
    s'=s.with("a","checking")}
  action beginPreCallB = all {s.b=="prepared",bOwns,
    s'=s.with("b","checking")}
  action finishPreCallA = all {s.a=="checking",
    s'=s.with("a",if(aOwns) "prepared" else "rejected")}
  action finishPreCallB = all {s.b=="checking",
    s'=s.with("b",if(bOwns) "prepared" else "rejected")}
  action assessA = all { s.a == "prepared", aOwns, s.aPartition, not(s.retained), not(s.journal), s.calls < 3,
    s' = s.with("a", "called").with("calls", s.calls + 1) }
  action assessB = all { s.b == "prepared", bOwns, s.bPartition, not(s.retained), not(s.journal), s.calls < 3,
    s' = s.with("b", "called").with("calls", s.calls + 1) }
  action recordA = all { s.a == "called", s' = s.with("a", "recorded").with("usage", true).with("usageA", true) }
  action recordB = all { s.b == "called", s' = s.with("b", "recorded").with("usage", true).with("usageB", true) }
  action retainA = all { s.a == "recorded", s' = s.with("a", "ready").with("retained", true).with("retainedBy", if (s.retained) s.retainedBy else 1)
    .with("resultA", if (s.retained) s.retainedBy else 1) }
  action retainB = all { s.b == "recorded", s' = s.with("b", "ready").with("retained", true).with("retainedBy", if (s.retained) s.retainedBy else 2)
    .with("resultB", if (s.retained) s.retainedBy else 2) }
  action reuseA = all { s.a == "prepared", s.retained, aOwns,
    s' = s.with("a", "ready").with("resultA", s.retainedBy) }
  action reuseB = all { s.b == "prepared", s.retained, bOwns,
    s' = s.with("b", "ready").with("resultB", s.retainedBy) }
  action beginPublicationA = all { s.a == "ready", aOwns,
    s' = s.with("a", "publishing") }
  action beginPublicationB = all { s.b == "ready", bOwns,
    s' = s.with("b", "publishing") }
  action publishA = all { s.a == "publishing", aOwns, s.retained, s.aPartition, s.resultA == s.retainedBy,
    s' = s.with("a", "published").with("journalResult", if (s.journal) s.journalResult else s.resultA).with("journal", true).with("writes", 1).with("validWrite", true) }
  action publishB = all { s.b == "publishing", bOwns, s.retained, s.bPartition, s.resultB == s.retainedBy,
    s' = s.with("b", "published").with("journalResult", if (s.journal) s.journalResult else s.resultB).with("journal", true).with("writes", 1).with("validWrite", true) }
  action refuseA = all { s.a == "publishing", not(aOwns),
    s' = s.with("a", "rejected") }
  action refuseB = all { s.b == "publishing", not(bOwns),
    s' = s.with("b", "rejected") }
  action finishA = all { s.a == "published", aOwns, s.journal,
    s' = s.with("a", "complete") }
  action finishB = all { s.b == "published", bOwns, s.journal,
    s' = s.with("b", "complete") }
  action currentA = all { s.a == "prepared", aOwns, s.journal,
    s' = s.with("a", "complete") }
  action currentB = all { s.b == "prepared", bOwns, s.journal,
    s' = s.with("b", "complete") }
  action tick = all { s.now < 2, s' = s.with("now", s.now + 1) }
  action step = any { startA, startB, collectA, collectB, incompleteA, holdA, holdB, busyB, partitionA, partitionB,
    beginPreCallA,beginPreCallB,finishPreCallA,finishPreCallB,
    assessA, assessB, recordA, recordB, retainA, retainB, reuseA, reuseB,
    beginPublicationA, beginPublicationB, publishA, publishB, refuseA, refuseB,
    finishA, finishB, currentA, currentB, tick, s' = s }
  val invariant = all { s.calls <= 3, s.writes <= 1, s.retained implies s.usage,
    s.retained iff s.retainedBy != 0,
    s.retainedBy == 1 implies s.usageA,
    s.retainedBy == 2 implies s.usageB,
    s.journal implies s.retained and s.validWrite and s.journalResult == s.retainedBy,
    s.a == "complete" or s.b == "complete" implies s.journal,
    s.sourceOwner == 1 and aLive implies not(bOwns),
    s.sourceOwner == 2 and bLive implies not(aOwns) }
  run expiredPublicationReusesInferenceTest = init.then(startA).then(collectA).then(holdA).then(partitionA)
    .then(assessA).then(recordA).then(retainA).then(beginPublicationA).then(tick).then(refuseA)
    .then(startB).then(collectB).then(holdB).then(partitionB).then(reuseB).then(beginPublicationB)
    .then(publishB).then(finishB).then(startA).then(collectA).then(holdA).then(partitionA).then(currentA)
    .expect(s.calls == 1 and s.writes == 1 and s.a == "complete" and s.b == "complete")
  run wholeGroupOwnershipExcludesOverlapTest = init.then(startA).then(startB).then(collectA).then(collectB)
    .then(holdA).then(holdB.fail())
  run overlappingConsumerWaitsThenReadsCurrentTest = init.then(startA).then(collectA).then(holdA).then(partitionA)
    .then(assessA).then(startB).then(collectB).then(busyB).then(recordA).then(retainA)
    .then(beginPublicationA).then(publishA).then(finishA).then(tick).then(startB)
    .then(collectB).then(holdB).then(partitionB).then(currentB)
    .expect(s.calls == 1 and s.writes == 1 and s.a == "complete" and s.b == "complete")
  run missingGroupCannotSpendTest = init.then(startA).then(incompleteA).expect(s.calls == 0 and not(s.journal))
  run unrecordedUsageCannotBecomeRetainedTest = init.then(startA).then(collectA).then(holdA).then(partitionA)
    .then(assessA).then(retainA.fail())
  run leaseExpiryDuringInferenceStillKeepsReusableReceiptTest = init.then(startA).then(collectA).then(holdA).then(partitionA)
    .then(assessA).then(tick).then(recordA).then(retainA).then(startB).then(collectB).then(holdB)
    .then(partitionB).then(reuseB).then(beginPublicationB).then(publishB).then(finishB)
    .then(startA).then(collectA).then(holdA).then(partitionA).then(currentA)
    .expect(s.calls == 1 and s.journal and s.a == "complete")
  run leaseExpiryDuringPreCallCheckPreventsSpendTest = init.then(startA).then(collectA).then(holdA).then(partitionA)
    .then(beginPreCallA).then(tick).then(finishPreCallA)
    .expect(s.calls==0 and s.a=="rejected")
    .then(startB).then(collectB).then(holdB).then(partitionB).then(assessB).then(recordB).then(retainB)
    .then(beginPublicationB).then(publishB).then(finishB)
    .then(startA).then(collectA).then(holdA).then(partitionA).then(currentA)
    .expect(s.calls==1 and s.writes==1 and s.a=="complete" and s.b=="complete")
}
