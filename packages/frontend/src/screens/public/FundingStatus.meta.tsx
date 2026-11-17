import type { ComponentMeta } from "vibestack/stories";
import { pool, prize } from "../home/fixtures.ts";
import type { FundingStatusProps } from "./FundingStatus.tsx";

export const meta: ComponentMeta<FundingStatusProps> = {
  args: { project: pool, networkPays: () => true },
  examples: { NotPaying: { networkPays: () => false }, ExternalPrize: { project: prize } },
};
