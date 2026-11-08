/** Exact count of positive bounded parts; no total-size limit is introduced. */
//@ verify
//@ requires total > 0 && width > 0
//@ ensures \result > 0
//@ ensures (\result - 1) * width < total && total <= \result * width
export function partitionCount(total: bigint, width: bigint): bigint {
  return (total - 1n) / width + 1n;
}

/** One contiguous part of the count above, including the positive tail. */
//@ verify
//@ requires total > 0 && width > 0
//@ requires index >= 0 && index < partitionCount(total, width)
//@ ensures \result > 0 && \result <= width
//@ ensures index * width + \result <= total
//@ ensures index < partitionCount(total, width) - 1 ==> \result == width
//@ ensures index == partitionCount(total, width) - 1 ==> (partitionCount(total, width) - 1) * width + \result == total
export function partitionSize(
  total: bigint,
  width: bigint,
  index: bigint,
): bigint {
  const remaining = total - index * width;
  return remaining < width ? remaining : width;
}
