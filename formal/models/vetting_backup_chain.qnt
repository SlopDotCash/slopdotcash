// @source workers/vetting-backup/core.ts
// @source workers/vetting-backup/qualification.ts
// @source workers/vetting-backup/qualification-entry.ts
// @source workers/vetting-backup/qualification-retention.ts
// @source workers/vetting-backup/workflow.mjs
// @source workers/vetting-backup/qualification-workflow.mjs
// @source migrations/0067_vetting_audit_retention.sql
// Two pages with one object each; digest equality is represented by exact
// predecessor IDs and verified-object membership. Scheduler exclusivity is a
// D1 constraint; queue delivery is at least once. Retention has a separate model.
module vetting_backup_chain {
  var s: { phase: str, day: int, copied: Set[int], pages: Set[int],
    cursor: int, completeReceipt: bool, restored: Set[int], acknowledgments: int }
  action init = s'={ phase:"idle", day:0, copied:Set(), pages:Set(), cursor:0,
    completeReceipt:false, restored:Set(), acknowledgments:0 }
  action start = all { s.phase=="idle", s'=s.with("phase","backup").with("day",1) }
  action copy(page) = all { s.phase=="backup", page==s.cursor, page<2,
    s'=s.with("copied",s.copied.union(Set(page))) }
  action recordPage(page, predecessor) = all { s.phase=="backup", page==s.cursor,
    page<2, s.copied.contains(page), predecessor==page-1,
    page==0 or s.pages.contains(page-1),
    s'=s.with("pages",s.pages.union(Set(page))) }
  action deliver(page) = all { s.phase=="backup", page==s.cursor,
    s.pages.contains(page), s'=s.with("cursor",s.cursor+1) }
  action replay(page) = all { s.pages.contains(page), s.acknowledgments<3,
    s'=s.with("acknowledgments",s.acknowledgments+1) }
  action receipt = all { s.phase=="backup", s.cursor==2, s.pages==Set(0,1),
    s'=s.with("completeReceipt",true) }
  action finishBackup = all { s.phase=="backup", s.completeReceipt,
    s'=s.with("phase","cleanup") }
  action finishCleanup = all { s.phase=="cleanup", s.completeReceipt,
    s'=s.with("phase","complete") }
  action restore(object, chainMatches, totalsMatch, uniqueObject, bytesMatch) = all {
    s.completeReceipt, s.copied.contains(object), chainMatches, totalsMatch,
    uniqueObject, bytesMatch, s'=s.with("restored",s.restored.union(Set(object))) }
  action step = { nondet p=Set(0,1).oneOf() nondet a=Set(false,true).oneOf()
    nondet b=Set(false,true).oneOf() nondet c=Set(false,true).oneOf() nondet d=Set(false,true).oneOf()
    any { start,copy(p),recordPage(p,p-1),deliver(p),replay(p),receipt,
      finishBackup,finishCleanup,restore(p,a,b,c,d),s'=s } }
  val invariant = all {
    s.pages.subseteq(s.copied), s.cursor>=0, s.cursor<=2,
    s.pages.contains(1) implies s.pages.contains(0),
    s.completeReceipt implies (s.pages==Set(0,1) and s.cursor==2),
    s.restored.size()>0 implies s.completeReceipt,
    s.restored.subseteq(s.copied), s.phase!="idle" implies s.day==1,
  }
  run replayDoesNotAdvanceCursorTest = init.then(start).then(copy(0)).then(recordPage(0,-1))
    .then(deliver(0)).then(replay(0)).expect(s.cursor==1 and s.pages==Set(0))
  run noConcurrentCycleTest = init.then(start).then(start.fail())
  run incompleteSnapshotCannotRestoreTest = init.then(start).then(copy(0)).then(restore(0,true,true,true,true).fail())
  run restoreVerifiedChainTest = init.then(start).then(copy(0)).then(recordPage(0,-1)).then(deliver(0))
    .then(copy(1)).then(recordPage(1,0)).then(deliver(1)).then(receipt).then(finishBackup)
    .then(finishCleanup).then(restore(1,true,true,true,true)).expect(s.restored==Set(1) and invariant)
  run duplicateObjectRefusedTest = init.then(start).then(copy(0)).then(recordPage(0,-1)).then(deliver(0))
    .then(copy(1)).then(recordPage(1,0)).then(deliver(1)).then(receipt)
    .then(restore(1,true,true,false,true).fail())
}
