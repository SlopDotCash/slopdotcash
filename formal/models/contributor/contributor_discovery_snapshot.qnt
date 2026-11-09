// @source skills/project-contributor-template/scripts/live-report.mjs
// A changed open-item inventory retries the entire snapshot once. A transport,
// malformed response or exhausted command budget fails without publishing an
// empty success. Two input kinds and a three-command representative bound.
module contributor_discovery_snapshot {
  type S = { attempt: int, reads: int, inventory: bool, activity: bool, published: bool, failed: bool }
  var s: S
  action init = s' = { attempt:1,reads:0,inventory:false,activity:false,published:false,failed:false }
  action readInventory = all { not(s.failed),not(s.published),not(s.inventory),s.reads<3,
    s'=s.with("reads",s.reads+1).with("inventory",true) }
  action readActivity = all { not(s.failed),not(s.published),s.inventory,not(s.activity),s.reads<3,
    s'=s.with("reads",s.reads+1).with("activity",true) }
  action changed = all { s.activity,not(s.published),not(s.failed),
    s'=if(s.attempt==1) s.with("attempt",2).with("reads",0).with("inventory",false).with("activity",false)
      else s.with("failed",true) }
  action unrelatedFailure = all { not(s.published),s'=s.with("failed",true) }
  action publish = all { s.inventory,s.activity,not(s.failed),s'=s.with("published",true) }
  action step = any { readInventory,readActivity,changed,unrelatedFailure,publish,s'=s }
  val invariant = all { s.attempt<=2,s.reads<=3,s.published implies s.inventory and s.activity and not(s.failed) }
  run retryFullSnapshotTest = init.then(readInventory).then(readActivity).then(changed).then(readInventory).then(readActivity).then(publish).expect(s.attempt==2 and invariant)
  run secondChangeFailsClosedTest = init.then(readInventory).then(readActivity).then(changed).then(readInventory).then(readActivity).then(changed).then(publish.fail())
  run failedReadNoEmptySuccessTest = init.then(readInventory).then(unrelatedFailure).then(publish.fail())
}
