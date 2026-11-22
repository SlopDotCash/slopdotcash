import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { readiness } from "./fixtures.ts";
import type { IntakePanelProps } from "./IntakePanel.tsx";

const onCheck = fn();

export const meta: ComponentMeta<IntakePanelProps> = {
  args: { readiness: readiness.ready, project: { id: "slop" }, form: <p>Report form</p>, onCheck },
  examples: { DepositOff: { project: { id: "slop", security: { reportDeposit: false } } }, Checking: { readiness: readiness.checking }, Stale: { readiness: readiness.stale }, Disabled: { readiness: readiness.disabled }, Failed: { readiness: readiness.failed } },
  play: {
    // spec/security/reportingReadiness.md, "Only a fresh, enabled, verified observation is ready"
    Default: async () => {
      await expect(screen.getByText("Report form")).toBeTruthy();
      await expect(screen.getByRole("heading", { name: "Private report" })).toBeTruthy();
    },
    // spec/security/reportingReadiness.md, "Only a fresh, enabled, verified observation is ready"
    Stale: async () => {
      onCheck.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Check again" }));
      await expect(onCheck).toHaveBeenCalled();
    },
    // spec/security/reportingReadiness.md, "Only a fresh, enabled, verified observation is ready"
    Disabled: async () => {
      await expect(screen.queryByText("Report form")).toBeNull();
    },
  },
};
