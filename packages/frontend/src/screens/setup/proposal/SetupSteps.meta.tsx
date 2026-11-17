import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { SetupStepsProps } from "./SetupSteps.tsx";

const onChoose = fn();

export const meta: ComponentMeta<SetupStepsProps> = {
  args: { current: 0, onChoose },
  examples: { Rewards: { current: 1 }, Review: { current: 2 } },
  play: {
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Default: async () => {
      onChoose.mockClear();
      const steps = screen.getAllByRole("button");
      await expect([steps.map((step) => step.textContent), steps.map((step) => step.getAttribute("aria-current"))]).toEqual([
        ["1Project", "2Rewards", "3Review"],
        ["step", null, null],
      ]);
      await userEvent.click(screen.getByRole("button", { name: /Review/ }));
      await expect(onChoose).toHaveBeenCalledWith(2);
    },
  },
};
