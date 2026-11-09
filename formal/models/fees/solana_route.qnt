// @source workers/fee-converter/jupiter-route.ts
// @source workers/fee-converter/verified-jupiter-policy.ts
// @source workers/fee-converter/jupiter-route-schema.ts
// @source workers/fee-converter/jupiter-wire.ts
// @source workers/fee-converter/verified-jupiter-wire.ts
// @source workers/fee-converter/jupiter-values.ts
// @source workers/fee-converter/solana-accounts.ts
// @source workers/fee-converter/solana-native-route.ts
// @source workers/fee-converter/solana-route-accounts.ts
// @source workers/fee-converter/solana-route-receipt.ts
// @source workers/fee-converter/verified-route-credit.ts
// @source contracts/solana/transactions.ts
// @source workers/fee-converter/solana-transaction.ts
// Route account/read/lookup proofs precede signing; receipt independently proves output.
module solana_route {
  type S={lookups:bool,accounts:bool,programs:bool,signers:bool,destination:bool,bounds:bool,signed:bool,received:bool}
  var s:S
  action init=s'={lookups:false,accounts:false,programs:false,signers:false,destination:false,bounds:false,signed:false,received:false}
  action inspect(lookups:bool,accounts:bool,programs:bool,signers:bool,destination:bool,bounds:bool):bool=all{not(s.signed),
    s'={lookups:lookups,accounts:accounts,programs:programs,signers:signers,destination:destination,bounds:bounds,signed:false,received:false}}
  val verified=s.lookups and s.accounts and s.programs and s.signers and s.destination and s.bounds
  action sign=all{verified,s'=s.with("signed",true)}
  action reconcile(exact:bool):bool=all{s.signed,exact,s'=s.with("received",true)}
  action inputs={nondet a=Set(true,false).oneOf() nondet b=Set(true,false).oneOf() nondet c=Set(true,false).oneOf()
    nondet d=Set(true,false).oneOf() nondet e=Set(true,false).oneOf() nondet f=Set(true,false).oneOf() inspect(a,b,c,d,e,f)}
  action step=any{inputs,sign,reconcile(true),s'=s}
  val invariant=all{s.signed implies verified,s.received implies s.signed}
  run unresolvedLookupTest=init.then(inspect(false,true,true,true,true,true)).then(sign.fail())
  run wrongDestinationTest=init.then(inspect(true,true,true,true,false,true)).then(sign.fail())
  run nativeOverDebitTest=init.then(inspect(true,true,true,true,true,false)).then(sign.fail())
  run checkedRouteTest=init.then(inspect(true,true,true,true,true,true)).then(sign).then(reconcile(true)).expect(invariant)
}
