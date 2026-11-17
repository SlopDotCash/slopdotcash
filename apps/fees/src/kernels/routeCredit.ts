//@ backend dafny
// spec/fees/conversion.md, "Only finalized fee receipts and claims are fee income; gas top-ups never are"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"

export interface RouteTokenBalance {
  accountIndex: number;
  owner: number;
  mint: number;
  programId: number;
  amount: bigint;
}

export interface RouteTokenChange {
  error: number;
  amount: bigint;
}

//@ pure
export function sameHolding(balance: RouteTokenBalance, wallet: number, mint: number, program: number): boolean {
  return balance.owner === wallet && balance.mint === mint && balance.programId === program;
}

export function balancePosition(balances: readonly RouteTokenBalance[], index: number): number {
  //@ ensures -1 <= \result && \result < balances.length
  //@ ensures (\result == -1) <==> forall(j, 0 <= j && j < balances.length ==> balances[j].accountIndex != index)
  //@ ensures \result >= 0 ==> balances[\result].accountIndex == index && forall(j, 0 <= j && j < \result ==> balances[j].accountIndex != index)
  let i = 0;
  while (i < balances.length) {
    //@ invariant 0 <= i && i <= balances.length
    //@ invariant forall(j, 0 <= j && j < i ==> balances[j].accountIndex != index)
    if (balances[i].accountIndex === index) return i;
    i++;
  }
  return -1;
}

export function routeTokenChange(before: readonly RouteTokenBalance[], after: readonly RouteTokenBalance[], index: number, wallet: number, mint: number, program: number, allowMissingBefore: boolean): RouteTokenChange {
  //@ ensures 0 <= \result.error && \result.error <= 2
  //@ ensures \result.error != 0 ==> \result.amount == 0
  //@ ensures \result.error == 0 ==> exists(p, 0 <= p && p < after.length && after[p].accountIndex == index && forall(j, 0 <= j && j < p ==> after[j].accountIndex != index) && sameHolding(after[p], wallet, mint, program) && (exists(q, 0 <= q && q < before.length && before[q].accountIndex == index && forall(j, 0 <= j && j < q ==> before[j].accountIndex != index) && sameHolding(before[q], wallet, mint, program) && \result.amount == after[p].amount - before[q].amount) || (allowMissingBefore && forall(j, 0 <= j && j < before.length ==> before[j].accountIndex != index) && \result.amount == after[p].amount)))
  const pre = balancePosition(before, index);
  const post = balancePosition(after, index);
  if ((pre >= 0 && !sameHolding(before[pre], wallet, mint, program)) || (post >= 0 && !sameHolding(after[post], wallet, mint, program))) return { error: 1, amount: 0n };
  if (post < 0 || (pre < 0 && !allowMissingBefore)) return { error: 2, amount: 0n };
  return { error: 0, amount: after[post].amount - (pre < 0 ? 0n : before[pre].amount) };
}

export function routeTokenCredit(before: readonly RouteTokenBalance[], after: readonly RouteTokenBalance[], source: number, destination: number, wallet: number, inputMint: number, outputMint: number, inputProgram: number, outputProgram: number, nativeInput: boolean, amountIn: bigint, minimumOut: bigint): RouteTokenChange {
  //@ ensures 0 <= \result.error && \result.error <= 3
  //@ ensures \result.error != 0 ==> \result.amount == 0
  //@ ensures \result.error == 0 ==> \result.amount >= minimumOut
  //@ ensures \result.error == 0 ==> exists(p, 0 <= p && p < after.length && after[p].accountIndex == destination && forall(j, 0 <= j && j < p ==> after[j].accountIndex != destination) && sameHolding(after[p], wallet, outputMint, outputProgram) && (exists(r, 0 <= r && r < before.length && before[r].accountIndex == destination && forall(j, 0 <= j && j < r ==> before[j].accountIndex != destination) && sameHolding(before[r], wallet, outputMint, outputProgram) && \result.amount == after[p].amount - before[r].amount) || (forall(j, 0 <= j && j < before.length ==> before[j].accountIndex != destination) && \result.amount == after[p].amount)))
  //@ ensures \result.error == 0 ==> exists(q, 0 <= q && q < after.length && after[q].accountIndex == source && forall(j, 0 <= j && j < q ==> after[j].accountIndex != source) && sameHolding(after[q], wallet, inputMint, inputProgram) && (exists(r, 0 <= r && r < before.length && before[r].accountIndex == source && forall(j, 0 <= j && j < r ==> before[j].accountIndex != source) && sameHolding(before[r], wallet, inputMint, inputProgram) && ((nativeInput && before[r].amount == after[q].amount) || (!nativeInput && before[r].amount - after[q].amount == amountIn))) || (nativeInput && forall(j, 0 <= j && j < before.length ==> before[j].accountIndex != source) && after[q].amount == 0)))
  const input = routeTokenChange(before, after, source, wallet, inputMint, inputProgram, nativeInput);
  if (input.error !== 0) return input;
  const output = routeTokenChange(before, after, destination, wallet, outputMint, outputProgram, true);
  if (output.error !== 0) return output;
  if (-input.amount !== (nativeInput ? 0n : amountIn) || output.amount < minimumOut) return { error: 3, amount: 0n };
  return output;
}

export function firstDebitedHolding(before: readonly RouteTokenBalance[], after: readonly RouteTokenBalance[], wallet: number, source: number, destination: number): number {
  //@ ensures -1 <= \result && \result < before.length
  //@ ensures \result >= 0 ==> before[\result].owner == wallet && before[\result].accountIndex != source && before[\result].accountIndex != destination
  //@ ensures \result == -1 ==> forall(k, 0 <= k && k < before.length && before[k].owner == wallet && before[k].accountIndex != source && before[k].accountIndex != destination ==> exists(p, 0 <= p && p < after.length && after[p].accountIndex == before[k].accountIndex && sameHolding(after[p], before[k].owner, before[k].mint, before[k].programId) && after[p].amount >= before[k].amount))
  let i = 0;
  while (i < before.length) {
    //@ invariant 0 <= i && i <= before.length
    //@ invariant forall(k, 0 <= k && k < i && before[k].owner == wallet && before[k].accountIndex != source && before[k].accountIndex != destination ==> exists(p, 0 <= p && p < after.length && after[p].accountIndex == before[k].accountIndex && sameHolding(after[p], before[k].owner, before[k].mint, before[k].programId) && after[p].amount >= before[k].amount))
    const pre = before[i];
    if (pre.owner === wallet && pre.accountIndex !== source && pre.accountIndex !== destination) {
      const post = balancePosition(after, pre.accountIndex);
      if (post < 0 || !sameHolding(after[post], pre.owner, pre.mint, pre.programId) || after[post].amount < pre.amount) return i;
    }
    i++;
  }
  return -1;
}
