import { writes as buybackWrites } from "./buyback/tables.ts";
import { writes as runtimeWrites } from "./runtime/tables.ts";
import { writes as submissionFeeRateWrites } from "./submissionFee/rateTables.ts";
import { writes as submissionFeeSendWrites } from "./submissionFee/sendTables.ts";
import { writes as submissionFeeWrites } from "./submissionFee/tables.ts";

export const writes = [
  ...runtimeWrites,
  "fee_conversions",
  "fee_converter_locks",
  "fee_send_replacements",
  "fee_native_gas",
  "fee_solana_expiry_proofs",
  "fee_solana_expiry_scans",
  "fee_solana_expiry_scan_steps",
  ...buybackWrites,
  ...submissionFeeWrites,
  ...submissionFeeSendWrites,
  ...submissionFeeRateWrites,
] as const;
