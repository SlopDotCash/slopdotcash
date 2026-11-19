// spec/frontend/drafts.md, "A draft belongs to one account and project"; spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"; spec/frontend/drafts.md, "The first send fixes a key and retries keep that key and content"
import { Alert, Button, Status, Stepper } from "@repo/ui";
import { Lock, TriangleAlert } from "lucide-react";
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
      <h3 ref={focusOnMount} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Lock aria-hidden className="size-4" /> Review
      </h3>
      <p>
        To {projectName}, as @{login}.
      </p>
      <SecurityOffer terms={terms} compact />
      <h4 className="font-semibold text-foreground">{body.summary}</h4>
      <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-4 font-mono text-sm whitespace-pre-wrap">{body.description}</pre>
      <Classification draft={draft} />
      <p className="flex flex-wrap gap-3">
        <Status presentation={{ tone: "Neutral", icon: "Lock", label: "Private · screened by Surplus Intelligence" }} />
        <Status presentation={{ tone: "Neutral", icon: "Eye", label: "Provider may retain data" }} />
        <Status presentation={{ tone: "Caution", icon: "Alert", label: "No credentials" }} />
      </p>
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
          {phase.message ? <p>{phase.message}</p> : null}
        </Alert>
        <Button type="submit" className="self-start" loading={busy}>
          {busy ? "Checking receipt…" : "Open receipt"}
        </Button>
      </form>
    );
  if (phase.kind === "needsSession")
    return (
      <form className={formClass} onSubmit={submitted(onSubmit)}>
        <Alert variant="warn">
          <h3 className="font-semibold">Sign-in check needed</h3>
          {error ? <p>{error}</p> : null}
        </Alert>
        <Button type="submit" className="self-start" loading={busy}>
          {busy ? "Checking session…" : "Recover report"}
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
      <Stepper aria-label="Report steps" steps={["Write", "Review"]} current={review ? 1 : 0} />
      {storageAvailable ? (
        <p>
          {attempted ? (
            <Status presentation={{ tone: "Caution", icon: "Clock", label: `Unconfirmed · @${login}` }} />
          ) : (
            <Status presentation={{ tone: "Neutral", icon: "Dot", label: `Draft · @${login}` }} />
          )}
        </p>
      ) : (
        <p role="alert" className="flex items-center gap-2 text-sm">
          <TriangleAlert aria-hidden className="size-4 text-destructive" /> Draft not saved. Keep this tab open.
        </p>
      )}
      {review ? (
        <Reviewed draft={draft} login={login} projectName={projectName} terms={terms} />
      ) : (
        <ReportFields
          draft={draft}
          onChange={(next) => {
            setInvalid(null);
            onChange(next);
          }}
        />
      )}
      {error ? (
        <Alert variant="destructive">
          <strong>Report not confirmed</strong>
          <p>{error}</p>
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
