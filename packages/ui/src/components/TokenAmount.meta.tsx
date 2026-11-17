import { expect, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { displayTicker } from "../../gen/frontend__presentation.ts";
import type { TokenAmountProps } from "./TokenAmount.tsx";

type Context = { canvasElement: HTMLElement };

const exact = (canvasElement: HTMLElement) => within(canvasElement).getByRole("group", { name: "Exact amount" }).textContent;

export const meta: ComponentMeta<TokenAmountProps> = {
  args: { value: "1,234.567891", symbol: "USDC" },
  examples: {
    "Net of fee": { value: "490.00", gross: "500.00 USDC", fee: "10.00 USDC" },
    "Token address": { value: "250,000", symbol: undefined, token: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
    "Project token": { value: "250,000", symbol: undefined, ticker: displayTicker("ProjectToken", { canonicalSymbol: "$$EPYH", leadingDollars: 2, body: ["E", "P", "Y", "H"] }) },
    "Native coin": { value: "0.125", symbol: undefined, ticker: displayTicker("NativeCoin", { canonicalSymbol: "ETH", leadingDollars: 0, body: ["E", "T", "H"] }) },
    "Unavailable ticker": {
      value: "42",
      symbol: undefined,
      token: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
      ticker: displayTicker("ProjectToken", { canonicalSymbol: "$$", leadingDollars: 1, body: ["$"] }),
    },
  },
  play: {
    // spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
    "Project token": ({ canvasElement }: Context) => expect(exact(canvasElement)).toBe("250,000 $EPYH"),
    // spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
    "Native coin": ({ canvasElement }: Context) => expect(exact(canvasElement)).toBe("0.125 ETH"),
    // spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
    "Unavailable ticker": ({ canvasElement }: Context) => expect(exact(canvasElement)).toBe("42 0x2b591e99afe9f32eaa6214f7b7629768c40eeb39"),
  },
};
