/**
 * Labels for the maintainer-authored `contribution` fields that generated
 * project skills carry as data (PRD SKL-03). Shared by the admin editor and
 * the owner's setup and update pages.
 */
import {
  CONTRIBUTION_FIELDS,
  type ContributionField,
} from "./project-schema.mjs";

/** The skill rules beside the approved scope, which has its own field. */
export type SkillRuleField = Exclude<ContributionField, "approvedScope">;
export const SKILL_RULE_FIELDS = CONTRIBUTION_FIELDS.filter(
  (field): field is SkillRuleField => field !== "approvedScope",
);

export const CONTRIBUTION_LABELS: Record<
  ContributionField,
  { label: string; hint: string; placeholder?: string }
> = {
  approvedScope: {
    label: "Approved scope",
    hint: "The accepted outcomes. Required.",
  },
  contributionGuide: {
    label: "Contribution guide",
    hint: "How to set up, branch and submit.",
    placeholder: "Empty = CONTRIBUTING.md",
  },
  supportedTasks: {
    label: "Supported tasks",
    hint: "The kinds of work the project wants.",
  },
  requiredTests: {
    label: "Required tests",
    hint: "Commands or workflows that must pass.",
    placeholder: "e.g. bun run verify",
  },
  reviewExpectations: {
    label: "Review expectations",
    hint: "Evidence a pull request must show for review.",
  },
  securityContact: {
    label: "Security contact",
    hint: "Where security reports go privately.",
    placeholder: "Email or Signal address",
  },
  closurePolicy: {
    label: "Closure policy",
    hint: "When maintainers close or decline a pull request.",
  },
  maintainerNotes: {
    label: "Maintainer notes",
    hint: "Anything else contributors should know.",
  },
};
