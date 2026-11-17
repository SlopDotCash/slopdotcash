import { budgetWrites } from "./budget/tables.ts";
import { ingressWrites } from "./ingress/tables.ts";
import { installationWrites } from "./installation/tables.ts";
import { leaseWrites } from "./lease/tables.ts";
import { readinessWrites } from "./readiness/tables.ts";
import { routeWrites } from "./route/tables.ts";
import { spendWrites } from "./spend/tables.ts";

export const writes = [
  ...ingressWrites,
  ...installationWrites,
  ...leaseWrites,
  ...routeWrites,
  ...spendWrites,
  ...budgetWrites,
  ...readinessWrites,
] as const;
