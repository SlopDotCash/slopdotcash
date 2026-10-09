import { CircleAlert, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "./Link";
import type { CycleIndexEntry } from "./lib/cycle-index";
import { cycleSettlementReminder } from "./lib/funding-reminders";
import { createProjectView, type ProjectView } from "./lib/project-view";
import { findProject, type ProjectDefinition } from "./lib/projects.mjs";
import { formatThirds } from "./lib/reviewer-leaders";
import type { CycleIndexState } from "./lib/use-cycle-index";
import type { DataState } from "./lib/use-snapshot";
import {
  cycleStateLabel,
  DataNotice,
  EmptyState,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
  NotFound,
  stale,
} from "./Presentation";
import { CycleAllocation } from "./ProjectLeaderboard";

export function CyclePage({
  project,
  cycleId,
  state,
  retry,
}: {
  project: ProjectDefinition;
  cycleId: string;
  state: DataState;
  retry: () => void;
}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(cycleId)) {
    return <NotFound title="Cycle unavailable" />;
  }
  if (state.status !== "ready")
    return (
      <main className="shell route-main">
        <h1>
          {project.name} · {formatCycleMonth(cycleId)}
        </h1>
        <DataNotice state={state} retry={retry} />
      </main>
    );
  const record = state.cycleIndex.cycles.find(
    (cycle) => cycle.projectId === project.id && cycle.cycleId === cycleId,
  );
  let view: ProjectView | null = null;
  try {
    view = createProjectView(state.snapshot, project.id, cycleId);
  } catch (error: unknown) {
    if (!record) {
      return (
        <NotFound
          title={error instanceof Error ? error.message : "Cycle unavailable"}
        />
      );
    }
  }
  const from = record?.contributionWindow.from ?? view?.cycle.from;
  const to = record?.contributionWindow.to ?? view?.cycle.endsAt;
  if (!from || !to) return <NotFound title="Cycle unavailable" />;
  const lifecycle =
    record?.state ?? (view?.cycle.status === "live" ? "live" : "closed");
  const reminder = cycleSettlementReminder({
    closesAt: to,
    fundingState:
      project.reward.reviewBudget?.fundingState === "committed"
        ? "committed"
        : project.reward.fundingState,
    kind:
      record?.kind ??
      (view?.reward.kind === "external-prize-share"
        ? "external-prize-share"
        : "monthly-pool"),
    now: new Date().toISOString(),
    paymentMode: project.reward.paymentMode,
    settledAt: record?.settledAt ?? null,
    state: record?.state ?? (view?.cycle.status === "live" ? "live" : "review"),
  });
  const currentStage =
    record?.state === "paid" || record?.state === "settlement-planned"
      ? 3
      : record?.state === "payment-ready"
        ? 2
        : lifecycle === "live"
          ? 0
          : 1;
  const headlineAmount = record
    ? record.kind === "external-prize-share"
      ? `${(record.reward.sharePartsPerMillion ?? 0) / 10_000}%`
      : formatMicroUsdc(
          record.state === "paid"
            ? record.reward.paidMinor
            : record.approvedAt !== null
              ? record.reward.approvedMinor
              : record.reward.suggestedMinor,
        )
    : view?.reward.kind === "monthly-pool"
      ? formatMicroUsdc(view.reward.projectedPrincipalMinor)
      : `${(view?.reward.totalSharePartsPerMillion ?? 0) / 10_000}%`;
  return (
    <main className="shell route-main cycle-page">
      <DataNotice state={state} retry={retry} />
      <p className="breadcrumb">
        <Link href={`/projects/${project.slug}`}>{project.name}</Link>
        <span>/</span>
        {cycleId}
      </p>
      <section className="cycle-hero">
        <div>
          <h1>
            {project.name} · {formatCycleMonth(cycleId)}
          </h1>
          <p>
            {lifecycle.replaceAll("-", " ")} · {formatDate(from)}–
            {formatDate(to)}
          </p>
        </div>
        <div className="cycle-number">
          <strong>{headlineAmount}</strong>
          <span>
            {record?.state === "paid"
              ? "paid principal"
              : record?.kind === "external-prize-share" ||
                  view?.reward.kind === "external-prize-share"
                ? "provisional shares assigned"
                : record
                  ? record.approvedAt !== null
                    ? "approved principal"
                    : "suggested principal"
                  : "projected principal"}
          </span>
          {record?.kind === "monthly-pool" &&
          record.state !== "paid" &&
          record.reward.fundingBasis &&
          (record.reward.fundingBasis.fundingState !== "committed" ||
            record.reward.fundingBasis.committedMinor === "0") ? (
            <p>No committed funding in this cycle’s frozen record.</p>
          ) : null}
        </div>
      </section>
      {record?.reward.lines ? (
        <p className="cycle-line-summary">
          Shared pool{" "}
          {formatMicroUsdc(record.reward.lines.sharedPool.suggestedMinor)} +
          additive review{" "}
          {formatMicroUsdc(record.reward.lines.reviewBudget.suggestedMinor)}{" "}
          suggested. The combined amount uses one wallet and one dust-floor
          decision.
        </p>
      ) : null}
      {reminder ? (
        <div
          className={`data-notice cycle-reminder ${reminder.kind}`}
          role="status"
        >
          <CircleAlert aria-hidden="true" size={18} />
          <span>{reminder.message}</span>
        </div>
      ) : null}
      {record?.kind === "external-prize-share" ? (
        <p>External prize shares; this cycle does not enter Slop settlement.</p>
      ) : record?.state === "closed-no-awards" ? (
        <p>Closed without awards. No payment is due.</p>
      ) : record?.state === "wound-up" ? (
        <p>
          The vault was returned. Approved awards are held without funded
          backing.
        </p>
      ) : (
        <ol className="cycle-status-grid" aria-label="Cycle progress">
          {[
            ["Contribution", `${formatDate(from)}–${formatDate(to)}`],
            [
              "Review",
              record?.reviewEndsAt
                ? `Review ends ${formatDate(record.reviewEndsAt)}`
                : "Review has not started",
            ],
            [
              "Approval",
              record?.approvedAt
                ? `Approved ${formatDate(record.approvedAt)}`
                : "Not approved",
            ],
            [
              "Settlement",
              record?.settledAt
                ? `Paid ${formatDate(record.settledAt)}`
                : record?.state === "settlement-planned"
                  ? "Unsigned plan; payment not verified"
                  : "Payment not verified",
            ],
          ].map(([label, description], index) => (
            <li
              key={label}
              aria-current={index === currentStage ? "step" : undefined}
            >
              <strong>{label}</strong>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      )}
      {view ? (
        <CycleAllocation updatedAt={state.snapshot.generatedAt} view={view} />
      ) : record ? (
        <ArchivedCycleLeaderboard cycle={record} />
      ) : null}
      {record ? <CycleArtifacts cycle={record} /> : null}
    </main>
  );
}

function ArchivedCycleLeaderboard({ cycle }: { cycle: CycleIndexEntry }) {
  return (
    <section className="section project-leader-section">
      <div className="section-heading">
        <h2>Contributors</h2>
      </div>
      {cycle.contributors.length === 0 ? (
        <EmptyState text="This cycle closed with no accepted awards." />
      ) : (
        <div className="leader-table">
          <table className="leader-grid">
            <caption className="visually-hidden">
              Archived cycle contributors
            </caption>
            <thead>
              <tr className="leader-row archived-leader-head">
                <th scope="col">Contributor</th>
                <th scope="col">Score</th>
                {cycle.kind === "external-prize-share" ? (
                  <th scope="col">External prize share</th>
                ) : (
                  <>
                    <th scope="col">Suggested</th>
                    <th scope="col">Approved</th>
                    <th scope="col">Paid</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {cycle.contributors.map((contributor) => (
                <tr
                  className="leader-row archived-leader-row"
                  key={contributor.actor.id}
                >
                  <th scope="row">
                    <Link
                      href={`/contributors/${encodeURIComponent(contributor.actor.login)}`}
                    >
                      {contributor.actor.login}
                    </Link>
                  </th>
                  <td>
                    {formatThirds(
                      contributor.scoreThirds ?? contributor.score * 3,
                    )}
                  </td>
                  {cycle.kind === "external-prize-share" ? (
                    <td>{(contributor.sharePartsPerMillion ?? 0) / 10_000}%</td>
                  ) : (
                    <>
                      {" "}
                      <td>
                        {formatMicroUsdc(contributor.suggestedMinor)}
                        {contributor.lines ? (
                          <small>
                            Pool{" "}
                            {formatMicroUsdc(
                              contributor.lines.sharedPool.suggestedMinor,
                            )}{" "}
                            + review{" "}
                            {formatMicroUsdc(
                              contributor.lines.reviewBudget.suggestedMinor,
                            )}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        {formatMicroUsdc(contributor.approvedMinor)}
                        {contributor.lines ? (
                          <small>
                            Pool{" "}
                            {formatMicroUsdc(
                              contributor.lines.sharedPool.approvedMinor,
                            )}{" "}
                            + review{" "}
                            {formatMicroUsdc(
                              contributor.lines.reviewBudget.approvedMinor,
                            )}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <strong>
                          {formatMicroUsdc(contributor.paidMinor)}
                        </strong>
                        {contributor.lines ? (
                          <small>
                            Pool{" "}
                            {formatMicroUsdc(
                              contributor.lines.sharedPool.paidMinor,
                            )}{" "}
                            + review{" "}
                            {formatMicroUsdc(
                              contributor.lines.reviewBudget.paidMinor,
                            )}
                          </small>
                        ) : null}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CycleArtifacts({ cycle }: { cycle: CycleIndexEntry }) {
  const files = [
    ["Frozen source", cycle.files.sourceSnapshot],
    ["Proposal", cycle.files.proposal],
    ["Approved allocation", cycle.files.allocation],
    ["Unsigned transfer plan", cycle.files.executionPlan],
    ["Verified settlement", cycle.files.settlement],
  ] as const;
  return (
    <section className="section cycle-artifacts">
      <div className="section-heading">
        <h2>Evidence</h2>
      </div>
      <details>
        <summary>Original records and checksums</summary>
        <div className="artifact-links">
          {files
            .filter((entry) => entry[1] !== null)
            .map(([label, file]) =>
              file ? (
                <ExternalLinkAnchor href={file.url} key={label}>
                  <span>
                    <strong>{label}</strong>
                    <small>{file.sha256}</small>
                  </span>
                  <ExternalLink aria-hidden="true" size={17} />
                </ExternalLinkAnchor>
              ) : null,
            )}
        </div>
      </details>
    </section>
  );
}

const ARCHIVE_FILTERS = ["project", "month", "state"] as const;
const ARCHIVE_FILTER_LABELS = {
  project: "Project",
  month: "Month",
  state: "State",
} as const;
function readArchiveFilters(): Record<
  (typeof ARCHIVE_FILTERS)[number],
  string
> {
  const params = new URLSearchParams(window.location.search);
  const read = (key: string, pattern: RegExp) => {
    const value = params.get(key) ?? "";
    return pattern.test(value) ? value : "";
  };
  return {
    project: read("project", /^[a-z0-9-]{1,48}$/u),
    month: read("month", /^\d{4}-(0[1-9]|1[0-2])$/u),
    state: read("state", /^[a-z-]{1,40}$/u),
  };
}

export function CycleArchivePage({
  state,
  retry,
}: {
  state: CycleIndexState;
  retry: () => void;
}) {
  const all =
    state.status === "ready"
      ? [...state.cycleIndex.cycles].sort(
          (left, right) =>
            right.cycleId.localeCompare(left.cycleId) ||
            left.projectId.localeCompare(right.projectId),
        )
      : [];
  const [filters, setFilters] = useState(readArchiveFilters);
  useEffect(() => {
    const restore = () => setFilters(readArchiveFilters());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ARCHIVE_FILTERS) {
      if (filters[key]) url.searchParams.set(key, filters[key]);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [filters]);
  // A filter appears only when the published records offer a choice.
  const options = {
    project: [...new Set(all.map((cycle) => cycle.projectId))].map(
      (id) => [id, findProject(id)?.name ?? id] as const,
    ),
    month: [...new Set(all.map((cycle) => cycle.cycleId))].map(
      (id) => [id, formatCycleMonth(id)] as const,
    ),
    state: [...new Set(all.map((cycle) => cycle.state))].map(
      (id) => [id, cycleStateLabel(id)] as const,
    ),
  };
  const cycles = all.filter(
    (cycle) =>
      (!filters.project || cycle.projectId === filters.project) &&
      (!filters.month || cycle.cycleId === filters.month) &&
      (!filters.state || cycle.state === filters.state),
  );
  const offered = ARCHIVE_FILTERS.filter(
    (key) => options[key].length > 1 || filters[key],
  );
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Payment cycles</h1>
        <p>
          Frozen records of proposed awards, approvals and verified payments.
        </p>
        {state.status === "loading" ? (
          <p role="status">Loading cycle history…</p>
        ) : state.status === "error" ? (
          <div role="alert">
            Cycle history unavailable: {state.message}{" "}
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        ) : all.length === 0 ? (
          <p>No published cycles yet.</p>
        ) : null}
        {state.status === "ready" && stale(state.cycleIndex) ? (
          <p className="data-notice data-stale" role="status">
            Cycle history may be outdated · updated{" "}
            {formatDate(state.cycleIndex.generatedAt)}
          </p>
        ) : null}
      </section>
      {all.length > 0 ? (
        <div className="points-controls cycle-filters">
          {offered.map((key) => (
            <label key={key}>
              {ARCHIVE_FILTER_LABELS[key]}
              <select
                aria-label={ARCHIVE_FILTER_LABELS[key]}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                value={filters[key]}
              >
                <option value="">All</option>
                {options[key].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p role="status">
            Showing {cycles.length} of {all.length} published cycles
          </p>
        </div>
      ) : null}
      {all.length > 0 && cycles.length === 0 ? (
        <p>
          No cycles match these filters.{" "}
          <button
            className="text-button"
            onClick={() => setFilters({ project: "", month: "", state: "" })}
            type="button"
          >
            Clear filters
          </button>
        </p>
      ) : null}
      <div className="cycle-records">
        {cycles.map((cycle) => {
          const project = findProject(cycle.projectId);
          return (
            <article
              className="cycle-record"
              key={`${cycle.projectId}-${cycle.cycleId}`}
            >
              <div>
                <h2>
                  <Link href={`/cycles/${cycle.projectId}/${cycle.cycleId}`}>
                    {project?.name ?? cycle.projectId} ·{" "}
                    {formatCycleMonth(cycle.cycleId)}
                  </Link>
                </h2>
                <p>{cycleStateLabel(cycle.state)}</p>
              </div>
              <dl>
                {cycle.kind === "external-prize-share" ? (
                  <div>
                    <dt>External prize share</dt>
                    <dd>
                      {(cycle.reward.sharePartsPerMillion ?? 0) / 10_000}%
                    </dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt>Suggested</dt>
                      <dd>{formatMicroUsdc(cycle.reward.suggestedMinor)}</dd>
                    </div>
                    <div>
                      <dt>Approved</dt>
                      <dd>{formatMicroUsdc(cycle.reward.approvedMinor)}</dd>
                    </div>
                    <div>
                      <dt>Paid</dt>
                      <dd>{formatMicroUsdc(cycle.reward.paidMinor)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </article>
          );
        })}
      </div>
    </main>
  );
}
