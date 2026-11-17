// spec/frontend/reportDetails.md, "Private report IDs scope both heading references"; spec/security/forwarding.md, "Each request uses its own exact row revision and a reporter-only v1 grant"; spec/frontend/drafts.md, "Submitted report text is kept only while its submission can still be sent and is erased on sign-out"
import { Alert, Button, Disclosure, ExternalLink } from "@repo/ui";
import { ArrowRight, RotateCcw } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import type { SubmissionView } from "@repo/security/client";
import type { DetailHeadings } from "../../../flows/security/details.vibe";
import type { ReportDraft } from "../../../flows/security/private.vibe";
import { run, useMounted, useOnce } from "./hooks.ts";
import { ReportFields } from "./ReportFields.tsx";
import { type ProgramRuntime, type SubmissionRequest, actOnSubmission, keepReportText, reconcileDue, storeReportText, submissionOpened } from "./runtime.vibe";
import { type CaseSummary, deliverable, githubSubmissionStatus, reportNeedsAction, reportReference, sendsFromTab, submissionStatus, utc } from "./summary.ts";

export type SubmissionCardProps = {
  submission: SubmissionView;
  /** The case this report opened, when the reporter can read it. */
  caseRecord?: CaseSummary;
  /** The signed-in reporter, named in the consent before a send. */
  login: string;
  headings: DetailHeadings;
  /** Whether a link points at this report. */
  focused: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** The report text this tab keeps for a send that has not reached GitHub. */
  draft: ReportDraft;
  onDraft: (draft: ReportDraft) => void;
  /** The time the status is read at, in milliseconds. */
  nowMs: number;
  busy: boolean;
  error: string | null;
  /** Whether GitHub must be authorized before this report can be sent. */
  needsGrant: boolean;
  /** The private report, read only when its authorized reader opens it. */
  report?: ReactNode;
  onAct: (request: SubmissionRequest) => void;
  onOpenCase: (caseId: string) => void;
};

function Delivery({ submission, busy, onAct, draft }: Pick<SubmissionCardProps, "submission" | "busy" | "onAct" | "draft">) {
  return (
    <Disclosure summary={submission.state === "failed" ? "Retry private GitHub delivery" : "Also send privately to GitHub"}>
      <div className="flex flex-col items-start gap-2 pt-2 text-foreground">
        <p>Optional: authorize GitHub to submit the saved report as you. Your original Slop receipt and review status are retained.</p>
        <Button variant="secondary" disabled={busy} onClick={() => onAct({ kind: "authorize", draft })}>
          Authorize private GitHub delivery
        </Button>
        <Button variant="link" disabled={busy} onClick={() => onAct({ kind: "send", draft: null })}>
          Send saved report to GitHub
        </Button>
      </div>
    </Disclosure>
  );
}

function SendFromTab({ submission, login, draft, busy, onDraft, onAct }: Pick<SubmissionCardProps, "submission" | "login" | "draft" | "busy" | "onDraft" | "onAct">) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAct({ kind: "send", draft });
  };
  return (
    <form className="flex flex-col gap-4 text-foreground" onSubmit={submit}>
      <p>
        The Slop private intake app will file this on GitHub as @{login} with your authorization, as a private report only you and the repository’s administrators and security managers can read.
      </p>
      <ReportFields draft={draft} disabled={busy} onChange={onDraft} />
      <Button type="submit" className="self-start" loading={busy}>
        {submission.state === "failed" ? "Fix and resend" : "Submit privately"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Slop stores no report text. It adds a “Report reference:” line with a random code to your description. The line names neither you nor Slop and stays if the advisory is published.
      </p>
    </form>
  );
}

