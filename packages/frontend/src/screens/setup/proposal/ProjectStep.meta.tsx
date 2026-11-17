import { expect, fn, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { filled, repositories } from "./fixtures.ts";
import type { ProjectStepProps } from "./ProjectStep.tsx";
import { RepositoryChoice } from "./RepositoryChoice.tsx";

const picker = <RepositoryChoice selected={filled.repository} onChoose={fn()} list={{ status: "ready", repositories }} onRetryList={fn()} />;

export const meta: ComponentMeta<ProjectStepProps> = {
  args: { proposal: filled, picker, branches: ["main", "release"], branchesLoading: false, extraRuleFields: [], imageKey: 0, shown: () => undefined, onChange: fn() },
  examples: {
    BranchesLoading: { branches: [], branchesLoading: true },
    Bounty: { proposal: { ...filled, fundingMode: "bounty" } },
    LegalTerms: { proposal: { ...filled, copyrightModel: "sponsor-owned", inboundMode: "assignment" }, shown: (field) => (field === "legalHolder" ? "Enter 2 to 240 characters." : undefined) },
    RestoredRules: { extraRuleFields: ["contributionGuide", "securityContact"] },
  },
  play: {
    // spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
    Default: async () => {
      await expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    },
    // spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
    Bounty: async () => {
      await expect(screen.queryByRole("checkbox")).toBeNull();
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    BranchesLoading: async () => {
      const branch = screen.getByLabelText("Integration branch");
      await expect([branch.hasAttribute("disabled"), branch.textContent]).toEqual([true, "Loading branches…"]);
    },
  },
};
