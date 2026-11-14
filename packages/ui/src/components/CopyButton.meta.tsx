import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { CopyButtonProps } from "./CopyButton.tsx";

type Context = { args: CopyButtonProps; canvasElement: HTMLElement };
const refused = fn(() => Promise.reject(new Error("Not allowed")));

export const meta: ComponentMeta<CopyButtonProps> = {
  args: { text: "pnpm install" },
  // The browser's refusal, which no type can supply.
  examples: { Refused: { onCopy: refused } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      const canvas = within(canvasElement);
      // spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
      await userEvent.click(canvas.getByRole("button", { name: "Copy" }));
      await expect(args.onCopy).toHaveBeenCalledWith("pnpm install");
      await expect(await canvas.findByText("Copied")).toBe(canvas.getByRole("status"));
      // spec/ui/copy.md, "Success settles back to ready; failure stays until the next attempt"
      await waitFor(() => expect(canvas.getByRole("status").textContent).toBe(""), { timeout: 3000 });
    },
    Refused: async ({ canvasElement }: Context) => {
      refused.mockClear();
      const canvas = within(canvasElement);
      const button = canvas.getByRole("button", { name: "Copy" });
      // spec/ui/copy.md, "Success settles back to ready; failure stays until the next attempt"
      await userEvent.click(button);
      await waitFor(() => expect(canvas.getByRole("status").textContent).toBe("Copy failed. Select and copy the text."));
      button.focus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(refused).toHaveBeenCalledTimes(2));
      await expect(canvas.getByRole("status").textContent).toBe("Copy failed. Select and copy the text.");
    },
  },
};
