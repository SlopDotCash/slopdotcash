import { writes as access } from "./access/tables.ts";
import { writes as accounts } from "./accounts/store/tables.ts";
import { writes as binding } from "./bindingConsent/tables.ts";
import { writes as projects } from "./projects/tables.ts";
import { writes as referrals } from "./referrals/tables.ts";
import { writes as submissionFee } from "./submissionFee/tables.ts";
import { writes as wallets } from "./wallets/tables.ts";

export const writes = [...accounts, ...projects, ...access, ...wallets, ...binding, ...referrals, ...submissionFee] as const;
