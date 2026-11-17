import { expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { Checkbox } from "./Checkbox.tsx";
import { Input } from "./Input.tsx";
import type { LabelProps } from "./Label.tsx";

const checked = fn();

export const meta: ComponentMeta<LabelProps> = {
  // A label names the control it wraps, which no value of `children` derived from its type shows.
  args: { children: <><Checkbox onCheckedChange={checked} />Gift wrap</> },
  examples: { WithInput: { htmlFor: "quantity", children: <>Quantity<Input id="quantity" /></> } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      checked.mockClear();
      const canvas = within(canvasElement);
      const checkbox = canvas.getByRole("checkbox", { name: "Gift wrap" });
      await userEvent.click(canvas.getByText("Gift wrap"));
      await expect(checkbox.getAttribute("aria-checked")).toBe("true");
      checkbox.focus();
      await userEvent.keyboard(" ");
      await expect(checkbox.getAttribute("aria-checked")).toBe("false");
      await expect(checked.mock.calls).toEqual([[true], [false]]);
    },
    WithInput: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByText("Quantity"));
      await userEvent.keyboard("12");
      await expect(canvas.getByRole<HTMLInputElement>("textbox", { name: "Quantity" }).value).toBe("12");
    },
  },
};
