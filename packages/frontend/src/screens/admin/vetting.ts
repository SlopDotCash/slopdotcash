// spec/security/enforcement.md, "Each repository clears on its own admission, exemption or retained clean scan"; spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"; spec/security/enforcement.md, "Assessments are queued by setup, owner rescan, administrator investigation or flag recovery"; spec/security/evidence.md, "Successful admission stays permanent and ordinary evidence waits ninety days"
import type { AdminAssessment, AdmissionExemption, OverviewFlag, OverviewProject, ProjectClearance, VettingOverview } from "@repo/security/client";
import type { StatusProps } from "@repo/ui";
import { Result, Schema } from "effect";

type Presentation = StatusProps["presentation"];

export type Overview = typeof VettingOverview.Type;
export type VettedProject = typeof OverviewProject.Type;
export type Assessment = typeof AdminAssessment.Type;
export type Exemption = AdmissionExemption;
export type Flag = OverviewFlag;
export type Clearance = ProjectClearance;

export const AssessmentResult = Schema.Struct({
  environment: Schema.optional(Schema.Struct({ runId: Schema.String })),
  telemetry: Schema.optional(Schema.Struct({ visibilityGaps: Schema.Array(Schema.String), tamperDetected: Schema.Boolean })),
  scan: Schema.optional(Schema.Struct({ runId: Schema.String })),
  reusedAssessmentId: Schema.optional(Schema.NullOr(Schema.String)),
  coverage: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ state: Schema.String, items: Schema.Number }))),
  checks: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  visibilityGaps: Schema.optional(Schema.Array(Schema.String)),
  artifacts: Schema.Array(Schema.Struct({ sha256: Schema.String, path: Schema.String, type: Schema.String, state: Schema.String, analysis: Schema.String })),
  findings: Schema.Array(Schema.Struct({ severity: Schema.String, category: Schema.String, summary: Schema.String })),
  confirmation: Schema.NullOr(Schema.Struct({ basis: Schema.String, rule: Schema.String })),
});

export type AssessmentResult = typeof AssessmentResult.Type;

export type ReadResult = { readonly kind: "none" } | { readonly kind: "unreadable" } | { readonly kind: "read"; readonly result: AssessmentResult };

export interface EvidenceRunLink {
  readonly assessmentId: string;
  readonly runId: string;
}

export interface ProjectVetting {
  readonly project: VettedProject;
  readonly history: ReadonlyArray<Assessment>;
  readonly queued: boolean;
  readonly exemptions: ReadonlyArray<Exemption>;
  readonly activeExemption: Exemption | undefined;
  readonly flags: ReadonlyArray<Flag>;
}

const stateLabels: Readonly<Record<string, string>> = {
  unscanned: "Unscanned",
  unverified: "Unverified",
  stale: "Stale",
  queued: "Queued",
  quarantined: "Quarantined",
  cleared: "Cleared",
  banned: "Banned",
};

const assessmentLabels: Readonly<Record<Assessment["state"], string>> = {
  pending: "Queued",
  incomplete: "Incomplete",
  clean: "Clean",
  malicious: "Confirmed malicious",
};

const admissionBasis = "Admission scan";

const decodeResult = Schema.decodeUnknownResult(AssessmentResult);

/** @throws {never} */
export function clearanceStateLabel(state: string): string {
  return stateLabels[state] ?? state;
}

/** A cleared project reads as what cleared it, so an exemption is never shown as a passed scan. @throws {never} */
export function clearanceLabel(clearance: Clearance | null): string {
  if (clearance === null) return "No vetting record";
  if (clearance.state !== "cleared") return clearanceStateLabel(clearance.state);
  const bases = [...new Set(clearance.repositories.map((repository) => (repository.basis === admissionBasis ? "Admitted" : repository.basis)))];
  return bases.length === 0 ? clearanceStateLabel(clearance.state) : bases.join(" · ");
}

/** Cleared, restricted, or anything short of cleared. @throws {never} */
export function clearanceTone(clearance: Clearance | null): "Positive" | "Negative" | "Caution" {
  const state = clearance?.state ?? "unscanned";
  return state === "cleared" ? "Positive" : state === "banned" || state === "quarantined" ? "Negative" : "Caution";
}

