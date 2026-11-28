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
    Links: { proposal: { ...filled, website: "http://ntwrk.party", x: "@elizaOS" }, shown: (field) => (field === "website" ? "Use an https:// address." : undefined) },
  },
  play: {
    // spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Default: async () => {
      await expect(["automatic-closure", "field-submissionFee", "field-wantedIssues", "field-reportDeposit"].map((id) => document.getElementById(id)?.getAttribute("aria-checked"))).toEqual(["false", "true", "true", "true"]);
      await expect(screen.getByText("Copyright model")).toBeTruthy();
      await expect(screen.getByText("Inbound terms")).toBeTruthy();
    },
    // spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
    Bounty: async () => {
      await expect(["automatic-closure", "field-submissionFee", "field-wantedIssues", "field-reportDeposit"].map((id) => document.getElementById(id)?.getAttribute("aria-checked") ?? null)).toEqual([null, null, null, "true"]);
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    Links: async () => {
      await expect([screen.getByLabelText<HTMLInputElement>("Website (optional)").value, screen.getByLabelText<HTMLInputElement>("X account (optional)").value]).toEqual(["http://ntwrk.party", "@elizaOS"]);
      await expect(screen.getByText("Use an https:// address.")).toBeTruthy();
    },
    // spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
    BranchesLoading: async () => {
      const branch = screen.getByLabelText("Integration branch");
      await expect([branch.hasAttribute("disabled"), branch.textContent]).toEqual([true, "Loading branches…"]);
    },
  },
};
