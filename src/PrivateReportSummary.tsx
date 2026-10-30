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
  "pvr-disabled":
    "GitHub private vulnerability reporting is off for this repository. Nothing was published.",
  "app-not-installed":
    "The Slop private intake app is not installed on this repository. Report directly on GitHub instead.",
  forbidden: "GitHub refused the report for your account.",
  invalid: "GitHub rejected the report fields. Fix them and send again.",
  "author-mismatch":
    "GitHub lists a different author for this advisory, so Slop cannot link it to you.",
  "not-found": "GitHub has no advisory with that ID that your account can see.",
  "grant-expired": "Your GitHub authorization expired. Authorize again.",
  "already-recorded": "This advisory already has a verified private case.",
  "not-private-report":
    "This advisory is not a live private report you filed. Link it for a maintainer to verify instead.",
  unverifiable:
    "GitHub has this report, but Slop could not confirm it within 24 hours. Link the advisory for a maintainer to verify instead.",
};

const SCREENING_LABELS: Record<
  NonNullable<Submission["intake"]>["state"],
  string
> = {
  queued: "Waiting for screening.",
  running: "Screening in progress.",
  legitimate: "Screening complete. Ready for the project owner's review.",
  "needs-information": "More evidence needed before owner review.",
  spam: "Held as spam or unsupported; available for owner review.",
  unavailable: "Screening unavailable; report saved.",
};

export function submissionStatus(submission: Submission): string {
  if (submission.intake) {
    if (
      submission.intake.canForward &&
      submission.intake.routingState === "pending"
    )
      return "Report cleared for review. The owner notification is pending.";
    if (submission.intake.canForward && submission.intake.reviewedAt)
      return "A maintainer cleared this report for owner review. No award has been approved by this routing decision.";
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
  return `GitHub is limiting new reports from your account right now. GitHub has no copy of this report. Wait ${wait}, then send it again.`;
}

export function githubSubmissionStatus(submission: Submission): string {
  switch (submission.state) {
    case "draft":
      return submission.retryAllowed
        ? "GitHub has no copy. You can send again."
        : submission.origin === "direct"
          ? "Ready to verify with GitHub."
          : "Not sent yet.";
    case "submitting":
      return "Sending to GitHub privately…";
    case "uncertain":
      return submission.reconcileAfter &&
        Date.parse(submission.reconcileAfter) > Date.now()
        ? `Not confirmed by GitHub yet. Check again after ${formatUtc(submission.reconcileAfter)}.`
        : "Not confirmed by GitHub. Check again.";
    case "submitted":
      return "Received by GitHub. Confirming…";
    case "receipt-verified":
      return `GitHub receipt · ${formatUtc(submission.githubCreatedAt)}.`;
    case "failed":
      return (
        FAILURE_LABELS[submission.failureCode ?? ""] ??
        "GitHub did not accept the report."
      );
    case "abandoned":
      return "Expired after 24 hours without a send.";
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

export function privateReportHref(submission: Submission): string {
  const query = new URLSearchParams({ submission: submission.id });
  if (submission.caseId) query.set("case", submission.caseId);
  return `/security?${query}`;
}

export const GRANT_ERRORS: Record<string, string> = {
  grant_identity_mismatch:
    "GitHub authorized a different account than the one signed in to Slop. Nothing was sent.",
  grant_state_mismatch: "The GitHub authorization did not match. Try again.",
  grant_exchange_failed:
    "GitHub did not complete the authorization. Try again.",
  grant_flow_missing: "The GitHub authorization expired. Try again.",
};
