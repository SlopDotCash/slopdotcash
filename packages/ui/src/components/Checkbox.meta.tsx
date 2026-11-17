import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { CheckboxProps } from "./Checkbox.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<CheckboxProps> = {
  args: { "aria-label": "Close the project automatically when its vault empties" },
  play: {
    // spec/ui/controls.md, "Story: Act only when an action is available"
    Default: async ({ canvasElement }: Context) => {
      const box = within(canvasElement).getByRole("checkbox", { name: "Close the project automatically when its vault empties" });
      await expect(box.getAttribute("aria-checked")).toBe("false");
      await userEvent.tab();
      await expect(document.activeElement).toBe(box);
      await userEvent.keyboard(" ");
      await expect(box.getAttribute("aria-checked")).toBe("true");
    },
  },
};
