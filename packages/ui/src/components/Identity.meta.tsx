import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { IdentityProps } from "./Identity.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<IdentityProps> = {
  args: { login: "octocat", href: "#contributors/octocat", detail: "Maintainer" },
  examples: { Plain: { href: undefined, detail: undefined } },
  play: {
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Default: async ({ canvasElement }: Context) => {
      await userEvent.tab();
      await expect(document.activeElement).toBe(within(canvasElement).getByRole("link", { name: "octocat" }));
    },
  },
};
