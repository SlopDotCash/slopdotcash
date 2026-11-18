import type { ComponentMeta } from "vibestack/stories";
import type { AwardAmountsProps } from "./AwardAmounts.tsx";

export const meta: ComponentMeta<AwardAmountsProps> = {
  args: { gross: "600 USDC", net: "588 USDC", fee: "12 USDC" },
};
