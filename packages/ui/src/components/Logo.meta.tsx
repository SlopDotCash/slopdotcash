import { expect, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { LogoProps } from "./Logo.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<LogoProps> = {
  args: { domain: "slop.cash" },
  examples: {
    Staging: { domain: "slop.tech", wordmark: true },
    "On orange": { variant: "inverse", size: "lg" },
  },
  play: {
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Default: ({ canvasElement }: Context) => expect(within(canvasElement).getByRole("img", { name: "slop.cash" })).toBeVisible(),
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Staging: ({ canvasElement }: Context) => expect([within(canvasElement).queryByRole("img"), canvasElement.textContent]).toEqual([null, "slop.tech"]),
  },
};
