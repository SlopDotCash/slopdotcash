import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { FeeConversionListProps } from "./FeeConversionList.tsx";
import { feeReport } from "./fixtures.ts";

export const meta: ComponentMeta<FeeConversionListProps> = {
  args: { report: feeReport },
  play: {
    // spec/fees/feeReport.md, "The report shows the latest 100 rows, finalized live totals per token as decimal strings, 24-hour state counts and each network's target"
    Default: async () => {
      await expect(screen.getByText("Not converted")).toBeTruthy();
      await expect(screen.getByText(/to 3,150\.25 USDC$/)).toBeTruthy();
      await expect(screen.getByText("No conversions")).toBeTruthy();
    },
  },
};
