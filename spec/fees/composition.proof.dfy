lemma ReceiptsUniqueMeaning(s: FeeFlow)
  ensures alwaysEveryReceiptHasSource(s) ==
    (((|s.fee.receipts| == |s.entries|) && !((exists r :: r in s.fee.receipts && !((exists e :: e in s.entries && (e.receipt == r)))))) && !((exists e :: e in s.entries && !(((((((e.receipt > 0) && (e.amount > 0)) && (e.chainTime > 0)) && (!(e.source.PayoutFee?) || (e.caseId == 0))) && (!(e.source.DirectAwardFee?) || (e.caseId > 0))) && (|ProofLib.Filter((x: FeeEntry) => (x.receipt == e.receipt), s.entries)| == 1))))))
{
}

lemma OutputsUniqueMeaning(s: FeeFlow)
  ensures alwaysOutputsOnce(s) ==
    (!((exists o :: o in s.outputs && !(((((((((o.row > 0) && (o.output > 0)) && (o.at <= s.fee.clock)) && (|ProofLib.Filter((x: Output) => (x.row == o.row), s.outputs)| == 1)) && (outputRow(s, o.row).id == o.row)) && outputRow(s, o.row).state.Finalized?) && (outputRow(s, o.row).output == o.output)) && (outputRow(s, o.row).kind.Conversion? || outputRow(s, o.row).kind.Claim?))))) && !((exists r :: r in s.fee.rows && !((((r.id > 0) && (r.id <= |s.fee.rows|)) && (outputRow(s, r.id) == r))))))
{
}

lemma KeptUniqueMeaning(s: FeeFlow)
  ensures alwaysKeptFeesProvenOnce(s) ==
    !((exists k :: k in s.kept && !((keptProven(k) && (|ProofLib.Filter((x: KeptFee) => (x.deposit == k.deposit), s.kept)| == 1)))))
{
}

lemma CreditsUniqueMeaning(s: FeeFlow)
  ensures alwaysNoReceiptCountedTwice(s) ==
    !((exists c :: c in s.credits && !(((((|ProofLib.Filter((x: Credit) => (x.key == c.key), s.credits)| == 1) && (!(receiptKeyed(c)) || (|ProofLib.Filter((x: Credit) => (receiptKeyed(x) && (x.key.id == c.key.id)), s.credits)| == 1))) && (!(rowKeyed(c)) || (|ProofLib.Filter((x: Credit) => (rowKeyed(x) && (x.key.id == c.key.id)), s.credits)| == 1))) && (!(depositKeyed(c)) || (|ProofLib.Filter((x: Credit) => (depositKeyed(x) && (x.key.id == c.key.id)), s.credits)| == 1))))))
{
}

lemma WithHoldingKeepsAssets(f: fees__conversion_Fee, token: int, h: fees__conversion_Holding)
  requires forall x :: x in f.holdings ==> x.token > 0 && x.token <= |f.holdings| && fees__conversion_holding(f, x.token).token == x.token && fees__conversion_holding(f, x.token).asset == x.asset
  requires h.token == fees__conversion_holding(f, token).token && h.asset == fees__conversion_holding(f, token).asset
  ensures var g := f.(holdings := fees__conversion_withHolding(token, h, f));
    |g.holdings| == |f.holdings|
    && (forall i :: 0 <= i < |f.holdings| ==> g.holdings[i].token == f.holdings[i].token && g.holdings[i].asset == f.holdings[i].asset)
    && (forall x :: x in g.holdings ==> x.token > 0 && x.token <= |g.holdings| && fees__conversion_holding(g, x.token).token == x.token && fees__conversion_holding(g, x.token).asset == x.asset)
    && (forall t :: fees__conversion_holding(g, t).token == fees__conversion_holding(f, t).token && fees__conversion_holding(g, t).asset == fees__conversion_holding(f, t).asset)
{
  hide *;
  reveal fees__conversion_withHolding, fees__conversion_holding;
  var g := f.(holdings := fees__conversion_withHolding(token, h, f));
  forall i | 0 <= i < |f.holdings|
    ensures g.holdings[i].token == f.holdings[i].token && g.holdings[i].asset == f.holdings[i].asset
  {
    var x := f.holdings[i];
    assert x in f.holdings;
    if x.token == token {
      assert fees__conversion_holding(f, x.token).token == x.token;
      assert fees__conversion_holding(f, x.token).asset == x.asset;
    }
  }
  forall x | x in g.holdings
    ensures x.token > 0 && x.token <= |g.holdings| && fees__conversion_holding(g, x.token).token == x.token && fees__conversion_holding(g, x.token).asset == x.asset
  {
    var i :| 0 <= i < |g.holdings| && g.holdings[i] == x;
    assert f.holdings[i] in f.holdings;
    assert g.holdings[x.token - 1].token == f.holdings[x.token - 1].token;
    assert g.holdings[x.token - 1].asset == f.holdings[x.token - 1].asset;
  }
}

