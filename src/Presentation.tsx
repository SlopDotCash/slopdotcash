import { ArrowRight, CircleAlert, RotateCcw, Wallet } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "./Link";
import { loginHref } from "./lib/browser-deployment";
import type { CycleIndexEntry } from "./lib/cycle-index";
import { useNotFoundHead } from "./lib/document-head";
import { GithubIcon } from "./lib/github-icon";
import type { GitHubActor, LeaderboardSnapshot } from "./lib/leaderboard";
import { POINTS_PER_THIRD } from "./lib/points";
import {
  type ProjectSessionState,
  useProjectMaintainer,
} from "./lib/project-api";
import type { ProjectDefinition } from "./lib/projects.mjs";
import type { DataState } from "./lib/use-snapshot";

type RouteTone = "neutral" | "success" | "warning" | "danger" | "info";

/** A reference section that stays reachable through existing section links. */
export function Disclosure({
  id,
  summary,
  children,
  className,
  lazy = false,
  revealFor = [],
}: {
  id?: string;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  lazy?: boolean;
  revealFor?: readonly string[];
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [activated, setActivated] = useState(!lazy);
  const aliases = revealFor.join("\n");
  useEffect(() => {
    const reveal = () => {
      const target = window.location.hash.slice(1);
      if (
        target &&
        (target === id || aliases.split("\n").includes(target)) &&
        details.current
      ) {
        setActivated(true);
        details.current.open = true;
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [id, aliases]);
  return (
    <details
      id={id}
      className={className}
      ref={details}
      onToggle={(event) => {
        if (event.currentTarget.open) setActivated(true);
      }}
    >
      <summary>{summary}</summary>
      {activated ? children : null}
    </details>
  );
}

function SectionNav({
  label,
  current,
  links,
}: {
  label: string;
  current: string;
  links: readonly { id: string; label: string; href: string }[];
}) {
  return (
    <nav aria-label={label} className="account-sections route-section-nav">
      {links.map((link) => (
        <Link
          key={link.id}
          href={link.href}
          ariaCurrent={current === link.id ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/** Project sections use client navigation without reloading the document. */
export function ProjectNav({
  project,
  current,
}: {
  project: Pick<ProjectDefinition, "id" | "slug">;
  current: "overview" | "funding" | "settings" | "security";
}) {
  const base = `/projects/${project.slug}`;
  const { allowed } = useProjectMaintainer(project.id);
  return (
    <SectionNav
      label="Project navigation"
      current={current}
      links={[
        { id: "overview", label: "Overview", href: base },
        { id: "funding", label: "Funds & awards", href: `${base}/funding` },
        ...(allowed
          ? [{ id: "settings", label: "Settings", href: `${base}/manage` }]
          : []),
      ]}
    />
  );
}

/** Page framing for inner routes; no global or homepage typography changes. */
export function RoutePageHeader({
  title,
  titleAction,
  icon,
  eyebrow,
  lead,
  actions,
  children,
}: {
  title: ReactNode;
  titleAction?: ReactNode;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="route-page-header">
      <div className="route-page-heading">
        {eyebrow ? <div className="route-eyebrow">{eyebrow}</div> : null}
        <div className="route-title-row">
          {icon ? (
            <span className="route-page-icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <h1>{title}</h1>
          {titleAction}
        </div>
        {lead ? <p className="route-lead">{lead}</p> : null}
        {children}
      </div>
      {actions ? <div className="route-page-actions">{actions}</div> : null}
    </header>
  );
}

/** A word and optional decorative icon always accompany the status color. */
export function StatusBadge({
  tone = "neutral",
  icon,
  children,
  className = "",
  title,
}: {
  tone?: RouteTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`route-badge route-badge--${tone} ${className}`}
      title={title}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

export function MetricGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <dl className={`route-metrics ${className}`}>{children}</dl>;
}

/** Use inside MetricGrid so each value keeps its semantic label. */
export function MetricTile({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: RouteTone;
  icon?: ReactNode;
}) {
  return (
    <div className={`route-metric route-metric--${tone}`}>
      <dt>
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        {label}
      </dt>
      <dd>{value}</dd>
      {detail ? <dd className="route-metric-detail">{detail}</dd> : null}
    </div>
  );
}

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
        <span>Data could not load.</span>
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
        {formatDateTime(state.snapshot.generatedAt)}.
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

/** An optional timestamp; a missing one shows a dash. */
export function formatNullableUtc(value: string | null): string {
  return value === null ? "—" : formatDateTime(value);
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
  useNotFoundHead();
  return (
    <Element
      className={
        Element === "main"
          ? "shell not-found route-not-found"
          : "not-found route-not-found"
      }
    >
      <RoutePageHeader title={title} icon={<CircleAlert />} />
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

/** Previous and next controls for one zero-based page of a long list. */
export function Pager({
  page,
  pages,
  onPage,
  noun,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  /** Names the list in the button labels when a page has two lists. */
  noun?: string;
}) {
  const suffix = noun ? ` ${noun}` : "";
  return (
    <div className="points-controls points-pagination">
      <button
        className="button secondary-button button-small"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        type="button"
      >
        Previous{suffix}
      </button>
      <span>
        Page {page + 1} of {pages}
      </span>
      <button
        className="button secondary-button button-small"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
        type="button"
      >
        Next{suffix}
      </button>
    </div>
  );
}

export function ExternalLinkAnchor({
  children,
  className,
  href,
  label,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  /** Accessible name when the visible content is an icon plus a short handle. */
  label?: string;
}) {
  return (
    <a
      aria-label={label}
      className={className}
      href={href}
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
    ? `${reward.monthlyCapDisplay} monthly · not funded`
    : `${formatMicroUsdc(reward.committedMinor)} funded · ${reward.monthlyCapDisplay} monthly`;
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

/** Integer credit-thirds in the displayed Slop Points unit. */
export function formatPointsFromThirds(thirds: number): string {
  return (thirds * POINTS_PER_THIRD).toLocaleString();
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
          <ExternalLinkAnchor
            className="profile-github"
            href={actor.url}
            label={`GitHub · @${actor.login}`}
          >
            <GithubIcon aria-hidden="true" size={16} />@{actor.login}
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
    <div className="payment-lifecycle">
      <ol
        className="payment-stages"
        aria-label="Ordinary award and payment milestones"
      >
        <li>
          <strong>Projected</strong>
          <span>An estimate, not an approved award.</span>
        </li>
        <li>
          <strong>Under review</strong>
          <span>The amount may change before the monthly cutoff.</span>
        </li>
        <li>
          <strong>Approved</strong>
          <span>The award amount is approved.</span>
        </li>
        <li>
          <strong>Paid</strong>
          <span>The finalized payment matches the award.</span>
        </li>
      </ol>
    </div>
  );
}

export function SignInPanel({
  state,
  next,
  purpose,
}: {
  state: Exclude<ProjectSessionState, { status: "signed-in" }>;
  next: string;
  purpose?: string;
}) {
  if (state.status === "checking") {
    return (
      <p aria-live="polite" className="admin-status">
        Checking sign-in…
      </p>
    );
  }
  return (
    <div className="sign-in-panel">
      {purpose ? <p>{purpose}</p> : null}
      {state.status === "error" ? (
        <p className="form-error" role="alert">
          <CircleAlert aria-hidden="true" /> {state.message}
        </p>
      ) : null}
      <a className="button primary-button" href={loginHref(next)}>
        Sign in with GitHub
      </a>
    </div>
  );
}

/**
 * Official network marks by escrow chain, shown beside the visible network
 * name, or alone when iconOnly is requested. Robinhood Chain uses its
 * official compact symbol from docs.robinhood.com/chain/brand-guidelines/.
 * Base is "The Square" from Base's brand kit
 * (github.com/base-org/brand-kit, logo/TheSquare/Digital/Base_square_blue.svg
 * at commit eba9e730). A network without a reviewed mark shows its name only.
 */
const NETWORK_MARKS: Readonly<Record<string, ReactNode>> = {
  ethereum: (
    <svg
      className="network-mark"
      data-network="ethereum"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16 2 7 17l9 5.3L25 17z" fill="#8c92b5" />
      <path d="m16 24-9-5.3L16 31l9-12.3z" fill="#62688f" />
      <path d="M16 2v20.3L25 17z" fill="#62688f" />
    </svg>
  ),
  robinhood: (
    <svg
      className="network-mark"
      data-network="robinhood"
      viewBox="0 0 32 42"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M0.237711 42H1.14916C1.31483 42 1.48056 41.9157 1.53587 41.7753C8.41284 23.9672 15.8974 15.1474 20.5926 9.86673C20.786 9.64201 20.7031 9.47355 20.4269 9.47355H12.0309C11.727 9.47355 11.4702 9.59707 11.2576 9.86673L5.23667 17.4507C4.3529 18.5742 4.13199 19.6134 4.13199 21.1021V28.8546C2.17104 34.4442 0.92819 38.2362 0.0168015 41.663C-0.038442 41.882 0.0444232 42 0.237711 42ZM30.5353 1.13119C29.2372 -0.273195 23.3821 -0.329391 20.6754 0.738011C20.1121 0.959852 19.5707 1.33622 19.3221 1.5525C16.8364 3.71537 15.1794 5.4288 13.6051 7.11409C13.4117 7.31068 13.4947 7.50727 13.7709 7.50727H23.0783C23.9345 7.50727 24.4316 8.01291 24.4316 8.88359V19.5573C24.4316 19.8382 24.6525 19.9225 24.8183 19.6696L30.4248 12.2261C31.3362 11.0183 31.6124 10.6532 31.8609 8.96792C32.1924 6.49613 31.999 2.70423 30.5353 1.13119ZM18.5212 29.4445L22.3601 23.0121C22.4431 22.8437 22.4706 22.647 22.4706 22.5066V11.7767C22.4706 11.4958 22.2773 11.3836 22.0841 11.6082C16.3118 18.1529 11.8099 25.0346 7.6395 33.3207C7.53455 33.5285 7.66712 33.7139 7.91572 33.6297L16.5327 30.9332C17.5048 30.6298 18.0517 30.231 18.5212 29.4445Z"
        fill="#ccff00"
      />
    </svg>
  ),
  solana: (
    <svg
      className="network-mark"
      data-network="solana"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#14f195" d="M5 3h18l-4 4H1z" />
      <path fill="#8e7af0" d="M1 10h18l4 4H5z" />
      <path fill="#9945ff" d="M5 17h18l-4 4H1z" />
    </svg>
  ),
  base: (
    <svg
      className="network-mark"
      data-network="base"
      viewBox="0 0 1280 1280"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#0000ff"
        d="M0,101.12c0-34.64,0-51.95,6.53-65.28,6.25-12.76,16.56-23.07,29.32-29.32C49.17,0,66.48,0,101.12,0h1077.76c34.63,0,51.96,0,65.28,6.53,12.75,6.25,23.06,16.56,29.32,29.32,6.52,13.32,6.52,30.64,6.52,65.28v1077.76c0,34.63,0,51.96-6.52,65.28-6.26,12.75-16.57,23.06-29.32,29.32-13.32,6.52-30.65,6.52-65.28,6.52H101.12c-34.64,0-51.95,0-65.28-6.52-12.76-6.26-23.07-16.57-29.32-29.32-6.53-13.32-6.53-30.65-6.53-65.28V101.12Z"
      />
    </svg>
  ),
};

export function NetworkName({
  chain,
  children,
  iconOnly = false,
}: {
  chain: string;
  children: ReactNode;
  iconOnly?: boolean;
}) {
  const mark = Object.hasOwn(NETWORK_MARKS, chain)
    ? NETWORK_MARKS[chain]
    : null;
  return (
    <span className="network-name">
      {mark}
      <span className={iconOnly && mark ? "visually-hidden" : undefined}>
        {children}
      </span>
    </span>
  );
}

/** The one empty state for a browser that offers no wallet for this network. */
export function NoWalletFound({ solana }: { solana: boolean }) {
  return (
    <div className="wallet-missing">
      <Wallet aria-hidden="true" size={22} />
      <p>
        <strong>{solana ? "No Solana wallet found" : "No wallet found"}</strong>
        <span>
          {solana
            ? "Use a Solana wallet that can send transactions."
            : "Use a wallet extension or your wallet app's browser."}
        </span>
      </p>
    </div>
  );
}

/** Shared chooser presentation; each feature keeps its wallet and signing rules. */
export function WalletConnection<T extends { id: string; name: string }>({
  address,
  wallets,
  disabled,
  legend,
  empty,
  className,
  onConnect,
}: {
  address: string | null;
  wallets: readonly T[];
  disabled: boolean;
  legend: string;
  /** Shown when no wallet is found; omit it where another control already shows it. */
  empty?: ReactNode;
  className?: string;
  onConnect: (provider: T) => void;
}) {
  if (address)
    return (
      <p>
        Connected: <code>{address}</code>
      </p>
    );
  if (!wallets.length) return empty ?? null;
  return (
    <fieldset disabled={disabled} className={className}>
      <legend>{legend}</legend>
      {wallets.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className="button secondary-button"
          onClick={() => onConnect(provider)}
        >
          Connect {provider.name}
        </button>
      ))}
    </fieldset>
  );
}

export function paymentStateLabel(project: ProjectDefinition): string {
  return project.reward.paymentMode === "enabled" ? "Enabled" : "Disabled";
}

/** "Live" only when a recorded vault can pay: payments must be enabled too. */
export function vaultStateLabel(project: ProjectDefinition): string {
  if (project.reward.kind === "external-prize-share") return "Not applicable";
  if (!project.escrow?.deployments.length) return "Not set up";
  return project.reward.paymentMode === "enabled" ? "Live" : "Set up";
}
