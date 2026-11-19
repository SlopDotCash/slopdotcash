// spec/frontend/reportDetails.md, "Private report IDs scope both heading references"; spec/frontend/reportDetails.md, "An individual mount or close changes only its own submission"; spec/frontend/composition.md, "Each mounted report must belong to the authorized current account lifetime"
import { Alert, Button, Disclosure, Field, Status, type StatusProps, Textarea } from "@repo/ui";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { SubmissionView } from "@repo/security/client";
import type { DetailHeadings } from "../../../flows/security/details.vibe";
import type { ReviewDecision } from "../../../flows/security/intake.vibe";
import type { ReportBody, ReportDraft } from "../../../flows/security/private.vibe";
import { ReportFields } from "./ReportFields.tsx";

export type PrivateReport = ReportBody;

export type DetailRead =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly report: PrivateReport; readonly refreshError?: string }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "signedOut" };

export type ReportDetailProps = {
  submission: SubmissionView;
  headings: DetailHeadings;
  open: boolean;
  /** The authorized reader opens or closes this report alone; its sibling reports stay as they are. */
  onOpenChange: (open: boolean) => void;
  detail: DetailRead;
  onRetry: () => void;
  busy: boolean;
  onRevise: (draft: ReportDraft) => void;
  onReview: (decision: ReviewDecision, reason: string) => void;
};

const severityTones: Readonly<Record<string, StatusProps["presentation"]["tone"]>> = { critical: "Negative", high: "Negative", medium: "Caution", low: "Notice" };

function draftOf(report: PrivateReport): ReportDraft {
  return { summary: report.summary, description: report.description, severity: report.severity ?? "", cvss: report.cvssVectorString ?? "", cwe: (report.cweIds ?? []).join(", ") };
}

function Revise({ report, busy, onRevise }: { report: PrivateReport; busy: boolean; onRevise: (draft: ReportDraft) => void }) {
  const [draft, setDraft] = useState(() => draftOf(report));
  return (
    <Disclosure summary="Edit report">
      <form
        className="flex flex-col gap-4 pt-2 text-foreground"
        onSubmit={(event) => {
          event.preventDefault();
          onRevise(draft);
        }}
      >
        <ReportFields draft={draft} onChange={setDraft} disabled={busy} />
        <Button type="submit" className="self-start" loading={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>
    </Disclosure>
  );
}

function Review({ busy, onReview }: { busy: boolean; onReview: (decision: ReviewDecision, reason: string) => void }) {
  const [reason, setReason] = useState("");
  const short = reason.trim().length < 8;
  const decide = (decision: ReviewDecision) => {
    onReview(decision, reason);
    setReason("");
  };
  return (
    <div className="flex flex-col gap-3">
      <Field label="Review reason">
        <Textarea required minLength={8} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || short} onClick={() => decide("forward")}>
          Forward to owner
        </Button>
        <Button variant="secondary" disabled={busy || short} onClick={() => decide("request-information")}>
          Request evidence
        </Button>
      </div>
    </div>
  );
}

function Loaded({ submission, headings, detail, busy, onRetry, onRevise, onReview }: Omit<ReportDetailProps, "open" | "onOpenChange" | "detail"> & { detail: Extract<DetailRead, { status: "ready" }> }) {
  const intake = submission.intake;
  return (
    <>
      {detail.refreshError ? (
        <p role="alert" className="flex items-center gap-2">
          <Status title={detail.refreshError} presentation={{ tone: "Caution", icon: "Alert", label: "Stale" }} />
          <span className="sr-only">{detail.refreshError}</span>
          <Button variant="link" onClick={onRetry}>
            <RotateCcw aria-hidden className="size-4" /> Retry
          </Button>
        </p>
      ) : null}
      <h4 id={headings.summary} className="font-semibold text-foreground">
        {detail.report.summary}
      </h4>
      {detail.report.severity ? (
        <p>
          <Status title="Severity" presentation={{ tone: severityTones[detail.report.severity] ?? "Neutral", icon: "Dot", label: detail.report.severity }} />
        </p>
      ) : null}
      <pre
        role="region"
        aria-labelledby={`${headings.card} ${headings.summary}`}
        tabIndex={0}
        className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-4 font-mono text-sm whitespace-pre-wrap text-foreground"
      >
        {detail.report.description}
      </pre>
      {intake?.canRevise ? <Revise key={intake.revision} report={detail.report} busy={busy} onRevise={onRevise} /> : null}
      {intake?.canReview ? <Review busy={busy} onReview={onReview} /> : null}
    </>
  );
}

/** The private report text, read only when its authorized reader opens it, with the revision and review it allows. */
export function ReportDetail({ open, onOpenChange, detail, ...rest }: ReportDetailProps) {
  return (
    <Disclosure summary="Report" open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-3 pt-2">
        {detail.status === "loading" ? (
          <p role="status">Loading private report…</p>
        ) : detail.status === "ready" ? (
          <Loaded {...rest} detail={detail} />
        ) : (
          <Alert
            variant="destructive"
            action={
              <Button variant="link" onClick={rest.onRetry}>
                Retry
              </Button>
            }
          >
            {detail.status === "error" ? detail.message : "Sign in again"}
          </Alert>
        )}
      </div>
    </Disclosure>
  );
}
