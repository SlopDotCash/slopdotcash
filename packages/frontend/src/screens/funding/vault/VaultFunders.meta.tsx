import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ProjectDeposits } from "./funding.vibe";
import type { VaultFundersProps } from "./VaultFunders.tsx";

const onRetry = fn();

const deposit = (index: number, githubLogin: string | null): ProjectDeposits["deposits"][number] => ({
  id: `deposit-${index}`,
  projectId: "slop",
  network: "base-mainnet",
  chain: "base",
  vault: "0x00000000000000000000000000000000000000aa",
  depositor: `0x${String(index).repeat(40).slice(0, 40)}`,
  githubLogin,
  amountBase: `${index}000000`,
  assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  assetDecimals: 6,
  transactionId: `0x${String(index).repeat(64).slice(0, 64)}`,
  depositedAt: `2026-11-1${index}T12:00:00.000Z`,
});

const funders: ProjectDeposits = { projectId: "slop", deposits: [1, 2, 3, 4, 5, 6].map((index) => deposit(index, index === 1 ? "fixture-funder" : null)), total: 8, servedAt: "2026-11-20T12:00:00.000Z" };

export const meta: ComponentMeta<VaultFundersProps> = {
  args: { view: "FundersListed", funders, onRetry },
  examples: { Loading: { view: "FundersLoading", funders: undefined }, Empty: { view: "NoFunders", funders: undefined }, Failed: { view: "FundersError", funders: undefined } },
  play: {
    // spec/frontend/projections.md, "Story: Let anyone fund a project from its public page and see who funded"
    Default: async () => {
      await expect(screen.getAllByRole("listitem")).toHaveLength(5);
      await userEvent.click(screen.getByRole("button", { expanded: false }));
      await expect(screen.getAllByRole("listitem")).toHaveLength(6);
    },
    // spec/frontend/projections.md, "Story: Let anyone fund a project from its public page and see who funded"
    Failed: async () => {
      onRetry.mockClear();
      await expect(screen.queryByRole("listitem")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Retry funders" }));
      await expect(onRetry).toHaveBeenCalledTimes(1);
    },
  },
};
