import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { IdentityProps } from "./Identity.tsx";

export const meta: ComponentMeta<IdentityProps> = {
  args: { login: "octocat" },
  examples: {
    Linked: { href: "#octocat", detail: "Maintainer" },
    Small: { size: "sm" },
    // The heading of a profile page.
    Profile: { size: "lg", detail: "Joined October 2026" },
  },
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current":
    // the login is the one link, named by the login alone, as the picture beside it is hidden.
    Linked: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await userEvent.tab();
      const link = within(canvasElement).getByRole("link", { name: "octocat" });
      await expect([document.activeElement, link.getAttribute("href")]).toEqual([link, "#octocat"]);
      await userEvent.tab();
      await expect(canvasElement.contains(document.activeElement)).toBe(false);
    },
  },
};