lemma BackedPreserved(s: FeeFlow, after: FeeFlow)
  requires alwaysIncomeBackedByReceiptOrConversion(s)
  requires after.credits == s.credits && after.buyback == s.buyback && after.fee.network == s.fee.network
  requires forall h :: h in after.fee.holdings ==> h.token > 0 && h.token <= |after.fee.holdings| && fees__conversion_holding(after.fee, h.token).token == h.token && fees__conversion_holding(after.fee, h.token).asset == h.asset
  requires forall t :: fees__conversion_holding(after.fee, t).asset == fees__conversion_holding(s.fee, t).asset
  requires forall o :: o in s.outputs ==> o in after.outputs && outputRow(after, o.row) == outputRow(s, o.row)
  requires forall e :: e in s.entries ==> e in after.entries
  requires forall k :: k in s.kept ==> k in after.kept
  ensures alwaysIncomeBackedByReceiptOrConversion(after)
{
  hide *;
  reveal alwaysIncomeBackedByReceiptOrConversion, backed, usdcClaimRow;
}

lemma SameFeeMetaKeepsInv(s: FeeFlow, after: FeeFlow)
  requires inv(s)
  requires after.fee.receipts == s.fee.receipts && after.fee.rows == s.fee.rows && after.fee.clock == s.fee.clock && after.fee.network == s.fee.network
  requires after.entries == s.entries && after.outputs == s.outputs && after.kept == s.kept && after.credits == s.credits && after.buyback == s.buyback
  requires forall h :: h in after.fee.holdings ==> h.token > 0 && h.token <= |after.fee.holdings| && fees__conversion_holding(after.fee, h.token).token == h.token && fees__conversion_holding(after.fee, h.token).asset == h.asset
  requires forall t :: fees__conversion_holding(after.fee, t).asset == fees__conversion_holding(s.fee, t).asset
  ensures inv(after)
{
  hide *;
  reveal inv, alwaysEveryReceiptHasSource, alwaysOutputsOnce, alwaysKeptFeesProvenOnce,
    alwaysNoReceiptCountedTwice, alwaysIncomeBackedByReceiptOrConversion,
    backed, usdcClaimRow, outputRow;
}

lemma OutputForMember(xs: seq<Output>, id: int)
  ensures var r := Std.Collections.Seq.FoldLeft((found: Output, o: Output) => (if (o.row == id) then o else found), Output(0, 0, 0), xs);
    r.row > 0 ==> r in xs && r.row == id
  decreases |xs|
{
  var f := (found: Output, o: Output) => (if (o.row == id) then o else found);
  var z := Output(0, 0, 0);
  if |xs| > 0 {
    var init := xs[..|xs| - 1];
    var last := xs[|xs| - 1];
    assert xs == init + [last];
    OutputForMember(init, id);
    ProofLib.FoldLeftAppend(f, z, init, last);
  }
}

lemma EntryForMember(xs: seq<FeeEntry>, feeReceipt: int)
  ensures var r := Std.Collections.Seq.FoldLeft((found: FeeEntry, e: FeeEntry) => (if (e.receipt == feeReceipt) then e else found), FeeEntry(typed0_fees__composition(FeeSource.PayoutFee), 0, 0, false, 0, 0, 0), xs);
    r.receipt > 0 ==> r in xs && r.receipt == feeReceipt
  decreases |xs|
{
  var f := (found: FeeEntry, e: FeeEntry) => (if (e.receipt == feeReceipt) then e else found);
  var z := FeeEntry(typed0_fees__composition(FeeSource.PayoutFee), 0, 0, false, 0, 0, 0);
  if |xs| > 0 {
    var init := xs[..|xs| - 1];
    var last := xs[|xs| - 1];
    assert xs == init + [last];
    EntryForMember(init, feeReceipt);
    ProofLib.FoldLeftAppend(f, z, init, last);
  }
}

lemma KeptForMember(xs: seq<KeptFee>, deposit: int)
  ensures var r := Std.Collections.Seq.FoldLeft((found: KeptFee, k: KeptFee) => (if (k.deposit == deposit) then k else found), KeptFee(0, 0, 0, false, false, false, false, 0), xs);
    r.deposit > 0 ==> r in xs && r.deposit == deposit
  decreases |xs|
{
  var f := (found: KeptFee, k: KeptFee) => (if (k.deposit == deposit) then k else found);
  var z := KeptFee(0, 0, 0, false, false, false, false, 0);
  if |xs| > 0 {
    var init := xs[..|xs| - 1];
    var last := xs[|xs| - 1];
    assert xs == init + [last];
    KeptForMember(init, deposit);
    ProofLib.FoldLeftAppend(f, z, init, last);
  }
}

lemma EqualAmountSelf(a: seq<int>)
  ensures settlement__money_equalAmounts(a, a)
{
  settlement__money_lawEqualReflexive_ensures(a);
}

