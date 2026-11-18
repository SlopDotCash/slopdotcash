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
  "pvr-disabled": "GitHub private reporting is off. Not sent.",
  "app-not-installed": "Slop app not installed. Report on GitHub.",
  forbidden: "GitHub refused the report for your account.",
  invalid: "GitHub rejected the report fields. Fix them and send again.",
  "author-mismatch": "Advisory belongs to another account.",
  "not-found": "Advisory not found.",
  "grant-expired": "Your GitHub authorization expired. Authorize again.",
  "already-recorded": "This advisory already has a verified private case.",
  "not-private-report": "Not your private report. Link it instead.",
  unverifiable: "Unconfirmed after 24h. Link the advisory.",
};

const screeningLabels: Readonly<Record<string, string>> = {
  queued: "Queued",
  running: "Screening",
  legitimate: "Owner review",
  "needs-information": "Needs evidence",
  spam: "Held",
  unavailable: "Unscreened",
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
      return submission.retryAllowed ? "Not sent · resend" : submission.origin === "direct" ? "Ready to verify" : "Not sent";
    case "submitting":
      return "Sending";
    case "uncertain":
      return submission.reconcileAfter !== null && Date.parse(submission.reconcileAfter) > nowMs
        ? `Unconfirmed · after ${utc(submission.reconcileAfter)}`
        : "Unconfirmed";
    case "submitted":
      return "Confirming";
    case "receipt-verified":
      return `GitHub receipt · ${utc(submission.githubCreatedAt)}.`;
    case "failed":
      return failureLabels[submission.failureCode ?? ""] ?? "GitHub did not accept the report.";
    case "abandoned":
      return "Expired";
    default:
      return "GitHub did not accept the report.";
  }
}

/** @throws {RangeError} */
export function submissionStatus(submission: SubmissionView, nowMs: number): string {
  const intake = submission.intake;
  if (intake === null) return githubSubmissionStatus(submission, nowMs);
  if (intake.canForward && intake.routingState === "pending") return "Cleared · notifying owner";
  if (intake.canForward && intake.reviewedAt !== null) return "Cleared · no award yet";
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

const linkFallbackFailures: ReadonlyArray<string> = ["not-private-report", "unverifiable"];

/** Whether a report failed in a way GitHub cannot verify, so the maintainer-verified link is the way on. @throws {never} */
export function needsLinkFallback(submissions: ReadonlyArray<SubmissionView>): boolean {
  return submissions.some((entry) => entry.state === "failed" && linkFallbackFailures.includes(entry.failureCode ?? ""));
}

/** The reports a reporter is shown: an abandoned one only when a link points at it. @throws {never} */
export function shownSubmissions(submissions: ReadonlyArray<SubmissionView>, focusId: string | null): ReadonlyArray<SubmissionView> {
  return submissions.filter((entry) => entry.state !== "abandoned" || entry.id === focusId);
}

/** The cases the shown reports belong to. @throws {never} */
export function knownCaseIds(submissions: ReadonlyArray<SubmissionView>, focusId: string | null): ReadonlyArray<string> {
  return shownSubmissions(submissions, focusId).flatMap((entry) => (entry.caseId === null ? [] : [entry.caseId]));
}

/** The linked report first, then those that need the reporter, each kept only when `shows` accepts its case. @throws {never} */
export function orderedSubmissions(
  submissions: ReadonlyArray<SubmissionView>,
  focusId: string | null,
  caseOf: (submission: SubmissionView) => CaseSummary | undefined,
  shows: (record: CaseSummary | undefined) => boolean,
): ReadonlyArray<SubmissionView> {
  return shownSubmissions(submissions, focusId)
    .filter((submission) => shows(caseOf(submission)))
    .toSorted((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || Number(reportNeedsAction(b)) - Number(reportNeedsAction(a)));
}

/** Whether a Slop-held report may still be delivered privately to GitHub as its reporter. @throws {never} */
export function deliverable(submission: SubmissionView): boolean {
  const intake = submission.intake;
  return intake !== null && intake.canForward && intake.canAuthorize && sendable(submission);
}

/** Whether a report Slop does not hold may be sent from this tab's kept text. @throws {never} */
export function sendsFromTab(submission: SubmissionView): boolean {
  return submission.intake === null && submission.origin === "slop" && sendable(submission);
}
