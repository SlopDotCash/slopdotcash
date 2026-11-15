import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { AddressProps } from "./Address.tsx";

const value = "0x8f3a1c9e2b7d4f6a0c5e8b1d3f7a9c2e4b6d8f0a";

export const meta: ComponentMeta<AddressProps> = {
  args: { value, label: "Vault address" },
  examples: { Preview: { preview: "0x8f3a…8f0a" } },
  play: {
    Preview: async ({ args, canvasElement }: { args: AddressProps; canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      // spec/ui/copy.md, "Copying starts from ready and reports the browser's answer": the whole value is copied, never the preview.
      await userEvent.click(canvas.getByRole("button", { name: "Copy address" }));
      await expect(args.onCopy).toHaveBeenCalledWith(value);
      await userEvent.click(canvas.getByRole("button", { name: "0x8f3a…8f0a" }));
      await expect(canvas.getByRole("group", { name: "Vault address" }).textContent).toBe(value);
    },
  },
};