/** Each repository's clearance and what decided it, named where the project lists its repositories. @throws {never} */
export function decidedBy(project: VettedProject): ReadonlyArray<{ readonly repository: string | null; readonly text: string }> {
  return (project.clearance?.repositories ?? []).map((entry) => ({
    repository: project.repositories?.find((repository) => repository.githubId === entry.repositoryId)?.id ?? (project.repositories ? entry.repositoryId : null),
    text: entry.state === "unscanned" ? "Awaiting admission scan" : entry.state === "stale" ? "Head ≠ scanned" : entry.state === "cleared" ? entry.basis : `${clearanceStateLabel(entry.state)} · ${entry.basis}`,
  }));
}

/** A clearance that only exemptions decided is already named by its badge. @throws {never} */
export function decidedByExemption(clearance: Clearance | null): boolean {
  return clearance !== null && clearance.state === "cleared" && clearance.repositories.length > 0 && clearance.repositories.every((entry) => entry.basis !== admissionBasis);
}

/** @throws {never} */
export function assessmentPresentation(state: Assessment["state"]): Presentation {
  const label = assessmentLabels[state];
  if (state === "clean") return { tone: "Positive", icon: "Check", label };
  return { tone: state === "malicious" ? "Negative" : "Caution", icon: state === "pending" ? "Clock" : "Alert", label };
}

/** The recorded result as this page reads it. @throws {never} */
export function resultOf(assessment: Assessment): ReadResult {
  if (assessment.result === null || assessment.result === undefined) return { kind: "none" };
  const decoded = decodeResult(assessment.result);
  return Result.isSuccess(decoded) ? { kind: "read", result: decoded.success } : { kind: "unreadable" };
}

/** Where a result's retained evidence lives; a reused scan points at its original. @throws {never} */
export function evidenceRunOf(assessment: Assessment, result: AssessmentResult): EvidenceRunLink | undefined {
  if (result.scan) return { assessmentId: result.reusedAssessmentId ?? assessment.id, runId: result.scan.runId };
  if (result.environment) return { assessmentId: assessment.id, runId: result.environment.runId };
  return undefined;
}

/** @throws {never} */
export function evidenceHref(run: EvidenceRunLink): string {
  return `/vetting-evidence?assessmentId=${encodeURIComponent(run.assessmentId)}&runId=${encodeURIComponent(run.runId)}`;
}

/** @throws {never} */
export function scanLabel(value: string): string {
  const text = value.replace(/([a-z])([A-Z])/gu, "$1 $2").replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Incomplete surfaces first. @throws {never} */
export function coverageRows(result: AssessmentResult): ReadonlyArray<readonly [string, { readonly state: string; readonly items: number }]> {
  return Object.entries(result.coverage ?? {}).sort((a, b) => Number(a[1].state === "complete") - Number(b[1].state === "complete"));
}

/** Checks that did not pass first. @throws {never} */
export function checkRows(result: AssessmentResult): ReadonlyArray<readonly [string, string]> {
  return Object.entries(result.checks ?? {}).sort((a, b) => Number(a[1] === "passed") - Number(b[1] === "passed"));
}

/** The tampering signal and the visibility gaps a run reported. @throws {never} */
export function visibilityOf(result: AssessmentResult): { readonly tampered: boolean; readonly gaps: ReadonlyArray<string> } {
  return { tampered: result.telemetry?.tamperDetected === true, gaps: result.telemetry?.visibilityGaps ?? result.visibilityGaps ?? [] };
}

/** One project's vetting: its scan history newest first, whether its current revision is queued, its exemptions and active flags. @throws {never} */
export function projectVetting(overview: Overview, projectId: string): ProjectVetting | undefined {
  const project = overview.projects.find((entry) => entry.id === projectId);
  if (project === undefined) return undefined;
  const history = overview.assessments.filter((assessment) => assessment.projectId === projectId);
  const exemptions = overview.exemptions.filter((exemption) => exemption.projectId === projectId);
  return {
    project,
    history,
    queued: history[0]?.state === "pending" && history[0].revision === project.revision,
    exemptions,
    activeExemption: exemptions.find((exemption) => exemption.revokedAt === null),
    flags: overview.flags.filter((flag) => flag.projectId === projectId),
  };
}

/** The current revision's clearance, or why it cannot be shown. @throws {never} */
export function activationClearance(overview: Overview, projectId: string, revision: number): { readonly kind: "ready"; readonly clearance: Clearance | null } | { readonly kind: "message"; readonly text: string } {
  const project = overview.projects.find((entry) => entry.id === projectId);
  return !project || project.revision !== revision ? { kind: "message", text: "Revision changed. Reload the page." } : { kind: "ready", clearance: project.clearance };
}

/** @throws {never} */
export function evidenceStateLabel(state: string): string {
  return state === "stored-unverified" ? "Unverified" : state.replaceAll("-", " ");
}
