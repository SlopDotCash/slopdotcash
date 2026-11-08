// @source workers/notify/security.ts
// @source migrations/0030_security_notification_outbox.sql
// @source migrations/0063_account_closure_notification_events.sql
// Primary + one backup, action notice vs informational report receipt.
module notification_escalation {
  var s:{receipt:bool,outcome:str,overdue:bool,read:bool,acknowledged:bool,primaryAccess:bool,backupAccess:bool,backup:bool}
  action init=s'={receipt:false,outcome:"queued",overdue:false,read:false,acknowledged:false,primaryAccess:true,backupAccess:true,backup:false}
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
  action immediateEscalation=all{Set("ambiguous","exhausted").contains(s.outcome),not(s.acknowledged),s.backupAccess,not(s.backup),s'=s.with("backup",true)}
  action scheduledEscalation=all{s.primaryAccess,s.backupAccess,not(s.acknowledged),not(s.backup),
    failure or (s.overdue and not(s.receipt) and Set("provider-accepted","delivered").contains(s.outcome)),s'=s.with("backup",true)}
  action step=any{informational,outcome("provider-accepted"),outcome("delivered"),outcome("ambiguous"),outcome("exhausted"),outcome("bounced"),outcome("local-suppressed"),outcome("provider-suppressed"),deadline,read,acknowledge,primaryRevoked,backupRevoked,primaryRestored,backupRestored,immediateEscalation,scheduledEscalation,s'=s}
  // Backup is historical: later authority revocation does not erase its notice.
  val invariant=s.receipt implies not(s.acknowledged)
  run readIsNotAcknowledgeTest=init.then(outcome("provider-accepted")).then(read).then(deadline).then(scheduledEscalation).expect(s.backup and not(s.acknowledged))
  run receiptDoesNotEscalateForTimeTest=init.then(informational).then(outcome("provider-accepted")).then(deadline).then(scheduledEscalation.fail())
  run failedReceiptEscalatesTest=init.then(informational).then(outcome("ambiguous")).then(immediateEscalation).expect(s.backup)
  run withheldMailDoesNotEscalateTest=init.then(outcome("local-suppressed")).then(deadline).then(scheduledEscalation.fail())
  run restoredRoleDoesNotRearmWithheldMailTest=init.then(primaryRevoked).then(outcome("local-suppressed")).then(primaryRestored).then(deadline).then(scheduledEscalation.fail())
  run revokedBackupCannotReceiveTest=init.then(outcome("bounced")).then(backupRevoked).then(immediateEscalation.fail())
  run oneBackupOnlyTest=init.then(outcome("ambiguous")).then(immediateEscalation).then(immediateEscalation.fail())
}
