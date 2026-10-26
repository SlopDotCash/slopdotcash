/** Native fees use exact integer wei. D1 counters stay within exact JS integers. */
export interface ReferralGasLimits {
  perTransactionWei: string;
  perDayWei: string;
}
export interface ReferralGasCost {
  maximumWei: string;
  actualWei: string | null;
  settledDay: string | null;
}
export class ReferralGasBudgetError extends Error {}
export function gasInteger(value: string): number {
  if (
    !/^(0|[1-9][0-9]*)$/u.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error(
      "Referral native fee is outside the exact accounting range",
    );
  return Number(value);
}
export function validateGasLimits(limits: ReferralGasLimits) {
  const perTransaction = gasInteger(limits.perTransactionWei);
  const perDay = gasInteger(limits.perDayWei);
  if (perTransaction <= 0 || perDay < perTransaction)
    throw new Error(
      "Referral daily native budget must cover one positive transaction limit",
    );
}
export function validateGasCost(cost: ReferralGasCost) {
  const maximum = gasInteger(cost.maximumWei);
  if (maximum <= 0 || (cost.actualWei === null) !== (cost.settledDay === null))
    throw new Error("Referral native fee evidence is incomplete");
  if (
    cost.actualWei !== null &&
    (gasInteger(cost.actualWei) > maximum ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(cost.settledDay ?? ""))
  )
    throw new Error("Referral native fee exceeds its signed limit");
}
