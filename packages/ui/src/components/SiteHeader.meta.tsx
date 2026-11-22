import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { Button } from "./Button.tsx";
import { Logo } from "./Logo.tsx";
import { NavTab, NavTabs } from "./NavTabs.tsx";
import type { SiteHeaderProps } from "./SiteHeader.tsx";

export const meta: ComponentMeta<SiteHeaderProps> = {
  args: {
    brand: <a href="#home" aria-label="Slop home"><Logo size="sm" wordmark /></a>,
    nav: (
      <NavTabs label="Main">
        <NavTab href="#projects" current>Projects</NavTab>
        <NavTab href="#rankings">Rankings</NavTab>
      </NavTabs>
    ),
    account: <Button size="sm">Sign in</Button>,
  },
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current":
    // home, the navigation and the account control, in the banner, with the page shown the one current tab.
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const banner = within(within(canvasElement).getByRole("banner"));
      const order = [banner.getByRole("link", { name: "Slop home" }), ...banner.getAllByRole("link", { name: /Projects|Rankings/ }), banner.getByRole("button", { name: "Sign in" })];
      const reached: (Element | null)[] = [];
      for (const back of [false, false, false, false, true]) {
        await userEvent.tab({ shift: back });
        reached.push(document.activeElement);
      }
      await expect(reached).toEqual([...order, order[2]]);
      await expect(order.map((control) => control.getAttribute("aria-current"))).toEqual([null, "page", null, null]);
    },
  },
};
