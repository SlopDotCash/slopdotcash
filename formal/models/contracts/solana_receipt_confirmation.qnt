// @source contracts/solana/integration/confirmation.mjs
// Local-suite confirmation polls exact transaction evidence, rereads after
// blockheight expiry, and treats caller abort as terminal rather than resend.
module solana_receipt_confirmation {
  type S={phase:str,expired:bool,receipt:bool,transactionFailed:bool,sends:int}
  var s:S
  action init=s'={phase:"poll",expired:false,receipt:false,transactionFailed:false,sends:0}
  action read(found:bool,matches:bool,failed:bool):bool=all{Set("poll","last-read").contains(s.phase),
    s'=if(found) s.with("phase",if(matches) "confirmed" else "invalid").with("receipt",matches).with("transactionFailed",failed)
      else s.with("phase",if(s.phase=="last-read") "expired" else "height")}
  action height(expired:bool):bool=all{s.phase=="height",s'=s.with("expired",expired).with("phase",if(expired) "last-read" else "poll")}
  action abort=all{Set("poll","height","last-read").contains(s.phase),s'=s.with("phase","aborted")}
  action step=any{read(false,false,false),read(true,true,false),read(true,true,true),read(true,false,false),height(true),height(false),abort,s'=s}
  val invariant=all{s.sends==0,s.phase=="confirmed" implies s.receipt,s.phase=="expired" implies s.expired and not(s.receipt)}
  run receiptWinsExpiryRaceTest=init.then(read(false,false,false)).then(height(true)).then(read(true,true,false)).expect(s.phase=="confirmed" and invariant)
  run absenceAfterExpiryTest=init.then(read(false,false,false)).then(height(true)).then(read(false,false,false)).expect(s.phase=="expired" and invariant)
  run failedReceiptStillConfirmedTest=init.then(read(true,true,true)).expect(s.receipt and s.transactionFailed and invariant)
  run wrongBlockhashRejectedTest=init.then(read(true,false,false)).expect(s.phase=="invalid" and not(s.receipt))
  run abortNeverResendsTest=init.then(abort).expect(s.phase=="aborted" and s.sends==0)
}
