import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { RetryProps } from "./parts.tsx";
import { maintainerCase } from "./fixtures.ts";

const onRetry = fn();

export const meta: ComponentMeta<RetryProps> = {
  args: { record: maintainerCase, busy: false, error: null, onRetry },
  examples: {
    Running: { record: { ...maintainerCase, analysis: { state: "running", summary: null, proposedSeverity: null, potentialLoss: null, duplicateCaseIds: [], rootCauseKey: null, remediation: null } } },
    None: { record: { ...maintainerCase, analysis: null, allowedActions: [] } },
  },
  play: {
    // spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"
    Default: async () => {
      await expect(screen.getByText("AI proposal. The report text can try to influence it; you decide.")).toBeTruthy();
      onRetry.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Run the analysis again" }));
      await expect(onRetry).toHaveBeenCalled();
    },
  },
};
