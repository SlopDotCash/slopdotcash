/** Signed-in inbox for account, project and payment events (PRD NOT-01). */

import {
  Bell,
  CircleDollarSign,
  FolderGit2,
  Inbox,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import "./private-report-design.css";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { errorMessage } from "./lib/errors";
import { clearAllDrafts } from "./lib/intake-drafts";
import {
  emailDeliveryLabel,
  MAX_NOTIFICATION_MARK,
  type Notification,
  type NotificationsResponse,
  notificationAction,
  notificationTitle,
  parseNotificationsResponse,
} from "./lib/notifications";
import { currentProjectSession, projectApiRequest } from "./lib/project-api";
import { useAction } from "./lib/use-action";
import {
  AccountNav,
  formatDateTime,
  RoutePageHeader,
  SignInPanel,
} from "./Presentation";
import {
  GRANT_ERRORS,
  githubSubmissionStatus,
  privateReportHref,
  type Submission,
  submissionStatus,
} from "./PrivateReportSummary";

type InboxState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; value: NotificationsResponse };

const UNAVAILABLE = "The inbox could not load. Retry.";

async function loadInbox(
  signal: AbortSignal,
  cursor: string | null = null,
): Promise<InboxState> {
  const response = await fetchWithDeadline(
    `/api/v1/notifications${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
    },
  );
  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) throw new Error(UNAVAILABLE);
  return {
    status: "ready",
    value: parseNotificationsResponse(
      await readBoundedJson(response, 1_048_576, "inbox"),
    ),
  };
}

async function markRead(eventKeys: string[]): Promise<"ok" | "signed-out"> {
  const response = await fetchWithDeadline("/api/v1/notifications/read", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventKeys }),
  });
  if (response.status === 401) return "signed-out";
  if (!response.ok)
    throw new Error("Could not mark the notification as read. Please retry.");
  return "ok";
}

async function acknowledgeSecurity(
  notification: Notification,
): Promise<"ok" | "signed-out"> {
  const response = await fetchWithDeadline(
    `/api/v1/security-cases/${encodeURIComponent(notification.subject)}/acknowledge`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventKey: notification.eventKey }),
    },
  );
  if (response.status === 401) return "signed-out";
  if (!response.ok)
    throw new Error("Could not acknowledge the security notice. Please retry.");
  return "ok";
}

export default function InboxPage() {
  const [reports, setReports] = useState<Submission[]>([]);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState(() => {
    const id = new URLSearchParams(window.location.search).get("submission");
    return id && /^ss_[A-Za-z0-9_-]{8,72}$/u.test(id) ? id : null;
  });
  const [grantError, setGrantError] = useState(() => {
    const code = new URLSearchParams(window.location.search).get("intake");
    return code && /^grant_[a-z_]{3,40}$/u.test(code) ? code : null;
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousPages, setPreviousPages] = useState<(string | null)[]>([]);
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const { busy, error: actionError, run } = useAction();
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const [recipient, setRecipient] = useState<string | null>(null);
  const previousRecipient = useRef<string | null>(null);
  const reportsGeneration = useRef(0);
  const [reportOwner, setReportOwner] = useState<string | null>(null);
  const acceptRecipient = useCallback((id: string | null) => {
    const changed =
      previousRecipient.current !== null && previousRecipient.current !== id;
    if (id === null || changed) {
      clearAllDrafts();
      reportsGeneration.current++;
      setReports([]);
      setReportsError(null);
      setReportOwner(null);
      setFocusId(null);
      setGrantError(null);
      const url = new URL(window.location.href);
      for (const key of ["case", "submission", "intake"])
        url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url);
      setCursor(null);
      setPreviousPages([]);
    }
    previousRecipient.current = id;
    setRecipient(id);
    return changed;
  }, []);
  const receive = useCallback(
    (next: InboxState) => {
      if (next.status === "ready" || next.status === "signed-out") {
        const changed = acceptRecipient(
          next.status === "ready" ? next.value.recipientGithubId : null,
        );
        if (changed && next.status === "ready" && cursor !== null) {
          setState({ status: "loading" });
          return;
        }
      }
      setState(next);
    },
    [cursor, acceptRecipient],
  );
  const needsReports =
    focusId !== null ||
    (state.status === "ready" &&
      state.value.notifications.some(
        (notice) => notice.kind === "security_report_received",
      ));
  const loadReports = useCallback(() => {
    const current = ++reportsGeneration.current;
    if (recipient === null || !needsReports) return;
    setReportsError(null);
    void projectApiRequest<{
      recipientGithubId: string;
      submissions: Submission[];
    }>("GET", "security-submissions")
      .then(async (body) => {
        if (body.recipientGithubId !== recipient)
          throw new Error("Private report response belongs to another account");
        const session = await currentProjectSession();
        if (current !== reportsGeneration.current) return;
        if (session?.githubId !== recipient) {
          acceptRecipient(session?.githubId ?? null);
          return;
        }
        setReportOwner(recipient);
        setReports(body.submissions);
      })
      .catch(async () => {
        if (current !== reportsGeneration.current) return;
        try {
          const session = await currentProjectSession();
          if (current !== reportsGeneration.current) return;
          if (session?.githubId !== recipient)
            acceptRecipient(session?.githubId ?? null);
          else setReportsError("Private report status could not load.");
        } catch {
          if (current === reportsGeneration.current) {
            setRecipient(null);
            setReportsError("Private report status could not load.");
          }
        }
      });
    return () => {
      reportsGeneration.current++;
    };
  }, [recipient, acceptRecipient, needsReports]);
  useEffect(loadReports, [loadReports]);
  const visibleReports =
    reportOwner === recipient && recipient !== null ? reports : [];
  const load = useCallback(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setState({ status: "loading" });
    loadInbox(controller.signal, cursor).then(
      (next) => {
        if (generation.current === current) receive(next);
      },
      async () => {
        if (generation.current !== current) return;
        setState({ status: "error", message: UNAVAILABLE });
        // Revalidate the account before retaining private metadata during an outage.
        try {
          const session = await currentProjectSession();
          if (generation.current !== current) return;
          if (session === null) receive({ status: "signed-out" });
          else acceptRecipient(session.githubId);
        } catch {
          if (generation.current === current) {
            setRecipient(null);
            setState({
              status: "error",
              message: "The inbox and private session could not load. Retry.",
            });
          }
        }
      },
    );
    return () => controller.abort();
  }, [cursor, receive, acceptRecipient]);
  useEffect(() => load(), [load]);

  function act(action: () => Promise<"ok" | "signed-out">, done: string) {
    setMessage("");
    return run(
      async () => {
        if ((await action()) === "signed-out") {
          receive({ status: "signed-out" });
          return;
        }
        const current = ++generation.current;
        const next = await loadInbox(new AbortController().signal, cursor);
        if (generation.current === current) {
          receive(next);
          setMessage(done);
        }
      },
      (error) => errorMessage(error, UNAVAILABLE),
    );
  }

  return (
    <main className="shell route-main inbox-page">
      <RoutePageHeader icon={<Inbox />} title="Inbox" />
      <AccountNav current="inbox" />
      {state.status === "loading" ? (
        <p role="status">Loading your inbox…</p>
      ) : null}
      {state.status === "signed-out" ? (
        <SignInPanel
          state={{ status: "signed-out" }}
          next={`/inbox${window.location.search}`}
        />
      ) : null}
      {state.status === "error" ? (
        <div role="alert">
          <p>{state.message}</p>
          <button
            className="button secondary-button"
            type="button"
            onClick={load}
          >
            Retry
          </button>
        </div>
      ) : null}
      {grantError ? (
        <p role="alert" className="form-error">
          {GRANT_ERRORS[grantError] ?? GRANT_ERRORS.grant_exchange_failed}{" "}
          <a
            href={`/security?${new URLSearchParams({ ...(focusId ? { submission: focusId } : {}), intake: grantError })}`}
          >
            Open private report
          </a>
        </p>
      ) : null}
      {reportsError && recipient !== null ? (
        <div className="form-error" role="alert">
          {reportsError}{" "}
          <button className="text-button" type="button" onClick={loadReports}>
            Retry report status
          </button>
        </div>
      ) : null}
      {state.status === "error" &&
      focusId &&
      visibleReports.find((report) => report.id === focusId) ? (
        <ol className="inbox-list" aria-label="Private report receipt">
          <PrivateReportItem
            submission={
              visibleReports.find(
                (report) => report.id === focusId,
              ) as Submission
            }
          />
        </ol>
      ) : null}
      {state.status === "ready" ? (
        <InboxList
          busy={busy}
          response={state.value}
          reports={visibleReports}
          focusId={focusId}
          onMark={(keys, done) => void act(() => markRead(keys), done)}
          onAcknowledge={(notification) =>
            void act(
              () => acknowledgeSecurity(notification),
              "Security notice acknowledged.",
            )
          }
        />
      ) : null}
      {state.status === "ready" &&
      (previousPages.length > 0 || state.value.nextCursor) ? (
        <nav aria-label="Notification pages" className="handoff-actions">
          <button
            type="button"
            className="button secondary-button"
            disabled={busy || previousPages.length === 0}
            onClick={() => {
              setCursor(previousPages.at(-1) ?? null);
              setPreviousPages((pages) => pages.slice(0, -1));
              setMessage("");
            }}
          >
            Newer notifications
          </button>
          <button
            type="button"
            className="button secondary-button"
            disabled={busy || !state.value.nextCursor}
            onClick={() => {
              setPreviousPages((pages) => [...pages, cursor]);
              setCursor(state.value.nextCursor ?? null);
              setMessage("");
            }}
          >
            Older notifications
          </button>
        </nav>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {actionError ? (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {state.status === "ready" ? (
        <p>
          <a href="/account#notifications">Email preferences</a>
        </p>
      ) : null}
    </main>
  );
}

function InboxList({
  response,
  busy,
  onMark,
  onAcknowledge,
  reports,
  focusId,
}: {
  reports: Submission[];
  focusId: string | null;
  response: NotificationsResponse;
  busy: boolean;
  onMark(eventKeys: string[], done: string): void;
  onAcknowledge(notification: Notification): void;
}) {
  const unreadKeys = response.notifications
    .filter((n) => n.readAt === null)
    .map((n) => n.eventKey)
    .slice(0, MAX_NOTIFICATION_MARK);
  const focused = reports.find((report) => report.id === focusId);
  const forNotice = (notice: Notification) =>
    notice.kind === "security_report_received"
      ? reports.find((report) => report.caseId === notice.subject)
      : undefined;
  const ordered = [...response.notifications].sort(
    (a, b) =>
      Number(forNotice(b)?.id === focusId) -
      Number(forNotice(a)?.id === focusId),
  );
  if (response.notifications.length === 0 && !focused)
    return <p className="inbox-empty">You have no notifications.</p>;
  return (
    <>
      <div className="inbox-summary">
        <p>
          {response.unread === 0 ? "All read." : `${response.unread} unread`}
        </p>
        {unreadKeys.length > 0 ? (
          <button
            className="button secondary-button"
            type="button"
            disabled={busy}
            onClick={() => onMark(unreadKeys, "Marked as read.")}
          >
            Mark shown as read
          </button>
        ) : null}
      </div>
      <ol className="inbox-list" aria-label="Notifications">
        {focused &&
        !response.notifications.some(
          (notice) => forNotice(notice)?.id === focusId,
        ) ? (
          <PrivateReportItem submission={focused} />
        ) : null}
        {ordered.map((n) => (
          <InboxItem
            busy={busy}
            key={n.eventKey}
            notification={n}
            submission={forNotice(n)}
            onMark={onMark}
            onAcknowledge={onAcknowledge}
          />
        ))}
      </ol>
    </>
  );
}

function InboxItem({
  notification: n,
  busy,
  onMark,
  onAcknowledge,
  submission,
}: {
  submission?: Submission;
  notification: Notification;
  busy: boolean;
  onMark(eventKeys: string[], done: string): void;
  onAcknowledge(notification: Notification): void;
}) {
  const unread = n.readAt === null;
  const title = submission
    ? `Private report · ${submission.projectId}`
    : notificationTitle(n);
  const Icon =
    n.kind.startsWith("security_") || n.kind.startsWith("slopbot_")
      ? ShieldCheck
      : n.kind === "wallet_changed"
        ? Wallet
        : n.kind.startsWith("payment_") ||
            n.kind.startsWith("payout_") ||
            n.kind === "award_reserved"
          ? CircleDollarSign
          : n.kind.startsWith("project_") ||
              n.kind.startsWith("application_") ||
              n.kind.startsWith("reinstatement_")
            ? FolderGit2
            : Bell;
  return (
    <li
      className={unread ? "inbox-item inbox-unread" : "inbox-item"}
      aria-labelledby={submission ? `submission-${submission.id}` : undefined}
    >
      <div className="inbox-item-heading">
        <span className="inbox-kind-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <a
          className="inbox-title"
          id={submission ? `submission-${submission.id}` : undefined}
          href={submission ? privateReportHref(submission) : n.actionPath}
          aria-label={`${title}: ${submission ? "Open case" : notificationAction(n)}`}
        >
          {title}
        </a>
      </div>
      {submission ? (
        <PrivateReportStatus submission={submission} />
      ) : n.detail && n.detail !== title ? (
        <p className="inbox-detail">{n.detail}</p>
      ) : null}
      <p className="inbox-meta">
        <time dateTime={n.sourceAt}>{formatDateTime(n.sourceAt)}</time>
        <span className="inbox-state">{unread ? "Unread" : "Read"}</span>
        {n.emailDelivery ? (
          <span
            className={`inbox-delivery${n.emailDelivery === "failed" || n.emailDelivery === "uncertain" ? " form-error" : ""}`}
          >
            {emailDeliveryLabel(n.emailDelivery)}
          </span>
        ) : null}
        {n.kind === "security_case" && n.acknowledgedAt ? (
          <span>Acknowledged</span>
        ) : null}
      </p>
      <div className="inbox-actions">
        {submission ? (
          <a className="text-button" href={privateReportHref(submission)}>
            Open case
          </a>
        ) : null}
        {n.kind === "security_case" && n.acknowledgedAt !== undefined ? (
          n.acknowledgedAt ? null : (
            <button
              className="button secondary-button button-small"
              type="button"
              disabled={busy}
              aria-label={`Acknowledge: ${title}`}
              onClick={() => onAcknowledge(n)}
            >
              Acknowledge
            </button>
          )
        ) : null}
        {unread ? (
          <button
            className="button secondary-button button-small"
            type="button"
            disabled={busy}
            aria-label={`Mark as read: ${title}`}
            onClick={() => onMark([n.eventKey], "Marked as read.")}
          >
            Mark as read
          </button>
        ) : null}
      </div>
    </li>
  );
}

function PrivateReportStatus({ submission }: { submission: Submission }) {
  return (
    <div className="private-report-status">
      {submission.intake ? (
        <p className="inbox-meta">
          Slop receipt ·{" "}
          <time dateTime={submission.intake.receivedAt}>
            {formatDateTime(submission.intake.receivedAt)}
          </time>
        </p>
      ) : null}
      <p className="inbox-detail">{submissionStatus(submission)}</p>
      {submission.intake ? (
        <span className="inbox-meta">
          {submission.state === "draft"
            ? "GitHub delivery optional · not sent"
            : githubSubmissionStatus(submission)}
        </span>
      ) : null}
    </div>
  );
}

function PrivateReportItem({ submission }: { submission: Submission }) {
  return (
    <li className="inbox-item" aria-labelledby={`submission-${submission.id}`}>
      <div className="inbox-item-heading">
        <ShieldCheck size={20} aria-hidden="true" />
        <a
          id={`submission-${submission.id}`}
          className="inbox-title"
          href={privateReportHref(submission)}
        >
          Private report · {submission.projectId}
        </a>
      </div>
      <PrivateReportStatus submission={submission} />
      <a className="text-button" href={privateReportHref(submission)}>
        Open case
      </a>
    </li>
  );
}
