/** Metadata-only private report presentation shared by Inbox and Security. */

import { TERMINAL_FAILURES } from "./lib/intake-drafts";
import { formatNullableUtc as formatUtc } from "./Presentation";

/** A Slop private submission; never contains report content. */
export type Submission = {
  id: string;
  projectId: string;
  repository: string;
  origin: "slop" | "direct";
  state:
    | "draft"
    | "submitting"
    | "uncertain"
    | "submitted"
    | "receipt-verified"
    | "failed"
    | "abandoned";
  revision: number;
  attempt: number;
  advisory: { ghsa: string; url: string } | null;
  githubCreatedAt: string | null;
  failureCode: string | null;
  caseId: string | null;
  retryAllowed: boolean;
  reconcileAfter: string | null;
  intake?: {
    state:
      | "queued"
      | "running"
      | "legitimate"
      | "needs-information"
      | "spam"
      | "unavailable";
    receivedAt: string;
    routingState?: "pending" | "routed";
    revision: number;
    reason: string | null;
    reviewedAt: string | null;
    canReview: boolean;
    canForward: boolean;
    canRetryScreening: boolean;
    canAuthorize?: boolean;
    canRevise?: boolean;
  } | null;
};

const FAILURE_LABELS: Record<string, string> = {
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

const SCREENING_LABELS: Record<
  NonNullable<Submission["intake"]>["state"],
  string
> = {
  queued: "Queued",
  running: "Screening",
  legitimate: "Owner review",
  "needs-information": "Needs evidence",
  spam: "Held",
  unavailable: "Unscreened",
};

export function submissionStatus(submission: Submission): string {
  if (submission.intake) {
    if (
      submission.intake.canForward &&
      submission.intake.routingState === "pending"
    )
      return "Cleared · notifying owner";
    if (submission.intake.canForward && submission.intake.reviewedAt)
      return "Cleared · no award yet";
    return SCREENING_LABELS[submission.intake.state];
  }
  return githubSubmissionStatus(submission);
}

/** The notice for a send that GitHub throttled before it kept a copy. */
export function rateLimitMessage(retryAfterSeconds: number | null): string {
  const wait =
    retryAfterSeconds === null
      ? "a few minutes"
      : retryAfterSeconds < 60
        ? "1 minute"
        : `${Math.ceil(retryAfterSeconds / 60)} minutes`;
  return `GitHub rate limit. Not sent. Retry in ${wait}.`;
}

export function githubSubmissionStatus(submission: Submission): string {
  switch (submission.state) {
    case "draft":
      return submission.retryAllowed
        ? "Not sent · resend"
        : submission.origin === "direct"
          ? "Ready to verify"
          : "Not sent";
    case "submitting":
      return "Sending";
    case "uncertain":
      return submission.reconcileAfter &&
        Date.parse(submission.reconcileAfter) > Date.now()
        ? `Unconfirmed · after ${formatUtc(submission.reconcileAfter)}`
        : "Unconfirmed";
    case "submitted":
      return "Confirming";
    case "receipt-verified":
      return `GitHub receipt · ${formatUtc(submission.githubCreatedAt)}.`;
    case "failed":
      return (
        FAILURE_LABELS[submission.failureCode ?? ""] ??
        "GitHub did not accept the report."
      );
    case "abandoned":
      return "Expired";
  }
}

export function reportNeedsAction(submission: Submission): boolean {
  if (
    ["submitting", "submitted", "uncertain"].includes(submission.state) ||
    (submission.state === "failed" &&
      !TERMINAL_FAILURES.includes(submission.failureCode ?? "") &&
      submission.advisory === null)
  )
    return true;
  return submission.intake
    ? Boolean(
        submission.intake.canRetryScreening ||
          (["needs-information", "spam", "unavailable"].includes(
            submission.intake.state,
          ) &&
            (submission.intake.canReview || submission.intake.canRevise)),
      )
    : !["receipt-verified", "abandoned"].includes(submission.state);
}

export const GRANT_ERRORS: Record<string, string> = {
  grant_identity_mismatch: "Wrong GitHub account. Nothing sent.",
  grant_state_mismatch: "The GitHub authorization did not match. Try again.",
  grant_exchange_failed:
    "GitHub did not complete the authorization. Try again.",
  grant_flow_missing: "The GitHub authorization expired. Try again.",
};
