import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { CompareChangeProps } from "./CompareChange.tsx";

export const meta: ComponentMeta<CompareChangeProps> = {
  args: {
    changes: [
      { label: "Monthly pool", current: "1,000.00 USDC", proposed: "2,500.00 USDC", exact: true },
      { label: "Refund address", current: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", proposed: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", exact: true },
      { label: "Closure", current: "Off", proposed: "On" },
    ],
  },
  play: {
    // spec/ui/controls.md, "An exact value scrolls rather than wraps, and the keyboard reaches it to scroll": each exact
    // value in turn, named current or proposed, and never the prose of Closure.
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const reached: (string | null)[] = [];
      for (let press = 0; press < 5; press++) {
        await userEvent.tab();
        if (canvasElement.contains(document.activeElement)) reached.push(document.activeElement!.textContent);
      }
      await expect(reached).toEqual([
        "Current: 1,000.00 USDC",
        "Proposed: 2,500.00 USDC",
        "Current: 0x8ba1f109551bD432803012645Ac136ddd64DBA72",
        "Proposed: 0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
      ]);
      await expect(within(canvasElement).getByText("On").closest("[tabindex]")).toBeNull();
    },
  },
};
