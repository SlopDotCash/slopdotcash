import { fn } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { RewardAssetFieldsProps } from "./RewardAssetFields.tsx";

const choice = { network: "solana", assetKind: "stablecoin", tokenAddress: "", tokenSymbol: "" } as const;

export const meta: ComponentMeta<RewardAssetFieldsProps> = {
  args: { choice, onChange: fn(), error: () => undefined, networkFixed: false },
  examples: {
    Token: { choice: { ...choice, assetKind: "token" }, error: (field) => (field === "tokenSymbol" ? "Enter a symbol of 1-16 letters or digits." : undefined) },
    Fixed: { networkFixed: true },
    Compact: { compact: true },
    NetworkRefused: { networkError: "Choose a supported network." },
  },
};