lemma CreditAppendKeepsInv(s: FeeFlow, key: fees__buyback_IncomeKey, amt: seq<int>, chainTime: int)
  requires inv(s)
  requires s.fee.network == s.buyback.source && key.network == s.fee.network && !credited(s, key)
  requires fees__buyback_canRecordIncome(s.buyback, key, amt, chainTime, fees__runtime_Sender.Worker)
  requires backed(s, Credit(key, amt))
  requires key.kind.UsdcClaim? ==> !(exists c :: c in s.credits && c.key.kind.ConversionOutput? && c.key.id == key.id)
  requires key.kind.ConversionOutput? ==> !(exists c :: c in s.credits && c.key.kind.UsdcClaim? && c.key.id == key.id)
  ensures inv(s.(buyback := fees__buyback_recordIncome(s.buyback, key, amt, chainTime, fees__runtime_Sender.Worker), credits := s.credits + [Credit(key, amt)]))
{
  hide *;
  reveal inv, credited, alwaysEveryReceiptHasSource, alwaysOutputsOnce, alwaysKeptFeesProvenOnce,
    alwaysIncomeBackedByReceiptOrConversion, backed, usdcClaimRow, outputRow,
    receiptKeyed, rowKeyed, depositKeyed, fees__buyback_recordIncome;
  var added := Credit(key, amt);
  var after := s.(buyback := fees__buyback_recordIncome(s.buyback, key, amt, chainTime, fees__runtime_Sender.Worker), credits := s.credits + [added]);
  var sumStep := (total: settlement__money_Amount, c: Credit) => settlement__money_addAmounts(total, c.amount);
  ProofLib.FoldLeftAppend(sumStep, settlement__money_zero, s.credits, added);
  assert after.buyback.income == Std.Collections.Seq.FoldLeft(sumStep, settlement__money_zero, after.credits);
  assert after.buyback.sources == s.buyback.sources + [key];
  assert alwaysIncomeBackedByReceiptOrConversion(after);
  CreditsUniqueMeaning(s);
  forall c | c in after.credits
    ensures |ProofLib.Filter((x: Credit) => (x.key == c.key), after.credits)| == 1
    ensures receiptKeyed(c) ==> |ProofLib.Filter((x: Credit) => (receiptKeyed(x) && (x.key.id == c.key.id)), after.credits)| == 1
    ensures rowKeyed(c) ==> |ProofLib.Filter((x: Credit) => (rowKeyed(x) && (x.key.id == c.key.id)), after.credits)| == 1
    ensures depositKeyed(c) ==> |ProofLib.Filter((x: Credit) => (depositKeyed(x) && (x.key.id == c.key.id)), after.credits)| == 1
  {
    var pKey := (x: Credit) => (x.key == c.key);
    ProofLib.FilterAppend(pKey, s.credits, added);
    if c == added {
      ProofLib.FilterNone(pKey, s.credits);
    }
    if receiptKeyed(c) {
      var pRec := (x: Credit) => (receiptKeyed(x) && (x.key.id == c.key.id));
      ProofLib.FilterAppend(pRec, s.credits, added);
      if c == added {
        forall i | 0 <= i < |s.credits|
          ensures !pRec(s.credits[i])
        {
          assert s.credits[i] in s.credits;
          if pRec(s.credits[i]) {
            assert s.credits[i].key == key;
          }
        }
        ProofLib.FilterNone(pRec, s.credits);
      } else if pRec(added) {
        assert c.key == key;
      }
    }
    if rowKeyed(c) {
      var pRow := (x: Credit) => (rowKeyed(x) && (x.key.id == c.key.id));
      ProofLib.FilterAppend(pRow, s.credits, added);
      if c == added {
        forall i | 0 <= i < |s.credits|
          ensures !pRow(s.credits[i])
        {
          assert s.credits[i] in s.credits;
          if pRow(s.credits[i]) {
            assert s.credits[i].key == key;
          }
        }
        ProofLib.FilterNone(pRow, s.credits);
      } else if pRow(added) {
        assert c.key == key;
      }
    }
    if depositKeyed(c) {
      var pDep := (x: Credit) => (depositKeyed(x) && (x.key.id == c.key.id));
      ProofLib.FilterAppend(pDep, s.credits, added);
      if c == added {
        forall i | 0 <= i < |s.credits|
          ensures !pDep(s.credits[i])
        {
          assert s.credits[i] in s.credits;
          if pDep(s.credits[i]) {
            assert s.credits[i].key == key;
          }
        }
        ProofLib.FilterNone(pDep, s.credits);
      } else if pDep(added) {
        assert c.key == key;
      }
    }
  }
  CreditsUniqueMeaning(after);
}

