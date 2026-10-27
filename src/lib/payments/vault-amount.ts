import { decimalBaseUnits } from "../base-units.mjs";

export function parseVaultAmount(value: string, decimals: number): bigint {
  if (
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  )
    throw new Error(
      "Enter a positive amount using digits and a decimal point.",
    );
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`This token supports at most ${decimals} decimal places.`);
  const amount = decimalBaseUnits(whole, fraction, decimals);
  if (amount <= 0n || amount >= 1n << 128n)
    throw new Error("The amount is outside the vault's supported range.");
  return amount;
}
