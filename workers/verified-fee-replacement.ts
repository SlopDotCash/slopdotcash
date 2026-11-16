/**
 * Same-nonce EVM fee replacement policy shared by the payment keeper and the
 * fee converter (PRD section 11): each step raises both fee fields by about
 * 25%, never by less than the 10% the node requires, and never above three
 * times the original fees or the absolute fee ceiling.
 */

export interface ReplacementFees {
  ok: boolean;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

//@ verify
//@ requires value >= 0 && percent >= 0
//@ ensures \result >= 0
//@ ensures (\result - 1) * 100 < value * percent && value * percent <= \result * 100
function ceilingPercent(value: bigint, percent: bigint): bigint {
  return (value * percent + 99n) / 100n;
}

//@ verify
//@ ensures \result <= left && \result <= right && (\result == left || \result == right)
function lesser(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

/** The next replacement fees, or ok false when a cap prevents a valid step. */
//@ verify
//@ requires originalMax > 0 && originalPriority >= 0 && latestMax > 0 && latestPriority >= 0 && ceiling > 0
//@ ensures \result.ok ==> \result.maxFeePerGas <= originalMax * 3 && \result.maxFeePerGas <= ceiling
//@ ensures \result.ok ==> \result.maxPriorityFeePerGas <= originalPriority * 3
//@ ensures \result.ok ==> \result.maxPriorityFeePerGas <= \result.maxFeePerGas
//@ ensures \result.ok ==> \result.maxFeePerGas * 100 >= latestMax * 110 && \result.maxPriorityFeePerGas * 100 >= latestPriority * 110
//@ ensures \result.ok ==> (\result.maxFeePerGas - 1) * 100 < latestMax * 125 && (\result.maxPriorityFeePerGas - 1) * 100 < latestPriority * 125
//@ ensures !\result.ok ==> \result.maxFeePerGas == 0 && \result.maxPriorityFeePerGas == 0
export function nextReplacementFees(
  originalMax: bigint,
  originalPriority: bigint,
  latestMax: bigint,
  latestPriority: bigint,
  ceiling: bigint,
): ReplacementFees {
  const feeCap = lesser(originalMax * 3n, ceiling);
  const maxFee = lesser(ceilingPercent(latestMax, 125n), feeCap);
  const priority = lesser(
    ceilingPercent(latestPriority, 125n),
    originalPriority * 3n,
  );
  if (
    maxFee < ceilingPercent(latestMax, 110n) ||
    priority < ceilingPercent(latestPriority, 110n) ||
    priority > maxFee
  )
    return { ok: false, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n };
  return { ok: true, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority };
}
