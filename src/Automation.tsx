import { CircleAlert, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SlopbotRepositorySummary } from "../backend/slopbot/summary";
import { browserDeployment } from "./lib/browser-deployment";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
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
 * ranked; its billed amount is cost recovery, not earnings.
 */
export function AutomationSection() {
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
    <section className="points-panel" aria-labelledby="automation-heading">
      <h2 id="automation-heading">Automation</h2>
      <p className="points-meta">
        Slopbot reviews issues and pull requests for maintainers. It is not
        ranked with people and takes no pool share.
      </p>
      <AutomationBody state={state} retry={retry} />
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
  if (sum("itemsReviewed") === 0)
    return <EmptyState text="Slopbot has not reviewed anything yet" />;
  const lastActivity = repositories
    .map((repository) => repository.lastActivityAt ?? "")
    .reduce((latest, value) => (value > latest ? value : latest), "");
  const costRecovery = repositories.reduce(
    (total, repository) => total + BigInt(repository.costRecoveryMicroUsdc),
    0n,
  );
  const installations = new Set(
    repositories.map((repository) => repository.installationId),
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
            <dt>Billed (cost recovery, not earnings)</dt>
            <dd>{formatMicroUsdc(costRecovery.toString())}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
