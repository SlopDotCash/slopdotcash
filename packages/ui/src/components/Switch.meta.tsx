import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { SwitchProps } from "./Switch.tsx";

const named = (canvasElement: HTMLElement) => within(canvasElement).getByRole<HTMLButtonElement>("switch", { name: "Automatic monthly payment" });

export const meta: ComponentMeta<SwitchProps> = {
  args: { "aria-label": "Automatic monthly payment" },
  play: {
    // spec/ui/controls.md, "Story: Act only when an action is available"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      named(canvasElement).focus();
      await userEvent.keyboard(" ");
      await expect(named(canvasElement).getAttribute("aria-checked")).toBe("true");
    },
    // spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
    Loading: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const control = named(canvasElement);
      await expect([control.disabled, control.getAttribute("aria-busy"), control.getAttribute("aria-disabled"), control.getAttribute("aria-checked")]).toEqual([false, "true", "true", "false"]);
    },
  },
};