lemma receive_ensures(s: FeeFlow, evidence: SourceEvidence, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canReceive(s, evidence, by_) ==> alwaysEveryReceiptHasSource(receive(s, evidence, by_)))
  ensures (inv(s) ==> canReceive(s, evidence, by_) ==> alwaysOutputsOnce(receive(s, evidence, by_)))
  ensures (inv(s) ==> canReceive(s, evidence, by_) ==> alwaysKeptFeesProvenOnce(receive(s, evidence, by_)))
  ensures (inv(s) ==> canReceive(s, evidence, by_) ==> alwaysNoReceiptCountedTwice(receive(s, evidence, by_)))
  ensures (inv(s) ==> canReceive(s, evidence, by_) ==> alwaysIncomeBackedByReceiptOrConversion(receive(s, evidence, by_)))
{
  hide *;
  reveal inv, canReceive, receive, sourceAdmitted, transferOf,
    alwaysEveryReceiptHasSource, alwaysOutputsOnce, alwaysKeptFeesProvenOnce,
    alwaysNoReceiptCountedTwice, outputRow,
    fees__conversion_canReceiveFee, fees__conversion_receiveFee, fees__conversion_holding;
  if inv(s) && canReceive(s, evidence, by_) {
    var after := receive(s, evidence, by_);
    var h := fees__conversion_holding(s.fee, evidence.token);
    var h2 := h.(balance := h.balance + evidence.amount, feeIncome := h.feeIncome + evidence.amount);
    {
      reveal alwaysIncomeBackedByReceiptOrConversion;
      WithHoldingKeepsAssets(s.fee, evidence.token, h2);
    }
    var g := s.fee.(holdings := fees__conversion_withHolding(evidence.token, h2, s.fee));
    assert after.fee.holdings == g.holdings;
    BackedPreserved(s, after);
    var added := FeeEntry(evidence.source, evidence.receipt, evidence.token, h.asset.TargetStable?, evidence.amount, evidence.chainTime, evidence.caseId);
    assert after.entries == s.entries + [added];
    assert after.fee.receipts == s.fee.receipts + [evidence.receipt];
    ReceiptsUniqueMeaning(s);
    forall e | e in after.entries
      ensures |ProofLib.Filter((x: FeeEntry) => (x.receipt == e.receipt), after.entries)| == 1
    {
      var p := (x: FeeEntry) => (x.receipt == e.receipt);
      ProofLib.FilterAppend(p, s.entries, added);
      if e == added {
        ProofLib.FilterNone(p, s.entries);
      }
    }
    ReceiptsUniqueMeaning(after);
  }
}

lemma recordCash_ensures(s: FeeFlow, bounty: settlement__directBounty_DirectBounty, read: fees__directBountyIncome_JournalRead, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canRecordCash(s, bounty, read, by_) ==> alwaysEveryReceiptHasSource(recordCash(s, bounty, read, by_)))
  ensures (inv(s) ==> canRecordCash(s, bounty, read, by_) ==> alwaysOutputsOnce(recordCash(s, bounty, read, by_)))
  ensures (inv(s) ==> canRecordCash(s, bounty, read, by_) ==> alwaysKeptFeesProvenOnce(recordCash(s, bounty, read, by_)))
  ensures (inv(s) ==> canRecordCash(s, bounty, read, by_) ==> alwaysNoReceiptCountedTwice(recordCash(s, bounty, read, by_)))
  ensures (inv(s) ==> canRecordCash(s, bounty, read, by_) ==> alwaysIncomeBackedByReceiptOrConversion(recordCash(s, bounty, read, by_)))
{
  hide *;
  reveal inv, recordCash, alwaysIncomeBackedByReceiptOrConversion;
  if inv(s) && canRecordCash(s, bounty, read, by_) {
    SameFeeMetaKeepsInv(s, recordCash(s, bounty, read, by_));
  }
}

lemma observeBalance_ensures(s: FeeFlow, token: int, balance: int, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canObserveBalance(s, token, balance, by_) ==> alwaysEveryReceiptHasSource(observeBalance(s, token, balance, by_)))
  ensures (inv(s) ==> canObserveBalance(s, token, balance, by_) ==> alwaysOutputsOnce(observeBalance(s, token, balance, by_)))
  ensures (inv(s) ==> canObserveBalance(s, token, balance, by_) ==> alwaysKeptFeesProvenOnce(observeBalance(s, token, balance, by_)))
  ensures (inv(s) ==> canObserveBalance(s, token, balance, by_) ==> alwaysNoReceiptCountedTwice(observeBalance(s, token, balance, by_)))
  ensures (inv(s) ==> canObserveBalance(s, token, balance, by_) ==> alwaysIncomeBackedByReceiptOrConversion(observeBalance(s, token, balance, by_)))
{
  hide *;
  reveal inv, observeBalance, fees__conversion_observeBalance, alwaysIncomeBackedByReceiptOrConversion;
  if inv(s) && canObserveBalance(s, token, balance, by_) {
    var h := fees__conversion_holding(s.fee, token);
    WithHoldingKeepsAssets(s.fee, token, h.(balance := balance, feeIncome := (if balance > h.balance then h.feeIncome + balance - h.balance else h.feeIncome)));
    SameFeeMetaKeepsInv(s, observeBalance(s, token, balance, by_));
  }
}

