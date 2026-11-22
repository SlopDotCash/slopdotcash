import type { ComponentMeta } from "vibestack/stories";
import { bounty, pool, prize } from "../home/fixtures.ts";
import type { FundingStatusProps } from "./FundingStatus.tsx";

export const meta: ComponentMeta<FundingStatusProps> = {
  args: { project: pool, networkPays: () => true },
  examples: { PaymentsOff: { networkPays: () => false }, NoVault: { project: bounty }, ExternalPrize: { project: prize } },
};
