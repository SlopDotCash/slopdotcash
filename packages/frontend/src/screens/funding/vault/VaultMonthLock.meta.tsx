import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { lockDeployment, lockProject, pledgedRow, unpledgedRow } from "./fixtures.ts";
import type { VaultMonthLockProps } from "./VaultMonthLock.tsx";

export const meta: ComponentMeta<VaultMonthLockProps> = {
  args: { project: lockProject, deployment: lockDeployment, period: "2026-11", row: pledgedRow, free: 900_000_000n, decimals: 6, wallet: undefined, monthlyMinor: 250_000_000n, onLocked: () => undefined },
  examples: { NoLockedMonths: { row: unpledgedRow, period: "2026-10" } },
  play: {
    // spec/frontend/monthLock.md, "A lapsed month stays locked until any connected wallet sends its release"
    Default: async () => {
      await expect(await screen.findByText(/^September 2026: .*never reserved for payout\. Release it to return it to the vault's free funds\.$/u)).toBeTruthy();
      await expect(screen.getByText(/^December 2099: .*locked until it is paid out\./u)).toBeTruthy();
    },
    // spec/frontend/monthLock.md, "The card appears only once the finalized read shows pledge support"
    NoLockedMonths: async () => {
      await expect(await screen.findByText("No months are locked in this vault.")).toBeTruthy();
    },
  },
};
