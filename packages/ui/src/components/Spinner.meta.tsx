import { expect, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { SpinnerProps } from "./Spinner.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<SpinnerProps> = {
  args: { label: "Loading payouts" },
  play: {
    // spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
    Default: ({ canvasElement }: Context) => expect(within(canvasElement).getByRole("status", { name: "Loading payouts" })).toBeVisible(),
  },
};
