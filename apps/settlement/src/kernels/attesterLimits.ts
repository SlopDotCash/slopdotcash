//@ backend dafny
// spec/settlement/signer.md, "Cancellation of an obsolete intent uses the same nonce and an empty zero-value self-transfer"; spec/settlement/keeperLifecycle.md, "Native fee liability and nonce become durable with the exact signed bytes"

export const MAX_FEE_PER_GAS = 10000000000n;
export const MIN_PRIORITY_FEE = 1000000n;
export const CANCELLATION_GAS = 21000n;

export interface SendFees {
  ok: boolean;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** @throws {never} */
export function gasEnvelope(gasCeiling: bigint): bigint {
  //@ requires gasCeiling >= 0
  //@ ensures \result === gasCeiling * 10000000000
  return gasCeiling * MAX_FEE_PER_GAS;
}

/** @throws {never} */
export function gasWithMargin(estimate: bigint): bigint {
  //@ requires estimate >= 0
  //@ ensures \result * 10 <= estimate * 12 && estimate * 12 < (\result + 1) * 10
  return (estimate * 12n) / 10n;
}

/** @throws {never} */
export function gasFits(gas: bigint, gasCeiling: bigint): boolean {
  //@ ensures \result <==> gas >= 0 && gas <= gasCeiling
  return gas >= 0n && gas <= gasCeiling;
}

/** @throws {never} */
//@ pure
export function bumpEighth(value: bigint): bigint {
  //@ requires value >= 0
  //@ ensures \result * 8 >= value * 9 && (\result - 1) * 8 < value * 9
  return (value * 9n + 7n) / 8n;
}

/** @throws {never} */
export function sendFees(baseFee: bigint): SendFees {
  //@ requires baseFee >= 0
  //@ ensures \result.ok <==> baseFee * 2 + 1000000 <= 10000000000
  //@ ensures \result.ok ==> \result.maxPriorityFeePerGas === 1000000 && \result.maxFeePerGas === baseFee * 2 + 1000000
  //@ ensures !\result.ok ==> \result.maxFeePerGas === 0 && \result.maxPriorityFeePerGas === 0
  const maxFee = baseFee * 2n + MIN_PRIORITY_FEE;
  if (maxFee > MAX_FEE_PER_GAS) return { ok: false, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
  return { ok: true, maxFeePerGas: maxFee, maxPriorityFeePerGas: MIN_PRIORITY_FEE };
}

/** @throws {never} */
export function cancellationFees(originalMax: bigint, originalPriority: bigint, baseFee: bigint): SendFees {
  //@ requires originalMax >= 0 && originalPriority >= 0 && baseFee >= 0
  //@ ensures \result.ok ==> \result.maxFeePerGas <= 10000000000 && \result.maxPriorityFeePerGas <= \result.maxFeePerGas
  //@ ensures \result.ok ==> \result.maxPriorityFeePerGas >= 1000000 && \result.maxPriorityFeePerGas >= bumpEighth(originalPriority)
  //@ ensures \result.ok ==> \result.maxFeePerGas >= bumpEighth(originalMax) && \result.maxFeePerGas >= baseFee * 2 + \result.maxPriorityFeePerGas
  //@ ensures !\result.ok ==> \result.maxFeePerGas === 0 && \result.maxPriorityFeePerGas === 0
  const bumpedPriority = bumpEighth(originalPriority);
  const priority = bumpedPriority > MIN_PRIORITY_FEE ? bumpedPriority : MIN_PRIORITY_FEE;
  const quote = baseFee * 2n + priority;
  const bumpedMax = bumpEighth(originalMax);
  const maxFee = quote > bumpedMax ? quote : bumpedMax;
  if (maxFee > MAX_FEE_PER_GAS || priority > maxFee) return { ok: false, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
  return { ok: true, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority };
}
