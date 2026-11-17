import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { RemoveProjectProps } from "./RemoveProject.tsx";

const remove = fn(async () => false);

export const meta: ComponentMeta<RemoveProjectProps> = {
  args: { name: "engine", disabled: false, remove, reason: "The project changed. Reload it before removing." },
  examples: { Publishing: { disabled: true } },
  play: {
    // spec/ui/confirmation.md, "Only an explicit confirm starts the work"
    Default: async () => {
      remove.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Remove project" }));
      await expect(screen.getByRole("alertdialog", { name: "Remove engine from Slop?" })).toBeTruthy();
      await expect(remove).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Keep project" }));
      await expect(remove).not.toHaveBeenCalled();
    },
    // spec/backend/projects.md, "A current maintainer removes a project and a lost reply can be retried"
    Publishing: async () => {
      remove.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Remove project" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      await expect(remove).not.toHaveBeenCalled();
    },
  },
};
