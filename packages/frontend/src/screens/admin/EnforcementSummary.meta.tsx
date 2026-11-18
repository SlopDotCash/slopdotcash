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
      await expect(screen.getByText("Confirmed malicious")).toBeTruthy();
      await expect(screen.getByTitle("Revision 3 is still active, community. Delist to retire it.")).toBeTruthy();
      await expect(screen.getByText("Scanner")).toBeTruthy();
    },
    // spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"
    Clear: async () => {
      await expect(screen.queryByText("History")).toBeNull();
      await expect(screen.queryByText("Confirmed malicious")).toBeNull();
    },
  },
};
