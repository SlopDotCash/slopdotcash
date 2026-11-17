// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
const canonicalUnits = /^(?:0|[1-9][0-9]*)$/u;

/** @throws {never} */
export function formatBaseUnits(value: string, decimals: number): string | undefined {
  if (!canonicalUnits.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(value);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/u, "");
  const whole = (amount / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}
