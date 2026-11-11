// @source workers/notify/security.ts
// @source backend/security/handler.ts
// @source migrations/0030_security_notification_outbox.sql
// @source migrations/0063_account_closure_notification_events.sql
// Primary + one backup, action notice vs informational report receipt.
module notification_escalation {
  var s:{receipt:bool,outcome:str,overdue:bool,read:bool,acknowledged:bool,primaryAccess:bool,backupAccess:bool,backup:bool,prepared:bool,creationEligible:bool}
  action init=s'={receipt:false,outcome:"queued",overdue:false,read:false,acknowledged:false,primaryAccess:true,backupAccess:true,backup:false,prepared:false,creationEligible:false}
  action informational=all{s.outcome=="queued",not(s.acknowledged),s'=s.with("receipt",true)}
  action outcome(value:str):bool=s'=s.with("outcome",value)
  action deadline=s'=s.with("overdue",true)
  action read=s'=s.with("read",true)
  action acknowledge=all{s.primaryAccess,not(s.receipt),s'=s.with("acknowledged",true)}
  action primaryRevoked=s'=s.with("primaryAccess",false)
  action backupRevoked=s'=s.with("backupAccess",false)
  action primaryRestored=s'=s.with("primaryAccess",true)
  action backupRestored=s'=s.with("backupAccess",true)
  val failure=Set("ambiguous","exhausted","bounced","provider-suppressed").contains(s.outcome)
  val eligible=failure or (s.overdue and not(s.receipt)
    and Set("provider-accepted","delivered").contains(s.outcome))
  action prepareImmediate=all{Set("ambiguous","exhausted").contains(s.outcome),not(s.acknowledged),s.backupAccess,not(s.backup),s'=s.with("prepared",true)}
  action prepareScheduled=all{s.primaryAccess,s.backupAccess,not(s.acknowledged),not(s.backup),
    eligible,s'=s.with("prepared",true)}
  // External access is an observed fact. Acknowledgment and existing backup
  // rows and the failure/overdue trigger are checked again by the atomic
  // INSERT, after the async access read. A prepared failure is not permanent.
  action commitEscalation=all{s.prepared,eligible,not(s.acknowledged),not(s.backup),s'=s.with("backup",true).with("prepared",false).with("creationEligible",eligible)}
  action step=any{informational,outcome("provider-accepted"),outcome("delivered"),outcome("ambiguous"),outcome("exhausted"),outcome("bounced"),outcome("local-suppressed"),outcome("provider-suppressed"),outcome("retrying"),deadline,read,acknowledge,primaryRevoked,backupRevoked,primaryRestored,backupRestored,prepareImmediate,prepareScheduled,commitEscalation,s'=s}
  // Backup is historical: later authority revocation does not erase its notice.
  val invariant=all{s.receipt implies not(s.acknowledged),s.backup implies s.creationEligible}
  run readIsNotAcknowledgeTest=init.then(outcome("provider-accepted")).then(read).then(deadline).then(prepareScheduled).then(commitEscalation).expect(s.backup and not(s.acknowledged))
  run receiptDoesNotEscalateForTimeTest=init.then(informational).then(outcome("provider-accepted")).then(deadline).then(prepareScheduled.fail())
  run failedReceiptEscalatesTest=init.then(informational).then(outcome("ambiguous")).then(prepareImmediate).then(commitEscalation).expect(s.backup)
  run withheldMailDoesNotEscalateTest=init.then(outcome("local-suppressed")).then(deadline).then(prepareScheduled.fail())
  run restoredRoleDoesNotRearmWithheldMailTest=init.then(primaryRevoked).then(outcome("local-suppressed")).then(primaryRestored).then(deadline).then(prepareScheduled.fail())
  run revokedBackupCannotReceiveTest=init.then(outcome("bounced")).then(backupRevoked).then(prepareScheduled.fail())
  run oneBackupOnlyTest=init.then(outcome("ambiguous")).then(prepareImmediate).then(commitEscalation).then(prepareImmediate.fail())
  run acknowledgmentAfterImmediateReadRefusesTest=init.then(outcome("ambiguous")).then(prepareImmediate).then(acknowledge)
    .expect(not(s.backup)).then(commitEscalation.fail())
  run acknowledgmentAfterScheduledReadRefusesTest=init.then(outcome("delivered")).then(deadline).then(prepareScheduled).then(acknowledge)
    .expect(not(s.backup)).then(commitEscalation.fail())
  run laterAccessChangeDoesNotEraseObservedGrantTest=init.then(outcome("bounced")).then(prepareScheduled).then(backupRevoked).then(commitEscalation)
    .expect(s.backup and not(s.backupAccess))
  run receiptDeliveredDuringPreparationRefusesTest=init.then(informational)
    .then(outcome("ambiguous")).then(prepareImmediate).then(outcome("delivered"))
    .expect(not(s.backup)).then(commitEscalation.fail())
  run earlyActionDeliveredDuringPreparationRefusesTest=init.then(outcome("ambiguous"))
    .then(prepareImmediate).then(outcome("delivered"))
    .expect(not(s.backup) and not(s.overdue)).then(commitEscalation.fail())
  run overdueActionStillEscalatesAfterDeliveryTest=init.then(outcome("ambiguous"))
    .then(prepareImmediate).then(deadline).then(outcome("delivered")).then(commitEscalation)
    .expect(s.backup and not(s.acknowledged))
  run retryingReceiptDuringPreparationRefusesTest=init.then(informational)
    .then(outcome("ambiguous")).then(prepareImmediate).then(outcome("retrying"))
    .expect(not(s.backup)).then(commitEscalation.fail())
  run reconciledFailureStillEscalatesTest=init.then(informational).then(outcome("ambiguous"))
    .then(prepareImmediate).then(outcome("provider-suppressed")).then(commitEscalation)
    .expect(s.backup)
  run committedBackupSurvivesLaterDeliveryTest=init.then(informational).then(outcome("ambiguous"))
    .then(prepareImmediate).then(commitEscalation).then(outcome("delivered"))
    .expect(s.backup and s.creationEligible and not(eligible) and invariant)
}