lemma accrue_ensures(s: FeeFlow, accrual: fees__conversion_VaultAccrual, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canAccrue(s, accrual, by_) ==> alwaysEveryReceiptHasSource(accrue(s, accrual, by_)))
  ensures (inv(s) ==> canAccrue(s, accrual, by_) ==> alwaysOutputsOnce(accrue(s, accrual, by_)))
  ensures (inv(s) ==> canAccrue(s, accrual, by_) ==> alwaysKeptFeesProvenOnce(accrue(s, accrual, by_)))
  ensures (inv(s) ==> canAccrue(s, accrual, by_) ==> alwaysNoReceiptCountedTwice(accrue(s, accrual, by_)))
  ensures (inv(s) ==> canAccrue(s, accrual, by_) ==> alwaysIncomeBackedByReceiptOrConversion(accrue(s, accrual, by_)))
{
  hide *;
  reveal inv, accrue, fees__conversion_accrue, alwaysIncomeBackedByReceiptOrConversion;
  if inv(s) && canAccrue(s, accrual, by_) {
    var v := fees__conversion_vaultOf(s.fee, accrual.vault);
    var h := fees__conversion_holding(s.fee, v.token);
    WithHoldingKeepsAssets(s.fee, v.token, h.(accrued := accrual.accrued, vaultObserved := accrual.accrued, vault := v.vault));
    SameFeeMetaKeepsInv(s, accrue(s, accrual, by_));
  }
}

lemma claim_ensures(s: FeeFlow, runId: int, vaultClaim: fees__conversion_VaultClaim, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canClaim(s, runId, vaultClaim, by_) ==> alwaysEveryReceiptHasSource(claim(s, runId, vaultClaim, by_)))
  ensures (inv(s) ==> canClaim(s, runId, vaultClaim, by_) ==> alwaysOutputsOnce(claim(s, runId, vaultClaim, by_)))
  ensures (inv(s) ==> canClaim(s, runId, vaultClaim, by_) ==> alwaysKeptFeesProvenOnce(claim(s, runId, vaultClaim, by_)))
  ensures (inv(s) ==> canClaim(s, runId, vaultClaim, by_) ==> alwaysNoReceiptCountedTwice(claim(s, runId, vaultClaim, by_)))
  ensures (inv(s) ==> canClaim(s, runId, vaultClaim, by_) ==> alwaysIncomeBackedByReceiptOrConversion(claim(s, runId, vaultClaim, by_)))
{
  hide *;
  reveal inv, claim, fees__conversion_claim, fees__conversion_noRow, fees__conversion_holding,
    alwaysEveryReceiptHasSource, alwaysOutputsOnce, alwaysKeptFeesProvenOnce,
    alwaysNoReceiptCountedTwice, alwaysIncomeBackedByReceiptOrConversion,
    backed, usdcClaimRow, outputRow;
  if inv(s) && canClaim(s, runId, vaultClaim, by_) {
    var token := fees__conversion_vaultOf(s.fee, vaultClaim.vault).token;
    var h := fees__conversion_holding(s.fee, token);
    WithHoldingKeepsAssets(s.fee, token, h.(accrued := h.accrued - vaultClaim.amount));
    var after := claim(s, runId, vaultClaim, by_);
    forall o | o in s.outputs
      ensures outputRow(after, o.row) == outputRow(s, o.row)
    {
      assert outputRow(s, o.row).id == o.row && o.row > 0;
      assert 0 <= o.row - 1 < |s.fee.rows|;
    }
    forall r | r in after.fee.rows
      ensures r.id > 0 && r.id <= |after.fee.rows| && outputRow(after, r.id) == r
    {
      if r in s.fee.rows {
        assert outputRow(s, r.id) == r;
      }
    }
  }
}

lemma sign_ensures(s: FeeFlow, runId: int, send: fees__conversion_SignedSend, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canSign(s, runId, send, by_) ==> alwaysEveryReceiptHasSource(sign(s, runId, send, by_)))
  ensures (inv(s) ==> canSign(s, runId, send, by_) ==> alwaysOutputsOnce(sign(s, runId, send, by_)))
  ensures (inv(s) ==> canSign(s, runId, send, by_) ==> alwaysKeptFeesProvenOnce(sign(s, runId, send, by_)))
  ensures (inv(s) ==> canSign(s, runId, send, by_) ==> alwaysNoReceiptCountedTwice(sign(s, runId, send, by_)))
  ensures (inv(s) ==> canSign(s, runId, send, by_) ==> alwaysIncomeBackedByReceiptOrConversion(sign(s, runId, send, by_)))
{
  hide *;
  reveal inv, canSign, sign, fees__conversion_canSign, fees__conversion_sign, fees__conversion_noRow,
    fees__conversion_pendingIntent, fees__conversion_holding,
    alwaysEveryReceiptHasSource, alwaysOutputsOnce, alwaysKeptFeesProvenOnce,
    alwaysNoReceiptCountedTwice, outputRow;
  if inv(s) && canSign(s, runId, send, by_) {
    var after := sign(s, runId, send, by_);
    var intent := fees__conversion_pendingIntent(s.fee, runId);
    PendingIntentQuoted(s.fee.rows, runId);
    assert intent in s.fee.rows && intent.state.Quoted?;
    assert outputRow(s, intent.id) == intent;
    forall o | o in s.outputs
      ensures outputRow(after, o.row) == outputRow(s, o.row)
    {
      assert outputRow(s, o.row).id == o.row && o.row > 0 && outputRow(s, o.row).state.Finalized?;
      assert 0 <= o.row - 1 < |s.fee.rows|;
      if s.fee.rows[o.row - 1].id == intent.id {
        assert s.fee.rows[o.row - 1] == outputRow(s, intent.id) == intent;
      }
    }
    forall r | r in after.fee.rows
      ensures r.id > 0 && r.id <= |after.fee.rows| && outputRow(after, r.id) == r
    {
      var i :| 0 <= i < |after.fee.rows| && after.fee.rows[i] == r;
      var orig := s.fee.rows[i];
      assert orig in s.fee.rows && outputRow(s, orig.id) == orig;
      assert s.fee.rows[orig.id - 1] == orig;
      assert after.fee.rows[orig.id - 1] == r;
    }
    assert after.fee.holdings == s.fee.holdings;
    {
      reveal alwaysIncomeBackedByReceiptOrConversion;
      assert forall h :: h in after.fee.holdings ==> h.token > 0 && h.token <= |after.fee.holdings| && fees__conversion_holding(after.fee, h.token).token == h.token && fees__conversion_holding(after.fee, h.token).asset == h.asset;
    }
    BackedPreserved(s, after);
  }
}

