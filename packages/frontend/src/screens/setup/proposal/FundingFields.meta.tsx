import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { FundingFieldsProps } from "./FundingFields.tsx";

const onChange = fn();
const onBounty = fn();
const onPromise = fn();
const choice = { mode: "monthly", network: "base", assetKind: "stablecoin", tokenAddress: "", tokenSymbol: "", monthlyAmount: "1500" } as const;
const noError = () => undefined;

export const meta: ComponentMeta<FundingFieldsProps> = {
  args: { choice, onChange, error: noError, networkFixed: false },
  examples: {
    PointsOnly: { choice: { ...choice, mode: "none" } },
    Compact: { compact: true, onBounty },
    PrivateBounty: { compact: true, onBounty, bounty: true },
    Token: { choice: { ...choice, assetKind: "token" }, error: (field) => (field === "tokenAddress" ? "Enter a 0x address with 40 hex characters." : undefined) },
    VaultNetwork: { networkFixed: true },
    Promised: { promise: { checked: true, onChange: onPromise } },
    PromiseWithoutAmount: { choice: { ...choice, monthlyAmount: "" }, promise: { checked: false, onChange: onPromise } },
  },
  play: {
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Compact: async () => {
      onBounty.mockClear();
      await expect(screen.getAllByRole("radio").map((radio) => radio.parentElement?.textContent)).toEqual(["Points only", "Monthly rewards", "Private bounty", "Base", "Ethereum", "Robinhood Chain", "Solana", "USDC", "ETH", "Another token"]);
      await userEvent.click(screen.getByRole("radio", { name: "Private bounty" }));
      await expect(onBounty).toHaveBeenCalledOnce();
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Promised: async () => {
      onPromise.mockClear();
      await userEvent.click(screen.getByRole("checkbox"));
      await expect(onPromise).toHaveBeenCalledWith(false);
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    PromiseWithoutAmount: async () => {
      await expect(screen.getByRole("checkbox")).toBeDisabled();
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    PrivateBounty: async () => {
      await expect(screen.getByLabelText("Award (USDC)")).toBeTruthy();
    },
  },
};
