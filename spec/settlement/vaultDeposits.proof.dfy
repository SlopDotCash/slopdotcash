// A completed page records the deposits of its blocks and moves the cursor to its end; its start is at most one past the cursor.
lemma completePage_ensures(v: EvmDeposits, slot: int, by_: string)
  ensures (inv(v) ==> canCompletePage(v, slot, by_) ==> alwaysRunsContiguous(completePage(v, slot, by_)))
  ensures (inv(v) ==> canCompletePage(v, slot, by_) ==> alwaysCursorFinalized(completePage(v, slot, by_)))
  ensures (inv(v) ==> canCompletePage(v, slot, by_) ==> alwaysRecordedExactlyBelowCursor(completePage(v, slot, by_)))
  ensures (inv(v) ==> canCompletePage(v, slot, by_) ==> alwaysBountyVaultNeverRead(completePage(v, slot, by_)))
  ensures (inv(v) ==> canCompletePage(v, slot, by_) ==> stepCursorNeverGoesBack(v, completePage(v, slot, by_)))
  ensures (inv(v) ==> canCompletePage(v, slot, by_) ==> stepRecordPermanent(v, completePage(v, slot, by_)))
  ensures (inv(v) ==> canCompletePage(v, slot, by_) ==> stepFailedPageChangesNothing(v, "completePage", completePage(v, slot, by_)))
{
  if inv(v) && canCompletePage(v, slot, by_) {
    var r := runOf(v, slot);
    var after := completePage(v, slot, by_);
    CompletedRecords(v, slot, by_);
    RecordedBelowCursor(v);
    RecordedBelowCursor(after);
    var inRange := (b: int) => ((b >= r.fromBlock) && (b <= r.toBlock));
    var unseen := (set_x: int) => !((set_x in v.recorded));
    var below := (b: int) => (b <= v.cursor);
    var belowAfter := (b: int) => (b <= after.cursor);
    forall x
      ensures x in after.recorded <==> x in ProofLib.Filter(belowAfter, chainDepositBlocks)
    {
      ProofLib.FilterMember(below, chainDepositBlocks, x);
      ProofLib.FilterMember(belowAfter, chainDepositBlocks, x);
      ProofLib.FilterMember(inRange, chainDepositBlocks, x);
      ProofLib.FilterMember(unseen, ProofLib.Filter(inRange, chainDepositBlocks), x);
    }
  }
}

// The vault starts with nothing recorded and no deposit at or below block zero.
lemma initialHolds_ensures()
  ensures inv(initialHolds())
{
  var v := initialHolds();
  var below := (b: int) => (b <= v.cursor);
  RecordedBelowCursor(v);
  ProofLib.FilterNone(below, chainDepositBlocks);
  assert |ProofLib.Filter(below, chainDepositBlocks)| == 0;
}

// The recorded-deposit rule, through the library's filter view.
lemma RecordedBelowCursor(v: EvmDeposits)
  ensures alwaysRecordedExactlyBelowCursor(v) == (!((exists set_x :: set_x in v.recorded && !((set_x in ProofLib.Filter((b: int) => (b <= v.cursor), chainDepositBlocks))))) && !((exists set_x :: set_x in ProofLib.Filter((b: int) => (b <= v.cursor), chainDepositBlocks) && !((set_x in v.recorded)))))
{
}

// What a completed page records, through the library's filter view.
lemma CompletedRecords(v: EvmDeposits, slot: int, by_: string)
  ensures var local_0 := runOf(v, slot); completePage(v, slot, by_).recorded == v.recorded + ProofLib.Filter((set_x: int) => !((set_x in v.recorded)), ProofLib.Filter((b: int) => ((b >= local_0.fromBlock) && (b <= local_0.toBlock)), chainDepositBlocks))
  ensures var local_0 := runOf(v, slot); completePage(v, slot, by_).cursor == (if (local_0.toBlock > v.cursor) then local_0.toBlock else v.cursor)
{
}

lemma FundersTotalAppend(testnets: seq<bool>, staging: bool, next: bool)
  ensures fundersTotal(testnets + [next], staging) == (if (staging || !(next)) then fundersTotal(testnets, staging) + 1 else fundersTotal(testnets, staging))
{
  ProofLib.FoldLeftAppend((n: int, testnet: bool) => (if (staging || !(testnet)) then (n + 1) else n), 0, testnets, next);
}

lemma lawProductionLeavesTestnetsOut_ensures(testnets: seq<bool>)
  ensures (lawProductionLeavesTestnetsOut(testnets) == true)
{
  FundersTotalAppend(testnets, false, true);
}

lemma FilterSingleton(names: seq<string>, login: string)
  ensures ProofLib.Filter((set_x: string) => !((set_x in names)), [login]) == (if login in names then [] else [login])
{
  var p := (set_x: string) => !((set_x in names));
  ProofLib.FilterCons(p, [login]);
  ProofLib.FilterNil(p, [login][1..]);
}

