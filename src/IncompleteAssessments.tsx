import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  onChange,
  onIdentityChange,
}: {
  actorId: string;
  initial: Queue | null;
  onChange: () => void;
  onIdentityChange: (actorId: string | null) => void;
}) {
  const [page, setPage] = useState<Queue | null>(initial);
  const [error, setError] = useState(initial === null);
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const readController = useRef<AbortController | null>(null);
  // Retire the old page in the committed replacement/removal, while keeping
  // the existing fetch and loading updates in their passive effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(
    () => () => readController.current?.abort(),
    [actorId, cursor, refresh, initial, onChange, onIdentityChange],
  );
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
    readController.current = controller;
    setPage(null);
    setError(false);
    const load = async () => {
      let value: Queue | undefined;
      let failure: unknown;
      let failed = false;
      let accessRefused = false;
      try {
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
        accessRefused = [401, 403, 404, 410].includes(response.status);
        if (!response.ok) throw new Error("Assessment queue unavailable");
        value = parseIncompleteAssessments(
          await readBoundedJson(response, 128 * 1024, "assessment queue"),
        );
      } catch (cause) {
        failed = true;
        failure = cause;
      }
      if (controller.signal.aborted) return;
      const current = await currentProjectSession().catch(() => {
        if (!controller.signal.aborted) onChange();
        throw new Error("The private session could not load. Reload Inbox.");
      });
      if (controller.signal.aborted) return;
      if (current?.githubId !== actorId) {
        onIdentityChange(current?.githubId ?? null);
        return;
      }
      if (accessRefused || (value && value.recipientGithubId !== actorId)) {
        onChange();
        throw new Error("Assessment queue access changed. Reload Inbox.");
      }
      if (failed) throw failure;
      if (value) setPage(value);
    };
    void load().catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [actorId, cursor, refresh, initial, onChange, onIdentityChange]);
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
