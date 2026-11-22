import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ProjectCardProps } from "./ProjectCard.tsx";

export const meta: ComponentMeta<ProjectCardProps> = {
  // The link the card becomes, which no type can supply.
  args: {
    children: <a href="#umia" />,
    name: "Umia Protocol",
    description: "Onchain venture funding with milestone escrow.",
    amount: "2,500.00 USDC",
    note: "This month",
  },
  examples: { Monthly: { amount: "$1k", unit: "/mo", note: undefined }, Preview: { children: undefined } },
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current":
    // the whole card is one link, reached once and named by what it shows.
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      const [card, ...others] = canvas.getAllByRole("link");
      await userEvent.tab();
      await expect([document.activeElement, others, card?.getAttribute("href"), canvas.getByRole("link", { name: /^Umia Protocol/ })]).toEqual([card, [], "#umia", card]);
      await userEvent.tab();
      await expect(canvasElement.contains(document.activeElement)).toBe(false);
    },
  },
};
