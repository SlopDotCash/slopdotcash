import { expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { FileFieldProps } from "./FileField.tsx";

const chosen = fn();
const removed = fn();
// One transparent pixel, standing for the caller's object URL of the chosen image.
const pixel = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export const meta: ComponentMeta<FileFieldProps> = {
  args: { "aria-label": "Project logo", accept: "image/*" },
  examples: {
    Choose: { onFiles: chosen },
    Chosen: { file: "logo.png", preview: <img src={pixel} alt="" />, onRemove: removed },
  },
  play: {
    // spec/ui/controls.md, "Story: Act only when an action is available"
    Choose: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      chosen.mockClear();
      const logo = new File(["logo"], "logo.png", { type: "image/png" });
      await userEvent.upload(within(canvasElement).getByLabelText<HTMLInputElement>("Project logo"), logo);
      await expect(chosen.mock.calls).toEqual([[[logo]]]);
    },
    // spec/ui/controls.md, "Story: Act only when an action is available"
    Chosen: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      removed.mockClear();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Remove" }));
      await expect(removed).toHaveBeenCalledOnce();
    },
    // spec/ui/controls.md, "A disabled or busy control refuses activation and stays named"
    Loading: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const input = within(canvasElement).getByLabelText<HTMLInputElement>("Project logo");
      await expect([input.disabled, input.getAttribute("aria-busy"), input.getAttribute("aria-disabled")]).toEqual([false, "true", "true"]);
    },
  },
};