lemma PendingIntentQuoted(rows: seq<fees__conversion_Row>, runId: int)
  ensures var r := Std.Collections.Seq.FoldLeft((found: fees__conversion_Row, r: fees__conversion_Row) => (if ((r.state.Quoted? && r.live) && (r.runId == runId)) then r else found), fees__conversion_noRow, rows);
    r.id > 0 ==> r in rows && r.state.Quoted?
  decreases |rows|
{
  var f := (found: fees__conversion_Row, r: fees__conversion_Row) => (if ((r.state.Quoted? && r.live) && (r.runId == runId)) then r else found);
  if |rows| > 0 {
    var init := rows[..|rows| - 1];
    var last := rows[|rows| - 1];
    assert rows == init + [last];
    PendingIntentQuoted(init, runId);
    ProofLib.FoldLeftAppend(f, fees__conversion_noRow, init, last);
  }
}

lemma finalizeSend_ensures(s: FeeFlow, runId: int, id: int, receipt: fees__conversion_SendReceipt, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canFinalizeSend(s, runId, id, receipt, by_) ==> alwaysEveryReceiptHasSource(finalizeSend(s, runId, id, receipt, by_)))
  ensures (inv(s) ==> canFinalizeSend(s, runId, id, receipt, by_) ==> alwaysOutputsOnce(finalizeSend(s, runId, id, receipt, by_)))
  ensures (inv(s) ==> canFinalizeSend(s, runId, id, receipt, by_) ==> alwaysKeptFeesProvenOnce(finalizeSend(s, runId, id, receipt, by_)))
  ensures (inv(s) ==> canFinalizeSend(s, runId, id, receipt, by_) ==> alwaysNoReceiptCountedTwice(finalizeSend(s, runId, id, receipt, by_)))
  ensures (inv(s) ==> canFinalizeSend(s, runId, id, receipt, by_) ==> alwaysIncomeBackedByReceiptOrConversion(finalizeSend(s, runId, id, receipt, by_)))
{
  hide *;
  reveal inv, canFinalizeSend, finalizeSend, fees__conversion_canFinalizeSend, fees__conversion_finalizeSend, fees__conversion_noRow,
    fees__conversion_holding,
    alwaysEveryReceiptHasSource, alwaysOutputsOnce, alwaysKeptFeesProvenOnce,
    alwaysNoReceiptCountedTwice, outputRow;
  if inv(s) && canFinalizeSend(s, runId, id, receipt, by_) {
    var r := if 0 <= id - 1 < |s.fee.rows| then s.fee.rows[id - 1] else fees__conversion_noRow;
    var h := fees__conversion_holding(s.fee, r.token);
    var credited := receipt.succeeded;
    var converted := credited && r.kind.Conversion?;
    var claimed := credited && r.kind.Claim?;
    var h2 := h.(
      balance := (if converted then h.balance - r.amountIn else if claimed then h.balance + receipt.output else h.balance),
      sold := (if converted then h.sold + r.amountIn else h.sold),
      usdcOut := (if converted then h.usdcOut + receipt.output else h.usdcOut),
      feeIncome := (if claimed then h.feeIncome + receipt.output else h.feeIncome),
      claimed := (if claimed then h.claimed + receipt.output else h.claimed),
      accrued := (if r.kind.Claim? && !credited then h.accrued + r.amountIn else h.accrued));
    {
      reveal alwaysIncomeBackedByReceiptOrConversion;
      WithHoldingKeepsAssets(s.fee, r.token, h2);
    }
    var g := s.fee.(holdings := fees__conversion_withHolding(r.token, h2, s.fee));
    var after := finalizeSend(s, runId, id, receipt, by_);
    assert after.fee.holdings == g.holdings;
    forall o | o in s.outputs
      ensures outputRow(after, o.row) == outputRow(s, o.row)
    {
      assert outputRow(s, o.row).id == o.row && o.row > 0 && outputRow(s, o.row).state.Finalized?;
      assert 0 <= o.row - 1 < |s.fee.rows|;
      if o.row == id {
        assert r == s.fee.rows[o.row - 1];
      }
      assert s.fee.rows[o.row - 1].id != id;
    }
    forall x | x in after.fee.rows
      ensures x.id > 0 && x.id <= |after.fee.rows| && outputRow(after, x.id) == x
    {
      var i :| 0 <= i < |after.fee.rows| && after.fee.rows[i] == x;
      var orig := s.fee.rows[i];
      assert orig in s.fee.rows && outputRow(s, orig.id) == orig;
      assert s.fee.rows[orig.id - 1] == orig;
      assert after.fee.rows[orig.id - 1] == x;
    }
    BackedPreserved(s, after);
    var row := outputRow(after, id);
    if (row.kind.Conversion? || row.kind.Claim?) && row.state.Finalized? && row.output > 0 {
      var added := Output(id, row.output, s.fee.clock);
      assert after.outputs == s.outputs + [added];
      OutputsUniqueMeaning(s);
      forall o | o in after.outputs
        ensures |ProofLib.Filter((x: Output) => (x.row == o.row), after.outputs)| == 1
      {
        var p := (x: Output) => (x.row == o.row);
        ProofLib.FilterAppend(p, s.outputs, added);
        if o == added {
          ProofLib.FilterNone(p, s.outputs);
        }
      }
      OutputsUniqueMeaning(after);
    }
  }
}

