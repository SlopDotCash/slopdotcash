import { Fragment, type ReactNode, useState } from "react";
import { Link } from "./Link";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import type { CycleIndex } from "./lib/cycle-index";
import { deploymentTier } from "./lib/deployment";
import { ESCROW_NETWORKS } from "./lib/escrow-policy.mjs";
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
import { isUsdMicroAsset } from "./lib/received-totals";
import { NETWORK_NAMES } from "./lib/reward-asset.mjs";
import { useDirectTransfers } from "./lib/use-direct-transfers";
import {
  type PublicResourceState,
  usePublicResource,
} from "./lib/use-public-resource";
import { useVaultPayments } from "./lib/use-vault-payments";
import { PaymentRecord, VaultPaymentRecord } from "./PaymentRecords";
import {
  ContributorIdentity,
  cycleContributorStateLabel,
  cycleLifecycleLabel,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
  formatPercent,
  formatPointsFromThirds,
} from "./Presentation";

async function loadProfiles(signal: AbortSignal) {
  // Reuse stored bytes only after the server revalidates the identity directory.
  const response = await fetchWithDeadline("/data/profiles.json", {
    signal,
    cache: "no-cache",
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
      <div className="profile-totals">{summary}</div>
      {awards ? <ActivityChart awards={awards} /> : null}
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
      {id ? <ProfilePaymentHistory actorId={id} cycles={cycles} /> : null}
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
      <figcaption>Daily activity · last {ACTIVITY_DAYS} days</figcaption>
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

/** One record list keeps archived awards, direct transfers and vault payments distinct. */
function ProfilePaymentHistory({
  actorId,
  cycles,
}: {
  actorId: string;
  cycles?: CycleIndex;
}) {
  const [showAll, setShowAll] = useState(false);
  const githubUserId = /^[1-9]\d*$/u.test(actorId)
    ? actorId
    : githubUserIdFromNodeId(actorId);
  const scope = githubUserId ? { githubUserId } : null;
  const [directState, retryDirect] = useDirectTransfers(scope);
  const [vaultState, retryVault] = useVaultPayments(scope);
  const history = (cycles?.cycles ?? []).flatMap((cycle) =>
    cycle.contributors
      .filter((contributor) => contributor.actor.id === actorId)
      .map((contributor) => ({ contributor, cycle })),
  );
  const direct = directState.status === "ready" ? directState.transfers : [];
  // All-time money received: archived cycles, disclosed direct transfers and
  // finalized USD-stablecoin vault payments. Other vault assets stay listed
  // in their own units and never convert to dollars.
  const vaultUsd =
    vaultState.status === "ready"
      ? vaultState.payments.reduce(
          (sum, payment) =>
            isUsdMicroAsset(
              payment.network,
              payment.assetAddress,
              payment.assetDecimals,
              deploymentTier(import.meta.env.VITE_SLOP_ENVIRONMENT) ===
                "staging",
            )
              ? sum + BigInt(payment.netBase)
              : sum,
          0n,
        )
      : null;
  const total =
    cycles && directState.status === "ready" && vaultUsd !== null
      ? history.reduce(
          (sum, { contributor }) =>
            sum +
            (contributor.state === "paid" ? BigInt(contributor.paidMinor) : 0n),
          direct.reduce(
            (sum, payment) => sum + BigInt(payment.amountMicro),
            vaultUsd,
          ),
        )
      : null;
  const entries = [
    ...history.map(({ contributor, cycle }) => ({
      id: `cycle:${cycle.projectId}:${cycle.cycleId}`,
      sortAt: cycle.settledAt ?? cycle.approvedAt ?? cycle.generatedAt,
      content: (
        <PaymentRecord
          name={
            <Link href={`/cycles/${cycle.projectId}/${cycle.cycleId}`}>
              {findProject(cycle.projectId)?.name ?? cycle.projectId} ·{" "}
              {formatCycleMonth(cycle.cycleId)}
            </Link>
          }
          detail={
            <>
              Archived cycle · {cycleLifecycleLabel(cycle)} ·{" "}
              {formatPointsFromThirds(
                contributor.scoreThirds ?? contributor.score * 3,
              )}{" "}
              points
            </>
          }
          amount={
            <>
              <strong>
                {cycle.kind === "external-prize-share"
                  ? contributor.sharePartsPerMillion === null
                    ? "Share not recorded"
                    : `${formatPercent(contributor.sharePartsPerMillion)} share`
                  : `${formatMicroUsdc(
                      contributor.state === "paid"
                        ? contributor.paidMinor
                        : contributor.approvedMinor !== "0"
                          ? contributor.approvedMinor
                          : contributor.suggestedMinor,
                    )} USDC`}
              </strong>
              <small>{cycleContributorStateLabel(contributor.state)}</small>
            </>
          }
        />
      ),
    })),
    ...direct.map((payment) => {
      const network =
        ESCROW_NETWORKS[payment.network as keyof typeof ESCROW_NETWORKS];
      const href = transactionUrl(payment.network, payment.transactionId);
      return {
        id: `direct:${payment.network}:${payment.transactionId}`,
        sortAt: payment.blockTime,
        content: (
          <PaymentRecord
            name={findProject(payment.projectId)?.name ?? payment.projectId}
            detail={
              <>
                Direct transfer · {NETWORK_NAMES[payment.chain]}
                {network?.testnet ? " testnet" : ""} · Work month:{" "}
                {formatCycleMonth(payment.contributionMonth)} · Paid{" "}
                {formatDate(payment.blockTime)}
              </>
            }
            amount={
              <>
                <strong>{formatMicroUsdc(payment.amountMicro)} USDC</strong>
                <small>Paid directly</small>
              </>
            }
            action={
              href ? (
                <ExternalLinkAnchor href={href}>
                  View transaction
                </ExternalLinkAnchor>
              ) : (
                <Link href={`/projects/${payment.projectId}/funding`}>
                  Funding record
                </Link>
              )
            }
          />
        ),
      };
    }),
    ...(vaultState.status === "ready" ? vaultState.payments : []).map(
      (payment) => ({
        id: `vault:${payment.id}`,
        sortAt: payment.indexedAt,
        content: <VaultPaymentRecord payment={payment} />,
      }),
    ),
  ].sort(
    (left, right) =>
      right.sortAt.localeCompare(left.sortAt) ||
      left.id.localeCompare(right.id),
  );
  return (
    <section
      className="profile-card profile-payments"
      aria-label="Awards and payments"
    >
      <div className="profile-card-heading">
        <h2>Awards and payments</h2>
      </div>
      <p className="profile-payments-summary">
        Money received (all time):{" "}
        <strong>
          {total !== null
            ? dollars(total)
            : scope &&
                directState.status !== "error" &&
                vaultState.status !== "error"
              ? "Loading…"
              : "Unavailable"}
        </strong>
      </p>
      <div className="profile-payment-notices">
        {!scope ? (
          <p role="status">Payment identity unavailable.</p>
        ) : directState.status === "error" ? (
          <p role="status">
            Direct payment records unavailable.{" "}
            <button className="text-button" type="button" onClick={retryDirect}>
              Retry payment records
            </button>
          </p>
        ) : directState.status === "loading" ? (
          <p role="status">Loading direct payments…</p>
        ) : null}
        {!scope ? null : vaultState.status === "error" ? (
          <p role="status">
            Project payment records unavailable.{" "}
            <button className="text-button" type="button" onClick={retryVault}>
              Retry project payments
            </button>
          </p>
        ) : vaultState.status === "loading" ? (
          <p role="status">Loading project payments…</p>
        ) : null}
      </div>
      {entries.length > 0 ? (
        <ul className="payment-records">
          {(showAll ? entries : entries.slice(0, 5)).map((entry) => (
            <Fragment key={entry.id}>{entry.content}</Fragment>
          ))}
        </ul>
      ) : directState.status === "ready" && vaultState.status === "ready" ? (
        <p>No awards or payments recorded.</p>
      ) : null}
      {entries.length > 5 ? (
        <button
          className="button secondary-button button-small"
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll
            ? "Show recent records"
            : `Show all ${entries.length} records`}
        </button>
      ) : null}
    </section>
  );
}
