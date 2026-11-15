import type { ComponentMeta } from "vibestack/stories";
import type { StepperProps } from "./Stepper.tsx";

export const meta: ComponentMeta<StepperProps> = {
  args: { steps: ["Project", "Rewards", "Review"], current: 1 },
  examples: { Lifecycle: { current: undefined } },
  bounds: { current: [0, 2] },
};
