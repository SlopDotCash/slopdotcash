// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
import type { ReactNode } from "react";
import type { Proposal, ProposalField } from "../../../flows/projects/proposal.ts";
import { contributionLabels, type SkillRuleField } from "../fields/contribution.ts";
import { ChoiceField, SelectField, TextField } from "../fields/ProjectFields.tsx";
import { ProjectImageField } from "../fields/ProjectImageField.tsx";
import { ClosureConsent } from "./ClosureConsent.tsx";
import { ContributionSettings } from "./ContributionSettings.tsx";

export type ProjectStepProps = {
  proposal: Proposal;
  /** The repository control, shown first. */
  picker: ReactNode;
  branches: ReadonlyArray<string>;
  branchesLoading: boolean;
  extraRuleFields: ReadonlyArray<SkillRuleField>;
  /** Changes when the draft is cleared, so the image control forgets its last refusal. */
  imageKey: number;
  shown: (field: ProposalField) => string | undefined;
  onChange: (field: Exclude<ProposalField, "repository">, value: string) => void;
};

const copyrightModels = [
  ["unknown", "Unknown"],
  ["mixed", "Mixed"],
  ["contributor-retained", "Contributor retained"],
  ["sponsor-owned", "Sponsor owned"],
] as const;

const inboundModes = [
  ["unknown", "Unknown"],
  ["license", "License"],
  ["cla", "CLA"],
  ["assignment", "Assignment"],
  ["dco", "DCO"],
  ["mixed", "Mixed"],
] as const;

type TextOf = Readonly<{ field: Exclude<ProposalField, "repository">; label: string; type?: "datetime-local" }>;

const inboundTerms: ReadonlyArray<TextOf> = [
  { field: "inboundTermsUrl", label: "Immutable terms URL" },
  { field: "inboundCommit", label: "Terms commit SHA" },
  { field: "inboundDigest", label: "Terms SHA-256" },
  { field: "inboundVersion", label: "Terms version" },
  { field: "inboundAcceptance", label: "Acceptance mechanism" },
];

const assignmentTerms: ReadonlyArray<TextOf> = [
  { field: "assignmentAssignee", label: "Assignment assignee" },
  { field: "assignmentUrl", label: "Signed instrument URL" },
  { field: "assignmentDigest", label: "Instrument SHA-256" },
  { field: "assignmentVersion", label: "Instrument version" },
  { field: "assignmentSignedAt", label: "Signed at", type: "datetime-local" },
];

/** The Project step: repository and branch, the public listing and its links, the skill rules, closure consent, the fee, wanted issues and report deposit, and saved legal terms. */
export function ProjectStep({ proposal: p, picker, branches, branchesLoading, extraRuleFields, imageKey, shown, onChange }: ProjectStepProps) {
  const text = ({ field, label, type }: TextOf) => <TextField key={field} label={label} name={field} type={type} value={p[field]} error={shown(field)} onChange={(value) => onChange(field, value)} />;
  const branchOptions =
    branches.length > 0
      ? [...(branches.includes(p.integrationBranch) ? [] : [["", "Select a branch"] as const]), ...branches.map((branch) => [branch, branch] as const)]
      : [["", branchesLoading ? "Loading branches…" : "Choose a repository"] as const];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 sm:grid-cols-[2fr_1fr]">
        {picker}
        <SelectField
          label="Integration branch"
          name="integrationBranch"
          value={branches.includes(p.integrationBranch) ? p.integrationBranch : ""}
          options={branchOptions}
          disabled={branches.length === 0}
          error={branches.length > 0 ? shown("integrationBranch") : undefined}
          onChange={(value) => onChange("integrationBranch", value)}
        />
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-4">
        <ProjectImageField key={imageKey} ownerLogin={p.stewardLogin} value={p.image} onChange={(value) => onChange("image", value)} />
        {text({ field: "name", label: "Project name" })}
      </div>
      {text({ field: "headline", label: "Short description" })}
      <TextField label="Goal" name="goal" multiline value={p.goal} error={shown("goal")} onChange={(value) => onChange("goal", value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Website (optional)" name="website" type="url" placeholder="https://example.com" value={p.website} error={shown("website")} onChange={(value) => onChange("website", value)} />
        <TextField label="X account (optional)" name="x" placeholder="@handle" value={p.x} error={shown("x")} onChange={(value) => onChange("x", value)} />
      </div>
      <TextField label="Acceptance criteria" name="criteria" multiline value={p.criteria} error={shown("criteria")} onChange={(value) => onChange("criteria", value)} />
      <div className="flex flex-col gap-4">
        {(["requiredTests", ...extraRuleFields] as const).map((field) => (
          <TextField key={field} label={contributionLabels[field].label} name={field} multiline value={p[field]} error={shown(field)} onChange={(value) => onChange(field, value)} />
        ))}
      </div>
      {p.fundingMode === "bounty" ? null : <ClosureConsent value={p.automaticClosure} onChange={(value) => onChange("automaticClosure", value)} />}
      <ContributionSettings bountyOnly={p.fundingMode === "bounty"} value={{ submissionFee: p.submissionFee, wantedIssues: p.wantedIssues, reportDeposit: p.reportDeposit }} onChange={onChange} />
      {p.copyrightModel !== "unknown" || p.inboundMode !== "unknown" ? (
        <section aria-label="Saved legal terms" className="flex flex-col gap-4">
          <ChoiceField label="Copyright model" name="copyrightModel" value={p.copyrightModel} options={copyrightModels} error={shown("copyrightModel")} onChange={(value) => onChange("copyrightModel", value)} />
          {p.copyrightModel === "sponsor-owned" ? text({ field: "legalHolder", label: "Copyright holder" }) : null}
          <ChoiceField label="Inbound terms" name="inboundMode" value={p.inboundMode} options={inboundModes} onChange={(value) => onChange("inboundMode", value)} />
          {p.inboundMode !== "unknown" ? inboundTerms.map(text) : null}
          {p.copyrightModel === "sponsor-owned" || p.inboundMode === "assignment" ? assignmentTerms.map(text) : null}
        </section>
      ) : null}
    </div>
  );
}
