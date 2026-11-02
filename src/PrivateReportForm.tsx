import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { errorMessage } from "./lib/errors";
import {
  clearAllDrafts,
  EMPTY_DRAFT,
  type ReportDraft,
} from "./lib/intake-drafts";
import {
  currentProjectSession,
  ProjectApiError,
  type ProjectSessionState,
  projectApiRequest,
} from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { SecurityOffer } from "./SecurityOffer";

const PREFIX = "slop-report-compose:";
type SavedReport = { draft: ReportDraft; key: string; attempted: boolean };

/** Only a confirmed identity change invalidates the tab's private drafts. */
export function usePrivateDraftSession(session: ProjectSessionState): void {
  const previousActor = useRef<string | null>(null);
  const actor =
    session.status === "signed-in" ? session.session.githubId : null;
  useEffect(() => {
    if (session.status === "signed-out") {
      clearAllDrafts();
      previousActor.current = null;
    } else if (actor !== null) {
      if (previousActor.current !== null && previousActor.current !== actor)
        clearAllDrafts();
      previousActor.current = actor;
    }
  }, [actor, session.status]);
}

function restore(owner: string, project: string): SavedReport {
  const fresh = {
    draft: { ...EMPTY_DRAFT },
    key: crypto.randomUUID(),
    attempted: false,
  };
  try {
    const accountPrefix = `${PREFIX}${owner}:`;
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(PREFIX) && !key.startsWith(accountPrefix))
        sessionStorage.removeItem(key);
    }
    const raw = sessionStorage.getItem(`${accountPrefix}${project}`);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as SavedReport;
    if (
      typeof saved.key !== "string" ||
      typeof saved.attempted !== "boolean" ||
      !saved.draft ||
      !Object.keys(EMPTY_DRAFT).every(
        (key) => typeof saved.draft[key as keyof ReportDraft] === "string",
      )
    )
      return fresh;
    return saved;
  } catch {
    return fresh;
  }
}

