import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { NavTab, type NavTabsProps } from "./NavTabs.tsx";

const focusedAfter = async (keys: ("tab" | "back" | "arrow")[]) => {
  const reached: Element[] = [];
  for (const key of keys) {
    if (key === "arrow") await userEvent.keyboard("{ArrowRight}");
    else await userEvent.tab({ shift: key === "back" });
    if (document.activeElement) reached.push(document.activeElement);
  }
  return reached;
};

export const meta: ComponentMeta<NavTabsProps> = {
  args: {
    label: "Project",
    children: ["Overview", "Rewards", "History"].map((name, index) => (
      <NavTab key={name} href={`#${name.toLowerCase()}`} current={index === 0}>
        {name}
      </NavTab>
    )),
  },
  play: {
    // spec/ui/controls.md, "The keyboard reaches a row of links in the order shown, and one navigation tab at most is current"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const [overview, rewards, history] = within(canvasElement).getAllByRole("link");
      await expect([overview, rewards, history].map((link) => link?.getAttribute("aria-current"))).toEqual(["page", null, null]);
      await expect(await focusedAfter(["tab", "tab", "arrow", "tab", "back"])).toEqual([overview, rewards, rewards, history, rewards]);
    },
  },
};
