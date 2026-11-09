import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
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
type AcceptedReport = { id: string; draftBytes: string | null };

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
  const [receipt, setReceipt] = useState<AcceptedReport | null>(null);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [needsSession, setNeedsSession] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const accepted = useRef(false);
  const closedDraft = useRef(false);
  const mounted = useRef(false);
  const operation = useRef(0);
  const inFlight = useRef(false);
  const recoveryDraftBytes = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [invalid, setInvalid] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const storageKey = `${PREFIX}${owner}:${project.id}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current += 1;
    };
  }, [owner, project.id]);
  const persist = (value: SavedReport) => {
    const bytes = JSON.stringify(value);
    try {
      sessionStorage.setItem(storageKey, bytes);
      setStorageAvailable(true);
      return bytes;
    } catch {
      setStorageAvailable(false);
      // A failed write may leave this same draft's earlier record in place.
      // Capture only that observed record, never an unrelated replacement.
      try {
        const previous = sessionStorage.getItem(storageKey);
        return previous === JSON.stringify(saved) || previous === bytes
          ? previous
          : null;
      } catch {
        return null;
      }
    }
  };
  const clearCapturedDraft = (bytes: string | null) => {
    if (bytes === null) return;
    try {
      if (sessionStorage.getItem(storageKey) === bytes)
        sessionStorage.removeItem(storageKey);
    } catch {
      // Unreadable or replaced storage is not evidence of ownership.
    }
  };
  const hideDraft = () => {
    closedDraft.current = true;
    recoveryDraftBytes.current = null;
    setSaved({
      draft: { ...EMPTY_DRAFT },
      key: crypto.randomUUID(),
      attempted: false,
    });
    setReview(false);
    setInvalid(null);
  };
  useEffect(() => {
    if (!closedDraft.current) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(saved));
        setStorageAvailable(true);
      } catch {
        setStorageAvailable(false);
      }
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
  const openReceipt = async (
    received: AcceptedReport,
    isCurrent: () => boolean,
  ) => {
    let current: Awaited<ReturnType<typeof currentProjectSession>>;
    try {
      current = await currentProjectSession();
    } catch {
      if (isCurrent())
        setReceiptMessage(
          "Your report was received, but this tab could not verify your current account. Check your session to open its receipt.",
        );
      return;
    }
    if (!isCurrent()) return;
    if (current?.githubId !== owner) {
      clearCapturedDraft(received.draftBytes);
      hideDraft();
      setReceipt({ id: received.id, draftBytes: null });
      setReceiptMessage(
        `Your report was received for @${login}. Your account changed or signed out. Sign in with that account, then check this receipt.`,
      );
      return;
    }
    clearCapturedDraft(received.draftBytes);
    window.location.assign(
      `/inbox?view=reports&submission=${encodeURIComponent(received.id)}`,
    );
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mounted.current || inFlight.current) return;
    if (receipt === null && !needsSession && !review) {
      setReview(true);
      setError(null);
      return;
    }
    const currentOperation = ++operation.current;
    const route = window.location.pathname + window.location.search;
    // A new URL can precede the lazy route replacing this form.
    const isCurrent = () =>
      mounted.current &&
      operation.current === currentOperation &&
      form.current !== null &&
      window.location.pathname + window.location.search === route;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let draftBytes: string | null = null;
    try {
      if (receipt !== null) {
        setReceiptMessage(null);
        await openReceipt(receipt, isCurrent);
        return;
      }
      if (needsSession) {
        let current: Awaited<ReturnType<typeof currentProjectSession>>;
        try {
          current = await currentProjectSession();
        } catch {
          if (isCurrent())
            setError(
              "Your current account could not be verified. Your original report is kept privately for recovery.",
            );
          return;
        }
        if (!isCurrent()) return;
        if (current?.githubId !== owner) {
          clearCapturedDraft(recoveryDraftBytes.current);
          hideDraft();
          setNeedsSession(false);
          setError(
            "Your account changed or signed out. Sign in again before submitting a report.",
          );
          return;
        }
        setNeedsSession(false);
        setError("Your account is verified. Review and retry the same report.");
        return;
      }
      const attempt = { ...saved, attempted: true };
      setSaved(attempt);
      draftBytes = persist(attempt);
      recoveryDraftBytes.current = draftBytes;
      const current = await currentProjectSession();
      if (!isCurrent()) return;
      if (current?.githubId !== owner) {
        clearCapturedDraft(draftBytes);
        hideDraft();
        setError(
          "Your account changed or signed out. Sign in again before submitting a report.",
        );
        return;
      }
      const result = await projectApiRequest<{ submission?: { id?: unknown } }>(
        "POST",
        "security-submissions",
        {
          projectId: project.id,
          idempotencyKey: attempt.key,
          origin: "slop",
          expectedReporterGithubId: owner,
          report: body(attempt.draft),
        },
        { expectedActorGithubId: owner },
      );
      if (!isCurrent()) return;
      const submissionId = result?.submission?.id;
      // Same identifier contract as the receipt route and backend loader.
      if (
        typeof submissionId !== "string" ||
        !/^ss_[A-Za-z0-9_-]{8,72}$/u.test(submissionId)
      )
        throw new ProjectApiError(
          0,
          "invalid_response",
          "The server did not return a usable report receipt. Retry the same report to reconcile it.",
        );
      const received = { id: submissionId, draftBytes };
      accepted.current = true;
      setReceipt(received);
      hideDraft();
      await openReceipt(received, isCurrent);
    } catch (cause) {
      if (!isCurrent()) return;
      if (accepted.current) {
        setReceiptMessage(
          "Your report was received, but this tab could not open its receipt. Check your session and try again.",
        );
        return;
      }
      let current: Awaited<ReturnType<typeof currentProjectSession>>;
      try {
        current = await currentProjectSession();
      } catch {
        if (isCurrent()) {
          setNeedsSession(true);
          setError(
            "Your current account could not be verified. Your original report is kept privately for recovery.",
          );
        }
        return;
      }
      if (!isCurrent()) return;
      if (current?.githubId !== owner) {
        clearCapturedDraft(draftBytes);
        hideDraft();
        setError(
          "Your account changed or signed out. Sign in again before submitting a report.",
        );
        return;
      }
      setError(errorMessage(cause));
      // A definite validation refusal did not accept a report. Uncertain and
      // authentication failures keep the original payload for reconciliation.
      if (
        cause instanceof ProjectApiError &&
        ["reporter_changed", "actor_changed"].includes(cause.code)
      ) {
        clearCapturedDraft(draftBytes);
        hideDraft();
      }
      if (cause instanceof ProjectApiError && cause.status === 400) {
        const corrected = {
          ...saved,
          attempted: false,
          key: crypto.randomUUID(),
        };
        // This completion may update only its captured storage record. The
        // passive draft effect must not later overwrite a replacement slot.
        closedDraft.current = true;
        try {
          if (
            draftBytes !== null &&
            sessionStorage.getItem(storageKey) === draftBytes
          ) {
            sessionStorage.setItem(storageKey, JSON.stringify(corrected));
            setStorageAvailable(true);
          } else setStorageAvailable(false);
        } catch {
          setStorageAvailable(false);
        }
        setSaved(corrected);
      }
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  const reviewed = body(saved.draft);
  if (receipt)
    return (
      <form
        ref={form}
        className="security-form report-composer"
        onSubmit={submit}
      >
        <div role="status">
          <h3>Report received</h3>
          <p>
            Slop saved your private report. Opening its receipt requires the
            same signed-in account.
          </p>
          {receiptMessage ? <p>{receiptMessage}</p> : null}
        </div>
        <div className="report-form-actions">
          <button
            type="submit"
            className="button primary-button"
            disabled={busy}
          >
            {busy ? "Checking receipt…" : "Check session and open receipt"}
          </button>
        </div>
      </form>
    );
  if (needsSession)
    return (
      <form
        ref={form}
        className="security-form report-composer"
        onSubmit={submit}
      >
        <div role="alert">
          <h3>Check your private session</h3>
          <p>{error}</p>
          <p>No new report will be sent when you check your session.</p>
        </div>
        <div className="report-form-actions">
          <button
            type="submit"
            className="button primary-button"
            disabled={busy}
          >
            {busy ? "Checking session…" : "Check session to recover report"}
          </button>
        </div>
      </form>
    );
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
          {fields(saved.draft, (draft) => {
            closedDraft.current = false;
            setSaved({ ...saved, draft });
          })}
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
