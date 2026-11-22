import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { Logo } from "./Logo.tsx";
import type { SiteFooterProps } from "./SiteFooter.tsx";

export const meta: ComponentMeta<SiteFooterProps> = {
  args: {
    brand: <Logo variant="inverse" size="xl" />,
    children: ["GitHub", "Docs", "X"].map((name) => <a key={name} href={`#${name.toLowerCase()}`}>{name}</a>),
  },
  examples: { Compact: { compact: true, brand: <Logo variant="inverse" size="lg" /> } },
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const links = within(within(canvasElement).getByRole("navigation", { name: "Community" })).getAllByRole("link");
      const reached: (Element | null)[] = [];
      for (const back of [false, false, false, true]) {
        await userEvent.tab({ shift: back });
        reached.push(document.activeElement);
      }
      await expect(reached).toEqual([links[0], links[1], links[2], links[1]]);
    },
  },
};
