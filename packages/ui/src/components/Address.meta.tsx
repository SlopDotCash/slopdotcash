import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { AddressProps } from "./Address.tsx";

type Context = { args: AddressProps; canvasElement: HTMLElement };
const value = "0x8f3a1c9e2b7d4f6a0c5e8b1d3f7a9c2e4b6d8f0a";
const refused = fn(() => Promise.reject(new Error("Not allowed")));

export const meta: ComponentMeta<AddressProps> = {
  args: { value, label: "Vault address" },
  // The browser's refusal, which no type can supply.
  examples: { Refused: { onCopy: refused } },
  play: {
    // spec/ui/copy.md, "Copying starts from ready and reports the browser's answer": the whole value is copied.
    Default: async ({ args, canvasElement }: Context) => {
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Copy address" }));
      await expect(args.onCopy).toHaveBeenCalledWith(value);
    },
    // spec/ui/copy.md, "Success settles back to ready; failure stays until the next attempt": the whole value stays
    // visible beside the failure, to select by hand.
    Refused: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Copy address" }));
      await waitFor(() => expect(canvas.getByRole("status").textContent).toBe("Copy failed. Select and copy the text."));
      const whole = canvas.getByRole("group", { name: "Vault address" });
      await expect(whole).toBeVisible();
      await expect(whole.textContent).toBe(value);
    },
  },
};
