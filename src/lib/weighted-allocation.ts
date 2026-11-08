/**
 * Keep the existing identity comparator within each equal-remainder group.
 * The verified allocator recomputes the arithmetic from this ordered input.
 */
import { allocateWeighted, sumAmounts } from "./verified-allocation";
import { weightedShare } from "./verified-money";

export function allocateWeightedRows<T>(
  total: bigint,
  rows: readonly T[],
  weightOf: (row: T) => bigint,
  compareTie: (a: T, b: T) => number,
) {
  const weighted = rows.map((row) => ({ row, weight: weightOf(row) }));
  const denominator = sumAmounts(weighted.map((entry) => entry.weight));
  const groups = new Map<bigint, typeof weighted>();
  for (const entry of weighted) {
    const remainder =
      denominator > 0n
        ? weightedShare(total, entry.weight, denominator).remainder
        : 0n;
    const group = groups.get(remainder);
    if (group) group.push(entry);
    else groups.set(remainder, [entry]);
  }
  const ordered: typeof weighted = [];
  for (const group of groups.values()) {
    if (group.length > 1) group.sort((a, b) => compareTie(a.row, b.row));
    for (const entry of group) ordered.push(entry);
  }
  const allocation = allocateWeighted(
    total,
    ordered.map((entry) => entry.weight),
  );
  return allocation.order.map(({ index, remainder }) => ({
    row: ordered[index].row,
    amount: allocation.amounts[index],
    remainder,
  }));
}
