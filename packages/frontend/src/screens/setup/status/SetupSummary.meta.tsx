import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { installNeeded, ownerApproved, quarantined, ready, unavailable } from "./fixtures.ts";
import type { SetupSummaryProps } from "./SetupSummary.tsx";

const onCheck = fn();

export const meta: ComponentMeta<SetupSummaryProps> = {
  args: { projectId: "engine", view: { setup: ready, busy: false, error: null }, onCheck },
  examples: {
    InstallSlopbot: { view: { setup: installNeeded, busy: false, error: null } },
    OwnerApprovedExemption: { view: { setup: ownerApproved, busy: false, error: null } },
    AuthorityUnavailable: { view: { setup: unavailable, busy: false, error: null } },
    RequestScan: { view: { setup: quarantined, busy: false, error: null } },
    Checking: { view: { setup: null, busy: true, error: null } },
    Failed: { view: { setup: null, busy: false, error: "Your account changed. Reload the project setup." } },
  },
  play: {
    // spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"
    OwnerApprovedExemption: async () => {
      await expect(screen.getByText("Owner-approved exemption")).toBeTruthy();
      await expect(screen.queryByText("Passed")).toBeNull();
    },
    // spec/ui/status.md, "Setup checks never look ready unless they are"
    AuthorityUnavailable: async () => {
      await expect(screen.getAllByText("Ready")).toHaveLength(2);
      await expect(screen.getByText("Unavailable")).toBeTruthy();
    },
    // spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"
    RequestScan: async () => {
      onCheck.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Request a new scan" }));
      await expect(onCheck).toHaveBeenCalledWith(true);
    },
    // spec/frontend/presentation.md, "Setup readiness shows authority, Slopbot, security and funding separately"
    InstallSlopbot: async () => {
      await expect(screen.getByRole("link", { name: "Install Slopbot" }).getAttribute("href")).toBe(installNeeded.nextAction.href);
      await expect(screen.getByText(/Points only/)).toBeTruthy();
    },
  },
};
