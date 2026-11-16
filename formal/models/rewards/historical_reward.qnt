// @source scripts/prepare-escrow-cycle.ts
// @source src/lib/reward-finalization.ts
// @source src/lib/rewards.ts
// @source src/lib/reward-cycle.ts
// @source src/lib/payments/escrow-review.ts
// Historical archived protocol only; current monthly allocations use a different model.
module historical_reward {
  type S = { row: str, phase: str, wallet: bool, deadline: bool, lapsed: bool, amount: int }
  var s: S
  action init = s' = { row:"unclaimed",phase:"proposed",wallet:false,deadline:false,lapsed:false,amount:0 }
  action wallet = all { s.phase=="proposed", s'=s.with("wallet",true).with("row","proposed").with("amount",0).with("deadline",false) }
  action deadline = s'=s.with("deadline",true)
  action approveRow = all { s.phase=="proposed",s.wallet,not(s.lapsed),s'=s.with("row","approved").with("amount",3) }
  action hold = all { s.phase=="proposed",s'=s.with("row","held").with("amount",0) }
  action belowMinimum = all { s.phase=="proposed",s'=s.with("row","held-below-minimum").with("amount",0) }
  action lapse = all { s.phase=="proposed",s.deadline,s'=s.with("lapsed",true).with("row","held").with("amount",0) }
  action finalize = all { s.phase=="proposed",s.row=="approved",s.deadline,not(s.lapsed),s'=s.with("phase","approved") }
  action step = any {wallet,deadline,approveRow,hold,belowMinimum,lapse,finalize,s'=s}
  val invariant = all { s.phase=="approved" implies (s.deadline and s.row=="approved" and not(s.lapsed)),
    s.amount>0 implies (s.wallet and s.row=="approved") }
  run historicalFinalizeTest = init.then(wallet).then(approveRow).then(deadline).then(finalize).expect(invariant)
  run lapsedRefusedTest = init.then(wallet).then(deadline).then(lapse).then(finalize.fail())
  run belowMinimumRefusedTest = init.then(wallet).then(belowMinimum).then(deadline).then(finalize.fail())
}
