import { ArrowRight, CircleAlert, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "./Link";
import type { CycleIndexEntry } from "./lib/cycle-index";
import type { GitHubActor, LeaderboardSnapshot } from "./lib/leaderboard";
import type { ProjectDefinition } from "./lib/projects.mjs";
import type { DataState } from "./lib/use-snapshot";

export function DataNotice({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <p className="data-notice" role="status">
        Loading records…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="data-notice data-error" role="alert">
        <CircleAlert aria-hidden="true" size={18} />
        <span>Live totals unavailable: {state.message}</span>
        <button onClick={retry} type="button">
          <RotateCcw aria-hidden="true" size={15} /> Retry
        </button>
      </div>
    );
  }
  // PRD section 9: a refresh that fails keeps the last good snapshot.
  if (state.refreshError !== undefined) {
    return (
      <p className="data-notice data-stale" role="status">
        Points may be outdated · updated{" "}
        {formatDateTime(state.snapshot.generatedAt)}. Refresh failed:{" "}
        {state.refreshError}
        <button onClick={retry} type="button">
          <RotateCcw aria-hidden="true" size={15} /> Retry
        </button>
      </p>
    );
  }
  // PRD section 9: a release that cannot refresh keeps the last good snapshot.
  if (stale(state.snapshot)) {
    return (
      <p className="data-notice data-stale" role="status">
        Points may be outdated · updated{" "}
        {formatDateTime(state.snapshot.generatedAt)}
      </p>
    );
  }
  return null;
}

export function stale(
  snapshot: Pick<LeaderboardSnapshot, "generatedAt">,
): boolean {
  return Date.now() - Date.parse(snapshot.generatedAt) > 8 * 60 * 60 * 1_000;
}

