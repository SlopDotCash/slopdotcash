import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ExemptionHistoryProps } from "./ExemptionHistory.tsx";
import { exemption } from "./fixtures.ts";

export const meta: ComponentMeta<ExemptionHistoryProps> = {
  args: { exemptions: [exemption] },
  examples: {
    Revoked: { exemptions: [{ ...exemption, revokedAt: "2026-11-04T10:00:00.000Z", revokedBy: { githubId: "1", githubLogin: "slop-admin" }, revocationReason: "The owner withdrew approval.", revocationDecisionReference: "owner-call-2" }] },
  },
  play: {
    // spec/security/enforcement.md, "An administrator records an audited exemption only for a current authorized steward"
    Default: async () => {
      await expect(screen.getByText(/Revision 3 · @slop-admin · .* · Active/)).toBeTruthy();
      await expect(screen.getByText("R_kgDOengine")).toBeTruthy();
    },
    // spec/security/enforcement.md, "Revocation is its own audited record and restores ordinary admission"
    Revoked: async () => {
      await expect(screen.getByText(/The owner withdrew approval\. · owner-call-2/)).toBeTruthy();
    },
  },
};
