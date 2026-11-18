import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { CaseActionsProps } from "./CaseActions.tsx";
import { maintainerCase, reporterCase } from "./fixtures.ts";

export const meta: ComponentMeta<CaseActionsProps> = {
  args: { record: maintainerCase, onSend: fn(() => Promise.resolve({ key: "k-1", error: null })) },
  examples: { Reporter: { record: reporterCase } },
  play: {
    // spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"
    Default: async () => {
      await userEvent.click(screen.getByRole("button", { name: "Decide" }));
      await expect(screen.getByRole("button", { name: "Decide" })).toHaveAttribute("aria-pressed", "true");
      await expect(screen.getByRole("button", { name: "Record decision" })).toBeVisible();
    },
  },
};