lemma observeKeptFee_ensures(s: FeeFlow, keptFee: KeptFee, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canObserveKeptFee(s, keptFee, by_) ==> alwaysEveryReceiptHasSource(observeKeptFee(s, keptFee, by_)))
  ensures (inv(s) ==> canObserveKeptFee(s, keptFee, by_) ==> alwaysOutputsOnce(observeKeptFee(s, keptFee, by_)))
  ensures (inv(s) ==> canObserveKeptFee(s, keptFee, by_) ==> alwaysKeptFeesProvenOnce(observeKeptFee(s, keptFee, by_)))
  ensures (inv(s) ==> canObserveKeptFee(s, keptFee, by_) ==> alwaysNoReceiptCountedTwice(observeKeptFee(s, keptFee, by_)))
  ensures (inv(s) ==> canObserveKeptFee(s, keptFee, by_) ==> alwaysIncomeBackedByReceiptOrConversion(observeKeptFee(s, keptFee, by_)))
{
  hide *;
  reveal inv, canObserveKeptFee, observeKeptFee, keptProven,
    alwaysEveryReceiptHasSource, alwaysOutputsOnce, alwaysNoReceiptCountedTwice,
    alwaysIncomeBackedByReceiptOrConversion, backed, usdcClaimRow, outputRow;
  if inv(s) && canObserveKeptFee(s, keptFee, by_) {
    var after := observeKeptFee(s, keptFee, by_);
    KeptUniqueMeaning(s);
    forall k | k in after.kept
      ensures |ProofLib.Filter((x: KeptFee) => (x.deposit == k.deposit), after.kept)| == 1
    {
      var p := (x: KeptFee) => (x.deposit == k.deposit);
      ProofLib.FilterAppend(p, s.kept, keptFee);
      if k == keptFee {
        ProofLib.FilterNone(p, s.kept);
      }
    }
    KeptUniqueMeaning(after);
  }
}