/** One account-bound tab draft; submission retries retain the same payload and key. */
export function PrivateReportForm({
  project,
  owner,
  login,
  fields,
  body,
}: {
  project: ProjectDefinition;
  owner: string;
  login: string;
  fields: (
    draft: ReportDraft,
    change: (draft: ReportDraft) => void,
  ) => ReactNode;
  body: (draft: ReportDraft) => Record<string, unknown>;
}) {
  const [saved, setSaved] = useState(() => restore(owner, project.id));
  const [review, setReview] = useState(saved.attempted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const accepted = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const [invalid, setInvalid] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const storageKey = `${PREFIX}${owner}:${project.id}`;
  const persist = (value: SavedReport) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  };
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      setStorageAvailable(false);
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (!accepted.current && (saved.draft.summary || saved.draft.description))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved, storageKey]);
  useEffect(() => {
    if (review) heading.current?.focus();
  }, [review]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!review) {
      setReview(true);
      setError(null);
      return;
    }
    const route = window.location.pathname + window.location.search;
    // A new URL can precede the lazy route replacing this form.
    const isCurrent = () =>
      form.current !== null &&
      window.location.pathname + window.location.search === route;
    const attempt = { ...saved, attempted: true };
    setSaved(attempt);
    persist(attempt);
    setBusy(true);
    setError(null);
    try {
      const current = await currentProjectSession();
      if (!isCurrent()) return;
      if (current?.githubId !== owner) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Private state is also cleared in memory. */
        }
        setSaved({
          draft: { ...EMPTY_DRAFT },
          key: crypto.randomUUID(),
          attempted: false,
        });
        setReview(false);
        throw new Error(
          "Your account changed or signed out. Sign in again before submitting a report.",
        );
      }
      const result = await projectApiRequest<{ submission: { id: string } }>(
        "POST",
        "security-submissions",
        {
          projectId: project.id,
          idempotencyKey: saved.key,
          origin: "slop",
          expectedReporterGithubId: owner,
          report: body(saved.draft),
        },
      );
      if (!isCurrent()) return;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Memory draft remains until navigation. */
      }
      accepted.current = true;
      window.location.assign(
        `/inbox?view=reports&submission=${encodeURIComponent(result.submission.id)}`,
      );
    } catch (cause) {
      if (!isCurrent()) return;
      setError(errorMessage(cause));
      // A definite validation refusal did not accept a report. Uncertain and
      // authentication failures keep the original payload for reconciliation.
      if (
        cause instanceof ProjectApiError &&
        cause.code === "reporter_changed"
      ) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Clear memory too. */
        }
        setSaved({
          draft: { ...EMPTY_DRAFT },
          key: crypto.randomUUID(),
          attempted: false,
        });
        setReview(false);
      }
      if (cause instanceof ProjectApiError && cause.status === 400) {
        setSaved({ ...saved, attempted: false, key: crypto.randomUUID() });
      }
    } finally {
      setBusy(false);
    }
  };
  const reviewed = body(saved.draft);
  return (
    <form
      ref={form}
      className="security-form report-composer"
      onSubmit={submit}
      onInvalidCapture={(event) => {
        const field = event.target as HTMLInputElement;
        setInvalid({ id: field.id, message: field.validationMessage });
      }}
    >
      {invalid && !review ? (
        <div className="form-error" role="alert">
          <strong>Check your report</strong>
          <p>
            <a
              href={`#${invalid.id}`}
              onClick={() => document.getElementById(invalid.id)?.focus()}
            >
              {invalid.message}
            </a>
          </p>
        </div>
      ) : null}
      <ol className="report-steps" aria-label="Report steps">
        <li aria-current={!review ? "step" : undefined}>1. Write report</li>
        <li aria-current={review ? "step" : undefined}>2. Review and submit</li>
      </ol>
      {!storageAvailable ? (
        <p role="alert">
          This tab cannot save your draft. Keep this page open until you receive
          a receipt.
        </p>
      ) : (
        <p className="field-hint">
          {saved.attempted
            ? `This tab keeps the report for @${login}. Its receipt is not confirmed.`
            : `Draft kept in this tab for @${login}. It is not submitted yet.`}
        </p>
      )}
      {review ? (
        <>
          <h3 ref={heading} tabIndex={-1}>
            Review your private report
          </h3>
          <p>
            To {project.name}, as @{login}.
          </p>
          <SecurityOffer project={project} compact />
          <h4>{String(reviewed.summary)}</h4>
          <pre className="report-preview">{String(reviewed.description)}</pre>
          {reviewed.severity || reviewed.cvssVectorString || reviewed.cweIds ? (
            <p>
              Classification:{" "}
              {[
                reviewed.severity,
                reviewed.cvssVectorString,
                ...(Array.isArray(reviewed.cweIds) ? reviewed.cweIds : []),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <p>
            Slop stores this report privately and uses Surplus Intelligence to
            screen it. Only you and currently authorized reviewers can read it.
            GitHub delivery is optional and separate.
          </p>
          <details>
            <summary>Privacy and review</summary>
            <p>
              Screening is advice, not an award decision. Provider retention
              follows the account terms; zero retention is not promised. Do not
              include credentials. Your receipt records the terms in force when
              Slop accepts the report.
            </p>
          </details>
        </>
      ) : (
        <>
          <p>
            Explain the affected component or revision, what an attacker could
            do, and how to reproduce it safely.
          </p>
          {fields(saved.draft, (draft) => setSaved({ ...saved, draft }))}
          <details>
            <summary>Example report structure</summary>
            <pre className="report-preview">
              Affected component and revision:\n\nImpact:\n\nSafe reproduction
              steps:\n1.\n2.\n\nExpected and actual results:\n\nSupporting
              evidence:
            </pre>
          </details>
        </>
      )}
      {error ? (
        <div className="form-error" role="alert">
          <strong>Report not confirmed</strong>
          <p>{error}</p>
          {saved.attempted ? (
            <p>
              Your original report is kept. Retry it to reconcile the same
              submission.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="report-form-actions">
        {review && !saved.attempted ? (
          <button
            type="button"
            className="button secondary-button"
            disabled={busy}
            onClick={() => setReview(false)}
          >
            Edit report
          </button>
        ) : null}
        <button type="submit" className="button primary-button" disabled={busy}>
          {busy
            ? "Submitting…"
            : !review
              ? "Review report"
              : saved.attempted
                ? "Retry same report"
                : "Submit private report"}
        </button>
      </div>
    </form>
  );
}
