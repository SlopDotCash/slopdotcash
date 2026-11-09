import { CircleDot, GitPullRequest } from "lucide-react";
import type { ProjectDefinition } from "./lib/projects.mjs";
import type { StandingsState } from "./lib/use-standings";
import { ExternalLinkAnchor, formatDateTime, stale } from "./Presentation";

/** Public snapshot suggestions; GitHub remains the authority for taking work. */
export function ProjectWork({
  project,
  state,
  retry,
}: {
  project: ProjectDefinition;
  state: StandingsState;
  retry: () => void;
}) {
  if (project.status !== "active") return null;
  // Reward-cycle views may not exist yet. Work discovery uses the snapshot
  // independently so a future pool start cannot hide current work.
  const repositories = new Set(project.repositories.map(({ id }) => id));
  const items =
    state.status === "ready"
      ? state.snapshot.work.filter((item) => repositories.has(item.repository))
      : [];
  return (
    <section className="section project-work" aria-label="Suggested work">
      <div className="section-heading">
        <h2>Suggested work</h2>
        {state.status === "ready" ? (
          <p className="data-freshness">
            {state.refreshError || stale(state.snapshot)
              ? "May be outdated · "
              : "Updated "}
            <time dateTime={state.snapshot.generatedAt}>
              {formatDateTime(state.snapshot.generatedAt)}
            </time>
          </p>
        ) : null}
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
          {state.refreshError ? (
            <p role="status">
              Refresh failed.{" "}
              <button onClick={retry} type="button">
                Retry
              </button>
            </p>
          ) : null}
          {items.length ? (
            <ul className="project-work-list">
              {items.map((item) => {
                const label = item.kind === "issue" ? "Issue" : "Review";
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
            <p className="muted">No suggested work in this snapshot.</p>
          )}
        </>
      )}
    </section>
  );
}
