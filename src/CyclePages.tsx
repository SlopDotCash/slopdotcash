import { CalendarDays, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "./Link";
import type { CycleIndexEntry } from "./lib/cycle-index";
import { errorMessage } from "./lib/errors";
import { cycleSettlementReminder } from "./lib/funding-reminders";
import {
  monthlyCutoff,
  PRD_MONTHLY_SCHEDULE,
} from "./lib/payments/monthly-allocation";
import {
  createProjectView,
  type ProjectView,
  projectCycleHasOpened,
} from "./lib/project-view";
import { findProject, type ProjectDefinition } from "./lib/projects.mjs";
import { resolveRewardCapMinor } from "./lib/reward-cap.mjs";
import type { CycleIndexState } from "./lib/use-cycle-index";
import type { DataState } from "./lib/use-snapshot";
import {
  awaitingApproval,
  cycleContributorStateLabel,
  cycleLifecycleLabel,
  cycleStateLabel,
  DataNotice,
  EmptyState,
  formatCycleMonth,
  formatDate,
  formatDateTime,
  formatMicroUsdc,
  NotFound,
  RoutePageHeader,
  StatusBadge,
  stale,
} from "./Presentation";
import { CycleAllocation } from "./ProjectLeaderboard";
import { VaultPaymentHistory } from "./VaultPaymentHistory";

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
  const notice = (noticeState: DataState) => (
    <main className="shell route-main">
      <h1>
        {project.name} · {formatCycleMonth(cycleId)}
      </h1>
      <DataNotice state={noticeState} retry={retry} />
    </main>
  );
  if (state.status !== "ready") return notice(state);
  const record = state.cycleIndex.cycles.find(
    (cycle) => cycle.projectId === project.id && cycle.cycleId === cycleId,
  );
  // A paused project is not collected; its recorded cycles still render.
  const collected = project.repositories.every((repository) =>
    state.snapshot.repositories.some(
      (candidate) => candidate.id === repository.id,
    ),
  );
  let view: ProjectView | null = null;
  // A month outside the snapshot window has no live view.
  if (collected && projectCycleHasOpened(state.snapshot, project.id, cycleId)) {
    try {
      view = createProjectView(state.snapshot, project.id, cycleId);
    } catch (error) {
      return notice({ status: "error", message: errorMessage(error) });
    }
  }
  if (!view && !record) {
    return (
      <NotFound title={`No ${formatCycleMonth(cycleId)} cycle record`}>
        <p>
          {collected
            ? ""
            : "Activity for this project has not been collected yet. "}
          See the <Link href={`/projects/${project.slug}`}>project page</Link>.
        </p>
      </NotFound>
    );
  }
  const from = record?.contributionWindow.from ?? view?.cycle.from;
  const to = record?.contributionWindow.to ?? view?.cycle.endsAt;
  if (!from || !to) return <NotFound title="Cycle unavailable" />;
  const lifecycle =
    record?.state ?? (view?.cycle.status === "live" ? "live" : "closed");
  const reminder = cycleSettlementReminder({
    closesAt: to,
    capMinor:
      record?.reward.capMinor ?? resolveRewardCapMinor(project, cycleId),
    kind:
      record?.kind ??
      (view?.reward.kind === "external-prize-share"
        ? "external-prize-share"
        : "monthly-pool"),
    now: new Date().toISOString(),
    settledAt: record?.settledAt ?? null,
    state: record?.state ?? (view?.cycle.status === "live" ? "live" : "review"),
  });
  const reviewClosed = record ? awaitingApproval(record) : false;
  // From 2026-11, owners change allocations until the monthly cutoff instead
  // of a 14-day review (PRD section 6). Earlier records keep their review.
  const ownerCutoff = monthlyCutoff(PRD_MONTHLY_SCHEDULE, cycleId);
  const currentStage =
    record?.state === "paid" || record?.state === "settlement-planned"
      ? 3
      : record?.state === "payment-ready" || reviewClosed
        ? 2
        : lifecycle === "live"
          ? 0
          : 1;
  const stages = [
    ["Contribution", `${formatDate(from)}–${formatDate(to)}`],
    ownerCutoff
      ? [
          "Owner changes",
          `${ownerCutoff.getTime() <= Date.now() ? "Closed" : "Closes"} ${formatDateTime(ownerCutoff.toISOString())}`,
        ]
      : [
          "Review",
          record?.reviewEndsAt
            ? `${reviewClosed ? "Ended" : "Ends"} ${formatDate(record.reviewEndsAt)}`
            : "Not started",
        ],
    [
      "Approval",
      record?.approvedAt
        ? `Approved ${formatDate(record.approvedAt)}`
        : reviewClosed
          ? "Awaiting owner approval"
          : "Not approved",
    ],
    [
      "Payment",
      record?.settledAt
        ? `Paid ${formatDate(record.settledAt)}`
        : record?.state === "settlement-planned"
          ? "Ready; payment not verified"
          : "Payment not verified",
    ],
  ];
  const terminalMessage =
    record?.kind === "external-prize-share"
      ? "External prize shares. Not paid through Slop."
      : record?.state === "closed-no-awards"
        ? "Closed without awards. No payment is due."
        : record?.state === "wound-up"
          ? "The vault was returned. Approved awards are held unfunded."
          : null;
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
    <main className="shell route-main cycle-page route-cycle">
      <DataNotice state={state} retry={retry} />
      <p className="breadcrumb">
        <Link href={`/projects/${project.slug}`}>{project.name}</Link>
      </p>
      <section className="cycle-hero">
        <RoutePageHeader
          title={
            <>
              {project.name} · {formatCycleMonth(cycleId)}
            </>
          }
          icon={<CalendarDays />}
          lead={
            <>
              {formatDate(from)}–{formatDate(to)}
            </>
          }
        >
          <StatusBadge
            tone={
              lifecycle === "paid"
                ? "success"
                : lifecycle === "live"
                  ? "info"
                  : "warning"
            }
          >
            {record
              ? cycleLifecycleLabel(record)
              : lifecycle.replaceAll("-", " ")}
          </StatusBadge>
        </RoutePageHeader>
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
            <p>No funding committed for this cycle.</p>
          ) : null}
        </div>
      </section>
      {reminder ? (
        <div
          className={`data-notice cycle-reminder ${reminder.kind}`}
          role="status"
        >
          <CircleAlert aria-hidden="true" size={18} />
          <span>
            {reminder.message}{" "}
            <Link href={`/projects/${project.slug}/funding`}>
              View project funding
            </Link>
          </span>
        </div>
      ) : null}
      {terminalMessage ? (
        <p>{terminalMessage}</p>
      ) : (
        <p className="cycle-current-stage">
          <strong>{stages[currentStage]?.[0]}</strong> ·{" "}
          {stages[currentStage]?.[1]}
        </p>
      )}
      {!terminalMessage || record?.reward.lines ? (
        <details className="cycle-history">
          <summary>Cycle history</summary>
          {!terminalMessage ? (
            <ol className="cycle-status-grid" aria-label="Cycle progress">
              {stages.map(([label, description], index) => (
                <li
                  key={label}
                  aria-current={index === currentStage ? "step" : undefined}
                >
                  <strong>{label}</strong>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
          ) : null}
          {record?.reward.lines ? (
            <section className="cycle-breakdown">
              <h3>Historical pool breakdown</h3>
              <CycleAmountHistory amounts={record.reward} />
            </section>
          ) : null}
        </details>
      ) : null}
      {record ? (
        // A frozen record is what is under review; never replace it with a
        // live recompute, even while the rolling window still covers the month.
        <ArchivedCycleLeaderboard cycle={record} />
      ) : view ? (
        <CycleAllocation updatedAt={state.snapshot.generatedAt} view={view} />
      ) : null}
    </main>
  );
}

const AMOUNT_PHASES = [
  ["Suggested", "suggestedMinor"],
  ["Approved", "approvedMinor"],
  ["Paid", "paidMinor"],
] as const;

function CycleAmountHistory({
  amounts,
}: {
  amounts: Pick<
    CycleIndexEntry["reward"],
    "suggestedMinor" | "approvedMinor" | "paidMinor" | "lines"
  >;
}) {
  return (
    <dl className="cycle-amount-history">
      {AMOUNT_PHASES.map(([label, key]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {formatMicroUsdc(amounts[key])}
            {amounts.lines ? (
              <small>
                Pool {formatMicroUsdc(amounts.lines.sharedPool[key])} + review{" "}
                {formatMicroUsdc(amounts.lines.reviewBudget[key])}
              </small>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
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
        <section
          className="plain-table-wrap cycle-contributor-table"
          aria-label="Archived cycle contributors"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users can scroll the full historical evidence.
          tabIndex={0}
        >
          <table className="plain-table cycle-contributors">
            <caption className="visually-hidden">
              Archived cycle contributors and current award amounts
            </caption>
            <thead>
              <tr>
                <th scope="col">Contributor</th>
                <th scope="col">Points</th>
                <th scope="col">
                  {cycle.kind === "external-prize-share"
                    ? "External prize share"
                    : "Amount"}
                </th>
              </tr>
            </thead>
            <tbody>
              {cycle.contributors.map((contributor) => {
                const phase =
                  contributor.state === "paid"
                    ? 2
                    : contributor.state === "proposed"
                      ? 0
                      : 1;
                const [label, key] = AMOUNT_PHASES[phase];
                return (
                  <tr key={contributor.actor.id}>
                    <th scope="row">
                      <Link
                        href={
                          "/contributors/" +
                          encodeURIComponent(contributor.actor.login)
                        }
                      >
                        {contributor.actor.login}
                      </Link>
                      <small className="cycle-contributor-state">
                        {cycleContributorStateLabel(contributor.state)}
                      </small>
                    </th>
                    <td>
                      {(
                        (contributor.scoreThirds ?? contributor.score * 3) * 10
                      ).toLocaleString()}
                    </td>
                    <td>
                      {cycle.kind === "external-prize-share" ? (
                        <span>
                          {(contributor.sharePartsPerMillion ?? 0) / 10_000}%
                        </span>
                      ) : (
                        <>
                          <span className="cycle-current-amount">
                            {label}{" "}
                            <strong>{formatMicroUsdc(contributor[key])}</strong>
                          </span>
                          <details className="cycle-row-history">
                            <summary>Amount history</summary>
                            <CycleAmountHistory amounts={contributor} />
                          </details>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
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
    <main className="shell evidence-page route-cycle-archive">
      <RoutePageHeader title="Payment cycles" icon={<CalendarDays />}>
        {state.status === "loading" ? (
          <p role="status">Loading cycle history…</p>
        ) : state.status === "error" ? (
          <div role="alert">
            Cycle history unavailable.{" "}
            <button
              className="button secondary-button button-small"
              type="button"
              onClick={retry}
            >
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
      </RoutePageHeader>
      <VaultPaymentHistory scope={{ all: true }} />
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
            {cycles.length} of {all.length} cycles
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
          const amountStage =
            cycle.state === "paid"
              ? "Paid"
              : cycle.approvedAt !== null
                ? "Approved"
                : "Suggested";
          const amount =
            amountStage === "Paid"
              ? cycle.reward.paidMinor
              : amountStage === "Approved"
                ? cycle.reward.approvedMinor
                : cycle.reward.suggestedMinor;
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
                <p>
                  <StatusBadge
                    tone={cycle.state === "paid" ? "success" : "warning"}
                  >
                    {cycleLifecycleLabel(cycle)}
                  </StatusBadge>
                </p>
              </div>
              {cycle.kind === "external-prize-share" ? (
                <dl>
                  <div>
                    <dt>External prize share</dt>
                    <dd>
                      {(cycle.reward.sharePartsPerMillion ?? 0) / 10_000}%
                    </dd>
                  </div>
                </dl>
              ) : (
                <details className="cycle-amounts">
                  <summary>
                    {amountStage} <strong>{formatMicroUsdc(amount)}</strong>
                  </summary>
                  <CycleAmountHistory amounts={cycle.reward} />
                </details>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
