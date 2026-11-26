import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { initialReadyDraft } from "./readyLabel.ts";
import type { ReadyLabelFieldsProps } from "./ReadyLabelFields.tsx";

const onChange = fn();
const saved = { enabled: true, approvals: 2, maxChangedLines: 300, maxChangedFiles: 12, protectedPaths: ["docs/legal/", "*.sql"] };

export const meta: ComponentMeta<ReadyLabelFieldsProps> = {
  args: { value: initialReadyDraft(undefined), shown: () => undefined, onChange },
  examples: {
    On: { value: initialReadyDraft(saved) },
    Refused: { value: { ...initialReadyDraft(saved), readyApprovals: "0" }, shown: (field) => (field === "readyApprovals" ? "Enter a whole number from 1 to 10." : undefined) },
  },
  play: {
    // spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
    Default: async () => {
      onChange.mockClear();
      const box = screen.getByRole("checkbox", { name: "Label pull requests that are ready to merge" });
      await expect([box.getAttribute("aria-checked"), screen.queryByLabelText("Approvals required")]).toEqual(["false", null]);
      await userEvent.click(box);
      await expect(onChange).toHaveBeenCalledWith("readyLabel", "true");
    },
    // spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
    On: async () => {
      await expect([screen.getByLabelText<HTMLInputElement>("Approvals required").value, screen.getByLabelText<HTMLTextAreaElement>("Extra protected paths").value]).toEqual(["2", "docs/legal/\n*.sql"]);
    },
    // spec/backend/readyLabelSettings.md, "Ready-label settings are bounded, off when absent or disabled, and only add protected paths"
    Refused: async () => {
      await expect(screen.getByText("Enter a whole number from 1 to 10.")).toBeTruthy();
    },
  },
};
