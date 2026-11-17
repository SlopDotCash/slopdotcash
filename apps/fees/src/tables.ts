import { writes as journalWrites } from "./journal/tables.ts";
import { writes as receiptWrites } from "./receipts/tables.ts";
import { writes as runtimeWrites } from "./runtime/tables.ts";

export const writes = [...runtimeWrites, ...journalWrites, ...receiptWrites] as const;
