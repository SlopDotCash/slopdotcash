import { writes as direct } from "./direct/tables.ts";
import { writes as directTransfers } from "./directTransfers/tables.ts";
import { writes as monthly } from "./monthly/tables.ts";
import { writes as payments } from "./payments/tables.ts";
import { writes as referrals } from "./referrals/tables.ts";
import { writes as scan } from "./scan/tables.ts";
import { writes as securityScope } from "./securityScope/tables.ts";
import { writes as vault } from "./vault/tables.ts";

export const writes = [...vault, ...scan, ...payments, ...monthly, ...direct, ...directTransfers, ...securityScope, ...referrals] as const;
