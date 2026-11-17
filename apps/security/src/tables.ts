// spec/security/evidence.md, "References, permanent admission and pending uploads are separate"; spec/security/intake.md, "Upload and receipt creation have separate durable states"; spec/security/admission.md, "An assessment is bound to its queued revision, commit and template"; spec/security/enforcement.md, "Journals only append and lifting a human restriction needs its decision"; spec/security/assessment.md, "Attempts are permanent, version-bound and finish once"
import { admissionTables } from "./admission/tables.ts";
import { assessmentTables } from "./assessment/tables.ts";
import { bountyTables } from "./bounty/tables.ts";
import { caseTables } from "./cases/tables.ts";
import { enforcementTables } from "./enforcement/tables.ts";
import { evidenceTables } from "./evidence/tables.ts";
import { intakeTables } from "./intake/tables.ts";

export const writes = [...evidenceTables, ...intakeTables, ...admissionTables, ...enforcementTables, ...assessmentTables, ...caseTables, ...bountyTables] as const;
