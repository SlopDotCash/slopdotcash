/** Signed-in inbox for account, project and payment events (PRD NOT-01). */

import {
  Bell,
  CircleDollarSign,
  FolderGit2,
  Inbox,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { InboxEmailAction } from "./InboxEmail";

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
import { currentProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";
import { formatDateTime, RoutePageHeader, SignInPanel } from "./Presentation";

const SecurityInbox = lazy(() =>
  import("./SecurityBounty").then((module) => ({
    default: module.SecurityInbox,
  })),
);
const PointsDisputes = lazy(() => import("./PointsDisputes"));
const IncompleteAssessments = lazy(() => import("./IncompleteAssessments"));

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
  // Signed out is an ordinary state. Read the session first so a signed-out
  // visit never sends a notifications request the browser logs as a 401. When
  // the first session read fails, the response still needs a fresh matching session.
  const session = await currentProjectSession().catch(() => undefined);
  if (session === null) return { status: "signed-out" };
  const response = await fetchWithDeadline(
    `/api/v1/notifications${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers:
        session === undefined
          ? undefined
          : { "x-slop-expected-github-id": session.githubId },
      signal,
    },
  );
  if (response.status === 401) return { status: "signed-out" };
  if (!response.ok) throw new Error(UNAVAILABLE);
  const value = parseNotificationsResponse(
    await readBoundedJson(response, 1_048_576, "inbox"),
  );
  const current = await currentProjectSession();
  if (current === null) return { status: "signed-out" };
  if (
    value.recipientGithubId !== current.githubId ||
    (session !== undefined && session.githubId !== current.githubId)
  )
    throw new Error("The inbox account changed. Retry.");
  return {
    status: "ready",
    value,
  };
}

async function markRead(
  eventKeys: string[],
  expectedActorId: string,
): Promise<"ok" | "signed-out"> {
  const response = await fetchWithDeadline("/api/v1/notifications/read", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-slop-expected-github-id": expectedActorId,
    },
    body: JSON.stringify({ eventKeys }),
  });
  if (response.status === 401) return "signed-out";
  if (!response.ok)
    throw new Error("Could not mark the notification as read. Please retry.");
  return "ok";
}

async function acknowledgeSecurity(
  notification: Notification,
  expectedActorId: string,
): Promise<"ok" | "signed-out"> {
  const response = await fetchWithDeadline(
    `/api/v1/security-cases/${encodeURIComponent(notification.subject)}/acknowledge`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "x-slop-expected-github-id": expectedActorId,
      },
      body: JSON.stringify({ eventKey: notification.eventKey }),
    },
  );
  if (response.status === 401) return "signed-out";
  if (!response.ok)
    throw new Error("Could not acknowledge the security notice. Please retry.");
  return "ok";
}

export default function InboxPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousPages, setPreviousPages] = useState<(string | null)[]>([]);
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const { busy, error: actionError, run } = useAction();
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const [recipient, setRecipient] = useState<string | null>(null);
  const previousRecipient = useRef<string | null>(null);
  const acceptRecipient = useCallback((id: string | null) => {
    const changed =
      previousRecipient.current !== null && previousRecipient.current !== id;
    if (id === null || changed) {
      clearAllDrafts();
      const url = new URL(window.location.href);
      for (const key of [
        "case",
        "submission",
        "intake",
        "points",
        "pointsDispute",
      ])
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
        // Revalidate the account before retaining private metadata during an outage.
        try {
          const session = await currentProjectSession();
          if (generation.current !== current) return;
          if (session === null) receive({ status: "signed-out" });
          else {
            acceptRecipient(session.githubId);
            setState({ status: "error", message: UNAVAILABLE });
          }
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
  useEffect(() => {
    const refresh = () => {
      load();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);
  const reportsIdentityChanged = useCallback(
    (actorId: string | null) => {
      acceptRecipient(actorId);
      load();
    },
    [acceptRecipient, load],
  );

  function act(
    action: (expectedActorId: string) => Promise<"ok" | "signed-out">,
    done: string,
  ) {
    if (busy || recipient === null || state.status !== "ready") return;
    const expectedActorId = recipient;
    const previous = state;
    const current = ++generation.current;
    setMessage("");
    setState({ status: "loading" });
    const ownsView = async () => {
      try {
        const session = await currentProjectSession();
        if (generation.current !== current) return false;
        if (session === null) {
          receive({ status: "signed-out" });
          return false;
        }
        if (session.githubId !== expectedActorId) {
          acceptRecipient(session.githubId);
          setState({
            status: "error",
            message: "Your account changed. Retry your inbox.",
          });
          return false;
        }
        return true;
      } catch {
        if (generation.current === current) {
          setRecipient(null);
          setState({
            status: "error",
            message: "The inbox and private session could not load. Retry.",
          });
        }
        return false;
      }
    };
    return run(
      async () => {
        if (!(await ownsView())) return;
        try {
          if ((await action(expectedActorId)) === "signed-out") {
            if (generation.current === current)
              receive({ status: "signed-out" });
            return;
          }
          if (!(await ownsView())) return;
          const next = await loadInbox(new AbortController().signal, cursor);
          if (generation.current === current) {
            receive(next);
            if (
              next.status === "ready" &&
              next.value.recipientGithubId === expectedActorId
            )
              setMessage(done);
          }
        } catch (caught) {
          if (await ownsView()) {
            setState(previous);
            throw caught;
          }
        }
      },
      (error) => errorMessage(error, UNAVAILABLE),
    );
  }

  return (
    <main className="shell route-main inbox-page">
      <RoutePageHeader icon={<Inbox />} title="Inbox" />
      <InboxEmailAction />
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
      {recipient !== null ? (
        <div hidden={state.status === "loading"}>
          {state.status === "ready" &&
          state.value.incompleteAssessments !== undefined ? (
            <Suspense fallback={null}>
              <IncompleteAssessments
                key={`incomplete:${recipient}`}
                actorId={recipient}
                initial={state.value.incompleteAssessments}
              />
            </Suspense>
          ) : null}
          {new URLSearchParams(window.location.search).has("points") ||
          new URLSearchParams(window.location.search).has("pointsDispute") ? (
            <Suspense fallback={<p role="status">Loading Points review…</p>}>
              <PointsDisputes
                key={`${recipient}:${window.location.search}`}
                actorId={recipient}
                onChange={load}
              />
            </Suspense>
          ) : null}
          <Suspense fallback={<p role="status">Loading reports…</p>}>
            <SecurityInbox
              embedded
              key={recipient}
              expectedActorId={recipient}
              onIdentityChange={reportsIdentityChanged}
            />
          </Suspense>
        </div>
      ) : null}
      <>
        {state.status === "ready" ? (
          <InboxList
            busy={busy}
            response={state.value}
            onMark={(keys, done) =>
              void act((actorId) => markRead(keys, actorId), done)
            }
            onAcknowledge={(notification) =>
              void act(
                (actorId) => acknowledgeSecurity(notification, actorId),
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
      </>
    </main>
  );
}

function InboxList({
  response,
  busy,
  onMark,
  onAcknowledge,
}: {
  response: NotificationsResponse;
  busy: boolean;
  onMark(eventKeys: string[], done: string): void;
  onAcknowledge(notification: Notification): void;
}) {
  const unreadKeys = response.notifications
    .filter((n) => n.readAt === null)
    .map((n) => n.eventKey)
    .slice(0, MAX_NOTIFICATION_MARK);
  if (response.notifications.length === 0)
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
        {response.notifications.map((n) => (
          <InboxItem
            busy={busy}
            key={n.eventKey}
            notification={n}
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
}: {
  notification: Notification;
  busy: boolean;
  onMark(eventKeys: string[], done: string): void;
  onAcknowledge(notification: Notification): void;
}) {
  const unread = n.readAt === null;
  const title = notificationTitle(n);
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
    <li className={unread ? "inbox-item inbox-unread" : "inbox-item"}>
      <div className="inbox-item-heading">
        <span className="inbox-kind-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <a
          className="inbox-title"
          href={n.actionPath}
          aria-label={`${title}: ${notificationAction(n)}`}
        >
          {title}
        </a>
      </div>
      {n.detail && n.detail !== title ? (
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
