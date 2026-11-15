import type { ComponentMeta } from "vibestack/stories";
import type { TokenAmountProps } from "./TokenAmount.tsx";

export const meta: ComponentMeta<TokenAmountProps> = {
  args: { value: "1,234.567891", symbol: "USDC" },
  examples: {
    "Net of fee": { value: "490.00", gross: "500.00 USDC", fee: "10.00 USDC" },
    "Token address": { value: "250,000", symbol: undefined, token: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
  },
};
