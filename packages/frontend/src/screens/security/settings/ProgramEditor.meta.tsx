import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { actor, published, unpublished } from "./fixtures.ts";
import type { ProgramEditorProps } from "./ProgramEditor.tsx";

const onPublish = fn(() => Promise.resolve(null));

export const meta: ComponentMeta<ProgramEditorProps> = {
  args: { project: published, actor, onPublish },
  examples: { New: { project: unpublished } },
  play: {
    // spec/security/program.md, "A program revision needs current owner authority and exact split rules"
    Default: async () => {
      onPublish.mockClear();
      await expect(screen.getByLabelText("Published gross award (USDC)")).toHaveValue("10000");
      await expect(screen.getByText("You decide each award: 75% to the researcher, 25% to Slop.", { exact: false })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Review bounty terms" }));
      await expect(await screen.findByText("Review before publishing")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Publish bounty terms" }));
      await expect(onPublish).toHaveBeenCalledTimes(1);
    },
    // spec/security/program.md, "A program revision needs current owner authority and exact split rules"
    New: async () => {
      await expect(screen.getByLabelText("Status")).toHaveValue("paused");
      await expect(screen.queryByText("View public terms")).toBeNull();
    },
  },
};
