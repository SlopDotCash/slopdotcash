import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { EnforcementSummaryProps } from "./EnforcementSummary.tsx";
import { clearEnforcement, decisionEnforcement } from "./fixtures.ts";

export const meta: ComponentMeta<EnforcementSummaryProps> = {
  args: { enforcement: decisionEnforcement, revision: 3, status: "active", listingTier: "community" },
  examples: { Clear: { enforcement: clearEnforcement } },
  play: {
    // spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"
    Default: async () => {
      await expect(screen.getByText(/Confirmed malicious result\./)).toBeTruthy();
      await expect(screen.getByText("Restriction active; revision 3 is still active and community. Delist to pause and retire it.")).toBeTruthy();
      await expect(screen.getByText(/by the signed security vetting service/)).toBeTruthy();
    },
    // spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"
    Clear: async () => {
      await expect(screen.queryByText(/Enforcement history/)).toBeNull();
      await expect(screen.queryByText(/Confirmed malicious result/)).toBeNull();
    },
  },
};
