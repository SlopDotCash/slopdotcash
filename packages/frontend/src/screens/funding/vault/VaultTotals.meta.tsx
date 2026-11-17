import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { legacySnapshot, staleSnapshot, usdcSnapshot } from "./fixtures.ts";
import type { VaultTotalsProps } from "./VaultTotals.tsx";

export const meta: ComponentMeta<VaultTotalsProps> = {
  args: { snapshot: usdcSnapshot },
  examples: { Stale: { snapshot: staleSnapshot }, NotReported: { snapshot: legacySnapshot } },
  play: {
    // spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"
    Stale: async () => {
      await expect(screen.getByText(/^Stale · read /u)).toBeTruthy();
    },
    // spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"
    NotReported: async () => {
      await expect([screen.getByText("Not reported").textContent, screen.queryByRole("figure")]).toEqual(["Not reported", null]);
    },
  },
};
