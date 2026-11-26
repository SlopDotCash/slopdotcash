import type { ComponentMeta } from "vibestack/stories";
import type { PayoutAmountProps } from "./PayoutAmount.tsx";

export const meta: ComponentMeta<PayoutAmountProps> = {
  args: {
    amount: "122500000",
    decimals: 6,
    symbol: "USDC",
  },
  examples: {
    WithGrossAndFee: { gross: "125 USDC", fee: "2.5 USDC" },
    UnreviewedToken: { symbol: undefined, token: "0x1111000000000000000000000000000000000001" },
  },
};
