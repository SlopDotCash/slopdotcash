// spec/security/evidence.md, "References, permanent admission and pending uploads are separate"; spec/security/intake.md, "Upload and receipt creation have separate durable states"
import { evidenceTables } from "./evidence/tables.ts";
import { intakeTables } from "./intake/tables.ts";

export const writes = [...evidenceTables, ...intakeTables] as const;
