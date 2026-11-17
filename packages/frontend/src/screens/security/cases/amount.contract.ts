// spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"
import { vectors } from "../../../kernels/vectors.ts";
import { decimalToMinor } from "./amount.ts";

export const typedAwardsBecomeExactMinorUnits = vectors<readonly [string, number], string | undefined>(
  [
    [["12.5", 6], "12500000"],
    [["1,000", 6], "1000000000"],
    [[" 0.000001 ", 6], "1"],
    [["1", 0], "1"],
    [["9999999999999999.5", 1], "99999999999999995"],
    [["0", 6], undefined],
    [["0.0", 6], undefined],
    [["1.1234567", 6], undefined],
    [["12345678901234567", 6], undefined],
    [["1e6", 6], undefined],
    [["-1", 6], undefined],
    [["", 6], undefined],
  ],
  ([text, decimals]) => decimalToMinor(text, decimals),
);
