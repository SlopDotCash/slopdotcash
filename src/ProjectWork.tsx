import { CircleDot, GitPullRequest, Star } from "lucide-react";
import { useState } from "react";
import { loadMergeActivity, wantedIssues } from "./lib/merge-activity";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { usePublicResource } from "./lib/use-public-resource";
import type { DataState } from "./lib/use-snapshot";
import { WANTED_ISSUES_SHOWN, wantedLabel } from "./lib/wanted-label.mjs";
import { DataNotice, ExternalLinkAnchor } from "./Presentation";

/** Suggestions shown before the rest are expanded; every item stays reachable. */
const SHOWN = 10;

type WorkItem = {
  id: string;
  kind: "issue" | "pull-request";
  number: number;
  title: string;
  url: string;
  /** Labelled by the maintainers as most wanted. */
  wanted: boolean;
  openPullRequests: number;
};

/**
 * Public snapshot suggestions; GitHub remains the authority for taking work.
 * Issues the maintainers labelled as wanted (PRD section 5) come first, read
 * from the stored scheduled observation, never from GitHub per page view.
 */
export function ProjectWork({
  project,
  state,
  retry,
  notice,
}: {
  project: ProjectDefinition;
  state: DataState;
  retry: () => void;
  /** Show the shared stale-data notice when no other section on the page does. */
  notice: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = wantedLabel(project);
  const active = project.status === "active";
  const [merge] = usePublicResource(
    active && label !== null,
    loadMergeActivity,
    "Wanted issues unavailable",
  );
  if (!active) return null;
  // Reward-cycle views may not exist yet. Work discovery uses the snapshot
  // independently so a future pool start cannot hide current work.
  const repositories = new Set(project.repositories.map(({ id }) => id));
  // A failed or pending read of the wanted list leaves the suggestions as
  // before; it never hides them.
  const wanted =
    merge.status === "ready"
      ? wantedIssues(merge.index.get(project.id), label, WANTED_ISSUES_SHOWN)
      : [];
  const wantedUrls = new Set(wanted.map((issue) => issue.url.toLowerCase()));
  const suggested =
    state.status === "ready"
      ? [
          state.snapshot.workQueue.issues,
          state.snapshot.workQueue.pullRequests,
        ].flatMap((queue) =>
          queue.filter(
            (item) =>
              repositories.has(item.repository) &&
              item.selection.status === "candidate" &&
              !wantedUrls.has(item.url.toLowerCase()),
          ),
        )
      : [];
  const items: WorkItem[] = [
    ...wanted.map((issue) => ({
      id: `wanted:${issue.url}`,
      kind: "issue" as const,
      number: issue.number,
      title: issue.title,
      url: issue.url,
      wanted: true,
      openPullRequests: issue.openPullRequests,
    })),
    ...suggested.map((item) => ({
      id: item.id,
      kind: item.kind,
      number: item.number,
      title: item.title,
      url: item.url,
      wanted: false,
      openPullRequests: 0,
    })),
  ];
  return (
    <section className="section project-work" aria-label="Suggested work">
      <div className="section-heading">
        <h2>Suggested work</h2>
      </div>
      {state.status === "loading" ? (
        <p role="status">Loading work…</p>
      ) : state.status === "error" && wanted.length === 0 ? (
        <p role="alert">
          Work unavailable.{" "}
          <button onClick={retry} type="button">
            Retry
          </button>
        </p>
      ) : (
        <>
          {notice ? <DataNotice state={state} retry={retry} /> : null}
          {items.length ? (
            <ul className="project-work-list">
              {(expanded ? items : items.slice(0, SHOWN)).map((item) => {
                const kind = item.kind === "issue" ? "Issue" : "PR";
                const Icon = item.wanted
                  ? Star
                  : item.kind === "issue"
                    ? CircleDot
                    : GitPullRequest;
                const note = item.wanted
                  ? item.openPullRequests > 0
                    ? "Wanted · PR open"
                    : "Wanted"
                  : null;
                return (
                  <li key={item.id}>
                    <ExternalLinkAnchor
                      href={item.url}
                      label={`${note ? `${note}. ` : ""}${kind} #${item.number}: ${item.title}`}
                    >
                      <Icon aria-hidden="true" size={18} />
                      <span className="project-work-title">{item.title}</span>
                      <span className="muted">
                        {note ? `${note} · ` : ""}
                        {kind} #{item.number}
                      </span>
                    </ExternalLinkAnchor>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Nothing open</p>
          )}
          {!expanded && items.length > SHOWN ? (
            <button
              className="button secondary-button"
              onClick={() => setExpanded(true)}
              type="button"
            >
              Show all {items.length}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
