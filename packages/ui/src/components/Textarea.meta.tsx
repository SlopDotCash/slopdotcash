import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { TextareaProps } from "./Textarea.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<TextareaProps> = {
  args: { "aria-label": "Reason" },
  examples: { Disabled: { disabled: true } },
  play: {
    // spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
    Default: async ({ canvasElement }: Context) => {
      const box = within(canvasElement).getByRole("textbox", { name: "Reason" });
      await userEvent.tab();
      await expect(document.activeElement).toBe(box);
      await userEvent.keyboard("Duplicate of the earlier report");
      await expect(box).toHaveValue("Duplicate of the earlier report");
    },
    // spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
    Disabled: async ({ canvasElement }: Context) => {
      const box = within(canvasElement).getByRole("textbox", { name: "Reason" });
      await userEvent.tab();
      await expect(document.activeElement).not.toBe(box);
      await expect(box).toBeDisabled();
    },
  },
};
