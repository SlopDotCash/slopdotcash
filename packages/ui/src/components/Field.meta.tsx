import { expect, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { FieldProps } from "./Field.tsx";
import { Input } from "./Input.tsx";

export const meta: ComponentMeta<FieldProps> = {
  args: { label: "Email", children: <Input type="email" /> },
  examples: { "Error and hint": { error: "Not an email address", hint: "Where receipts go" } },
  play: {
    // spec/ui/controls.md, "An invalid field is described by its error, then its hint"
    "Error and hint": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const input = within(canvasElement).getByRole("textbox", { name: "Email" });
      await expect(input.getAttribute("aria-invalid")).toBe("true");
      await expect(input).toHaveAccessibleDescription("Not an email address Where receipts go");
    },
    // spec/ui/controls.md, "An invalid field is described by its error, then its hint"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const input = within(canvasElement).getByRole("textbox", { name: "Email" });
      await expect([input.getAttribute("aria-invalid"), input.getAttribute("aria-describedby")]).toEqual([null, null]);
    },
  },
};
