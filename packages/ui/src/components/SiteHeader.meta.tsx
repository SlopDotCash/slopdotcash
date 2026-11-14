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
};
