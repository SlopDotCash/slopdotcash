// spec/security/evidence.md, "References, permanent admission and pending uploads are separate"; spec/security/intake.md, "Upload and receipt creation have separate durable states"; spec/security/admission.md, "An assessment is bound to its queued revision, commit and template"; spec/security/enforcement.md, "Journals only append and lifting a human restriction needs its decision"; spec/security/assessment.md, "Attempts are permanent, version-bound and finish once"; spec/security/routineDecisions.md, "The pass reads only an unappealed undecided report once per case revision and mode"; spec/security/reportDeposit.md, "A deposit is asked only with a new case, at a rate in force, from a reporter who is not exempt"
import { admissionTables } from "./admission/tables.ts";
import { assessmentTables } from "./assessment/tables.ts";
import { bountyTables } from "./bounty/tables.ts";
import { caseTables } from "./cases/tables.ts";
import { depositTables } from "./deposit/tables.ts";
import { enforcementTables } from "./enforcement/tables.ts";
import { evidenceTables } from "./evidence/tables.ts";
import { intakeTables } from "./intake/tables.ts";

const routineTables = ["security_routine_runs", "security_routine_decisions"] as const;

export const writes = [...evidenceTables, ...intakeTables, ...admissionTables, ...enforcementTables, ...assessmentTables, ...caseTables, ...bountyTables, ...routineTables, ...depositTables] as const;
