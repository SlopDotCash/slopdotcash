import { CircleDot, GitPullRequest } from "lucide-react";
import type { ProjectDefinition } from "./lib/projects.mjs";
import type { DataState } from "./lib/use-snapshot";
import { DataNotice, ExternalLinkAnchor } from "./Presentation";

/** Public snapshot suggestions; GitHub remains the authority for taking work. */
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
  if (project.status !== "active") return null;
  // Reward-cycle views may not exist yet. Work discovery uses the snapshot
  // independently so a future pool start cannot hide current work.
  const repositories = new Set(project.repositories.map(({ id }) => id));
  const items =
    state.status === "ready"
      ? [
          state.snapshot.workQueue.issues,
          state.snapshot.workQueue.pullRequests,
        ].flatMap((queue) =>
          queue.filter(
            (item) =>
              repositories.has(item.repository) &&
              item.selection.status === "candidate",
          ),
        )
      : [];
  return (
    <section className="section project-work" aria-label="Suggested work">
      <div className="section-heading">
        <h2>Suggested work</h2>
      </div>
      {state.status === "loading" ? (
        <p role="status">Loading work…</p>
      ) : state.status === "error" ? (
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
              {items.map((item) => {
                const label = item.kind === "issue" ? "Issue" : "PR";
                const Icon = item.kind === "issue" ? CircleDot : GitPullRequest;
                return (
                  <li key={item.id}>
                    <ExternalLinkAnchor
                      href={item.url}
                      label={`${label} #${item.number}: ${item.title}`}
                    >
                      <Icon aria-hidden="true" size={18} />
                      <span className="project-work-title">{item.title}</span>
                      <span className="muted">
                        {label} #{item.number}
                      </span>
                    </ExternalLinkAnchor>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No suggested work right now.</p>
          )}
        </>
      )}
    </section>
  );
}
