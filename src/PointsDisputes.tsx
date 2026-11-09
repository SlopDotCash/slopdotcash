import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "./Link";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import type { PointAward, PointRevision } from "./lib/points";
import { currentProjectSession } from "./lib/project-api";
import { formatDateTime } from "./Presentation";

type Dispute = {
  id: string;
  state: "triage" | "review" | "resolved";
  openedAt: string;
  draft: "uphold" | "deny" | null;
  resolution: "upheld" | "denied" | null;
  revision?: PointRevision;
  reason?: string;
  resolutionReason?: string | null;
  mayDecide?: boolean;
};
type List = {
  awards: { revisionId: string; award: PointAward; disputeId: string | null }[];
  next: string | null;
};
const stateLabel = (value: Dispute) =>
  value.resolution === "upheld"
    ? "Dispute upheld"
    : value.resolution === "denied"
      ? "Dispute denied"
      : value.state === "review"
        ? "Moderator review"
        : "Slopbot review";

export default function PointsDisputes({
  actorId,
  onChange,
  onIdentityChange,
}: {
  actorId: string;
  onChange: () => void;
  onIdentityChange: (actorId: string | null) => void;
}) {
  const initial = new URLSearchParams(window.location.search).get(
    "pointsDispute",
  );
  const [selected, setSelected] = useState<string | null>(initial);
  const [page, setPage] = useState<List | null>(null);
  const [detail, setDetail] = useState<Dispute | null>(null);
  const [award, setAward] = useState<{
    revisionId: string;
    award: PointAward;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const mounted = useRef(true);
  const readController = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readController.current?.abort();
    };
  }, []);
  // A new page/target owns its commit before the passive fetch effect starts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(
    () => () => readController.current?.abort(),
    [actorId, selected, cursor, retry],
  );
  const clearPrivateView = () => {
    setPage(null);
    setDetail(null);
    setAward(null);
    setReason("");
    setDecision("");
  };
  const request = async (
    path: string,
    signal?: AbortSignal,
    body?: unknown,
  ) => {
    const active = () => mounted.current && !signal?.aborted;
    let value: unknown;
    let failure: unknown;
    let failed = false;
    let accessRefused = false;
    try {
      const response = await fetchWithDeadline(
        `/api/v1/points/disputes${path}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal,
          headers: {
            "x-slop-expected-github-id": actorId,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined
            ? {}
            : { method: "POST", body: JSON.stringify(body) }),
        },
      );
      accessRefused =
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404 ||
        response.status === 410;
      if (active() && accessRefused) clearPrivateView();
      value = await readBoundedJson(response, 512 * 1024, "Points review");
      accessRefused ||=
        response.status === 409 &&
        (value as { error?: string } | null)?.error === "account_changed";
      if (active() && accessRefused) clearPrivateView();
      if (!response.ok)
        throw new Error(
          (value as { message?: string } | null)?.message ??
            "Points review unavailable. Retry.",
        );
    } catch (error) {
      failed = true;
      failure = error;
    }
    if (active()) {
      // Revalidate even after a failed request before retaining cached private
      // content. A departed read must not change its replacement parent's actor.
      const current = await currentProjectSession().catch(() => {
        if (active()) {
          clearPrivateView();
          onChange();
        }
        throw new Error("The private session could not load. Reload Inbox.");
      });
      if (active() && current?.githubId !== actorId) {
        clearPrivateView();
        onIdentityChange(current?.githubId ?? null);
        throw new Error("The account changed. Reload Inbox.");
      }
      if (active() && accessRefused) onChange();
    }
    if (failed) throw failure;
    return value;
  };
  // The parent remounts this private view whenever its authenticated actor changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: request is bound to this actor; retry reloads the current page.
  useEffect(() => {
    const controller = new AbortController();
    readController.current = controller;
    setError("");
    setBusy(true);
    setDetail(null);
    request(
      selected
        ? `/${encodeURIComponent(selected)}`
        : cursor
          ? `?before=${cursor}`
          : "",
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted)
          selected ? setDetail(value as Dispute) : setPage(value as List);
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "Points review unavailable. Retry.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [actorId, selected, cursor, retry]);
  const act = async (body: unknown, path = "") => {
    setBusy(true);
    setError("");
    try {
      const result = (await request(path, undefined, body)) as Dispute;
      if (!mounted.current) return;
      setSelected(result.id);
      setAward(null);
      setReason("");
      setDecision("");
      const url = new URL(window.location.href);
      url.searchParams.delete("points");
      url.searchParams.set("pointsDispute", result.id);
      window.history.replaceState(window.history.state, "", url);
      setRetry((value) => value + 1);
      onChange();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Points review unavailable. Retry.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section aria-label="Points review">
      <h2>Review Points</h2>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      ) : null}
      {busy ? <p role="status">Loading…</p> : null}
      {detail?.revision ? (
        <>
          <p>
            <strong>
              {detail.revision.award.amount.toLocaleString()} points
            </strong>{" "}
            · @{detail.revision.award.actor.login} ·{" "}
            {detail.revision.award.projectId} ·{" "}
            {formatDateTime(detail.revision.award.occurredAt)} ·{" "}
            <a href={detail.revision.award.sourceUrl}>Original work</a>
          </p>
          <p>{detail.reason}</p>
          <p role="status">{stateLabel(detail)}</p>
          {detail.draft ? (
            <p>
              Slopbot:{" "}
              {detail.draft === "uphold"
                ? "Review the award"
                : "Keep the award"}
            </p>
          ) : null}
          {detail.resolutionReason ? <p>{detail.resolutionReason}</p> : null}
          {detail.mayDecide ? (
            <form
              className="form-field"
              onSubmit={(event) => event.preventDefault()}
            >
              <label htmlFor="points-decision">Decision reason</label>
              <textarea
                id="points-decision"
                disabled={busy}
                value={decision}
                maxLength={4000}
                onChange={(event) => setDecision(event.target.value)}
                required
              />
              <div className="inbox-actions">
                <button
                  type="button"
                  className="button secondary-button"
                  disabled={busy || !decision.trim()}
                  onClick={() =>
                    void act(
                      { action: "uphold", reason: decision },
                      `/${encodeURIComponent(detail.id)}`,
                    )
                  }
                >
                  Uphold dispute
                </button>
                <button
                  type="button"
                  className="button secondary-button"
                  disabled={busy || !decision.trim()}
                  onClick={() =>
                    void act(
                      { action: "deny", reason: decision },
                      `/${encodeURIComponent(detail.id)}`,
                    )
                  }
                >
                  Deny dispute
                </button>
              </div>
            </form>
          ) : null}
          <div className="inbox-actions">
            {!detail.draft && detail.state !== "resolved" ? (
              <button
                type="button"
                className="button secondary-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    { action: "retry" },
                    `/${encodeURIComponent(detail.id)}`,
                  )
                }
              >
                Retry Slopbot review
              </button>
            ) : null}
            <Link className="button secondary-button" href="/inbox?points">
              Points history
            </Link>
          </div>
        </>
      ) : award ? (
        <form
          className="form-field"
          onSubmit={(event) => {
            event.preventDefault();
            void act({ revisionId: award.revisionId, reason });
          }}
        >
          <p>
            <strong>{award.award.amount.toLocaleString()} points</strong> ·{" "}
            {award.award.projectId} · {formatDateTime(award.award.occurredAt)} ·{" "}
            <a href={award.award.sourceUrl}>Original work</a>
          </p>
          <label htmlFor="points-dispute-reason">Reason</label>
          <textarea
            id="points-dispute-reason"
            disabled={busy}
            value={reason}
            maxLength={4000}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          <div className="inbox-actions">
            <button
              type="button"
              className="button secondary-button"
              disabled={busy}
              onClick={() => setAward(null)}
            >
              Back
            </button>
            <button
              type="submit"
              className="button primary-button"
              disabled={busy || !reason.trim()}
            >
              Request review
            </button>
          </div>
        </form>
      ) : !selected && page ? (
        <>
          {page.awards.length ? (
            <ul className="payment-records">
              {page.awards.map((item) => (
                <li key={item.revisionId}>
                  <a href={item.award.sourceUrl}>
                    {item.award.projectId} ·{" "}
                    {formatDateTime(item.award.occurredAt)}
                  </a>{" "}
                  · <strong>{item.award.amount.toLocaleString()} points</strong>{" "}
                  {item.disputeId ? (
                    <Link
                      href={`/inbox?pointsDispute=${encodeURIComponent(item.disputeId)}`}
                    >
                      Open review
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setAward(item);
                        setReason("");
                      }}
                    >
                      Review
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No Points records.</p>
          )}
          {page.next ? (
            <button
              type="button"
              className="button secondary-button"
              disabled={busy}
              onClick={() => setCursor(page.next)}
            >
              Older records
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
