lemma lawUnreadVaultsNoCoverage_ensures(monthlyPool: bool, amount: seq<int>, vaults: seq<FreeRead>)
  ensures (lawUnreadVaultsNoCoverage(monthlyPool, amount, vaults) == true)
{
  var counted := (v: FreeRead) => ((v.recorded && v.read) && settlement__money_validAmount(v.free));
  if forall v :: v in vaults ==> !(v.recorded) || !(v.read) {
    ProofLib.FilterNone(counted, vaults);
    CoverageNeedsAReadVault(monthlyPool, amount, vaults);
  }
}

lemma lawTwoAccountsNameNobody_ensures(account: Registration, otherAccount: Registration)
  ensures (lawTwoAccountsNameNobody(account, otherAccount) == true)
{
  var named := (r: Registration) => (r.publicAccount && !(r.closed));
  var both := [account, otherAccount];
  ProofLib.FilterCons(named, both);
  ProofLib.FilterCons(named, both[1..]);
  ProofLib.FilterNil(named, both[1..][1..]);
  DepositorNeedsOneNamedAccount(both);
}

lemma lawPrivateOrClosedAccountNamesNobody_ensures(account: Registration)
  ensures (lawPrivateOrClosedAccountNamesNobody(account) == true)
{
  var named := (r: Registration) => (r.publicAccount && !(r.closed));
  ProofLib.FilterCons(named, [account]);
  ProofLib.FilterNil(named, [account][1..]);
  DepositorNeedsOneNamedAccount([account]);
}

// Without a vault both recorded and read, no coverage is shown.
lemma CoverageNeedsAReadVault(monthlyPool: bool, amount: seq<int>, vaults: seq<FreeRead>)
  ensures |ProofLib.Filter((v: FreeRead) => ((v.recorded && v.read) && settlement__money_validAmount(v.free)), vaults)| == 0 ==> monthsCovered(monthlyPool, amount, vaults) == Coverage.NoCoverage
{
}

// A depositor is named only when exactly one public open account matches.
lemma DepositorNeedsOneNamedAccount(registrations: seq<Registration>)
  ensures |ProofLib.Filter((r: Registration) => (r.publicAccount && !(r.closed)), registrations)| != 1 ==> depositorLogin(registrations) == ""
{
}
