// spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"; spec/security/forwarding.md, "Each request uses its own exact row revision and a reporter-only v1 grant"
import { Alert, Button } from "@repo/ui";
import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { SubmissionView } from "@repo/security/client";
import { grantErrors } from "../../../flows/security/intake.vibe";
import { type CaseSummary, orderedSubmissions, shownSubmissions } from "./summary.ts";

export type SubmissionList =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly submissions: ReadonlyArray<SubmissionView>; readonly authorityUnavailable: boolean; readonly refreshError: string | null };

export type SubmissionsPanelProps = {
  list: SubmissionList;
  /** The reporter's cases, which name each report's next step and award. */
  cases: ReadonlyArray<CaseSummary>;
  /** The report a link points at, shown first even when it was abandoned. */
  focusId: string | null;
  /** The code GitHub's authorization callback returned, when it failed. */
  grantError: string | null;
  /** Whether a report is shown under the current filter, given its case. */
  shows?: (record: CaseSummary | undefined) => boolean;
  onRefresh: () => void;
  /** One report, as `SubmissionEntry` shows it. */
  entry: (submission: SubmissionView, caseRecord: CaseSummary | undefined, focused: boolean) => ReactNode;
};

function Refresh({ label, onRefresh }: { label: string; onRefresh: () => void }) {
  return (
    <Button variant="link" onClick={onRefresh}>
      <RotateCcw aria-hidden className="size-4" /> {label}
    </Button>
  );
}

const everyReport = () => true;

/** `#security-submissions`: the reporter's private reports, the linked one first, then those that need them. */
export function SubmissionsPanel({ list, cases, focusId, grantError, shows = everyReport, onRefresh, entry }: SubmissionsPanelProps) {
  if (list.status === "loading") return <p role="status">Loading private reports…</p>;
  if (list.status === "failed")
    return (
      <Alert variant="destructive" action={<Refresh label="Retry" onRefresh={onRefresh} />}>
        {list.message}
      </Alert>
    );
  const caseOf = (submission: SubmissionView) => cases.find((record) => record.id === submission.caseId);
  const ordered = orderedSubmissions(list.submissions, focusId, caseOf, shows);
  const quiet = grantError === null && !list.authorityUnavailable && list.refreshError === null;
  if (quiet && shownSubmissions(list.submissions, focusId).length === 0)
    return cases.length === 0 ? <p className="text-muted-foreground">You have no private reports yet.</p> : null;
  return (
    <section id="security-submissions" aria-labelledby="security-submissions-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="security-submissions-heading" className="text-xl font-semibold text-foreground">
          Private reports
        </h2>
        <Refresh label="Refresh reports" onRefresh={onRefresh} />
      </div>
      {list.authorityUnavailable ? (
        <Alert variant="warn" announcement="Polite" action={<Refresh label="Retry access check" onRefresh={onRefresh} />}>
          Some maintainer access could not be checked. Your own reports are shown.
        </Alert>
      ) : null}
      {list.refreshError === null ? null : <Alert variant="destructive">Report status could not refresh. The previous status is shown. {list.refreshError}</Alert>}
      {grantError === null ? null : <Alert variant="destructive">{grantErrors[grantError] ?? grantErrors.grant_exchange_failed}</Alert>}
      <p className="text-sm text-muted-foreground">Screening assists review; owners decide awards. GitHub delivery is optional.</p>
      {ordered.map((submission) => (
        <div key={submission.id}>{entry(submission, caseOf(submission), submission.id === focusId)}</div>
      ))}
    </section>
  );
}
