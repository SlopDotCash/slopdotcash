import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { SelectProps } from "./Select.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<SelectProps> = {
  args: {
    "aria-label": "Network",
    children: (
      <>
        <option>Base</option>
        <option>Ethereum</option>
        <option>Solana</option>
      </>
    ),
  },
  examples: { Disabled: { disabled: true } },
  play: {
    // spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
    Default: async ({ canvasElement }: Context) => {
      const select = within(canvasElement).getByRole("combobox", { name: "Network" });
      await userEvent.tab();
      await expect(document.activeElement).toBe(select);
      await userEvent.selectOptions(select, "Ethereum");
      await expect(select).toHaveValue("Ethereum");
    },
    // spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
    Disabled: async ({ canvasElement }: Context) => {
      const select = within(canvasElement).getByRole("combobox", { name: "Network" });
      await userEvent.tab();
      await expect(document.activeElement).not.toBe(select);
      await expect(select).toBeDisabled();
    },
  },
};
