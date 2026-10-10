import { CircleAlert, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import type { SlopbotRepositorySummary } from "../backend/slopbot/summary";
import { browserDeployment } from "./lib/browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { EmptyState, formatDate, formatMicroUsdc } from "./Presentation";

/** No Slopbot activity for this long marks the row as stale (BOT-07). */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

type AutomationState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error" }
  | { status: "ready"; repositories: SlopbotRepositorySummary[] };

const COUNTS = [
  ["itemsReviewed", "Items reviewed"],
  ["itemsLabeled", "Labeled"],
  ["itemsClosed", "Closed"],
  ["closuresReopened", "Closures reopened"],
  ["closuresAppealed", "Closures appealed"],
] as const;

/**
 * LDR-04 Automation row. Slopbot is shown apart from people and is never
 * ranked. Billed costs do not establish verified recovery or earnings.
 */
export function AutomationSection({
  project,
}: {
  project?: ProjectDefinition;
}) {
  const heading = useId();
  const [state, setState] = useState<AutomationState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    void attempt;
    if (!browserDeployment.browserOrigins.has(window.location.origin)) {
      setState({ status: "unavailable" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchWithDeadline("/api/v1/slopbot/summary", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Slopbot summary unavailable");
        const body = (await readBoundedJson(
          response,
          256 * 1024,
          "slopbot",
        )) as {
          repositories: SlopbotRepositorySummary[];
        };
        setState({ status: "ready", repositories: body.repositories });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section className="points-panel" aria-labelledby={heading}>
      <h2 id={heading}>Automation</h2>
      <p className="points-meta">
        Slopbot reviews issues and pull requests for maintainers. It is not
        ranked with people and takes no pool share.
      </p>
      {project ? (
        <p className="points-meta">
          Activity for{" "}
          <a href={project.links.repository}>the project repository</a>.
        </p>
      ) : null}
      <AutomationBody
        state={
          state.status === "ready" && project
            ? {
                ...state,
                repositories: state.repositories.filter(
                  (repository) =>
                    String(repository.repositoryId) ===
                    project.authority.repositoryId,
                ),
              }
            : state
        }
        retry={retry}
      />
    </section>
  );
}

function AutomationBody({
  state,
  retry,
}: {
  state: AutomationState;
  retry: () => void;
}) {
  if (state.status === "loading")
    return (
      <p className="data-notice" role="status">
        Loading Slopbot activity…
      </p>
    );
  if (state.status === "unavailable")
    return (
      <EmptyState text="Slopbot activity loads only on the live Slop site." />
    );
  if (state.status === "error")
    return (
      <div className="data-notice data-error" role="alert">
        <CircleAlert aria-hidden="true" size={18} />
        <span>Slopbot activity unavailable.</span>
        <button onClick={retry} type="button">
          <RotateCcw aria-hidden="true" size={15} /> Retry
        </button>
      </div>
    );
  const repositories = state.repositories;
  const sum = (key: (typeof COUNTS)[number][0]) =>
    repositories.reduce((total, repository) => total + repository[key], 0);
  if (repositories.length === 0)
    return (
      <EmptyState text="No Slopbot activity is recorded for these repositories yet" />
    );
  const lastActivity = repositories
    .map((repository) => repository.lastActivityAt ?? "")
    .reduce((latest, value) => (value > latest ? value : latest), "");
  const billed = repositories.reduce(
    (total, repository) => total + BigInt(repository.billedMicroUsdc),
    0n,
  );
  const installations = new Set(
    repositories.flatMap((repository) => repository.installationIds),
  ).size;
  return (
    <>
      {Date.now() - Date.parse(lastActivity) > STALE_AFTER_MS ? (
        <div className="data-notice data-stale" role="status">
          <span className="status-dot stale-dot" />
          No Slopbot activity in the last 7 days.
        </div>
      ) : null}
      <div className="automation-row">
        <p className="automation-name">
          <strong>Slopbot</strong>
          <small>
            {repositories.length}{" "}
            {repositories.length === 1 ? "repository" : "repositories"} ·{" "}
            {installations}{" "}
            {installations === 1 ? "installation" : "installations"} · last
            activity {formatDate(lastActivity)}
          </small>
        </p>
        <dl className="automation-metrics">
          {COUNTS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{new Intl.NumberFormat("en-US").format(sum(key))}</dd>
            </div>
          ))}
          <div>
            <dt>Cost billed (not earnings)</dt>
            <dd>{formatMicroUsdc(billed.toString())}</dd>
          </div>
          <div>
            <dt>Cost recovered</dt>
            <dd>Not verified</dd>
          </div>
          <div>
            <dt>Agreement with maintainers</dt>
            <dd>Not recorded</dd>
          </div>
        </dl>
      </div>
      <p className="points-meta">
        Cost recovery is not earnings. Billed costs are not proof of payment.
        Settlement evidence and maintainer agreement records are not available
        yet.
      </p>
    </>
  );
}
