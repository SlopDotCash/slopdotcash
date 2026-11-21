import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { DisclosureProps } from "./Disclosure.tsx";

export const meta: ComponentMeta<DisclosureProps> = {
  args: { summary: "Earlier cycles", children: "October 2026: 3 accepted pull requests." },
  examples: { Open: { defaultOpen: true } },
  play: {
    // spec/ui/controls.md, "A disclosure opens and closes from its trigger and never hides what a decision rests on"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const trigger = within(canvasElement).getByRole("button", { name: "Earlier cycles" });
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      await expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await userEvent.keyboard(" ");
      await expect(trigger.getAttribute("aria-expanded")).toBe("false");
    },
  },
};
