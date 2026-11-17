import { expect, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { AvatarProps } from "./Avatar.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<AvatarProps> = {
  args: { name: "octocat" },
  examples: { Named: { decorative: false, size: "lg" } },
  play: {
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Default: ({ canvasElement }: Context) => expect(within(canvasElement).queryByRole("img")).toBeNull(),
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Named: ({ canvasElement }: Context) => expect(within(canvasElement).getByRole("img", { name: "octocat" })).toBeVisible(),
  },
};
