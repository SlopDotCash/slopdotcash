import { expect, userEvent, waitFor, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { RadioGroupProps } from "./RadioGroup.tsx";

const options = [
  { value: "evm", label: "EVM wallet" },
  { value: "solana", label: "Solana wallet" },
];

export const meta: ComponentMeta<RadioGroupProps> = {
  args: { legend: "Wallet", options },
  play: {
    // Arrow keys choose the next option.
    // spec/ui/controls.md, "Story: Act only when an action is available"
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("radio", { name: "EVM wallet" }));
      // Radix moves focus a moment after the key goes down, and chooses only while it is held.
      await userEvent.keyboard("{ArrowDown>}");
      await waitFor(() => expect(canvas.getByRole("radio", { name: "Solana wallet" }).getAttribute("aria-checked")).toBe("true"));
      await userEvent.keyboard("{/ArrowDown}");
    },
    // spec/ui/controls.md, "An invalid field is described by its error, then its hint"
    Error: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const group = within(canvasElement).getByRole("radiogroup", { name: "Wallet" });
      await expect(group.getAttribute("aria-invalid")).toBe("true");
      await expect(group).toHaveAccessibleDescription("Something went wrong");
    },
  },
};
