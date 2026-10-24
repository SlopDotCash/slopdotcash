import { type ReactNode, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import type { CycleIndex } from "./lib/cycle-index";
import { githubUserIdFromNodeId } from "./lib/github-actor";
import type { ScoreEvent } from "./lib/leaderboard";
import { transactionUrl } from "./lib/payments/contracts";
import { type PointRevision, type PointsMember, pointKey } from "./lib/points";
import { dailyPoints } from "./lib/profile-activity";
import {
  assertProfiles,
  type ProfileIndex,
  profileCounts,
  profileIssueOutcomes,
} from "./lib/profiles";
import {
  findIngestedProjectByRepositoryId,
  findProject,
} from "./lib/projects.mjs";
import { TARGET_REPOSITORIES } from "./lib/repositories.mjs";
import { useDirectTransfers } from "./lib/use-direct-transfers";
import { usePublicResource } from "./lib/use-public-resource";
import {
  ContributorIdentity,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDate,
  formatDateTime,
  formatMicroUsdc,
} from "./Presentation";

async function loadProfiles(signal: AbortSignal) {
  const response = await fetchWithDeadline("/data/profiles.json", {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw Error("Profiles unavailable");
  const index = await readBoundedJson(response, 8 * 1024 * 1024, "profiles");
  assertProfiles(index);
  return { index };
}
type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; index: ProfileIndex };
export function useProfiles(enabled = true): {
  state: State;
  retry: () => void;
} {
  const [state, retry] = usePublicResource(
    enabled,
    loadProfiles,
    "Profiles unavailable",
    15_000,
  );
  return { state, retry };
}
function dollars(n: bigint) {
  return formatMicroUsdc(n.toString());
}
export function ProfileActivity({
  work,
  awards,
  pointsMissing,
  revisions,
  login,
  actorId,
  showIdentity = false,
  cycles,
  census,
  summary,
  badges,
  children,
}: {
  login: string;
  work?: readonly ScoreEvent[];
  awards?: PointsMember["awards"];
  /** Shown per record while the points journal is loading or unavailable. */
  pointsMissing?: string;
  revisions?: readonly PointRevision[];
  actorId?: string;
  showIdentity?: boolean;
  cycles?: CycleIndex;
  census: ReturnType<typeof useProfiles>;
  summary?: ReactNode;
  badges?: ReactNode;
  /** Sections shown between the record and the activity timeline. */
  children?: ReactNode;
}) {
  const { state, retry } = census;
  const matches =
    state.status === "ready"
      ? state.index.people.filter((p) =>
          actorId
            ? p.id === actorId
            : p.login.toLowerCase() === login.toLowerCase(),
        )
      : [];
  const p = matches.length === 1 ? matches[0] : undefined;
  const id = actorId ?? p?.id;
  const counts = p
    ? profileCounts(p)
    : id && state.status === "ready"
      ? { merged: 0, open: 0, closed: 0 }
      : null;
  const image =
    p?.avatarUrl ??
    `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`;
  const payments =
    cycles && id
      ? cycles.cycles.flatMap((c) =>
          c.contributors
            .filter((m) => m.actor.id === id && m.state === "paid")
            .map((m) => ({
              date: c.settledAt,
              amount: BigInt(m.paidMinor),
              href: `/cycles/${c.projectId}/${c.cycleId}`,
              name: `${findProject(c.projectId)?.name ?? c.projectId} · ${formatCycleMonth(c.cycleId)}`,
            })),
        )
      : null;
  const githubUserId = id
    ? /^[1-9]\d*$/u.test(id)
      ? id
      : githubUserIdFromNodeId(id)
    : null;
  const [directState, retryDirect] = useDirectTransfers(
    githubUserId ? { githubUserId } : null,
  );
  const direct =
    !githubUserId || directState.status !== "ready"
      ? null
      : directState.transfers.map((t) => ({
          date: t.blockTime,
          amount: BigInt(t.amountMicro),
          href:
            transactionUrl(t.network, t.transactionId) ??
            `/projects/${encodeURIComponent(t.projectId)}/funding`,
          name: `${findProject(t.projectId)?.name ?? t.projectId} · ${formatCycleMonth(t.contributionMonth)}`,
        }));
  return (
    <section className="profile-activity" aria-label="Contributor profile">
      {showIdentity ? (
        <ContributorIdentity
          actor={{
            login: p?.login ?? login,
            avatarUrl: image,
            url: `https://github.com/${encodeURIComponent(p?.login ?? login)}`,
          }}
        />
      ) : null}
      {badges}
      <div className="profile-totals">
        {summary}
        <div>
          <strong>
            {payments && direct
              ? dollars(
                  [...payments, ...direct].reduce((n, r) => n + r.amount, 0n),
                )
              : (!id && state.status === "loading") ||
                  (Boolean(githubUserId) && directState.status === "loading")
                ? "Loading…"
                : "Unavailable"}
          </strong>
          <span>paid · USDC</span>
        </div>
      </div>
      {githubUserId && directState.status === "error" ? (
        <p role="status">
          <span>Payment records unavailable.</span>{" "}
          <button type="button" onClick={retryDirect}>
            Retry payment records
          </button>
        </p>
      ) : githubUserId && directState.status === "loading" ? (
        <p role="status">Loading payment records…</p>
      ) : null}
      {state.status === "error" ? (
        <p role="status">
          PR counts are unavailable.{" "}
          <button type="button" onClick={retry}>
            Retry profile
          </button>
        </p>
      ) : state.status === "loading" ? (
        <p role="status">Loading PR history…</p>
      ) : counts ? (
        <PullRequestBar counts={counts} login={p?.login ?? login} />
      ) : null}
      {revisions ? <PointsRevisionHistory revisions={revisions} /> : null}
      {children}
      {payments && direct ? (
        <PayoutList payments={payments} direct={direct} />
      ) : null}
      <ProfileTimeline
        work={work}
        awards={awards}
        pointsMissing={pointsMissing}
      />
      {state.status === "ready" && id ? (
        <IssueOutcomes key={id} index={state.index} actorId={id} />
      ) : null}
    </section>
  );
}

const PR_SEGMENTS = [
  ["merged", "Merged", "is:merged"],
  ["open", "Open", "is:open"],
  ["closed", "Closed without merging", "is:closed is:unmerged"],
] as const;

function PullRequestBar({
  counts,
  login,
}: {
  counts: { merged: number; open: number; closed: number };
  login: string;
}) {
  const total = counts.merged + counts.open + counts.closed;
  const decided = counts.merged + counts.closed;
  return (
    <section className="profile-card" aria-label="Pull requests">
      <div className="profile-card-heading">
        <h2>Pull requests</h2>
        <span>
          {total.toLocaleString()} total
          {decided > 0
            ? ` · ${Math.round((counts.merged * 100) / decided)}% merged`
            : ""}
        </span>
      </div>
      {total > 0 ? (
        <div className="pr-bar" aria-hidden="true">
          {PR_SEGMENTS.map(([key]) =>
            counts[key] > 0 ? (
              <span
                className={`pr-bar-${key}`}
                key={key}
                style={{ flexGrow: counts[key] }}
              />
            ) : null,
          )}
        </div>
      ) : null}
      <ul className="pr-legend">
        {PR_SEGMENTS.map(([key, label, query]) => (
          <li key={key}>
            <span className={`pr-dot pr-bar-${key}`} aria-hidden="true" />
            <a
              href={`https://github.com/pulls?q=${encodeURIComponent(`is:pr author:${login} ${query}`)}`}
            >
              <strong>{counts[key].toLocaleString()}</strong> PRs{" "}
              {label.toLowerCase()}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ACTIVITY_DAYS = 35;

/** The same point awards shown in the activity timeline, grouped by UTC day. */
function ActivityChart({ awards }: { awards: PointsMember["awards"] }) {
  const days = dailyPoints(awards, new Date(), ACTIVITY_DAYS);
  const max = Math.max(...days.map((entry) => entry.points));
  if (max <= 0) return null;
  const total = days.reduce((sum, entry) => sum + entry.points, 0);
  return (
    <figure className="activity-chart">
      <figcaption>
        {total.toLocaleString()} points in the last {ACTIVITY_DAYS} days
      </figcaption>
      <div className="activity-bars" aria-hidden="true">
        {days.map((entry) => (
          <span
            key={entry.day}
            style={{ height: `${Math.max(4, (entry.points / max) * 100)}%` }}
            className={entry.points > 0 ? "" : "activity-bar-empty"}
            title={`${formatDate(entry.day)} · ${entry.points.toLocaleString()} points`}
          />
        ))}
      </div>
    </figure>
  );
}

type Payout = {
  date: string | null;
  amount: bigint;
  href: string;
  name: string;
};

function PayoutList({
  payments,
  direct,
}: {
  payments: Payout[];
  direct: Payout[];
}) {
  const rows = [
    ...payments.map((payment) => ({ ...payment, kind: "Verified settlement" })),
    ...direct.map((payment) => ({ ...payment, kind: "Direct transfer" })),
  ].sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") ||
      a.href.localeCompare(b.href),
  );
  if (rows.length === 0) return null;
  return (
    <section className="profile-card" aria-label="Payouts">
      <div className="profile-card-heading">
        <h2>Payouts</h2>
        <span>
          {dollars(rows.reduce((total, row) => total + row.amount, 0n))} USDC
        </span>
      </div>
      <ul className="payout-list">
        {rows.map((row) => (
          <li key={`${row.kind}:${row.href}`}>
            <ExternalLinkAnchor href={row.href}>
              <span>
                <strong>{row.name}</strong>
                <small>
                  {row.date ? formatDate(row.date) : "Date unavailable"} ·{" "}
                  {row.kind}
                </small>
              </span>
              <strong className="payout-amount">{dollars(row.amount)}</strong>
            </ExternalLinkAnchor>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PointsRevisionHistory({
  revisions,
}: {
  revisions: readonly PointRevision[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!revisions.length) return null;
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const ordered = [...revisions].reverse();
  return (
    <details className="points-revisions">
      <summary>Points decision history ({revisions.length})</summary>
      <p>Each entry replaces the prior amount for that contribution.</p>
      <ol className="points-history">
        {(expanded ? ordered : ordered.slice(0, 10)).map((revision) => {
          const previous = revision.previous
            ? byId.get(revision.previous)
            : undefined;
          const delta = revision.award.amount - (previous?.award.amount ?? 0);
          return (
            <li key={revision.id}>
              <ExternalLinkAnchor href={revision.award.sourceUrl}>
                {revision.award.category.replaceAll("-", " ")}
              </ExternalLinkAnchor>
              <p>
                {previous?.award.amount.toLocaleString() ?? "0"} →{" "}
                {revision.award.amount.toLocaleString()} Points · Change:{" "}
                {delta > 0 ? "+" : ""}
                {delta.toLocaleString()}
                {revision.award.provisional ? " · Provisional" : ""}
              </p>
              <p>
                {revision.decision?.reason ??
                  "This earlier record does not include a separate decision reason."}
              </p>
              <dl>
                <dt>Work occurred</dt>
                <dd>
                  <time dateTime={revision.award.occurredAt}>
                    {new Date(revision.award.occurredAt).toLocaleString()}
                  </time>
                </dd>
                <dt>Decision effective</dt>
                <dd>
                  {revision.decision ? (
                    <time dateTime={revision.decision.effectiveAt}>
                      {new Date(revision.decision.effectiveAt).toLocaleString()}
                    </time>
                  ) : (
                    "Not recorded in this earlier revision"
                  )}
                </dd>
                <dt>Recorded</dt>
                <dd>
                  <time dateTime={revision.recordedAt}>
                    {new Date(revision.recordedAt).toLocaleString()}
                  </time>
                </dd>
                <dt>Rule</dt>
                <dd>{revision.sourceRule}</dd>
                <dt>Revision</dt>
                <dd>
                  <code>{revision.id}</code>
                </dd>
                <dt>Predecessor</dt>
                <dd>
                  {revision.previous ? (
                    <code>{revision.previous}</code>
                  ) : (
                    "First record"
                  )}
                </dd>
                {revision.decision ? (
                  <>
                    <dt>Decision source</dt>
                    <dd>
                      <code>{revision.decision.sourceId}</code>
                    </dd>
                  </>
                ) : null}
              </dl>
            </li>
          );
        })}
      </ol>
      {ordered.length > 10 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show recent decisions"
            : `View all ${ordered.length} decisions`}
        </button>
      ) : null}
    </details>
  );
}

function ProfileTimeline({
  work = [],
  awards = [],
  pointsMissing,
}: {
  work?: readonly ScoreEvent[];
  awards?: PointsMember["awards"];
  pointsMissing?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const unmatchedAwards = new Map(awards.map((award) => [award.key, award]));
  const records = [
    ...work.map((event) => {
      const project = findIngestedProjectByRepositoryId(event.repository);
      if (!project)
        throw new TypeError(
          `Score event ${event.id} has no registered project`,
        );
      const candidate = unmatchedAwards.get(
        pointKey(
          project.id,
          event.actor.id,
          event.category,
          event.category === "evidence" ? event.id : event.source.id,
        ),
      );
      const award =
        candidate?.sourceUrl === event.source.url &&
        candidate.occurredAt === new Date(event.occurredAt).toISOString()
          ? candidate
          : undefined;
      if (award) unmatchedAwards.delete(award.key);
      return {
        key: `work:${event.id}`,
        date: event.occurredAt,
        href: event.evaluation?.decisionUrl ?? event.source.url,
        title: event.source.title,
        detail: `${project.name} · ${event.category.replaceAll("-", " ")}${event.evaluation ? ` · reviewed by ${event.evaluation.reviewer}` : ""}`,
        amount: award
          ? `+${award.amount.toLocaleString()} Points${award.provisional ? " · Provisional tier" : ""}`
          : (pointsMissing ?? "Points pending"),
      };
    }),
    ...[...unmatchedAwards.values()].map((award) => ({
      key: `points:${award.key}`,
      date: award.occurredAt,
      href: award.sourceUrl,
      title: award.category.replaceAll("-", " "),
      detail: `${findProject(award.projectId)?.name ?? award.projectId}${award.provisional ? " · Provisional tier" : ""}`,
      amount: `+${award.amount.toLocaleString()} Points`,
    })),
  ].sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") || a.key.localeCompare(b.key),
  );
  if (records.length === 0) return null;
  const groups = new Map<string, typeof records>();
  for (const record of expanded ? records : records.slice(0, 10)) {
    const day = record.date?.slice(0, 10) ?? "";
    const group = groups.get(day) ?? [];
    group.push(record);
    groups.set(day, group);
  }
  return (
    <section className="profile-timeline" aria-label="Contribution activity">
      <h2>Activity</h2>
      {pointsMissing ? null : <ActivityChart awards={awards} />}
      {records.length > 10 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show recent activity"
            : `View all ${records.length} activity records`}
        </button>
      ) : null}
      {[...groups].map(([day, rows]) => (
        <section key={day}>
          <h3>
            {day ? (
              <time dateTime={day}>{formatDate(day)}</time>
            ) : (
              "Date unavailable"
            )}
          </h3>
          <ul className="points-history">
            {rows.map((row) => (
              <li key={row.key} data-activity-date={row.date ?? ""}>
                <ExternalLinkAnchor href={row.href}>
                  <strong>{row.title}</strong>
                </ExternalLinkAnchor>
                <small>
                  {row.amount} · {row.detail}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function IssueOutcomes({
  index,
  actorId,
}: {
  index: ProfileIndex;
  actorId: string;
}) {
  const [open, setOpen] = useState(false);
  const [repository, setRepository] = useState("");
  const [period, setPeriod] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const issues =
    index.issues?.items.filter((issue) => issue.authorId === actorId) ?? [];
  const repositories = [
    ...new Set(issues.map((issue) => issue.repository)),
  ].sort();
  const periods = [
    ...new Set(
      issues
        .flatMap((issue) => [
          issue.createdAt,
          ...issue.events.map((event) => event.occurredAt),
        ])
        .map((date) => new Date(date).toISOString().slice(0, 7)),
    ),
  ]
    .sort()
    .reverse();
  const counts = profileIssueOutcomes(
    issues,
    actorId,
    repository || undefined,
    period || undefined,
  );
  const denominator = counts.completed + counts.notPlanned;
  const history = issues
    .filter((issue) => !repository || issue.repository === repository)
    .flatMap((issue) => [
      {
        issue,
        id: `opened:${issue.id}`,
        date: issue.createdAt,
        label: "Opened",
      },
      ...issue.events.map((event) => ({
        issue,
        id: event.id,
        date: event.occurredAt,
        label:
          event.kind === "closed"
            ? event.reason === "COMPLETED"
              ? "Completed"
              : event.reason === "NOT_PLANNED"
                ? "Not planned"
                : event.reason === "DUPLICATE"
                  ? "Closed as duplicate"
                  : "Closed · reason unknown"
            : event.kind === "reopened"
              ? "Reopened"
              : event.kind === "transferred"
                ? "Transferred"
                : event.relatedIssueId === issue.id
                  ? event.kind === "duplicate"
                    ? "Another issue marked as duplicate"
                    : "Duplicate reference removed"
                  : event.kind === "duplicate"
                    ? "Marked as duplicate"
                    : "Duplicate mark removed",
      })),
    ])
    .filter(
      (event) =>
        !period || new Date(event.date).toISOString().slice(0, 7) === period,
    )
    .sort(
      (left, right) =>
        Date.parse(right.date) - Date.parse(left.date) ||
        left.id.localeCompare(right.id),
    );
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Issue outcomes</summary>
      {open ? (
        index.issues ? (
          <>
            <label>
              Repository
              <select
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
              >
                <option value="">All tracked repositories</option>
                {repositories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Period (UTC)
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              >
                <option value="">Recorded history</option>
                {periods.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </label>
            <p>
              {denominator
                ? `${counts.completed.toLocaleString()} completed : ${counts.notPlanned.toLocaleString()} not planned · ${(counts.completed / denominator).toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 })} completion rate`
                : "Not enough data for a completion rate."}
            </p>
            <dl className="issue-outcome-counts">
              {(
                [
                  ["Open", counts.open],
                  ["Reopened", counts.reopened],
                  ["Completed", counts.completed],
                  ["Not planned", counts.notPlanned],
                  ["Duplicate", counts.duplicate],
                  ["Unknown close reason", counts.unknown],
                  ["Source unavailable", counts.unavailable],
                  ["History incomplete", counts.incomplete],
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{count.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
            <p className="points-meta">
              {period
                ? "Final state at month end for issues opened or transitioned in this month."
                : "Latest recorded GitHub state."}{" "}
              Duplicate, unknown, unavailable and incomplete outcomes are
              excluded from the rate.
            </p>
            {counts.incomplete ? (
              <p>
                {counts.incomplete.toLocaleString()} issues have a current
                GitHub state that their visible history does not explain, for
                example when GitHub hides events by an account that is no longer
                available.
              </p>
            ) : null}
            {counts.transferred ? (
              <p>
                {counts.transferred.toLocaleString()} issues have a transfer in
                their recorded history.
              </p>
            ) : null}
            {counts.corrected ? (
              <p>
                {counts.corrected.toLocaleString()} histories include a later
                source correction.
              </p>
            ) : null}
            <details
              onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
            >
              <summary>
                Issue history · {history.length.toLocaleString()} records
              </summary>
              {historyOpen ? (
                <ul className="points-history">
                  {history.map((record) => {
                    const repository = TARGET_REPOSITORIES.find(
                      (candidate) => candidate.id === record.issue.repository,
                    );
                    if (!repository)
                      throw new TypeError("Issue repository is not registered");
                    return (
                      <li key={record.id}>
                        <time dateTime={record.date}>
                          {formatDateTime(record.date)}
                        </time>
                        {" · "}
                        <a
                          href={`https://github.com/${repository.owner}/${repository.name}/issues/${record.issue.number}`}
                        >
                          {record.issue.repository}#{record.issue.number}
                        </a>
                        {" · "}
                        {record.label}
                        {record.issue.unavailableSince
                          ? " · Source now unavailable"
                          : ""}
                        {record.issue.historyIncompleteSince != null
                          ? " · History incomplete"
                          : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </details>
            <p className="points-meta">
              Coverage: accessible issues in the tracked repositories, plus
              retained records first captured from{" "}
              {formatDate(index.issues.firstObservedAt)}. Records deleted before
              capture may be absent.
            </p>
          </>
        ) : (
          <p>Issue history is unavailable in this census.</p>
        )
      ) : null}
    </details>
  );
}
