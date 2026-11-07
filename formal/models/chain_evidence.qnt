// @source contracts/evm/adapter.ts
// @source contracts/solana/adapter.ts
// @source contracts/solana/wallet-transactions.ts
// @source backend/payments/evm-adapter.ts
// @source backend/payments/solana-funding.ts
// @source backend/payments/vault-snapshots.ts
// Finality is separate from identity, success and exact amount/asset reconciliation.
module chain_evidence {
  type S = { network: bool, canonical: bool, success: bool, exact: bool, asset: bool,
    finalized: bool, accepted: bool }
  var s: S
  action init = s' = { network: false, canonical: false, success: false, exact: false, asset: false, finalized: false, accepted: false }
  action evidence(network: bool, canonical: bool, success: bool, exact: bool, asset: bool, finalized: bool): bool =
    s' = { network: network, canonical: canonical, success: success, exact: exact,
      asset: asset, finalized: finalized, accepted: false }
  action accept = all { s.network,s.canonical,s.success,s.exact,s.asset,s.finalized,
    s' = s.with("accepted",true) }
  action choose = { nondet a = Set(true,false).oneOf() nondet b = Set(true,false).oneOf()
    nondet c = Set(true,false).oneOf() nondet d = Set(true,false).oneOf()
    nondet e = Set(true,false).oneOf() nondet f = Set(true,false).oneOf()
    evidence(a,b,c,d,e,f) }
  action step = any { choose, accept, s' = s }
  val invariant = s.accepted implies all { s.network,s.canonical,s.success,s.exact,s.asset,s.finalized }
  run pendingNotPaidTest = init.then(evidence(true,true,true,true,true,false)).then(accept.fail())
  run wrongAssetTest = init.then(evidence(true,true,true,true,false,true)).then(accept.fail())
  run unbalancedTest = init.then(evidence(true,true,true,false,true,true)).then(accept.fail())
  run acceptedTest = init.then(evidence(true,true,true,true,true,true)).then(accept).expect(s.accepted and invariant)
}
