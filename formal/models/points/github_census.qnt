// @source scripts/generate-leaderboard.ts
// @source scripts/generate-profiles.ts
// @source scripts/profile-issue-census.ts
// Two cursor pages, three immutable IDs. Census counts and identities must
// reconcile before publication. Search may split ranges and deduplicate their
// shared boundary. A mismatch discards the search attempt and retries the
// original range once. Each attempt must reconcile to its own parent count. This model
// does not encode every hydration field or scoring policy branch.
module github_census {
  var s: { phase: str, seen: Set[int], cursors: Set[int], expected: int,
    countStable: bool, identityStable: bool, ended: bool, complete: bool, published: bool, attempt: int }
  action init = s'={phase:"collecting",seen:Set(),cursors:Set(),expected:3,
    countStable:true,identityStable:true,ended:false,complete:false,published:false,attempt:1}
  action page(cursor, ids, count, identity, terminal) = all {
    s.phase=="collecting",not(s.ended),not(s.cursors.contains(cursor)),count==s.expected,identity,
    s'=s.with("cursors",s.cursors.union(Set(cursor))).with("seen",s.seen.union(ids)).with("ended",terminal) }
  action retrySplit(childCount, freshCount) = all {
    s.phase=="collecting",s.attempt==1,childCount!=s.expected,
    s'=s.with("attempt",2).with("expected",freshCount)
      .with("seen",Set()).with("cursors",Set()).with("ended",false) }
  action finish = all {s.phase=="collecting",s.ended,s.seen.size()==s.expected,
    s'=s.with("phase","validated").with("complete",true)}
  action publish = all {s.phase=="validated",s.complete,
    s'=s.with("phase","published").with("published",true)}
  action step = {nondet cursor=Set(1,2).oneOf() nondet id=Set(1,2,3).oneOf()
    nondet count=Set(2,3,4).oneOf() nondet identity=Set(false,true).oneOf()
    nondet terminal=Set(false,true).oneOf()
    any {page(cursor,Set(id),count,identity,terminal),page(cursor,Set(1,2),count,identity,terminal),
      retrySplit(id,count),finish,publish,s'=s}}
  val invariant = all {s.seen.subseteq(Set(1,2,3)),s.cursors.size()<=2,s.attempt<=2,
    s.published implies (s.complete and s.ended and s.seen.size()==s.expected and s.identityStable and s.countStable)}
  run completeCensusTest = init.then(page(1,Set(1,2),3,true,false)).then(page(2,Set(3),3,true,true))
    .then(finish).then(publish).expect(s.published and invariant)
  run repeatedCursorRefusedTest = init.then(page(1,Set(1),3,true,false)).then(page(1,Set(1),3,true,true).fail())
  run changingCountRefusedTest = init.then(page(1,Set(1),3,true,false)).then(page(2,Set(2),4,true,true).fail())
  run overlappingPagesCannotInventCountTest = init.then(page(1,Set(1,2),3,true,false))
    .then(page(2,Set(1,2),3,true,true)).then(finish.fail())
  run splitCountRetryRebuildsCensusTest = init.then(page(1,Set(1,2),3,true,true))
    .then(retrySplit(2,2)).then(page(1,Set(2,3),2,true,true))
    .then(finish).then(publish).expect(s.published and s.seen==Set(2,3) and invariant)
  run splitRetryRefusesSecondMismatchTest = init.then(page(1,Set(1,2),3,true,true))
    .then(retrySplit(2,3)).then(page(1,Set(1,2),3,true,true))
    .then(retrySplit(2,3).fail())
  run splitRetryDiscardsPartialPagesTest = init.then(page(1,Set(1,2,3),3,true,true))
    .then(retrySplit(2,3)).then(finish.fail())
  run completeCountStillRequiresTerminalPageTest = init.then(page(1,Set(1,2,3),3,true,false))
    .then(finish.fail())
}