/** One private submission and the only actions its state allows; never its report text unless its reader opens it. */
export function SubmissionCard(props: SubmissionCardProps) {
  const { submission, caseRecord, headings, focused, expanded, onExpandedChange, nowMs, busy, error, needsGrant, report, onAct, onOpenCase } = props;
  const reference = reportReference(submission, caseRecord);
  const intake = submission.intake;
  return (
    <article aria-labelledby={headings.card} className={`flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground ${focused ? "border-primary" : "border-border"}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headings.card} className="font-semibold">
          Private report · {submission.projectId}
          {reference === null ? null : (
            <>
              {" · "}
              <span title={submission.caseId ?? undefined}>{reference}</span>
            </>
          )}
        </h3>
        {submission.caseId === null ? null : (
          <Button variant="link" onClick={() => onOpenCase(submission.caseId ?? "")}>
            Open case
          </Button>
        )}
      </header>
      {caseRecord === undefined ? null : (
        <div className="flex flex-col gap-1 text-sm">
          <p className="flex items-center gap-2">
            <ArrowRight aria-hidden className="size-4" />
            <span>
              <strong>Next step:</strong> {caseRecord.nextStep}
            </span>
          </p>
          <p className="text-muted-foreground">
            Award: {caseRecord.award}
            {caseRecord.nextStepDueAt === null ? "" : ` · Due ${utc(caseRecord.nextStepDueAt)}`}
          </p>
        </div>
      )}
      {intake !== null && submission.state !== "draft" ? <p className="text-sm text-muted-foreground">{githubSubmissionStatus(submission, nowMs)}</p> : null}
      <Disclosure summary={submissionStatus(submission, nowMs)} open={expanded} onOpenChange={onExpandedChange}>
        <div className="flex flex-col gap-3 pt-2 text-foreground">
          {intake === null ? null : (
            <>
              <p className="text-sm text-muted-foreground">Slop receipt · {utc(intake.receivedAt)}</p>
              {intake.reason === null ? null : <p>{intake.reason}</p>}
              {report}
              {intake.canRetryScreening ? (
                <Button variant="link" className="self-start" disabled={busy} onClick={() => onAct({ kind: "screen" })}>
                  <RotateCcw aria-hidden className="size-4" /> {intake.canForward ? "Retry owner notification" : "Retry screening"}
                </Button>
              ) : null}
              {deliverable(submission) ? <Delivery submission={submission} busy={busy} onAct={onAct} draft={props.draft} /> : null}
            </>
          )}
          {submission.advisory === null ? null : (
            <p>
              <ExternalLink href={submission.advisory.url}>{submission.advisory.ghsa}</ExternalLink>
            </p>
          )}
          {sendsFromTab(submission) ? <SendFromTab {...props} /> : null}
          {submission.state === "uncertain" || submission.state === "submitted" ? (
            <Button className="self-start" disabled={busy} onClick={() => onAct({ kind: "reconcile" })}>
              <RotateCcw aria-hidden className="size-4" /> Check again
            </Button>
          ) : null}
          {needsGrant ? (
            <Alert
              variant="destructive"
              action={
                <Button variant="link" disabled={busy} onClick={() => onAct({ kind: "authorize", draft: props.draft })}>
                  Authorize GitHub to submit as you
                </Button>
              }
            >
              Authorize GitHub for this report first.
            </Alert>
          ) : null}
          {error === null ? null : <Alert variant="destructive">{error}</Alert>}
        </div>
      </Disclosure>
    </article>
  );
}

export type SubmissionEntryProps = {
  section: ProgramRuntime;
  /** The signed-in reporter's GitHub user ID; a response for anyone else is refused. */
  owner: string;
  login: string;
  submission: SubmissionView;
  caseRecord?: CaseSummary;
  focused: boolean;
  /** The private report, mounted by its reader under this report's heading references. */
  report?: (headings: DetailHeadings) => ReactNode;
  onUpdated: (submission: SubmissionView) => void;
  onOpenCase: (caseId: string) => void;
};

type Acting = { readonly busy: boolean; readonly error: string | null; readonly needsGrant: boolean };

const idle: Acting = { busy: false, error: null, needsGrant: false };

function Opened(props: SubmissionEntryProps & { headings: DetailHeadings; kept: ReportDraft }) {
  const { section, owner, submission, focused, onUpdated, report, ...shown } = props;
  const [draft, setDraft] = useState(props.kept);
  const [acting, setActing] = useState(idle);
  const [expanded, setExpanded] = useState(focused || reportNeedsAction(submission));
  const [wasFocused, setWasFocused] = useState(focused);
  if (focused !== wasFocused) {
    setWasFocused(focused);
    if (focused) setExpanded(true);
  }
  useOnce(section, `kept:${submission.id}:${submission.state}:${submission.intake?.revision ?? 0}`, () => keepReportText(submission));
  const due = submission.state === "uncertain" && submission.reconcileAfter !== null ? Date.parse(submission.reconcileAfter) : null;
  useOnce(section, `due:${submission.id}:${due ?? 0}`, () => reconcileDue(due ?? 0));
  const act = (request: SubmissionRequest) => {
    setActing({ ...acting, busy: true, error: null });
    void run(section, actOnSubmission(owner, submission, request)).then((done) => {
      if (!done.ok) return setActing({ ...idle, error: done.message });
      const result = done.value;
      switch (result.kind) {
        case "updated":
          onUpdated(result.submission);
          return setActing({ ...idle, error: result.notice });
        case "grantRequired":
          return setActing({ ...idle, needsGrant: true });
        case "redirect":
          return location.assign(result.url);
        default:
          return setActing({ ...idle, needsGrant: acting.needsGrant, error: result.message });
      }
    });
  };
  return (
    <SubmissionCard
      {...shown}
      submission={submission}
      focused={focused}
      report={report?.(props.headings)}
      expanded={expanded}
      onExpandedChange={setExpanded}
      draft={draft}
      onDraft={(next) => {
        setDraft(next);
        void run(section, storeReportText(submission, next));
      }}
      nowMs={Date.now()}
      busy={acting.busy}
      error={acting.error}
      needsGrant={acting.needsGrant}
      onAct={act}
    />
  );
}

/** A reporter's submission in the page runtime: its kept text, its heading references and its actions. */
export function SubmissionEntry(props: SubmissionEntryProps) {
  const opened = useMounted(props.section, () => submissionOpened(props.submission.id));
  if (opened.status === "running") return <p role="status">Loading private report…</p>;
  if (opened.status === "failed") return <Alert variant="destructive">{opened.message}</Alert>;
  return <Opened {...props} headings={opened.value.headings} kept={opened.value.text} />;
}
