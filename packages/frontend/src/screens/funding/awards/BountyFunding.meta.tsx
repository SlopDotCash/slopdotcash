import type { ComponentMeta } from "vibestack/stories";
import type { BountyFundingProps } from "./BountyFunding.tsx";
import { bountyProject } from "./fixtures.ts";

export const meta: ComponentMeta<BountyFundingProps> = {
  args: { project: bountyProject },
};
