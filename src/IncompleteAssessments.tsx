import { useEffect, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import {
  parseIncompleteAssessments,
  type IncompleteAssessments as Queue,
} from "./lib/incomplete-assessments";
import { currentProjectSession } from "./lib/project-api";
import { formatDateTime } from "./Presentation";

/** An existing Inbox view, scoped to current project maintainers and admins. */
export default function IncompleteAssessments({
  actorId,
  initial,
}: {
  actorId: string;
  initial: Queue | null;
}) {
  const [page, setPage] = useState<Queue | null>(initial);
  const [error, setError] = useState(initial === null);
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  useEffect(() => {
    setPage(initial);
    setError(initial === null);
    setCursor(null);
    setPrevious([]);
    setRefresh(0);
  }, [initial]);
  useEffect(() => {
    if (refresh === 0 && cursor === null) {
      setPage(initial);
      setError(initial === null);
      return;
    }
    const controller = new AbortController();
    setPage(null);
    setError(false);
    const load = async () => {
      const response = await fetchWithDeadline(
        `/api/v1/notifications/incomplete-assessments${cursor ? `?${new URLSearchParams({ after: cursor })}` : ""}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: { "x-slop-expected-github-id": actorId },
        },
      );
      if (!response.ok) throw new Error("Assessment queue unavailable");
      const value = parseIncompleteAssessments(
        await readBoundedJson(response, 128 * 1024, "assessment queue"),
      );
      if (
        value.recipientGithubId !== actorId ||
        (await currentProjectSession())?.githubId !== actorId
      )
        throw new Error("Inbox account changed");
      if (!controller.signal.aborted) setPage(value);
    };
    void load().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [actorId, cursor, refresh, initial]);
  if (!error && (!page || (page.items.length === 0 && previous.length === 0)))
    return null;
  return (
    <section aria-labelledby="incomplete-assessments-heading">
      <h2 id="incomplete-assessments-heading">Incomplete assessments</h2>
      {error ? (
        <div role="alert">
          <p>The assessment queue could not load.</p>
          <button
            className="button secondary-button"
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}
      {page ? (
        <>
          <ul className="inbox-list">
            {page.items.map((item) => (
              <li
                className="inbox-item"
                key={`${item.projectId}:${item.repository}:${item.pullRequest}`}
              >
                <a
                  className="inbox-title"
                  href={`https://github.com/${item.repository}/pull/${item.pullRequest}`}
                  aria-label={`${item.projectName}: ${item.repository} #${item.pullRequest}`}
                >
                  {item.repository} #{item.pullRequest}
                </a>
                <p className="inbox-meta">
                  {item.running ? (
                    "Retrying"
                  ) : item.retryAt ? (
                    <>
                      Next retry{" "}
                      <time dateTime={item.retryAt}>
                        {formatDateTime(item.retryAt)}
                      </time>
                    </>
                  ) : (
                    "Awaiting assessment"
                  )}
                </p>
              </li>
            ))}
          </ul>
          {previous.length > 0 || page.next ? (
            <nav
              className="handoff-actions"
              aria-label="Incomplete assessment pages"
            >
              {previous.length > 0 ? (
                <button
                  className="button secondary-button"
                  type="button"
                  onClick={() => {
                    setCursor(previous.at(-1) ?? null);
                    setPrevious((values) => values.slice(0, -1));
                  }}
                >
                  Back
                </button>
              ) : null}
              {page.next ? (
                <button
                  className="button secondary-button"
                  type="button"
                  onClick={() => {
                    setPrevious((values) => [...values, cursor]);
                    setCursor(page.next);
                  }}
                >
                  More
                </button>
              ) : null}
            </nav>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
