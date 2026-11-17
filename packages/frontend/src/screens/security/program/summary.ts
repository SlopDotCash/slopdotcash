// spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"; spec/security/forwarding.md, "Each request uses its own exact row revision and a reporter-only v1 grant"
import type { SubmissionView } from "@repo/security/client";
import { terminalFailureCodes } from "../../../../gen/frontend__drafts.ts";
import { formatDateTime } from "../../../app/format.ts";

export interface CaseSummary {
  readonly id: string;
  readonly advisory: { readonly ghsa: string } | null;
  readonly nextStep: string;
  readonly nextStepDueAt: string | null;
  readonly award: string;
}

const failureLabels: Readonly<Record<string, string>> = {
  "pvr-disabled": "GitHub private vulnerability reporting is off for this repository. Nothing was published.",
  "app-not-installed": "The Slop private intake app is not installed on this repository. Report directly on GitHub instead.",
  forbidden: "GitHub refused the report for your account.",
  invalid: "GitHub rejected the report fields. Fix them and send again.",
  "author-mismatch": "GitHub lists a different author for this advisory, so Slop cannot link it to you.",
  "not-found": "GitHub has no advisory with that ID that your account can see.",
  "grant-expired": "Your GitHub authorization expired. Authorize again.",
  "already-recorded": "This advisory already has a verified private case.",
  "not-private-report": "This advisory is not a live private report you filed. Link it for a maintainer to verify instead.",
  unverifiable: "GitHub has this report, but Slop could not confirm it within 24 hours. Link the advisory for a maintainer to verify instead.",
};

const screeningLabels: Readonly<Record<string, string>> = {
  queued: "Waiting for screening.",
  running: "Screening in progress.",
  legitimate: "Screening complete. Ready for the project owner's review.",
  "needs-information": "More evidence needed before owner review.",
  spam: "Held as spam or unsupported; available for owner review.",
  unavailable: "Screening unavailable; report saved.",
};

/** @throws {RangeError} */
export function utc(value: string | null): string {
  return value === null ? "—" : formatDateTime(value);
}

function terminal(submission: SubmissionView): boolean {
  return terminalFailureCodes.includes(submission.failureCode ?? "");
}

/** Whether the submission may still be sent to GitHub: a draft, or a failure GitHub can still take. @throws {never} */
export function sendable(submission: SubmissionView): boolean {
  return submission.state === "draft" || (submission.state === "failed" && !terminal(submission) && submission.advisory === null);
}

/** @throws {RangeError} */
export function githubSubmissionStatus(submission: SubmissionView, nowMs: number): string {
  switch (submission.state) {
    case "draft":
      return submission.retryAllowed ? "GitHub has no copy. You can send again." : submission.origin === "direct" ? "Ready to verify with GitHub." : "Not sent yet.";
    case "submitting":
      return "Sending to GitHub privately…";
    case "uncertain":
      return submission.reconcileAfter !== null && Date.parse(submission.reconcileAfter) > nowMs
        ? `Not confirmed by GitHub yet. Check again after ${utc(submission.reconcileAfter)}.`
        : "Not confirmed by GitHub. Check again.";
    case "submitted":
      return "Received by GitHub. Confirming…";
    case "receipt-verified":
      return `GitHub receipt · ${utc(submission.githubCreatedAt)}.`;
    case "failed":
      return failureLabels[submission.failureCode ?? ""] ?? "GitHub did not accept the report.";
    case "abandoned":
      return "Expired after 24 hours without a send.";
    default:
      return "GitHub did not accept the report.";
  }
}

/** @throws {RangeError} */
export function submissionStatus(submission: SubmissionView, nowMs: number): string {
  const intake = submission.intake;
  if (intake === null) return githubSubmissionStatus(submission, nowMs);
  if (intake.canForward && intake.routingState === "pending") return "Report cleared for review. The owner notification is pending.";
  if (intake.canForward && intake.reviewedAt !== null) return "A maintainer cleared this report for owner review. No award has been approved by this routing decision.";
  return screeningLabels[intake.state] ?? screeningLabels.unavailable;
}

/** @throws {never} */
export function reportNeedsAction(submission: SubmissionView): boolean {
  if (["submitting", "submitted", "uncertain"].includes(submission.state) || (submission.state === "failed" && !terminal(submission) && submission.advisory === null)) return true;
  const intake = submission.intake;
  if (intake === null) return !["receipt-verified", "abandoned"].includes(submission.state);
  return intake.canRetryScreening || (["needs-information", "spam", "unavailable"].includes(intake.state) && (intake.canReview || intake.canRevise));
}

/** The reference a reporter tells reports apart by: the advisory, else the case's last eight characters. @throws {never} */
export function caseTitle(record: { readonly id: string; readonly advisory: { readonly ghsa: string } | null }): string {
  return record.advisory?.ghsa ?? `Case ${record.id.slice(-8)}`;
}

/** @throws {never} */
export function reportReference(submission: SubmissionView, record: CaseSummary | undefined): string | null {
  if (submission.caseId !== null) return caseTitle({ id: submission.caseId, advisory: record?.advisory ?? submission.advisory });
  return submission.advisory?.ghsa ?? null;
}
