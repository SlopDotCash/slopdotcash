//@ backend dafny
// spec/settlement/keeperLifecycle.md, "Native fee liability and nonce become durable with the exact signed bytes"

/** @throws {never} */
export function positiveBudgetFits(perTransaction: bigint, perDay: bigint): boolean {
  //@ ensures \result <==> perTransaction > 0 && perDay >= perTransaction
  return perTransaction > 0n && perDay >= perTransaction;
}

/** @throws {never} */
export function withinBudget(maximum: bigint, committed: bigint, perTransaction: bigint, perDay: bigint): boolean {
  //@ ensures \result <==> maximum <= perTransaction && committed <= perDay
  return maximum <= perTransaction && committed <= perDay;
}

/** @throws {never} */
export function worstCaseNativeCost(gas: bigint, maxFeePerGas: bigint, value: bigint): bigint {
  //@ requires gas >= 0 && maxFeePerGas >= 0 && value >= 0
  //@ ensures \result === gas * maxFeePerGas + value
  //@ ensures \result >= value
  return gas * maxFeePerGas + value;
}

/** @throws {never} */
export function nativeCostWithin(gas: bigint, maxFeePerGas: bigint, value: bigint, limits: bigint[]): boolean {
  //@ ensures \result <==> gas >= 0 && maxFeePerGas >= 0 && value >= 0 && forall(k, 0 <= k && k < limits.length ==> gas * maxFeePerGas + value <= limits[k])
  if (gas < 0n || maxFeePerGas < 0n || value < 0n) return false;
  const cost = gas * maxFeePerGas + value;
  let i = 0;
  while (i < limits.length) {
    //@ invariant 0 <= i && i <= limits.length
    //@ invariant forall(k, 0 <= k && k < i ==> cost <= limits[k])
    if (cost > limits[i]) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function nativeCostCeiling(limit: bigint, envelope: bigint): bigint {
  //@ ensures \result <= limit && \result <= envelope
  //@ ensures \result === limit || \result === envelope
  return limit < envelope ? limit : envelope;
}

/** @throws {never} */
export function executionGasCost(gasUsed: bigint, gasPrice: bigint): bigint {
  //@ requires gasUsed >= 0 && gasPrice >= 0
  //@ ensures \result === gasUsed * gasPrice
  //@ ensures \result >= 0
  return gasUsed * gasPrice;
}

/** @throws {never} */
export function nativeFeeTotal(execution: bigint, blob: bigint, data: bigint, operator: bigint): bigint {
  //@ requires execution >= 0 && blob >= 0 && data >= 0 && operator >= 0
  //@ ensures \result === execution + blob + data + operator
  //@ ensures \result >= execution && \result >= blob && \result >= data && \result >= operator
  return execution + blob + data + operator;
}

/** @throws {never} */
export function normalizedNativeDelta(before: bigint, after: bigint, fee: bigint, payer: boolean): bigint {
  //@ requires before >= 0 && after >= 0 && fee >= 0
  //@ ensures \result + before === after + (payer ? fee : 0)
  return after - before + (payer ? fee : 0n);
}
