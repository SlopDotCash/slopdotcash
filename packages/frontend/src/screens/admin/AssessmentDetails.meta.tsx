import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { AssessmentDetailsProps } from "./AssessmentDetails.tsx";
import { assessment } from "./fixtures.ts";

export const meta: ComponentMeta<AssessmentDetailsProps> = {
  args: { assessment },
  examples: { Unreadable: { assessment: { ...assessment, result: { findings: "none" } } } },
  play: {
    // spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"
    Default: async () => {
      await expect(screen.getByText("Incomplete")).toBeTruthy();
      await expect(screen.getByRole("link", { name: /Evidence/ }).getAttribute("href")).toBe("/vetting-evidence?assessmentId=assess-1&runId=run-1");
      await expect(screen.getByText("Credential Theft")).toBeTruthy();
    },
    // spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"
    Unreadable: async () => {
      await expect(screen.getByText("The recorded result could not be read.")).toBeTruthy();
      await expect(screen.queryByRole("link", { name: /Evidence/ })).toBeNull();
    },
  },
};
