import { type ReactNode, useState } from "react";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import type { CycleIndex } from "./lib/cycle-index";
import { githubUserIdFromNodeId } from "./lib/github-actor";
import { transactionUrl } from "./lib/payments/contracts";
import type { PointsMember } from "./lib/points";
import { dailyPoints } from "./lib/profile-activity";
import {
  assertProfiles,
  type ProfileIndex,
  profileCounts,
} from "./lib/profiles";
import { findProject } from "./lib/projects.mjs";
import { useDirectTransfers } from "./lib/use-direct-transfers";
import {
  type PublicResourceState,
  usePublicResource,
} from "./lib/use-public-resource";
import {
  ContributorIdentity,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
} from "./Presentation";
import { VaultPaymentHistory } from "./VaultPaymentHistory";

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
export function useProfiles(enabled = true): {
  state: PublicResourceState<{ index: ProfileIndex }>;
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
  awards,
  login,
  actorId,
  showIdentity,
  cycles,
  census,
  summary,
  badges,
  children,
}: {
  login: string;
  awards?: PointsMember["awards"];
  actorId?: string;
  showIdentity: boolean;
  cycles?: CycleIndex;
  census: ReturnType<typeof useProfiles>;
  summary?: ReactNode;
  badges?: ReactNode;
  /** Sections shown between the record and the activity chart. */
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
    directState.status === "ready"
      ? directState.transfers.map((t) => ({
          date: t.blockTime,
          amount: BigInt(t.amountMicro),
          href:
            transactionUrl(t.network, t.transactionId) ??
            `/projects/${encodeURIComponent(t.projectId)}/funding`,
          name: `${findProject(t.projectId)?.name ?? t.projectId} · ${formatCycleMonth(t.contributionMonth)}`,
        }))
      : [];
  const paid =
    payments && directState.status === "ready"
      ? [...payments, ...direct].reduce((total, row) => total + row.amount, 0n)
      : null;
  const paidMissing =
    (!id && state.status === "loading") ||
    (githubUserId && directState.status === "loading")
      ? "Loading…"
      : "Unavailable";
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
      {awards ? <ActivityChart awards={awards} /> : null}
      <div className="profile-totals">
        {summary}
        <div>
          <strong>{paid === null ? paidMissing : dollars(paid)}</strong>
          <span>direct and archived payments · USDC</span>
        </div>
      </div>
      {directState.status === "error" ? (
        <p role="status">
          Payment records unavailable.{" "}
          <button
            className="button secondary-button button-small"
            type="button"
            onClick={retryDirect}
          >
            Retry payment records
          </button>
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="status">
          PR counts are unavailable.{" "}
          <button
            className="button secondary-button button-small"
            type="button"
            onClick={retry}
          >
            Retry profile
          </button>
        </p>
      ) : state.status === "loading" ? (
        <p role="status">Loading PR history…</p>
      ) : counts ? (
        <PullRequestBar counts={counts} login={p?.login ?? login} />
      ) : null}
      {children}
      <PayoutList
        payments={payments ?? []}
        direct={direct}
        total={paid === null ? paidMissing : `${dollars(paid)} USDC`}
      />
      <VaultPaymentHistory scope={githubUserId ? { githubUserId } : null} />
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
  return (
    <figure
      className="activity-chart"
      aria-label={`Points per day, last ${ACTIVITY_DAYS} days`}
    >
      <figcaption>Points · last {ACTIVITY_DAYS} days</figcaption>
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
  total,
}: {
  payments: Payout[];
  direct: Payout[];
  total: string;
}) {
  const [allPayouts, setAllPayouts] = useState(false);
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
        <span>{total}</span>
      </div>
      <ul className="payout-list">
        {(allPayouts ? rows : rows.slice(0, 3)).map((row) => (
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
      {rows.length > 3 ? (
        <button
          className="button secondary-button button-small"
          type="button"
          aria-expanded={allPayouts}
          onClick={() => setAllPayouts(!allPayouts)}
        >
          {allPayouts
            ? "Show recent payouts"
            : `Show all ${rows.length} payouts`}
        </button>
      ) : null}
    </section>
  );
}
