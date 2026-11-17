// spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"

const typedAmount = /^(\d{1,16})(?:\.(\d+))?$/u;

/** A typed decimal award as positive integer minor units, without floats; undefined for anything else. @throws {never} */
export function decimalToMinor(text: string, decimals: number): string | undefined {
  const match = typedAmount.exec(text.replaceAll(",", "").trim());
  if (match === null) return undefined;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return undefined;
  const minor = BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return minor === 0n ? undefined : minor.toString();
}
