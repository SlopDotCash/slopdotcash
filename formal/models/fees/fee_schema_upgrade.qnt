// @source migrations/0076_fee_conversion_pending.sql
// @source migrations/0078_fee_conversion_transaction_size.sql
// @source migrations/0082_fee_claim_journal.sql
// @source migrations/0087_fee_send_replacements.sql
// @source migrations/0088_fee_approval_journal.sql
// Data migration contract: old fields are immutable projections of the rebuilt rows.
module fee_schema_upgrade {
  type S={version:int,unknownAmount:int,unknownBytes:int,finalizedAmount:int,finalizedTx:int,kind:str}
  var s:S
  action init=s'={version:0,unknownAmount:3,unknownBytes:1,finalizedAmount:2,finalizedTx:2,kind:"legacy"}
  action upgrade=all{s.version<5,s'=s.with("version",s.version+1).with("kind",if(s.version>=2) "conversion" else s.kind)}
  action step=any{upgrade,s'=s}
  val invariant=all{s.unknownAmount==3,s.unknownBytes==1,s.finalizedAmount==2,s.finalizedTx==2,
    s.version>=3 implies s.kind=="conversion"}
  run preservedAcrossAllRebuildsTest=init.then(upgrade).then(upgrade).then(upgrade).then(upgrade).then(upgrade).expect(invariant and s.version==5)
}