lemma NamingLoginsFilter(depositSolana: bool, depositor: string, regs: seq<Registrant>)
  ensures namingLogins(depositSolana, depositor, regs) == Std.Collections.Seq.FoldLeft((names: seq<string>, reg: Registrant) => (if (countedRegistrant(reg) && holdsDeposit(depositSolana, depositor, reg)) then (names + ProofLib.Filter((set_x: string) => !((set_x in names)), [reg.login])) else names), [], regs)
{
  var f := (names: seq<string>, reg: Registrant) => (if (countedRegistrant(reg) && holdsDeposit(depositSolana, depositor, reg)) then (names + Std.Collections.Seq.Filter((set_x: string) => !((set_x in names)), [reg.login])) else names);
  var g := (names: seq<string>, reg: Registrant) => (if (countedRegistrant(reg) && holdsDeposit(depositSolana, depositor, reg)) then (names + ProofLib.Filter((set_x: string) => !((set_x in names)), [reg.login])) else names);
  ProofLib.FoldLeftPointwise(f, g, [], regs, regs);
}

lemma NamingLoginsAppend(depositSolana: bool, depositor: string, regs: seq<Registrant>, next: Registrant)
  ensures namingLogins(depositSolana, depositor, regs + [next]) == (var cur := namingLogins(depositSolana, depositor, regs); if (countedRegistrant(next) && holdsDeposit(depositSolana, depositor, next)) then (cur + (if next.login in cur then [] else [next.login])) else cur)
{
  NamingLoginsFilter(depositSolana, depositor, regs);
  NamingLoginsFilter(depositSolana, depositor, regs + [next]);
  var g := (names: seq<string>, reg: Registrant) => (if (countedRegistrant(reg) && holdsDeposit(depositSolana, depositor, reg)) then (names + ProofLib.Filter((set_x: string) => !((set_x in names)), [reg.login])) else names);
  ProofLib.FoldLeftAppend(g, [], regs, next);
  FilterSingleton(namingLogins(depositSolana, depositor, regs), next.login);
}

lemma DepositorLoginFoldAppend(depositSolana: bool, depositor: string, regs: seq<Registrant>, next: Registrant)
  ensures Std.Collections.Seq.FoldLeft((name: string, reg: Registrant) => (if (countedRegistrant(reg) && holdsDeposit(depositSolana, depositor, reg)) then reg.login else name), "", regs + [next]) == (if (countedRegistrant(next) && holdsDeposit(depositSolana, depositor, next)) then next.login else Std.Collections.Seq.FoldLeft((name: string, reg: Registrant) => (if (countedRegistrant(reg) && holdsDeposit(depositSolana, depositor, reg)) then reg.login else name), "", regs))
{
  ProofLib.FoldLeftAppend((name: string, reg: Registrant) => (if (countedRegistrant(reg) && holdsDeposit(depositSolana, depositor, reg)) then reg.login else name), "", regs, next);
}

lemma lawUnsignedRegistrationNamesNobody_ensures(reg: Registrant)
  ensures (lawUnsignedRegistrationNamesNobody(reg) == true)
{
  if !reg.walletSigned {
    assert [] + [reg] == [reg];
    NamingLoginsAppend(reg.solana, reg.address, [], reg);
    assert namingLogins(reg.solana, reg.address, []) == [];
    assert namingLogins(reg.solana, reg.address, [reg]) == [];
  }
}

lemma lawUncountedRegistrationHidesNobody_ensures(reg: Registrant, other: Registrant)
  ensures (lawUncountedRegistrationHidesNobody(reg, other) == true)
{
  if countedRegistrant(reg) && !countedRegistrant(other) {
    assert [] + [reg] == [reg];
    assert [reg] + [other] == [reg, other];
    NamingLoginsAppend(reg.solana, reg.address, [], reg);
    assert namingLogins(reg.solana, reg.address, []) == [];
    NamingLoginsAppend(reg.solana, reg.address, [reg], other);
    assert namingLogins(reg.solana, reg.address, [reg, other]) == [reg.login];
    DepositorLoginFoldAppend(reg.solana, reg.address, [], reg);
    DepositorLoginFoldAppend(reg.solana, reg.address, [reg], other);
  }
}

lemma lawTwoSignedAccountsNameNobody_ensures(reg: Registrant, other: Registrant)
  ensures (lawTwoSignedAccountsNameNobody(reg, other) == true)
{
  if countedRegistrant(reg) && countedRegistrant(other) && holdsDeposit(reg.solana, reg.address, other) && reg.login != other.login {
    assert [] + [reg] == [reg];
    assert [reg] + [other] == [reg, other];
    NamingLoginsAppend(reg.solana, reg.address, [], reg);
    assert namingLogins(reg.solana, reg.address, []) == [];
    NamingLoginsAppend(reg.solana, reg.address, [reg], other);
    assert namingLogins(reg.solana, reg.address, [reg, other]) == [reg.login, other.login];
  }
}
