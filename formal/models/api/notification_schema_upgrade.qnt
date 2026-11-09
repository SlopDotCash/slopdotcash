// @source migrations/0030_security_notification_outbox.sql
// @source migrations/0033_optional_notification_email.sql
// @source migrations/0063_account_closure_notification_events.sql
// @source migrations/0065_slopbot_appeal_notifications.sql
// @source migrations/0079_slopbot_scam_review_notifications.sql
// @source migrations/0111_verified_notification_email.sql
// @evidence workers/notify/security.test.ts
// Populated successful SQL upgrades, with copy/drop/restore ordering exposed.
// Two historical read/unread notices, two pre-binding outboxes/evidence facts,
// and two later notices. No concurrent application access during a rebuild.
// api_dev_migrations covers local transaction failure; delivery/reconciliation
// and user verification details remain in their own models.
module notification_schema_upgrade {
  pure val emptyPayloads = Map(1->0,2->0,3->0,4->0,5->0,6->0)
  var s: {schema:int,phase:str,notices:Set[int],read:Set[int],payloads:int->int,
    copy:Set[int],copyRead:Set[int],copyPayloads:int->int,legacy:bool,
    securityQueue:Set[int],activityQueue:Set[int],versions:int->int,
    securityEvidence:Set[int],activityEvidence:Set[int],destination:int,
    consent:int,boundAtCreation:Set[int],sent:Set[int]}
  action init = s'={schema:0,phase:"ready",notices:Set(1,2),read:Set(2),
    payloads:emptyPayloads.set(1,101).set(2,102),copy:Set(),copyRead:Set(),copyPayloads:emptyPayloads,
    legacy:false,securityQueue:Set(),activityQueue:Set(),versions:emptyPayloads,
    securityEvidence:Set(),activityEvidence:Set(),destination:0,consent:0,boundAtCreation:Set(),sent:Set()}
  action enableOutbox = all {s.schema==0,s.phase=="ready",s'=s.with("schema",1)}
  // Existing queued/delivered rows are created after 0030/0033, before rebuilds.
  // The original two notices have no retrospective queue rows.
  action legacyDeliveries = all {s.schema==1,s.phase=="ready",not(s.legacy),
    s'=s.with("legacy",true).with("notices",s.notices.union(Set(3,4)))
      .with("payloads",s.payloads.set(3,103).set(4,104))
      .with("securityQueue",Set(3)).with("activityQueue",Set(4))
      .with("versions",s.versions.set(4,1))
      .with("securityEvidence",Set(3)).with("activityEvidence",Set(4))}
  action copyRows = all {s.schema>=1,s.schema<4,s.phase=="ready",
    s'=s.with("phase","copied").with("copy",s.notices)
      .with("copyRead",s.read).with("copyPayloads",s.payloads)}
  // Each SQL file drops enqueue triggers before recreating the empty table.
  action replaceTable = all {s.phase=="copied",s'=s.with("phase","empty")
    .with("notices",Set()).with("read",Set()).with("payloads",emptyPayloads)}
  // Enqueue triggers are still absent: replaying history creates no mail.
  action restoreRows = all {s.phase=="empty",s'=s.with("phase","restored")
    .with("notices",s.copy).with("read",s.copyRead).with("payloads",s.copyPayloads)}
  action restoreTriggers = all {s.phase=="restored",s'=s.with("phase","ready")
    .with("schema",s.schema+1).with("copy",Set()).with("copyRead",Set()).with("copyPayloads",emptyPayloads)}
  // Nullable new fields do not enroll users or bind old outbox destinations.
  action addVerifiedDestinations = all {s.schema==4,s.phase=="ready",s'=s.with("schema",5)}
  action verifyDestination = all {s.schema==5,s.phase=="ready",s'=s.with("destination",2)}
  action optIn = all {s.schema==5,s.phase=="ready",s.destination==2,s'=s.with("consent",2)}
  action publish(id:int):bool = all {s.schema==5,s.phase=="ready",not(s.notices.contains(id)),
    s'=s.with("notices",s.notices.union(Set(id))).with("payloads",s.payloads.set(id,100+id))
      .with("securityQueue",s.securityQueue.union(Set(id)))
      .with("versions",s.versions.set(id,if(s.destination==2 and s.consent==2) 2 else 0))
      .with("boundAtCreation",if(s.destination==2 and s.consent==2) s.boundAtCreation.union(Set(id)) else s.boundAtCreation)}
  action replay(id:int):bool = all {s.phase=="ready",s.notices.contains(id),s'=s}
  action markRead(id:int):bool = all {s.phase=="ready",s.notices.contains(id),not(s.read.contains(id)),s'=s.with("read",s.read.union(Set(id)))}
  // Registered-destination delivery is projected here only to expose the
  // version guard. Attempts, provider outcomes and escalation are separate.
  action send(id:int):bool = all {s.phase=="ready",s.schema==5,
    s.securityQueue.contains(id),s.versions.get(id)==2,s.destination==2,s.consent==2,
    s'=s.with("sent",s.sent.union(Set(id)))}
  pure def kinds(schema:int):Set[int] = if(schema<2) Set(0,1)
    else if(schema<3) Set(0,1,2) else if(schema<4) Set(0,1,2,3) else Set(0,1,2,3,4)
  action step = any {enableOutbox,legacyDeliveries,copyRows,replaceTable,restoreRows,restoreTriggers,
    addVerifiedDestinations,verifyDestination,optIn,publish(5),publish(6),replay(5),replay(6),
    markRead(1),markRead(2),send(3),send(5),send(6),s'=s}
  val invariant = all {
    s.schema>=0 and s.schema<=5,
    s.phase!="empty" implies (Set(1,2).subseteq(s.notices) and s.read.contains(2)),
    s.notices.forall(id=>s.payloads.get(id)==100+id),
    s.legacy implies (s.securityQueue.contains(3) and s.activityQueue==Set(4) and
      s.securityEvidence==Set(3) and s.activityEvidence==Set(4)),
    s.versions.get(3)==0, s.versions.get(4)==(if(s.legacy) 1 else 0),
    not(s.securityQueue.contains(1)) and not(s.securityQueue.contains(2)),
    s.sent.subseteq(s.boundAtCreation),
    s.boundAtCreation.forall(id=>Set(5,6).contains(id) and s.versions.get(id)==2)
  }
  action rebuild = copyRows.then(replaceTable).then(restoreRows).then(restoreTriggers)
  action upgrade = enableOutbox.then(legacyDeliveries).then(rebuild).then(rebuild).then(rebuild).then(addVerifiedDestinations)
  run outboxActivationDoesNotReplayHistoryTest = init.then(enableOutbox)
    .expect(s.securityQueue==Set() and s.notices==Set(1,2) and s.read==Set(2))
  run copyBackDoesNotEnqueueHistoryTest = init.then(enableOutbox).then(legacyDeliveries)
    .then(copyRows).then(replaceTable).then(restoreRows)
    .expect(s.notices==Set(1,2,3,4) and s.securityQueue==Set(3) and s.activityQueue==Set(4))
  run populatedRowsAndEvidenceSurviveAllRebuildsTest = init.then(upgrade)
    .expect(s.notices==Set(1,2,3,4) and s.read==Set(2) and s.securityEvidence==Set(3) and s.activityEvidence==Set(4))
  run priorReadStateIsPreservedTest = init.then(enableOutbox).then(markRead(1))
    .then(rebuild).then(rebuild).then(rebuild).expect(s.read==Set(1,2))
  run verifiedAddressDoesNotBindOldQueueTest = init.then(upgrade).then(verifyDestination).then(optIn)
    .expect(s.versions.get(3)==0 and s.versions.get(4)==1 and s.sent==Set())
  run onlyLaterBoundNoticeCanSendTest = init.then(upgrade).then(publish(5))
    .then(verifyDestination).then(optIn).then(publish(6)).then(send(6))
    .expect(s.versions.get(5)==0 and s.versions.get(6)==2 and s.sent==Set(6))
  run duplicateNewEventStillHasOneQueueRowTest = init.then(upgrade).then(verifyDestination)
    .then(optIn).then(publish(5)).then(replay(5)).expect(s.securityQueue==Set(3,5))
  run kindsWidenOnlyAtTheirSchemaStepTest = init.then(enableOutbox).expect(not(kinds(s.schema).contains(2)))
    .then(rebuild).expect(kinds(s.schema).contains(2) and not(kinds(s.schema).contains(3)))
    .then(rebuild).expect(kinds(s.schema).contains(3) and not(kinds(s.schema).contains(4)))
    .then(rebuild).expect(kinds(s.schema).contains(4))
}
