import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { DisclosureProps } from "./Disclosure.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<DisclosureProps> = {
  args: { summary: "Earlier payments", children: "October 2026: 490.00 USDC, paid 3 Nov." },
  examples: { Open: { defaultOpen: true } },
  play: {
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Default: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      const trigger = canvas.getByRole("button", { name: "Earlier payments" });
      await expect([trigger.getAttribute("aria-expanded"), canvas.queryByText(/October 2026/)]).toEqual(["false", null]);
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      await expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await expect(canvas.getByText(/October 2026/)).toBeVisible();
    },
  },
};
