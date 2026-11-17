// spec/frontend/drafts.md, "A draft belongs to one account and project"; spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"; spec/frontend/drafts.md, "The first send fixes a key and retries keep that key and content"
import { Alert, Button, Disclosure, Stepper } from "@repo/ui";
import { type FormEvent, useState } from "react";
import { type ReportDraft, reportBody } from "../../../flows/security/private.vibe";
import type { ComposerPhase } from "./compose.vibe";
import { ReportFields } from "./ReportFields.tsx";
import { SecurityOffer } from "./SecurityOffer.tsx";
import type { ProgramTerms } from "./terms.schema.ts";

export type ReportComposerProps = {
  /** The signed-in reporter the tab's draft belongs to. */
  login: string;
  projectName: string;
  terms: ProgramTerms | undefined;
  draft: ReportDraft;
  /** Whether this draft was sent once and its receipt is not confirmed: its key and content are fixed. */
  attempted: boolean;
  storageAvailable: boolean;
  phase: ComposerPhase;
  busy: boolean;
  error: string | null;
  onChange: (draft: ReportDraft) => void;
  onEdit: () => void;
  onSubmit: () => void;
};

const exampleStructure = "Affected component and revision:\n\nImpact:\n\nSafe reproduction steps:\n1.\n2.\n\nExpected and actual results:\n\nSupporting evidence:";

const formClass = "flex flex-col gap-4";

function focusOnMount(node: HTMLHeadingElement | null) {
  node?.focus();
}

function submitted(onSubmit: () => void) {
  return (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
}

function Classification({ draft }: { draft: ReportDraft }) {
  const body = reportBody(draft);
  const parts = [body.severity, body.cvssVectorString, ...(body.cweIds ?? [])].filter((part): part is string => part !== undefined && part !== "");
  return parts.length > 0 ? <p>Classification: {parts.join(" · ")}</p> : null;
}

function Reviewed({ draft, login, projectName, terms }: Pick<ReportComposerProps, "draft" | "login" | "projectName" | "terms">) {
  const body = reportBody(draft);
  return (
    <>
      <h3 ref={focusOnMount} tabIndex={-1} className="text-lg font-semibold text-foreground">
        Review your private report
      </h3>
      <p>
        To {projectName}, as @{login}.
      </p>
      <SecurityOffer terms={terms} compact />
      <h4 className="font-semibold text-foreground">{body.summary}</h4>
      <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-4 font-mono text-sm whitespace-pre-wrap">{body.description}</pre>
      <Classification draft={draft} />
      <p>Slop stores this report privately and uses Surplus Intelligence to screen it. Only you and currently authorized reviewers can read it. GitHub delivery is optional and separate.</p>
      <Disclosure summary="Privacy and review">
        <p>
          Screening is advice, not an award decision. Provider retention follows the account terms; zero retention is not promised. Do not include credentials. Your receipt records the terms in force when Slop accepts
          the report.
        </p>
      </Disclosure>
    </>
  );
}

/** The tab's private report for one account and project: write, review, then send once; a retry sends the same report under the same key. */
export function ReportComposer({ login, projectName, terms, draft, attempted, storageAvailable, phase, busy, error, onChange, onEdit, onSubmit }: ReportComposerProps) {
  const [invalid, setInvalid] = useState<{ readonly id: string; readonly message: string } | null>(null);
  if (phase.kind === "received")
    return (
      <form className={formClass} onSubmit={submitted(onSubmit)}>
        <Alert variant="ok">
          <h3 className="font-semibold">Report received</h3>
          <p>Slop saved your private report. Opening its receipt requires the same signed-in account.</p>
          {phase.message ? <p>{phase.message}</p> : null}
        </Alert>
        <Button type="submit" className="self-start" loading={busy}>
          {busy ? "Checking receipt…" : "Check session and open receipt"}
        </Button>
      </form>
    );
  if (phase.kind === "needsSession")
    return (
      <form className={formClass} onSubmit={submitted(onSubmit)}>
        <Alert variant="warn">
          <h3 className="font-semibold">Check your private session</h3>
          {error ? <p>{error}</p> : null}
          <p>No new report will be sent when you check your session.</p>
        </Alert>
        <Button type="submit" className="self-start" loading={busy}>
          {busy ? "Checking session…" : "Check session to recover report"}
        </Button>
      </form>
    );
  const review = phase.review;
  return (
    <form
      className={formClass}
      onSubmit={submitted(onSubmit)}
      onInvalidCapture={(event) => {
        const field = event.target as HTMLInputElement;
        setInvalid({ id: field.id, message: field.validationMessage });
      }}
    >
      {invalid && !review ? (
        <Alert variant="destructive">
          <strong>Check your report</strong>
          <p>
            <a href={`#${invalid.id}`} className="text-primary underline underline-offset-4" onClick={() => document.getElementById(invalid.id)?.focus()}>
              {invalid.message}
            </a>
          </p>
        </Alert>
      ) : null}
      <Stepper aria-label="Report steps" steps={["Write report", "Review and submit"]} current={review ? 1 : 0} />
      {storageAvailable ? (
        <p className="text-sm text-muted-foreground">
          {attempted ? `This tab keeps the report for @${login}. Its receipt is not confirmed.` : `Draft kept in this tab for @${login}. It is not submitted yet.`}
        </p>
      ) : (
        <Alert variant="warn">This tab cannot save your draft. Keep this page open until you receive a receipt.</Alert>
      )}
      {review ? (
        <Reviewed draft={draft} login={login} projectName={projectName} terms={terms} />
      ) : (
        <>
          <p>Explain the affected component or revision, what an attacker could do, and how to reproduce it safely.</p>
          <ReportFields
            draft={draft}
            onChange={(next) => {
              setInvalid(null);
              onChange(next);
            }}
          />
          <Disclosure summary="Example report structure">
            <pre className="rounded-md border border-border bg-muted p-4 font-mono text-sm whitespace-pre-wrap">{exampleStructure}</pre>
          </Disclosure>
        </>
      )}
      {error ? (
        <Alert variant="destructive">
          <strong>Report not confirmed</strong>
          <p>{error}</p>
          {attempted ? <p>Your original report is kept. Retry it to reconcile the same submission.</p> : null}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {review && !attempted ? (
          <Button variant="secondary" disabled={busy} onClick={onEdit}>
            Edit report
          </Button>
        ) : null}
        <Button type="submit" loading={busy}>
          {busy ? "Submitting…" : !review ? "Review report" : attempted ? "Retry same report" : "Submit private report"}
        </Button>
      </div>
    </form>
  );
}
