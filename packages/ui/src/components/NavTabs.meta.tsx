import type { ComponentMeta } from "vibestack/stories";
import { NavTab, type NavTabsProps } from "./NavTabs.tsx";

export const meta: ComponentMeta<NavTabsProps> = {
  args: {
    label: "Project",
    children: ["Overview", "Rewards", "History"].map((name, index) => (
      <NavTab key={name} href={`#${name.toLowerCase()}`} current={index === 0}>
        {name}
      </NavTab>
    )),
  },
};
