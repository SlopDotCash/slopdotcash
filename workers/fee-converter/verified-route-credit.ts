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

/** Locate the exact account index in validated, unique balance records. */
//@ verify
//@ ensures -1 <= \result && \result < balances.length
//@ ensures \result == FirstBalance(balances, index)
//@ ensures (\result == -1) <==> forall(j, 0 <= j && j < balances.length ==> balances[j].accountIndex != index)
//@ ensures \result >= 0 ==> balances[\result].accountIndex == index && forall(j, 0 <= j && j < \result ==> balances[j].accountIndex != index)
export function balancePosition(
  balances: readonly RouteTokenBalance[],
  index: number,
): number {
  let i = 0;
  while (i < balances.length) {
    //@ invariant 0 <= i && i <= balances.length
    //@ invariant FirstBalance(balances, index) == BalanceFrom(balances, index, i)
    if (balances[i].accountIndex === index) return i;
    i++;
  }
  return -1;
}

/** Bind both observations before accepting a token account delta. */
//@ verify
//@ ensures \result == TokenChange(before, after, index, wallet, mint, program, allowMissingBefore)
//@ ensures 0 <= \result.error && \result.error <= 2
//@ ensures (\result.error == 0) <==> CompleteTokenAccount(before, after, index, wallet, mint, program, allowMissingBefore)
//@ ensures \result.error == 0 ==> \result.amount == AccountDelta(before, after, index)
export function routeTokenChange(
  before: readonly RouteTokenBalance[],
  after: readonly RouteTokenBalance[],
  index: number,
  wallet: number,
  mint: number,
  program: number,
  allowMissingBefore: boolean,
): RouteTokenChange {
  const pre = balancePosition(before, index);
  const post = balancePosition(after, index);
  if (
    (pre >= 0 &&
      (before[pre].owner !== wallet ||
        before[pre].mint !== mint ||
        before[pre].programId !== program)) ||
    (post >= 0 &&
      (after[post].owner !== wallet ||
        after[post].mint !== mint ||
        after[post].programId !== program))
  )
    return { error: 1, amount: 0n };
  if (post < 0 || (pre < 0 && !allowMissingBefore))
    return { error: 2, amount: 0n };
  return {
    error: 0,
    amount: after[post].amount - (pre < 0 ? 0n : before[pre].amount),
  };
}

/** Preserve source, destination, then exact-debit/minimum-credit refusal order. */
//@ verify
//@ ensures \result == TokenCredit(before, after, source, destination, wallet, inputMint, outputMint, inputProgram, outputProgram, nativeInput, amountIn, minimumOut)
//@ ensures 0 <= \result.error && \result.error <= 3
//@ ensures (\result.error == 0) <==> CompleteTokenExchange(before, after, source, destination, wallet, inputMint, outputMint, inputProgram, outputProgram, nativeInput, amountIn, minimumOut)
//@ ensures \result.error == 0 ==> \result.amount == AccountDelta(before, after, destination) && \result.amount >= minimumOut
export function routeTokenCredit(
  before: readonly RouteTokenBalance[],
  after: readonly RouteTokenBalance[],
  source: number,
  destination: number,
  wallet: number,
  inputMint: number,
  outputMint: number,
  inputProgram: number,
  outputProgram: number,
  nativeInput: boolean,
  amountIn: bigint,
  minimumOut: bigint,
): RouteTokenChange {
  const input = routeTokenChange(
    before,
    after,
    source,
    wallet,
    inputMint,
    inputProgram,
    nativeInput,
  );
  if (input.error !== 0) return input;
  const output = routeTokenChange(
    before,
    after,
    destination,
    wallet,
    outputMint,
    outputProgram,
    true,
  );
  if (output.error !== 0) return output;
  if (
    -input.amount !== (nativeInput ? 0n : amountIn) ||
    output.amount < minimumOut
  )
    return { error: 3, amount: 0n };
  return output;
}

/** First pre-existing unrelated wallet holding that lost identity or value. */
//@ verify
//@ ensures -1 <= \result && \result < before.length
//@ ensures \result == FirstDebitedHolding(before, after, wallet, source, destination)
//@ ensures (\result == -1) <==> forall(j, 0 <= j && j < before.length ==> !DebitedHolding(before[j], after, wallet, source, destination))
//@ ensures \result >= 0 ==> DebitedHolding(before[\result], after, wallet, source, destination) && forall(j, 0 <= j && j < \result ==> !DebitedHolding(before[j], after, wallet, source, destination))
export function firstDebitedHolding(
  before: readonly RouteTokenBalance[],
  after: readonly RouteTokenBalance[],
  wallet: number,
  source: number,
  destination: number,
): number {
  let i = 0;
  while (i < before.length) {
    //@ invariant 0 <= i && i <= before.length
    //@ invariant FirstDebitedHolding(before, after, wallet, source, destination) == DebitedFrom(before, after, wallet, source, destination, i)
    const pre = before[i];
    if (
      pre.owner === wallet &&
      pre.accountIndex !== source &&
      pre.accountIndex !== destination
    ) {
      const post = balancePosition(after, pre.accountIndex);
      if (
        post < 0 ||
        after[post].owner !== pre.owner ||
        after[post].mint !== pre.mint ||
        after[post].programId !== pre.programId ||
        after[post].amount < pre.amount
      )
        return i;
    }
    i++;
  }
  return -1;
}
