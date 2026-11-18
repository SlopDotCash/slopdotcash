import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ActionFormProps } from "./ActionForm.tsx";
import { appealCase, awardCase, maintainerCase } from "./fixtures.ts";

const onSend = fn(() => Promise.resolve({ key: "k-1", error: null }));
const refused = fn(() => Promise.resolve({ key: "k-2", error: "This case changed. Reload it and decide again." }));

export const meta: ComponentMeta<ActionFormProps> = {
  args: { action: "request-information", record: maintainerCase, onSend },
  examples: {
    Decide: { action: "decide" },
    Award: { action: "award", record: awardCase },
    AppealDecision: { action: "decide-appeal", record: appealCase },
    Refused: { onSend: refused },
  },
  play: {
    // spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"
    Default: async () => {
      onSend.mockClear();
      await userEvent.type(screen.getByLabelText("What you need"), "A transaction that shows the loss.");
      await userEvent.click(screen.getByRole("button", { name: "Ask for information" }));
      await expect(onSend).toHaveBeenCalledWith({ reason: "A transaction that shows the loss." }, null);
    },
    // spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"
    Decide: async () => {
      await expect(screen.getByLabelText("Root cause key")).toHaveValue("withdrawal-rounding");
      await expect(screen.queryByLabelText("Original case ID")).toBeNull();
    },
    // spec/security/cases.md, "An award commits only under paid terms, eligibility and project clearance"
    Award: async () => {
      await expect(screen.getByLabelText("Gross award (USDC)")).toHaveValue("10000");
      await expect(screen.getByText("75% researcher 7,500 USDC | 25% Slop 2,500 USDC")).toBeTruthy();
    },
    // spec/security/cases.md, "Current technical approvers and triagers request information on the current report version"
    Refused: async () => {
      await userEvent.type(screen.getByLabelText("What you need"), "More detail.");
      await userEvent.click(screen.getByRole("button", { name: "Ask for information" }));
      await expect(await screen.findByText("This case changed. Reload it and decide again.")).toBeTruthy();
    },
  },
};