/** Date and time in UTC, for timestamps shown beside formatDate values. */
export function formatDateTime(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value))} UTC`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function formatTime(value: string | null): string {
  if (value === null) return "—";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

/** Optional admin timestamps include an explicit UTC suffix. */
export function formatNullableUtc(value: string | null): string {
  return value === null ? "—" : `${formatTime(value)} UTC`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

/** Renders as a section when the route already provides its own `main`. */
export function NotFound({
  title = "Page not found",
  children,
  as: Element = "main",
}: {
  title?: string;
  children?: ReactNode;
  as?: "main" | "section";
}) {
  return (
    <Element className={Element === "main" ? "shell not-found" : "not-found"}>
      <h1>{title}</h1>
      {children}
      <Link className="button primary-button" href="/">
        See open projects <ArrowRight aria-hidden="true" />
      </Link>
    </Element>
  );
}

export function formatMicroUsdc(value: string): string {
  const amount = BigInt(value);
  const fraction = amount % 1_000_000n;
  if (fraction === 0n) {
    return `$${new Intl.NumberFormat("en-US").format(amount / 1_000_000n)}`;
  }
  const roundedCents = (amount + 5_000n) / 10_000n;
  const whole = roundedCents / 100n;
  const cents = (roundedCents % 100n).toString().padStart(2, "0");
  return `$${new Intl.NumberFormat("en-US").format(whole)}.${cents}`;
}

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

export function ExternalLinkAnchor({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <a className={className} href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

export function formatCycleMonth(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

/**
 * Stored cycle states keep their recorded names; pages show the PRD section 6
 * award and payment words instead (awards: projected, under review, approved,
 * excluded; payments: underfunded, awaiting wallet, ready, held, submitted,
 * paid).
 */
const CYCLE_STATE_LABELS: Record<CycleIndexEntry["state"], string> = {
  "closed-no-awards": "Closed, no awards",
  "external-provisional": "Provisional external shares",
  review: "Under review",
  "payment-ready": "Approved",
  "settlement-planned": "Approved, payment ready",
  paid: "Paid",
  "wound-up": "Approved, payment held",
};

export function cycleStateLabel(state: CycleIndexEntry["state"]): string {
  return CYCLE_STATE_LABELS[state];
}

/** A contributor's recorded cycle row in PRD section 6 award and payment words. */
const CYCLE_CONTRIBUTOR_STATE_LABELS: Record<
  CycleIndexEntry["contributors"][number]["state"],
  string
> = {
  proposed: "Under review",
  approved: "Approved",
  excluded: "Excluded",
  "external-share": "External prize share",
  unclaimed: "Awaiting wallet",
  held: "Held",
  "held-below-minimum": "Held below the payment minimum",
  paid: "Paid",
};

export function cycleContributorStateLabel(
  state: CycleIndexEntry["contributors"][number]["state"],
): string {
  return CYCLE_CONTRIBUTOR_STATE_LABELS[state];
}

/**
 * A closed review window waits on owner approval. The record keeps its
 * `review` state, so the page derives this from `reviewEndsAt`.
 */
export function awaitingApproval(
  cycle: Pick<CycleIndexEntry, "approvedAt" | "reviewEndsAt" | "state">,
  now = Date.now(),
): boolean {
  return (
    cycle.state === "review" &&
    cycle.approvedAt === null &&
    cycle.reviewEndsAt !== null &&
    Date.parse(cycle.reviewEndsAt) <= now
  );
}

export function cycleLifecycleLabel(
  cycle: Pick<CycleIndexEntry, "approvedAt" | "reviewEndsAt" | "state">,
): string {
  return awaitingApproval(cycle)
    ? "Under review, awaiting approval"
    : cycleStateLabel(cycle.state);
}

export function reviewBudgetLabel(
  reviewBudget: NonNullable<ProjectDefinition["reward"]["reviewBudget"]>,
): string {
  return reviewBudget.fundingState === "committed"
    ? `${formatMicroUsdc(reviewBudget.committedMinor)} of ${reviewBudget.monthlyCapDisplay} review budget funded`
    : `${reviewBudget.monthlyCapDisplay} review budget · not funded`;
}

/**
 * Commitment is a balance claim, never proof that signers can act. This
 * protocol has no authenticated accessibility evidence type yet.
 */
export function monthlyPoolUnfunded(
  reward: Pick<ProjectDefinition["reward"], "committedMinor" | "fundingState">,
): boolean {
  return (
    reward.fundingState !== "committed" || BigInt(reward.committedMinor) === 0n
  );
}

export function monthlyPoolLabel(
  reward: Pick<
    ProjectDefinition["reward"],
    "committedMinor" | "fundingState" | "monthlyCapDisplay"
  >,
): string {
  return monthlyPoolUnfunded(reward)
    ? `${reward.monthlyCapDisplay} monthly target · not funded`
    : `${formatMicroUsdc(reward.committedMinor)} funded · ${reward.monthlyCapDisplay} monthly target`;
}

export function Avatar({
  actor,
  size = "medium",
}: {
  actor: Pick<GitHubActor, "login" | "avatarUrl">;
  size?: "large" | "medium" | "small";
}) {
  const label = actor.login.slice(0, 2).toUpperCase();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl !== actor.avatarUrl) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={`avatar avatar-${size}`}
        onError={() => setFailedUrl(actor.avatarUrl)}
        src={actor.avatarUrl}
      />
    );
  }
  return (
    <span aria-hidden="true" className={`avatar avatar-${size}`}>
      {label}
    </span>
  );
}

export function formatPercent(partsPerMillion: number): string {
  return `${(partsPerMillion / 10_000).toFixed(2)}%`;
}

/** A pledged pool never headlines its cap; the cap is small print only. */
export const UNFUNDED_POOL_HEADLINE = "Not funded yet";

/** A $0 monthly pool pays no money; accepted work still earns points. */
export function monthlyPoolPointsOnly(
  reward: Pick<ProjectDefinition["reward"], "kind" | "monthlyCapMinor">,
): boolean {
  return reward.kind === "monthly-pool" && reward.monthlyCapMinor === "0";
}

/** One identity header for scored, historical and newly registered contributors. */
export function ContributorIdentity({
  actor,
  children,
}: {
  actor: Pick<GitHubActor, "login" | "avatarUrl" | "url">;
  children?: ReactNode;
}) {
  return (
    <section className="profile-hero">
      <Avatar actor={actor} size="large" />
      <div className="profile-identity">
        <h1>{actor.login}</h1>
        <div className="profile-links">
          <ExternalLinkAnchor href={actor.url}>
            GitHub · @{actor.login}
          </ExternalLinkAnchor>
          {children}
        </div>
      </div>
    </section>
  );
}

/** Current vault lifecycle shared by contributor and sponsor guidance (PAY-01). */
export function PaymentLifecycle() {
  return (
    <>
      <h3>Award review</h3>
      <ol className="payment-stages" aria-label="Award review stages">
        <li>
          <strong>Projected</strong>
          <span>An estimate from accepted work, not an approved award.</span>
        </li>
        <li>
          <strong>Under review</strong>
          <span>
            A closed month&apos;s allocations, adjustable by the owner until the
            monthly cutoff.
          </span>
        </li>
        <li>
          <strong>Approved</strong>
          <span>
            The owner approved the amount. Funding and payment are separate.
          </span>
        </li>
        <li>
          <strong>Excluded</strong>
          <span>
            A recorded decision, such as a payout exclusion or ban, keeps the
            award out of payment.
          </span>
        </li>
      </ol>
      <div className="payment-branches">
        <h3>Payment of an approved award</h3>
        <dl>
          <div>
            <dt>Underfunded</dt>
            <dd>The vault has not reserved enough funds.</dd>
          </div>
          <div>
            <dt>Funded, awaiting wallet</dt>
            <dd>Funds are reserved. Add or confirm a payout wallet.</dd>
          </div>
          <div>
            <dt>Funded, ready</dt>
            <dd>Funds and the wallet binding are ready for execution.</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>A transaction was sent. Chain verification is pending.</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>Finalized evidence reconciles the recipient amount and fee.</dd>
          </div>
          <div>
            <dt>Held</dt>
            <dd>
              A requirement or failed attempt needs attention. The award remains
              unpaid.
            </dd>
          </div>
        </dl>
        <p>
          Awaiting wallet is a payment state, not a separate award: the award
          stays approved while it waits for you to add or confirm a payout
          wallet.
        </p>
      </div>
    </>
  );
}