lemma creditClaim_ensures(s: FeeFlow, id: int, chainTime: int, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canCreditClaim(s, id, chainTime, by_) ==> alwaysEveryReceiptHasSource(creditClaim(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditClaim(s, id, chainTime, by_) ==> alwaysOutputsOnce(creditClaim(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditClaim(s, id, chainTime, by_) ==> alwaysKeptFeesProvenOnce(creditClaim(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditClaim(s, id, chainTime, by_) ==> alwaysNoReceiptCountedTwice(creditClaim(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditClaim(s, id, chainTime, by_) ==> alwaysIncomeBackedByReceiptOrConversion(creditClaim(s, id, chainTime, by_)))
{
  hide *;
  reveal inv, canCreditClaim, creditClaim, keyOf, outputFor, credited,
    backed, usdcClaimRow, outputRow, alwaysIncomeBackedByReceiptOrConversion,
    fees__buyback_canRecordIncome;
  if inv(s) && canCreditClaim(s, id, chainTime, by_) {
    var o := outputFor(s, id);
    var key := keyOf(fees__buyback_IncomeKind.UsdcClaim, s.fee.network, id);
    var amt := settlement__money_smallAmount(o.output);
    OutputForMember(s.outputs, id);
    EqualAmountSelf(amt);
    CreditAppendKeepsInv(s, key, amt, chainTime);
  }
}

lemma creditConversion_ensures(s: FeeFlow, id: int, chainTime: int, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canCreditConversion(s, id, chainTime, by_) ==> alwaysEveryReceiptHasSource(creditConversion(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditConversion(s, id, chainTime, by_) ==> alwaysOutputsOnce(creditConversion(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditConversion(s, id, chainTime, by_) ==> alwaysKeptFeesProvenOnce(creditConversion(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditConversion(s, id, chainTime, by_) ==> alwaysNoReceiptCountedTwice(creditConversion(s, id, chainTime, by_)))
  ensures (inv(s) ==> canCreditConversion(s, id, chainTime, by_) ==> alwaysIncomeBackedByReceiptOrConversion(creditConversion(s, id, chainTime, by_)))
{
  hide *;
  reveal inv, canCreditConversion, creditConversion, keyOf, outputFor, credited,
    backed, usdcClaimRow, outputRow, alwaysIncomeBackedByReceiptOrConversion,
    fees__buyback_canRecordIncome;
  if inv(s) && canCreditConversion(s, id, chainTime, by_) {
    var o := outputFor(s, id);
    var key := keyOf(fees__buyback_IncomeKind.ConversionOutput, s.fee.network, id);
    var amt := settlement__money_smallAmount(o.output);
    OutputForMember(s.outputs, id);
    EqualAmountSelf(amt);
    CreditAppendKeepsInv(s, key, amt, chainTime);
  }
}

lemma creditDirectFee_ensures(s: FeeFlow, feeReceipt: int, chainTime: int, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canCreditDirectFee(s, feeReceipt, chainTime, by_) ==> alwaysEveryReceiptHasSource(creditDirectFee(s, feeReceipt, chainTime, by_)))
  ensures (inv(s) ==> canCreditDirectFee(s, feeReceipt, chainTime, by_) ==> alwaysOutputsOnce(creditDirectFee(s, feeReceipt, chainTime, by_)))
  ensures (inv(s) ==> canCreditDirectFee(s, feeReceipt, chainTime, by_) ==> alwaysKeptFeesProvenOnce(creditDirectFee(s, feeReceipt, chainTime, by_)))
  ensures (inv(s) ==> canCreditDirectFee(s, feeReceipt, chainTime, by_) ==> alwaysNoReceiptCountedTwice(creditDirectFee(s, feeReceipt, chainTime, by_)))
  ensures (inv(s) ==> canCreditDirectFee(s, feeReceipt, chainTime, by_) ==> alwaysIncomeBackedByReceiptOrConversion(creditDirectFee(s, feeReceipt, chainTime, by_)))
{
  hide *;
  reveal inv, canCreditDirectFee, creditDirectFee, keyOf, entryFor, credited,
    backed, alwaysIncomeBackedByReceiptOrConversion, fees__buyback_canRecordIncome;
  if inv(s) && canCreditDirectFee(s, feeReceipt, chainTime, by_) {
    var e := entryFor(s, feeReceipt);
    var key := keyOf(fees__buyback_IncomeKind.DirectFee, s.fee.network, feeReceipt);
    var amt := settlement__money_smallAmount(e.amount);
    EntryForMember(s.entries, feeReceipt);
    EqualAmountSelf(amt);
    CreditAppendKeepsInv(s, key, amt, chainTime);
  }
}

lemma creditKeptFee_ensures(s: FeeFlow, deposit: int, chainTime: int, by_: fees__runtime_Sender)
  ensures (inv(s) ==> canCreditKeptFee(s, deposit, chainTime, by_) ==> alwaysEveryReceiptHasSource(creditKeptFee(s, deposit, chainTime, by_)))
  ensures (inv(s) ==> canCreditKeptFee(s, deposit, chainTime, by_) ==> alwaysOutputsOnce(creditKeptFee(s, deposit, chainTime, by_)))
  ensures (inv(s) ==> canCreditKeptFee(s, deposit, chainTime, by_) ==> alwaysKeptFeesProvenOnce(creditKeptFee(s, deposit, chainTime, by_)))
  ensures (inv(s) ==> canCreditKeptFee(s, deposit, chainTime, by_) ==> alwaysNoReceiptCountedTwice(creditKeptFee(s, deposit, chainTime, by_)))
  ensures (inv(s) ==> canCreditKeptFee(s, deposit, chainTime, by_) ==> alwaysIncomeBackedByReceiptOrConversion(creditKeptFee(s, deposit, chainTime, by_)))
{
  hide *;
  reveal inv, canCreditKeptFee, creditKeptFee, keyOf, keptFor, credited,
    backed, alwaysKeptFeesProvenOnce, alwaysIncomeBackedByReceiptOrConversion,
    fees__buyback_canRecordIncome;
  if inv(s) && canCreditKeptFee(s, deposit, chainTime, by_) {
    var k := keptFor(s, deposit);
    var key := keyOf(fees__buyback_IncomeKind.KeptSubmissionFee, s.fee.network, deposit);
    var amt := settlement__money_smallAmount(k.amount);
    KeptForMember(s.kept, deposit);
    EqualAmountSelf(amt);
    CreditAppendKeepsInv(s, key, amt, chainTime);
  }
}
