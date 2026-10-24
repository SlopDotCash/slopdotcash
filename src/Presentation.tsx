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
  // PRD section 9: a release that cannot refresh keeps the last good snapshot.
  if (stale(state.snapshot)) {
    return (
      <p className="data-notice data-stale" role="status">
        Scores may be outdated · updated{" "}
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
  onClick,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  onClick?: () => void;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={onClick}
      rel="noreferrer"
      target="_blank"
    >
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

export function cycleStateLabel(state: CycleIndexEntry["state"]): string {
  return state
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
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
    ? "Awaiting approval"
    : cycleStateLabel(cycle.state);
}

export function reviewBudgetLabel(
  reviewBudget: NonNullable<ProjectDefinition["reward"]["reviewBudget"]>,
): string {
  return reviewBudget.fundingState === "committed"
    ? `${formatMicroUsdc(reviewBudget.committedMinor)} committed of ${reviewBudget.monthlyCapDisplay} cap · accessibility unknown · additive review line`
    : `${reviewBudget.monthlyCapDisplay} cap · additive review line · uncommitted pledge`;
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
    ? `unfunded, target ${reward.monthlyCapDisplay}`
    : `${formatMicroUsdc(reward.committedMinor)} committed · accessibility unknown · target ${reward.monthlyCapDisplay}`;
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

export function formatScore(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    useGrouping: true,
  }).format(value);
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
          <span>A frozen proposal in its public review window.</span>
        </li>
        <li>
          <strong>Approved</strong>
          <span>
            The owner approved the amount. Funding and payment are separate.
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
          Unclaimed awards need a usable wallet; their records show whether
          funds are reserved. Excluded awards keep the decision and reason and
          do not enter payment.
        </p>
      </div>
    </>
  );
}
