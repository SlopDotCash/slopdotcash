import { writes as buybackWrites } from "./buyback/tables.ts";
import { writes as journalWrites } from "./journal/tables.ts";
import { writes as receiptWrites } from "./receipts/tables.ts";
import { writes as runtimeWrites } from "./runtime/tables.ts";
import { writes as submissionFeeRateWrites } from "./submissionFee/rateTables.ts";
import { writes as submissionFeeSendWrites } from "./submissionFee/sendTables.ts";
import { writes as submissionFeeWrites } from "./submissionFee/tables.ts";

export const writes = [
  ...runtimeWrites,
  ...journalWrites,
  ...receiptWrites,
  ...buybackWrites,
  ...submissionFeeWrites,
  ...submissionFeeSendWrites,
  ...submissionFeeRateWrites,
] as const;
