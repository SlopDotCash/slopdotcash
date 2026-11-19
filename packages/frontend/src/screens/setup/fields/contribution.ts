// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
export const skillRuleFields = ["contributionGuide", "supportedTasks", "requiredTests", "reviewExpectations", "securityContact", "closurePolicy", "maintainerNotes"] as const;

export type SkillRuleField = (typeof skillRuleFields)[number];

export type ContributionField = "approvedScope" | SkillRuleField;

export interface ContributionLabel {
  readonly label: string;
  readonly hint: string;
  readonly placeholder?: string;
}

export const contributionLabels: Readonly<Record<ContributionField, ContributionLabel>> = {
  approvedScope: { label: "Approved scope", hint: "The accepted outcomes. Required." },
  contributionGuide: { label: "Contribution guide", hint: "How to set up, branch and submit.", placeholder: "Empty = CONTRIBUTING.md" },
  supportedTasks: { label: "Supported tasks", hint: "The kinds of work the project wants." },
  requiredTests: { label: "Required tests", hint: "Commands or workflows that must pass.", placeholder: "e.g. bun run verify" },
  reviewExpectations: { label: "Review expectations", hint: "Evidence a pull request must show for review." },
  securityContact: { label: "Security contact", hint: "Where security reports go privately.", placeholder: "Email or Signal address" },
  closurePolicy: { label: "Closure policy", hint: "When maintainers close or decline a pull request." },
  maintainerNotes: { label: "Maintainer notes", hint: "Anything else contributors should know." },
};
