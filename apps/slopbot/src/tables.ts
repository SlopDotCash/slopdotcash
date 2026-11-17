import { appealWrites } from "./appeals/tables.ts";
import { budgetWrites } from "./budget/tables.ts";
import { closeAttemptWrites } from "./closeAttempt/tables.ts";
import { holdWrites } from "./holds/tables.ts";
import { ingressWrites } from "./ingress/tables.ts";
import { installationWrites } from "./installation/tables.ts";
import { leaseWrites } from "./lease/tables.ts";
import { publishWrites } from "./publish/tables.ts";
import { readinessWrites } from "./readiness/tables.ts";
import { routeWrites } from "./route/tables.ts";
import { spendWrites } from "./spend/tables.ts";
import { historyWrites } from "./value/history/tables.ts";
import { inferenceWrites } from "./value/inference/tables.ts";
import { requestWrites } from "./value/requests/tables.ts";
import { workUnitWrites } from "./value/workUnits/tables.ts";

export const writes = [
  ...ingressWrites,
  ...installationWrites,
  ...leaseWrites,
  ...routeWrites,
  ...spendWrites,
  ...budgetWrites,
  ...readinessWrites,
  ...publishWrites,
  ...closeAttemptWrites,
  ...holdWrites,
  ...appealWrites,
  ...requestWrites,
  ...inferenceWrites,
  ...historyWrites,
  ...workUnitWrites,
] as const;
