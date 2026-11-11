/** Pure limits used after each caller validates configuration and evidence. */

//@ verify
//@ ensures \result <==> perTransaction > 0 && perDay >= perTransaction
export function positiveBudgetFits(
  perTransaction: bigint,
  perDay: bigint,
): boolean {
  return perTransaction > 0n && perDay >= perTransaction;
}

//@ verify
//@ ensures \result <==> maximum <= perTransaction && committed <= perDay
export function withinBudget(
  maximum: bigint,
  committed: bigint,
  perTransaction: bigint,
  perDay: bigint,
): boolean {
  return maximum <= perTransaction && committed <= perDay;
}

//@ verify
//@ ensures \result <= 600000
//@ ensures estimatedTokens <= 480000 ==> \result == 120000 + estimatedTokens
//@ ensures estimatedTokens >= 480000 ==> \result == 600000
export function boundedReviewTimeout(estimatedTokens: number): number {
  return Math.min(600_000, 120_000 + estimatedTokens);
}
