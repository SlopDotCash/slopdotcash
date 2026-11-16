import { expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { SegmentedControlProps } from "./SegmentedControl.tsx";

const chosen = fn();

export const meta: ComponentMeta<SegmentedControlProps> = {
  args: {
    "aria-label": "Period",
    value: "month",
    options: [
      { value: "month", label: "This month" },
      { value: "all", label: "All time" },
    ],
  },
  examples: { Choose: { onValueChange: chosen } },
  play: {
    // Pressing the chosen segment keeps it; another one is offered.
    // spec/ui/controls.md, "Story: Act only when an action is available"
    Choose: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      chosen.mockClear();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("radio", { name: "This month" }));
      await userEvent.click(canvas.getByRole("radio", { name: "All time" }));
      await expect(chosen.mock.calls).toEqual([["all"]]);
    },
  },
};
