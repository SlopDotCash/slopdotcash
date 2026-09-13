import { Link } from "./Link";
import { copyText } from "./lib/copy-text";
import { SOURCE_REPOSITORY } from "./lib/source-repository";
import {
  LoginPage,
  PointsLabel,
  PointsNav,
  PointsPage,
  PointsProvider,
  PointsStandings,
  ProfilePoints,
  PublicXLink,
} from "./Points";

export {
  rootPublishedTemplateProject,
  safeProposalHttpsUrl,
} from "./lib/project-proposal";

import { type CycleIndexState, useCycleIndex } from "./lib/use-cycle-index";
import { useFundingReviews } from "./lib/use-funding-reviews";
import { type DataState, useSnapshot } from "./lib/use-snapshot";
/**
 * Renders the GitHub-native Slop network across discovery, project,
 * contributor, cycle, and project-proposal routes. Every fetched snapshot is
 * validated before money, score, work, or usage is presented as healthy data.
 */

import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  ExternalLink,
  Menu,
  RotateCcw,
  X,
} from "lucide-react";
import { readBoundedJson } from "./lib/browser-json";
import { SettlementVerification } from "./SettlementVerification";
import { WalletRegistration } from "./WalletRegistration";

export { readBoundedJson } from "./lib/browser-json";

import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  allocationFundingMinor,
  deriveAllocationFundingBasis,
  type PromotionCycle,
  projectPromotionEligible,
} from "./lib/allocation-funding";
import type { CycleIndexEntry } from "./lib/cycle-index";
import {
  assertProjectFundingIndex,
  currentProjectFundingRecords,
  isFundingAddress,
  type ProjectFundingIndex,
  type ProjectFundingRecord,
  projectFundingTotals,
  publicFundingRecordsForDonor,
} from "./lib/funding";
import { cycleSettlementReminder } from "./lib/funding-reminders";
import { createGlobalLeaders } from "./lib/global-leaderboard";
import { createInstallCommand } from "./lib/install-command";
import {
  type GitHubActor,
  type LeaderboardSnapshot,
  PROFILE_OPPORTUNITY_LIMIT,
  type ScoreEvent,
  type ScoreOpportunity,
} from "./lib/leaderboard";
import {
  type ModelOutcomeSummary,
  summarizeModelOutcomes,
} from "./lib/model-outcomes";
import {
  createProjectView,
  type ProjectContributor,
  type ProjectView,
} from "./lib/project-view";
import {
  findProject,
  findProjectByRepositoryId,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";
import {
  formatThirds,
  type ReviewerLeader,
  selectReviewerLeaders,
} from "./lib/reviewer-leaders";
import { feeForPrincipal, PLATFORM_FEE_BASIS_POINTS } from "./lib/rewards";
import {
  type PublicSignerReport,
  publicSignerStatus,
} from "./lib/signer-capability";
import {
  summarizeWhoBuilds,
  WHO_BUILDS_CROSS_REFERENCE,
  WHO_BUILDS_SNAPSHOT,
  whoBuildsDateLabel,
} from "./lib/who-builds";

const ProjectProposalPage = lazy(() => import("./ProjectProposalPage"));

const FundingReview = lazy(() =>
  import("./FundingReview").then((module) => ({
    default: module.FundingReview,
  })),
);

const SOCIAL_X = "https://x.com/SlopCash";
const SOCIAL_LINKEDIN = "https://www.linkedin.com/company/slop-cash";
const SOCIAL_TELEGRAM = "https://t.me/slopcashofficial";
const FUNDING_TIMEOUT_MS = 12_000;
const WALLET_CLAIM_TIMEOUT_MS = 12_000;
const MAX_FUNDING_INDEX_BYTES = 8 * 1024 * 1024;
const MAX_WALLET_CLAIM_BYTES = 16 * 1024;
const PROFILE_EVENT_PREVIEW_LIMIT = 10;
const HERO_ACTIONS = [
  "SHIPPING OPEN SOURCE.",
  "SECURING THE WEB.",
  "HACKING THE PLANET.",
  "BUILDING AGI.",
] as const;
const HERO_HOLD_MS = 2_400;
const HERO_TYPE_MS = 55;
const HERO_DELETE_MS = 30;
const HERO_GAP_MS = 220;

export function publicFooterDomain(
  hostname: string,
): "slop.cash" | "slop.tech" {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized === "slop.tech" || normalized === "www.slop.tech"
    ? "slop.tech"
    : "slop.cash";
}

interface Route {
  kind:
    | "cycle"
    | "wallet"
    | "funding-project"
    | "home"
    | "how-it-works"
    | "manage-project"
    | "new-project"
    | "profile"
    | "project"
    | "receipts"
    | "models"
    | "sponsors"
    | "verification"
    | "cycle-archive"
    | "unknown"
    | "points"
    | "login";
  projectId?: string;
  cycleId?: string;
  login?: string;
}

function internalRoute(pathname: string): Route {
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { kind: "unknown" };
  }
  if (segments.length === 0) return { kind: "home" };
  if (segments.length === 1 && segments[0] === "login")
    return { kind: "login" };
  if (segments.length === 1 && segments[0] === "points")
    return { kind: "points" };
  if (segments.length === 1 && segments[0] === "wallet")
    return { kind: "wallet" };
  if (segments.length === 1 && segments[0] === "how-it-works") {
    return { kind: "how-it-works" };
  }
  if (segments.length === 1 && segments[0] === "receipts") {
    return { kind: "receipts" };
  }
  if (segments.length === 1 && segments[0] === "models") {
    return { kind: "models" };
  }
  if (segments.length === 1 && segments[0] === "sponsors") {
    return { kind: "sponsors" };
  }
  if (segments.length === 1 && segments[0] === "verification") {
    return { kind: "verification" };
  }
  if (segments.length === 1 && segments[0] === "cycles") {
    return { kind: "cycle-archive" };
  }
  if (segments[0] === "projects" && segments[1] === "new") {
    return { kind: "new-project" };
  }
  if (
    segments[0] === "projects" &&
    segments.length === 3 &&
    segments[2] === "manage"
  ) {
    return { kind: "manage-project", projectId: segments[1] };
  }
  if (
    segments[0] === "projects" &&
    segments.length === 3 &&
    segments[2] === "funding"
  ) {
    return { kind: "funding-project", projectId: segments[1] };
  }
  if (segments[0] === "projects" && segments.length === 2) {
    return { kind: "project", projectId: segments[1] };
  }
  if (segments[0] === "contributors" && segments.length === 2) {
    return { kind: "profile", login: segments[1] };
  }
  if (segments[0] === "cycles" && segments.length === 3) {
    return { kind: "cycle", projectId: segments[1], cycleId: segments[2] };
  }
  return { kind: "unknown" };
}

function useRoute(): Route {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return useMemo(() => internalRoute(path), [path]);
}

function ExternalLinkAnchor({
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

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1_000 ? "compact" : "standard",
  }).format(value);
}

function formatScore(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    useGrouping: false,
  }).format(value);
}

function formatMicroUsdc(value: string): string {
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

function formatPercent(partsPerMillion: number): string {
  return `${(partsPerMillion / 10_000).toFixed(2)}%`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function formatCycleMonth(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function cycleStateLabel(state: CycleIndexEntry["state"]): string {
  return state
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function stale(snapshot: Pick<LeaderboardSnapshot, "generatedAt">): boolean {
  return Date.now() - Date.parse(snapshot.generatedAt) > 8 * 60 * 60 * 1_000;
}

function Header({ isHome }: { isHome: boolean }) {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButtonRef.current?.focus();
    };
    const closeForRoute = () => setOpen(false);
    window.addEventListener("pointerdown", closeForOutsidePointer);
    window.addEventListener("keydown", closeForEscape);
    window.addEventListener("popstate", closeForRoute);
    return () => {
      window.removeEventListener("pointerdown", closeForOutsidePointer);
      window.removeEventListener("keydown", closeForEscape);
      window.removeEventListener("popstate", closeForRoute);
    };
  }, [open]);
  const closeMenu = () => setOpen(false);
  return (
    <header className="site-header" ref={headerRef}>
      <div className="shell header-inner">
        <Link ariaLabel="Slop home" className="wordmark" href="/">
          slop.cash
        </Link>
        <button
          aria-expanded={open}
          aria-controls="primary-navigation"
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="menu-button"
          onClick={() => setOpen((value) => !value)}
          ref={menuButtonRef}
          type="button"
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <nav
          className={open ? "nav-links nav-links-open" : "nav-links"}
          id="primary-navigation"
        >
          {!isHome ? (
            <Link href="/" onNavigate={closeMenu}>
              Home
            </Link>
          ) : null}
          <Link href="/#projects" onNavigate={closeMenu}>
            Projects
          </Link>
          <Link href="/#leaderboard" onNavigate={closeMenu}>
            Leaderboard
          </Link>
          <PointsNav onNavigate={closeMenu} />
          <Link href="/how-it-works" onNavigate={closeMenu}>
            How it works
          </Link>
          <Link href="/models" onNavigate={closeMenu}>
            Models
          </Link>
          <Link href="/sponsors" onNavigate={closeMenu}>
            Sponsors
          </Link>
          <Link className="nav-cta" href="/projects/new" onNavigate={closeMenu}>
            Add a project
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const domain = publicFooterDomain(window.location.hostname);
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-brand-row">
          <div className="wordmark footer-wordmark">{domain}</div>
          <p className="footer-copyright">
            © {new Date().getUTCFullYear()} slop.cash.
          </p>
        </div>
        <div className="footer-links">
          <Link href="/#projects">Projects</Link>
          <Link href="/how-it-works">How scoring works</Link>
          <Link href="/receipts">Receipts</Link>
          <Link href="/models">Models</Link>
          <Link href="/cycles">Cycle archive</Link>
          <Link href="/sponsors">Fund a pool</Link>
          <Link href="/projects/new">Add a project</Link>
          <ExternalLinkAnchor href={SOURCE_REPOSITORY}>
            GitHub
          </ExternalLinkAnchor>
          <ExternalLinkAnchor href={SOCIAL_X}>X</ExternalLinkAnchor>
          <ExternalLinkAnchor href={SOCIAL_LINKEDIN}>
            LinkedIn
          </ExternalLinkAnchor>
          <ExternalLinkAnchor href={SOCIAL_TELEGRAM}>
            Telegram
          </ExternalLinkAnchor>
        </div>
      </div>
    </footer>
  );
}

function DataNotice({ state, retry }: { state: DataState; retry: () => void }) {
  if (state.status === "loading") {
    return null;
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
  if (!stale(state.snapshot)) return null;
  return (
    <div className="data-notice data-stale" role="status">
      <span className="status-dot stale-dot" />
      Data may be outdated · updated {formatDate(state.snapshot.generatedAt)}
    </div>
  );
}

function TypewriterHeroHeading() {
  const [index, setIndex] = useState(0);
  const [characters, setCharacters] = useState(HERO_ACTIONS[0].length);
  const [phase, setPhase] = useState<"deleting" | "holding" | "typing">(
    "holding",
  );
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = HERO_ACTIONS[index];
    let delay = 1;
    let advance: () => void;
    if (phase === "holding") {
      delay = HERO_HOLD_MS;
      advance = () => setPhase("deleting");
    } else if (phase === "deleting" && characters > 0) {
      delay = HERO_DELETE_MS;
      advance = () => setCharacters((value) => Math.max(0, value - 1));
    } else if (phase === "deleting") {
      delay = HERO_GAP_MS;
      advance = () => {
        setIndex((value) => (value + 1) % HERO_ACTIONS.length);
        setPhase("typing");
      };
    } else if (characters < target.length) {
      delay = HERO_TYPE_MS;
      advance = () => setCharacters((value) => value + 1);
    } else {
      advance = () => setPhase("holding");
    }
    const timer = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timer);
  }, [characters, index, phase]);
  const action = HERO_ACTIONS[index];
  return (
    <h1 aria-label="MAKE MONEY SHIPPING OPEN SOURCE.">
      <span aria-hidden="true" className="hero-message">
        <span>MAKE MONEY</span>
        <span className="hero-switch">
          {HERO_ACTIONS.map((candidate) => (
            <span className="hero-switch-sizer" key={candidate}>
              {candidate}
            </span>
          ))}
          <span className="hero-typewriter">
            {action.slice(0, characters)}
            <span className="hero-typewriter-caret" />
          </span>
          <span className="hero-mobile-action">{action}</span>
        </span>
      </span>
    </h1>
  );
}

function monthlyPoolCapLabel(reward: ProjectDefinition["reward"]): string {
  const minor = BigInt(reward.monthlyCapMinor);
  if (minor % 1_000_000n !== 0n) return reward.monthlyCapDisplay;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  })
    .format(minor / 1_000_000n)
    .replace(/K$/u, "k");
}

function ProjectCard({ project }: { project: ProjectDefinition }) {
  const unfunded =
    project.reward.kind === "monthly-pool" &&
    monthlyPoolUnfunded(project.reward);
  const amount =
    project.reward.kind === "monthly-pool"
      ? monthlyPoolCapLabel(project.reward)
      : (project.reward.externalOpportunity?.advertisedAmountDisplay ??
        "External");
  return (
    <Link className="project-card" href={`/projects/${project.slug}`}>
      <div className="project-card-heading">
        <div>
          <h3>{project.name}</h3>
        </div>
        <ArrowRight aria-hidden="true" />
      </div>
      <div className="project-card-content">
        <p className="project-summary">{project.description}</p>
        <p className="project-bounty">
          <strong>{amount}</strong>
          {project.reward.kind === "monthly-pool" ? <span>/mo</span> : null}
        </p>
        {project.reward.kind === "monthly-pool" && !unfunded ? (
          <small className="project-money-state">
            Committed balance · accessibility unknown · payments disabled
          </small>
        ) : null}
        {project.reward.reviewBudget ? (
          <small className="project-review-budget">
            + {reviewBudgetLabel(project.reward.reviewBudget)}
          </small>
        ) : null}
      </div>
    </Link>
  );
}

function Avatar({
  actor,
  size = "medium",
}: {
  actor: GitHubActor;
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

function ReviewContribution({ reviewer }: { reviewer?: ReviewerLeader }) {
  if (!reviewer) return null;
  return (
    <small className="review-score-detail">
      Includes {formatThirds(reviewer.reviewThirds)} review point
      {reviewer.reviewThirds === 3 ? "" : "s"} · {reviewer.reviewEventCount}{" "}
      scored review
      {reviewer.reviewEventCount === 1 ? "" : "s"}
    </small>
  );
}

function GlobalLeaderboard() {
  return (
    <section
      className="section shell home-leaderboard-section"
      id="leaderboard"
    >
      <PointsStandings compact title="Leaderboard" />
    </section>
  );
}

function HomePage({ state, retry }: { state: DataState; retry: () => void }) {
  const views = state.status === "ready" ? state.views : [];
  const promotedProjects = PROJECTS.filter((project) =>
    projectPromotionEligible(
      project,
      state.status === "ready" ? state.cycleIndex.cycles : null,
      views.find((view) => view.project.id === project.id)?.cycle.id ?? null,
    ),
  );
  const featuredProjects = promotedProjects.filter(
    (project) => project.listingTier === "featured",
  );
  const communityProjects = promotedProjects.filter(
    (project) => project.listingTier === "community",
  );
  return (
    <main>
      <section className="hero shell">
        <DataNotice state={state} retry={retry} />

        <TypewriterHeroHeading />
        <p className="hero-copy">
          Fund accepted work on GitHub. Slop calculates allocations from public
          evidence; project owners sign payments directly.
        </p>
        <div className="hero-actions">
          <Link className="button primary-button" href="/#projects">
            Explore projects <ArrowRight aria-hidden="true" />
          </Link>
          <Link className="button secondary-button" href="/projects/new">
            Fund a project
          </Link>
        </div>
      </section>

      <section className="section shell home-projects-section" id="projects">
        <div className="home-section-heading">
          <div>
            <h2 className="home-section-title">Projects</h2>
          </div>
        </div>
        <section className="project-tier" aria-labelledby="featured-projects">
          <h3 id="featured-projects">Featured</h3>
          <div className="project-grid">
            {featuredProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
        {communityProjects.length > 0 ? (
          <details className="project-tier community-projects">
            <summary>Community projects</summary>
            <div className="project-grid">
              {communityProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </details>
        ) : null}
      </section>
      <section className="section shell audience-section">
        <div className="audience-grid">
          <article>
            <h3>Pay for accepted outcomes.</h3>
            <p>
              Commit a capped contributor pool and an optional additive review
              budget.
            </p>
            <Link href="/projects/new">Fund a project</Link>
          </article>
          <article>
            <h3>Keep GitHub in control.</h3>
            <p>
              Review work in the project repository while Slop publishes the
              record.
            </p>
            <Link href="/how-it-works">See the mechanism</Link>
          </article>
          <article>
            <h3>Ship with any agent.</h3>
            <p>
              Use the project skill, disclose the exact model, and land useful
              work.
            </p>
            <Link href="/#projects">Explore projects</Link>
          </article>
        </div>
      </section>
      <section className="how-section" id="how-it-works">
        <div className="shell">
          <div className="home-section-heading inverse-heading">
            <div>
              <h2 className="home-section-title">How it works</h2>
            </div>
          </div>
          <div className="how-grid">
            <article>
              <h3>Choose work.</h3>
              <p>Read the project terms and choose unblocked work on GitHub.</p>
            </article>
            <article>
              <h3>Submit a PR.</h3>
              <p>
                Use the project skill to guide your agent through testing and
                submission.
              </p>
            </article>
            <article>
              <h3>Get reviewed.</h3>
              <p>
                Maintainers review your PR. Track accepted work, scores, and
                payments on Slop.
              </p>
            </article>
          </div>
          <div className="owner-callout">
            <div>
              <h3>Add your project.</h3>
            </div>
            <Link className="button inverse-button" href="/projects/new">
              Get started <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
      <GlobalLeaderboard />
    </main>
  );
}

function projectAgentPrompt(project: ProjectDefinition): string {
  const target = project.repositories[0];
  // The public registry the bootstrap skill matches against publishes
  // `aliases.at(-1) ?? id`, so a transferred repository resolves to its current
  // path. Emitting `id` here would hand the operator the pre-transfer path,
  // whose origin has no exact registry match and stops the skill.
  const repository = target?.aliases?.at(-1) ?? target?.id;
  if (!repository) {
    throw new TypeError(`Project ${project.id} has no contribution repository`);
  }
  const origin = window.location.origin.replace(/\/$/u, "");
  return `Read ${origin}/SKILL.md and follow it to contribute to github.com/${repository}.`;
}

function AgentPromptBox({ prompt }: { prompt: string }) {
  const [copy, setCopy] = useState<"copied" | "error" | "idle">("idle");
  useEffect(() => {
    if (copy !== "copied") return;
    const timer = window.setTimeout(() => setCopy("idle"), 1_600);
    return () => window.clearTimeout(timer);
  }, [copy]);
  const copyPrompt = async () => {
    try {
      await copyText(prompt);
      setCopy("copied");
    } catch {
      // error-policy:J4 Clipboard denial remains visibly distinct and selectable text stays available.
      setCopy("error");
    }
  };
  return (
    <div className="command-box agent-prompt-box">
      <output aria-label="Agent prompt" className="agent-prompt-copy">
        <code>
          {prompt
            .split(/(https?:\/\/[^/\s]+\/|github\.com\/)/u)
            .map((segment, index) => (
              <span key={segment}>
                {segment}
                {index % 2 === 1 ? <wbr /> : null}
              </span>
            ))}
        </code>
      </output>
      <button
        aria-label={
          copy === "copied"
            ? "Copied agent prompt"
            : copy === "error"
              ? "Copy unavailable; select agent prompt"
              : "Copy agent prompt"
        }
        onClick={() => void copyPrompt()}
        type="button"
      >
        {copy === "copied" ? <Check /> : <Clipboard />}
        <span className="agent-prompt-copy-label">
          {copy === "copied"
            ? "Copied"
            : copy === "error"
              ? "Select text"
              : "Copy"}
        </span>
      </button>
    </div>
  );
}

function projectInstallCommand(project: ProjectDefinition): string {
  const origin = `${window.location.origin.replace(/\/$/u, "")}/projects/${project.slug}`;
  return createInstallCommand(origin, `\${HOME}/.agents/skills`, {
    skillName: project.skill.id,
    skillRepositoryPath: project.skill.sourcePath,
  });
}

export function ProjectParticipation({
  project,
  cycles,
  displayCycleId,
}: {
  project: ProjectDefinition;
  cycles: readonly PromotionCycle[] | null;
  displayCycleId: string | null;
}) {
  if (projectPromotionEligible(project, cycles, displayCycleId))
    return <InstallPanel project={project} />;
  return (
    <section className="section" id="start">
      <h2>Contribution record remains open</h2>
      <p>
        {cycles
          ? "Skill promotion is paused after two unfunded cycles. Accepted work and scores continue to be recorded; committed funding is required to resume promotion."
          : "Funding history must load before skill promotion is available."}
      </p>
    </section>
  );
}

function InstallPanel({ project }: { project: ProjectDefinition }) {
  const [copy, setCopy] = useState<"manual-copied" | "error" | "idle">("idle");
  const origin = window.location.origin.replace(/\/$/u, "");
  const manualCommand = projectInstallCommand(project);
  const copyManualCommand = async () => {
    try {
      await copyText(manualCommand);
      setCopy("manual-copied");
    } catch {
      // error-policy:J4 Clipboard denial remains visibly distinct and selectable text stays available.
      setCopy("error");
    }
  };
  useEffect(() => {
    if (copy !== "manual-copied") return;
    const timer = window.setTimeout(() => setCopy("idle"), 1_600);
    return () => window.clearTimeout(timer);
  }, [copy]);
  return (
    <div className="install-panel" id="start">
      <div className="install-heading">
        <div>
          <h2>Copy this into your agent.</h2>
        </div>
      </div>
      <AgentPromptBox prompt={projectAgentPrompt(project)} />
      {project.reward.kind === "monthly-pool" &&
      allocationFundingMinor(project.reward) === 0n ? (
        <p>
          Unfunded trial: this skill records accepted work and scores with a $0
          funding-backed projection.
        </p>
      ) : null}
      <p className="install-note">
        Any model can join. The skill publishes the exact provider, model, and
        client. Signed receipts and permanent private traces are optional; only
        Slop operators can access uploaded trace contents. Payout setup uses an
        authenticated, append-only Slop wallet registry.
      </p>
      <details className="install-advanced">
        <summary>Advanced options</summary>
        <p>
          Use the direct installer if your agent cannot follow the prompt, or
          open the workflow document to inspect the instructions without running
          them.
        </p>
        <div className="command-box command-box-secondary">
          <textarea
            aria-label="Manual install command"
            readOnly
            spellCheck={false}
            value={manualCommand}
          />
          <button
            aria-label={
              copy === "manual-copied"
                ? "Copied manual install command"
                : copy === "error"
                  ? "Copy unavailable; select manual install command"
                  : "Copy manual install command"
            }
            onClick={() => void copyManualCommand()}
            type="button"
          >
            {copy === "manual-copied" ? <Check /> : <Clipboard />}
            {copy === "manual-copied"
              ? "Copied"
              : copy === "error"
                ? "Select text"
                : "Copy"}
          </button>
        </div>
        <a
          href={`${origin}/projects/${project.slug}/mission.md`}
          rel="noreferrer"
          target="_blank"
        >
          Preview the complete workflow
          <ExternalLink aria-hidden="true" />
        </a>
        <a
          href={`${origin}/projects/${project.slug}/review-codex.md`}
          rel="noreferrer"
          target="_blank"
        >
          Install the independent reviewer skill
          <ExternalLink aria-hidden="true" />
        </a>
      </details>
    </div>
  );
}

function RewardValue({ leader }: { leader: ProjectContributor }) {
  return leader.simulatedMinor !== null ? (
    formatMicroUsdc(leader.simulatedDisplayMinor ?? leader.simulatedMinor)
  ) : (
    <>{formatPercent(leader.projectedSharePartsPerMillion ?? 0)} share</>
  );
}

function ProjectLeaderboard({
  updatedAt,
  view,
}: {
  updatedAt: string;
  view: ProjectView;
}) {
  const reviewers = new Map(
    selectReviewerLeaders(view.ledger).map((reviewer) => [
      reviewer.actor.id,
      reviewer,
    ]),
  );
  return (
    <>
      <PointsStandings projectId={view.project.id} compact />
      <section className="section project-leader-section">
        <div className="section-heading">
          <h2>{formatCycleMonth(view.cycle.id)} leaderboard.</h2>
          <p className="data-freshness">Updated {formatDate(updatedAt)}</p>
          {view.project.reward.reviewBudget ? (
            <p>{reviewBudgetLabel(view.project.reward.reviewBudget)}</p>
          ) : null}
          {view.reward.kind === "monthly-pool" ? (
            <p>
              Shares simulate the {monthlyPoolLabel(view.project.reward)} cap.
              Not approved payouts.
            </p>
          ) : null}
        </div>
        {view.leaders.length === 0 ? (
          <EmptyState text="No accepted outcomes in this cycle yet." />
        ) : (
          <div className="leader-table">
            <table className="leader-grid">
              <caption className="visually-hidden">
                {view.project.name} leaderboard
              </caption>
              <thead>
                <tr className="leader-row project-leader-head">
                  <th scope="col">Rank</th>
                  <th scope="col">Contributor</th>
                  <th scope="col">Score</th>
                  <th scope="col">Simulated share</th>
                </tr>
              </thead>
              <tbody>
                {view.leaders.map((leader) => (
                  <tr
                    className="leader-row project-leader-row"
                    key={leader.actor.id}
                  >
                    <td className="rank-cell">#{leader.rank}</td>
                    <td className="person-cell">
                      <Link
                        className="person-link"
                        href={`/contributors/${encodeURIComponent(leader.actor.login)}`}
                      >
                        <Avatar actor={leader.actor} />
                        <span>
                          <strong>{leader.actor.login}</strong>
                          <PointsLabel actorId={leader.actor.id} />
                          <small>
                            {leader.acceptedOutcomeCount} accepted events
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <strong title={`Exact score ${leader.scoreThirds}/3`}>
                        {formatThirds(leader.scoreThirds)}
                      </strong>
                      <ReviewContribution
                        reviewer={reviewers.get(leader.actor.id)}
                      />
                      {leader.computeBonusBasisPoints > 0 ? (
                        <small>
                          +{leader.computeBonusBasisPoints / 100}% receipt
                          evidence
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <strong>
                        <RewardValue leader={leader} />
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function ProjectPaymentHistory({
  project,
  state,
}: {
  project: ProjectDefinition;
  state: DataState;
}) {
  if (state.status !== "ready") return null;
  const cycles = state.cycleIndex.cycles
    .filter((cycle) => cycle.projectId === project.id)
    .sort((left, right) => right.cycleId.localeCompare(left.cycleId));
  const approved = cycles.reduce(
    (total, cycle) => total + BigInt(cycle.reward.approvedMinor),
    0n,
  );
  const paid = cycles.reduce(
    (total, cycle) => total + BigInt(cycle.reward.paidMinor),
    0n,
  );
  const fees = cycles.reduce(
    (total, cycle) => total + BigInt(cycle.reward.feeMinor),
    0n,
  );
  return (
    <section className="section payment-history">
      <div className="simple-heading">
        <h2>Payment history</h2>
        <Link href={`/projects/${project.slug}/funding`}>Manage payouts</Link>
        <Link href={`/projects/${project.slug}/manage`}>
          Draft a project update
        </Link>
      </div>
      <p className="money-summary">
        <strong>{formatMicroUsdc(paid.toString())} paid</strong>
        <span>{formatMicroUsdc(approved.toString())} approved</span>
        <span>{formatMicroUsdc(fees.toString())} in 1% payout fees</span>
      </p>
      {cycles.length === 0 ? (
        <EmptyState text="No payment cycles have closed yet." />
      ) : (
        <div className="plain-table-wrap">
          <table className="plain-table">
            <caption className="visually-hidden">
              {project.name} payment cycles
            </caption>
            <thead>
              <tr>
                <th scope="col">Cycle</th>
                <th scope="col">Approved</th>
                <th scope="col">Fee</th>
                <th scope="col">Paid</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {cycles.map((cycle) => (
                <tr key={cycle.cycleId}>
                  <th scope="row">
                    <Link href={`/cycles/${project.slug}/${cycle.cycleId}`}>
                      {cycle.cycleId}
                    </Link>
                  </th>
                  <td>{formatMicroUsdc(cycle.reward.approvedMinor)}</td>
                  <td>{formatMicroUsdc(cycle.reward.feeMinor)}</td>
                  <td>{formatMicroUsdc(cycle.reward.paidMinor)}</td>
                  <td>{cycle.state.replaceAll("-", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function fundingExplorer(
  network: ProjectDefinition["funding"]["addresses"][number]["network"],
  address: string,
): string {
  const encoded = encodeURIComponent(address);
  if (network === "solana") return `https://solscan.io/account/${encoded}`;
  if (network === "base") return `https://basescan.org/address/${encoded}`;
  if (network === "ethereum") return `https://etherscan.io/address/${encoded}`;
  return `https://mempool.space/address/${encoded}`;
}

function fundingTransactionExplorer(record: ProjectFundingRecord): string {
  const encoded = encodeURIComponent(record.transactionId);
  if (record.network === "solana") return `https://solscan.io/tx/${encoded}`;
  if (record.network === "base") return `https://basescan.org/tx/${encoded}`;
  if (record.network === "ethereum")
    return `https://etherscan.io/tx/${encoded}`;
  return `https://mempool.space/tx/${encoded}`;
}

function formatFundingMinor(record: ProjectFundingRecord): string {
  return formatFundingAmount(record.asset, record.amountMinor);
}

function formatFundingAmount(
  asset: ProjectFundingRecord["asset"],
  amountMinor: string,
): string {
  if (asset === "USDC") return formatMicroUsdc(amountMinor);
  const satoshis = BigInt(amountMinor);
  const whole = satoshis / 100_000_000n;
  const fraction = (satoshis % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${fraction} BTC`;
}

function FundingQr({
  address,
  asset,
  network,
}: {
  address: string;
  asset: string;
  network: string;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(null);
    setFailed(false);
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toString(address, {
          errorCorrectionLevel: "M",
          margin: 1,
          type: "svg",
          width: 176,
        }),
      )
      .then((value) => {
        if (active)
          setSource(`data:image/svg+xml,${encodeURIComponent(value)}`);
      })
      .catch(() => {
        // error-policy:J1 Keep the copyable address usable when QR generation fails.
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [address]);
  if (failed)
    return (
      <p role="status">
        QR code unavailable. Copy the receiving address instead.
      </p>
    );
  return source ? (
    <img
      alt={`${network} ${asset} receiving address QR code`}
      className="funding-qr"
      height="176"
      src={source}
      width="176"
    />
  ) : null;
}

export function ProjectFunding({ project }: { project: ProjectDefinition }) {
  const [copy, setCopy] = useState<{
    key: string;
    status: "copied" | "error";
  } | null>(null);
  const now = Date.now();
  const activeRoutes = project.funding.addresses.filter(
    (route) =>
      Date.parse(route.effectiveAt) <= now &&
      (route.replacedAt === null || now < Date.parse(route.replacedAt)),
  );
  return (
    <section className="section project-funding">
      <details open={activeRoutes.length === 0}>
        <summary>Fund this project</summary>
        <p>
          Funding: {project.reward.fundingState} · Committed:{" "}
          {formatMicroUsdc(project.reward.committedMinor)} · Payments:{" "}
          {project.reward.paymentMode}
        </p>
        {activeRoutes.length === 0 ? (
          <p>
            Not accepting direct funding yet. The steward publishes an address
            through a reviewed manifest change.
          </p>
        ) : null}
        <p>{project.funding.disclosure}</p>
        {activeRoutes.length > 0 ? (
          <p>
            Check the network, asset, and full address in your wallet before
            sending. Transfers are irreversible. GitHub identity does not prove
            wallet ownership.
          </p>
        ) : null}
        <div className="funding-routes">
          {activeRoutes.map((route) => {
            const key = `${route.network}:${route.asset}:${route.address}:${route.effectiveAt}`;
            return (
              <div className="funding-route" key={key}>
                <strong>
                  {route.asset} · {route.network}
                </strong>
                <code>{route.address}</code>
                <FundingQr
                  address={route.address}
                  asset={route.asset}
                  network={route.network}
                />
                <div>
                  <button
                    className="text-button"
                    onClick={() => {
                      void copyText(route.address).then(
                        () => setCopy({ key, status: "copied" }),
                        () => setCopy({ key, status: "error" }),
                      );
                    }}
                    type="button"
                  >
                    {copy?.key === key && copy.status === "copied"
                      ? "Address copied"
                      : copy?.key === key && copy.status === "error"
                        ? "Copy unavailable; select address"
                        : "Copy address"}
                  </button>
                  <ExternalLinkAnchor
                    href={fundingExplorer(route.network, route.address)}
                  >
                    View address <ExternalLink aria-hidden="true" size={14} />
                  </ExternalLinkAnchor>
                </div>
              </div>
            );
          })}
        </div>
        <Link href={`/projects/${project.slug}/funding`}>
          View transactions
        </Link>
      </details>
    </section>
  );
}

type FundingDataState =
  | { status: "error"; message: string }
  | { status: "loading" }
  | { status: "ready"; index: ProjectFundingIndex };

function useFundingIndex(): FundingDataState {
  const [funding, setFunding] = useState<FundingDataState>({
    status: "loading",
  });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(new Error("funding request timed out")),
      FUNDING_TIMEOUT_MS,
    );
    const addresses = new Map(
      PROJECTS.map((candidate) => [candidate.id, candidate.funding.addresses]),
    );
    const commitments = new Map(
      PROJECTS.map((candidate) => [
        candidate.id,
        candidate.funding.commitments ?? [],
      ]),
    );
    void fetch("/data/funding.json", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return readBoundedJson(
          response,
          MAX_FUNDING_INDEX_BYTES,
          "Funding index",
        );
      })
      .then((value) => assertProjectFundingIndex(value, addresses, commitments))
      .then((index) => {
        if (active) setFunding({ status: "ready", index });
      })
      .catch((error: unknown) => {
        if (active) {
          setFunding({
            status: "error",
            message: error instanceof Error ? error.message : "Invalid data",
          });
        }
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);
  return funding;
}

type CurrentWalletState =
  | { status: "loading" }
  | { status: "none"; login: string }
  | { status: "error"; login: string }
  | { status: "ready"; address: string; login: string; sourceUrl: string };

function useCurrentWallet(state: DataState, login: string): CurrentWalletState {
  const [wallet, setWallet] = useState<CurrentWalletState>({
    status: "loading",
  });
  useEffect(() => {
    if (state.status !== "ready") return;
    const normalizedLogin = login.toLowerCase();
    setWallet({ status: "loading" });
    const actors: Array<{ id: string; login: string; avatarUrl?: string }> = [
      ...state.views.flatMap((view) => [
        ...view.leaders.map((leader) => leader.actor),
        ...view.opportunities.map((opportunity) => opportunity.actor),
      ]),
      ...state.cycleIndex.cycles.flatMap((cycle) =>
        cycle.contributors.map((contributor) => contributor.actor),
      ),
    ];
    const actor = actors.find(
      (candidate) => candidate.login.toLowerCase() === normalizedLogin,
    );
    const avatarActorId = actor?.avatarUrl
      ? /^https:\/\/avatars\.githubusercontent\.com\/u\/(\d+)(?:\?|$)/u.exec(
          actor.avatarUrl,
        )?.[1]
      : undefined;
    const githubActorId =
      actor && /^\d+$/u.test(actor.id) ? actor.id : avatarActorId;
    if (!githubActorId) {
      setWallet({ status: "none", login: normalizedLogin });
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(new Error("wallet claim request timed out")),
      WALLET_CLAIM_TIMEOUT_MS,
    );
    void fetch(
      `https://api.slop.cash/api/v1/wallet-claims/actors/${githubActorId}/current`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return readBoundedJson(
          response,
          MAX_WALLET_CLAIM_BYTES,
          "Wallet claim",
        );
      })
      .then((value) => {
        if (!active) return;
        if (value === null) {
          setWallet({ status: "none", login: normalizedLogin });
          return;
        }
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value)
        ) {
          throw new TypeError("Wallet claim must be an object");
        }
        const claim = value as Record<string, unknown>;
        if (
          typeof claim.claimId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(claim.claimId) ||
          claim.githubActorId !== githubActorId ||
          typeof claim.address !== "string" ||
          !isFundingAddress("solana", claim.address)
        ) {
          throw new TypeError("Wallet claim has invalid actor-bound metadata");
        }
        setWallet({
          status: "ready",
          address: claim.address,
          login: normalizedLogin,
          sourceUrl: `https://api.slop.cash/api/v1/wallet-claims/${claim.claimId}`,
        });
      })
      .catch(() => {
        if (active) setWallet({ status: "error", login: normalizedLogin });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [state, login]);
  if (wallet.status !== "loading" && wallet.login !== login.toLowerCase()) {
    return { status: "loading" };
  }
  return wallet;
}

export function SignerReports({
  reports,
}: {
  reports: readonly PublicSignerReport[];
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const groups = new Map<string, PublicSignerReport[]>();
  for (const report of reports) {
    const key = `${report.cycleId}:${report.instrumentId}`;
    const group = groups.get(key) ?? [];
    group.push(report);
    groups.set(key, group);
  }
  return (
    <section aria-label="Signer capability reports">
      <h2>Signer capability</h2>
      <p>
        These reports do not prove available balance or authorize payment.
        Payments remain disabled.
      </p>
      {[...groups.entries()].map(([key, group]) => {
        const state = publicSignerStatus(group, now);
        return (
          <article key={key}>
            <h3>
              <span aria-live="polite">
                {group[0].cycleId} ·{" "}
                {state === "inaccessible"
                  ? "Inaccessible"
                  : state === "both-signers-current"
                    ? "Both signers reported capability"
                    : "Current capability unknown"}
              </span>
            </h3>
            <p>Instrument: {group[0].instrumentId}</p>
            <ul>
              {group.map((report) => (
                <li key={`${report.sourceRepository}:${report.sourceCommit}`}>
                  {report.role}:{" "}
                  {report.capability === "lost-access"
                    ? "reported lost access"
                    : report.expiresAt !== null &&
                        Date.parse(report.expiresAt) <= now
                      ? "capability report expired"
                      : "reported signing capability"}
                  . {report.reason}{" "}
                  <ExternalLinkAnchor
                    href={`https://github.com/${report.sourceRepository}/commit/${report.sourceCommit}`}
                  >
                    Signed report
                  </ExternalLinkAnchor>
                  {report.expiresAt && (
                    <>
                      {" "}
                      · Expires{" "}
                      <time dateTime={report.expiresAt}>
                        {report.expiresAt}
                      </time>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}

function ProjectFundingPage({
  project,
  state,
}: {
  project: ProjectDefinition;
  state: DataState;
}) {
  const funding = useFundingIndex();
  const records =
    funding.status === "ready"
      ? currentProjectFundingRecords(
          funding.index.records.filter(
            (record) => record.projectId === project.id,
          ),
        )
      : [];
  const totals = projectFundingTotals(records);
  return (
    <main className="shell route-main funding-page">
      <p className="breadcrumb">
        <Link href={`/projects/${project.slug}`}>{project.name}</Link>
        <span>/</span>Funding
      </p>
      <section className="simple-heading">
        <div>
          <h1>Project funding</h1>
          <p>{project.funding.disclosure}</p>
        </div>
      </section>
      <Suspense fallback={<p role="status">Loading funding review…</p>}>
        <FundingReview
          key={project.id}
          project={project}
          sourceRepositoryUrl={SOURCE_REPOSITORY}
          cycleIndex={state.status === "ready" ? state.cycleIndex : null}
          funding={funding.status === "ready" ? funding.index : null}
        />
      </Suspense>
      <h2>Funding records</h2>
      <p>
        Verified and self-reported amounts are always shown separately. A GitHub
        login or submitted transaction ID does not prove wallet ownership or
        payment.
      </p>
      <p>
        On-chain balance does not establish signer capability or payout
        availability. Published signer reports do not activate payments;
        settlement and funding safeguards must also be satisfied.
      </p>
      {funding.status === "ready" &&
        funding.index.signerReports?.some(
          (r) => r.projectId === project.id,
        ) && (
          <SignerReports
            reports={funding.index.signerReports.filter(
              (r) => r.projectId === project.id,
            )}
          />
        )}
      {funding.status === "loading" ? (
        <div className="data-notice" role="status">
          <span className="pulse" /> Reading funding records…
        </div>
      ) : funding.status === "error" ? (
        <div className="data-notice data-error" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          Funding records unavailable: {funding.message}
        </div>
      ) : records.length === 0 ? (
        <EmptyState text="No reviewed public funding transactions have been published yet." />
      ) : (
        <>
          {totals.map((assetTotals) => (
            <p className="money-summary" key={assetTotals.asset}>
              <strong>
                {formatFundingAmount(
                  assetTotals.asset,
                  assetTotals.verifiedMinor,
                )}{" "}
                verified on-chain
              </strong>
              <span>
                {formatFundingAmount(
                  assetTotals.asset,
                  assetTotals.selfReportedMinor,
                )}{" "}
                self-reported
              </span>
            </p>
          ))}
          <div className="plain-table-wrap">
            <table className="plain-table">
              <caption className="visually-hidden">
                {project.name} funding transactions
              </caption>
              <thead>
                <tr>
                  <th scope="col">Transaction</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Attribution</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.recordId}>
                    <th scope="row">
                      <ExternalLinkAnchor
                        href={fundingTransactionExplorer(record)}
                      >
                        {record.transactionId.slice(0, 12)}…
                      </ExternalLinkAnchor>
                    </th>
                    <td>{formatFundingMinor(record)}</td>
                    <td>
                      {record.donor.attribution === "github"
                        ? `@${record.donor.login}`
                        : "Anonymous"}
                    </td>
                    <td>{record.state.replaceAll("-", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function ProjectPage({
  project,
  state,
  retry,
}: {
  project: ProjectDefinition;
  state: DataState;
  retry: () => void;
}) {
  const view =
    state.status === "ready"
      ? state.views.find((candidate) => candidate.project.id === project.id)
      : undefined;
  const headlinePrefix = "Make money ";
  const promotionEligible = projectPromotionEligible(
    project,
    state.status === "ready" ? state.cycleIndex.cycles : null,
    view?.cycle.id ?? null,
  );
  const headlineAction = project.headline.startsWith(headlinePrefix)
    ? project.headline.slice(headlinePrefix.length)
    : null;
  return (
    <main>
      <section className="project-hero">
        <div className="shell">
          <DataNotice state={state} retry={retry} />
          <p className="breadcrumb">
            <Link href="/">Projects</Link>
            <span>/</span>
            {project.name}
          </p>
          <div className="project-hero-grid">
            <div>
              <h1>
                {headlineAction ? (
                  <>
                    Make money{" "}
                    <span className="project-headline-action">
                      {headlineAction}
                    </span>
                  </>
                ) : (
                  project.headline
                )}
              </h1>
              <p className="hero-copy">{project.description}</p>
              <p className="project-terms-line">
                By{" "}
                <ExternalLinkAnchor href={project.steward.github.profileUrl}>
                  {project.steward.displayName}
                </ExternalLinkAnchor>{" "}
                · {project.terms.repositoryLicense.spdx ?? "license unknown"} ·{" "}
                {project.terms.inbound.mode === "unknown"
                  ? "inbound terms unknown"
                  : `${project.terms.inbound.mode} inbound terms`}{" "}
                · <a href={`/projects/${project.id}/terms.json`}>Terms</a>
                {project.steward.github.type === "User" ? (
                  <PublicXLink actorId={project.steward.github.nodeId} />
                ) : null}
                {" · "}
                <a href="/points#people">Meet contributors and maintainers</a>
              </p>
              {project.terms.externalPrize ? (
                <p className="project-policy-warning">
                  Organizer rules decide eligibility, amount, and payment.
                </p>
              ) : null}
            </div>
            {promotionEligible ? (
              <aside className="reward-card">
                <span>
                  {project.reward.kind === "monthly-pool"
                    ? "MONTHLY POOL"
                    : "EXTERNAL OPPORTUNITY"}
                </span>
                <strong
                  className={
                    project.reward.kind === "monthly-pool"
                      ? "reward-amount-monthly"
                      : undefined
                  }
                >
                  {project.reward.kind === "monthly-pool"
                    ? `${monthlyPoolCapLabel(project.reward)} / mo`
                    : project.reward.externalOpportunity
                        ?.advertisedAmountDisplay}
                </strong>
                <p>
                  {project.reward.kind === "monthly-pool"
                    ? monthlyPoolUnfunded(project.reward)
                      ? `Target ${project.reward.monthlyCapDisplay} per month. No funding is committed, so no payment is scheduled until the project commits funds.`
                      : `${formatMicroUsdc(project.reward.committedMinor)} committed against a ${project.reward.monthlyCapDisplay} monthly target. Accessibility is unknown; no payment is enabled.`
                    : "10% of an award actually received is allocated to Slop Cash; the remaining 90% is shared among accepted contributors. The prize sponsor controls eligibility and payment."}
                </p>
                <div>
                  {project.reward.reviewBudget ? (
                    <small>
                      + {reviewBudgetLabel(project.reward.reviewBudget)}
                    </small>
                  ) : null}
                  {project.reward.kind === "external-prize-share" ? (
                    <small>No platform pool · no dollar projection</small>
                  ) : null}
                  <div className="reward-actions">
                    <ExternalLinkAnchor href={project.links.repository}>
                      View in GitHub
                      <ExternalLink aria-hidden="true" size={14} />
                    </ExternalLinkAnchor>
                  </div>
                </div>
              </aside>
            ) : (
              <aside className="reward-card">
                <span>FUNDING PROMOTION PAUSED</span>
                <strong>$0</strong>
                <p>Accepted work and cycle history remain available.</p>
              </aside>
            )}
          </div>
        </div>
      </section>
      <div className="shell">
        <ProjectParticipation
          project={project}
          displayCycleId={view?.cycle.id ?? null}
          cycles={state.status === "ready" ? state.cycleIndex.cycles : null}
        />
        {state.status === "ready" &&
        project.repositories.some(
          (repository) =>
            !state.snapshot.repositories.some(
              (collected) => collected.id === repository.id,
            ),
        ) ? (
          <p className="data-notice" role="status">
            Activity for this project has not been collected yet.
          </p>
        ) : null}
        <ProjectFunding project={project} />
        <ProjectPaymentHistory project={project} state={state} />
        {view && state.status === "ready" ? (
          <ProjectLeaderboard
            updatedAt={state.snapshot.generatedAt}
            view={view}
          />
        ) : null}
      </div>
    </main>
  );
}

export function DonorFundingProfile({
  actor,
  records,
}: {
  actor: Pick<GitHubActor, "id" | "login">;
  records: readonly ProjectFundingRecord[];
}) {
  const publicRecords = publicFundingRecordsForDonor(records, actor.id);
  if (publicRecords.length === 0) return null;
  const totals = projectFundingTotals(publicRecords);
  return (
    <section className="section profile-section">
      <div className="profile-section-heading">
        <h2>Public project funding</h2>
        <span>
          {publicRecords.length} attributed record
          {publicRecords.length === 1 ? "" : "s"}
        </span>
      </div>
      <p>
        Only transactions explicitly attributed to this GitHub actor appear
        here. Anonymous funding never appears on contributor profiles.
      </p>
      {totals.map((assetTotals) => (
        <p className="money-summary" key={assetTotals.asset}>
          <strong>
            {formatFundingAmount(assetTotals.asset, assetTotals.verifiedMinor)}{" "}
            verified on-chain
          </strong>
          <span>
            {formatFundingAmount(
              assetTotals.asset,
              assetTotals.selfReportedMinor,
            )}{" "}
            self-reported
          </span>
        </p>
      ))}
      <div className="plain-table-wrap">
        <table className="plain-table">
          <caption className="visually-hidden">
            Publicly attributed project funding
          </caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Amount</th>
              <th scope="col">State</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {publicRecords.map((record) => (
              <tr key={record.recordId}>
                <th scope="row">
                  {findProject(record.projectId)?.name ?? record.projectId}
                </th>
                <td>{formatFundingMinor(record)}</td>
                <td>{record.state.replaceAll("-", " ")}</td>
                <td>
                  <ExternalLinkAnchor href={fundingTransactionExplorer(record)}>
                    View transaction
                  </ExternalLinkAnchor>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProfilePage({
  login,
  state,
  retry,
}: {
  login: string;
  state: DataState;
  retry: () => void;
}) {
  const funding = useFundingIndex();
  const [fundingReviews] = useFundingReviews(true);
  const currentWallet = useCurrentWallet(state, login);
  if (state.status !== "ready")
    return (
      <main className="shell route-main">
        <ProfilePoints
          login={login}
          showIdentity={state.status !== "loading"}
        />
        <DataNotice state={state} retry={retry} />
      </main>
    );
  const matches = state.views.flatMap((view) =>
    view.leaders
      .filter(
        (leader) => leader.actor.login.toLowerCase() === login.toLowerCase(),
      )
      .map((leader) => ({ leader, view })),
  );
  const history = state.cycleIndex.cycles.flatMap((cycle) =>
    cycle.contributors
      .filter(
        (contributor) =>
          contributor.actor.login.toLowerCase() === login.toLowerCase(),
      )
      .map((contributor) => ({ contributor, cycle })),
  );
  const loginOpportunities = state.views.flatMap((view) =>
    view.opportunities
      .filter(
        (opportunity) =>
          opportunity.actor.login.toLowerCase() === login.toLowerCase(),
      )
      .map((opportunity) => ({ opportunity, project: view.project })),
  );
  const globalLeaders = createGlobalLeaders(
    state.snapshot,
    state.views,
    state.cycleIndex,
  );
  const globalRank = globalLeaders.findIndex(
    (leader) => leader.actor.login.toLowerCase() === login.toLowerCase(),
  );
  const globalLeader =
    globalRank === -1 ? undefined : globalLeaders[globalRank];
  // A frozen month with no cycle directory still records the contributor.
  const preparations =
    fundingReviews.status === "ready"
      ? fundingReviews.index.reviews
          .filter(
            (review) =>
              !state.cycleIndex.cycles.some(
                (cycle) =>
                  cycle.projectId === review.projectId &&
                  cycle.cycleId === review.cycleId,
              ),
          )
          .flatMap((review) =>
            review.contributors
              .filter(
                (contributor) =>
                  contributor.actor.login.toLowerCase() === login.toLowerCase(),
              )
              .map((contributor) => ({ contributor, review })),
          )
          .sort(
            (left, right) =>
              right.review.cycleId.localeCompare(left.review.cycleId) ||
              left.review.projectId.localeCompare(right.review.projectId),
          )
      : [];
  if (
    matches.length === 0 &&
    history.length === 0 &&
    !globalLeader &&
    loginOpportunities.length === 0 &&
    preparations.length === 0
  ) {
    if (fundingReviews.status === "loading")
      return (
        <main className="shell route-main" aria-busy="true">
          <p className="data-notice">Checking frozen months…</p>
        </main>
      );
    return (
      <main className="shell route-main">
        <ProfilePoints login={login} cycles={state.cycleIndex} showIdentity />
      </main>
    );
  }
  const historicalActor =
    history[0]?.contributor.actor ?? preparations[0]?.contributor.actor;
  const opportunityActor = loginOpportunities[0]?.opportunity.actor;
  const actor: GitHubActor = globalLeader?.actor ??
    matches[0]?.leader.actor ??
    opportunityActor ?? {
      id: historicalActor?.id ?? `historical:${login.toLowerCase()}`,
      login: historicalActor?.login ?? login,
      avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`,
      url: `https://github.com/${encodeURIComponent(login)}`,
      kind: "User",
    };
  const events = state.snapshot.ledger.flatMap((event) => {
    if (event.actor.id !== actor.id) return [];
    const project = findProjectByRepositoryId(event.repository);
    if (!project) {
      throw new TypeError(`Score event ${event.id} has no registered project`);
    }
    return [{ event, project }];
  });
  const opportunities = loginOpportunities
    .filter(({ opportunity }) => opportunity.actor.id === actor.id)
    .sort(
      (left, right) =>
        Date.parse(right.opportunity.occurredAt) -
          Date.parse(left.opportunity.occurredAt) ||
        left.opportunity.source.number - right.opportunity.source.number ||
        left.opportunity.id.localeCompare(right.opportunity.id),
    )
    .slice(0, PROFILE_OPPORTUNITY_LIMIT);
  // Outside the rolling window the frozen months are the only scored record.
  const score =
    globalLeader?.score ??
    formatThirds(
      preparations.reduce(
        (total, { contributor }) => total + Number(contributor.scoreThirds),
        0,
      ),
    );
  // The live score is a rolling window, never a full-history total.
  const scoreLabel = globalLeader
    ? `${state.snapshot.window.days}-day score to ${formatDate(state.snapshot.window.to)}`
    : "score, frozen months";
  const acceptedOutcomes = matches.reduce(
    (total, match) => total + match.leader.acceptedOutcomeCount,
    0,
  );
  const projected = matches.reduce(
    (total, match) => total + BigInt(match.leader.projectedMinor ?? "0"),
    0n,
  );
  // Name the UTC cycle behind the projection and whether money backs it.
  const cycleId = (matches[0]?.view ?? state.views[0])?.cycle.id;
  const monthlyPools = (
    matches.length > 0 ? matches.map(({ view }) => view) : state.views
  ).filter((view) => view.project.reward.kind === "monthly-pool");
  const projectedUnfunded =
    monthlyPools.length > 0 &&
    monthlyPools.every((view) => monthlyPoolUnfunded(view.project.reward));
  const projectedLabel = `${
    cycleId ? formatCycleMonth(cycleId) : "monthly"
  } projected${projectedUnfunded ? ", unfunded" : ""}`;
  const paid = history.reduce(
    (total, { contributor }) => total + BigInt(contributor.paidMinor),
    0n,
  );
  const historicalWallet = history.find(({ contributor }) => contributor.wallet)
    ?.contributor.wallet;
  const featuredEvents = events.slice(0, PROFILE_EVENT_PREVIEW_LIMIT);
  const remainingEvents = events.slice(PROFILE_EVENT_PREVIEW_LIMIT);
  return (
    <main className="shell route-main profile-page">
      <DataNotice state={state} retry={retry} />
      <p className="breadcrumb">
        <Link href="/">Back to leaderboard</Link>
      </p>
      <section className="profile-hero">
        <Avatar actor={actor} size="large" />
        <div className="profile-identity">
          <h1>{actor.login}</h1>
          <div className="profile-links">
            <ExternalLinkAnchor href={actor.url}>
              GitHub <ExternalLink aria-hidden="true" size={15} />
            </ExternalLinkAnchor>
            {currentWallet.status === "ready" ? (
              <ExternalLinkAnchor href={currentWallet.sourceUrl}>
                Current payout wallet · {currentWallet.address}{" "}
                <ExternalLink aria-hidden="true" size={15} />
              </ExternalLinkAnchor>
            ) : historicalWallet ? (
              <ExternalLinkAnchor href={historicalWallet.sourceUrl}>
                Historical payout wallet · {historicalWallet.address}{" "}
                <ExternalLink aria-hidden="true" size={15} />
              </ExternalLinkAnchor>
            ) : currentWallet.status === "loading" ? (
              <span>Checking current payout wallet…</span>
            ) : currentWallet.status === "error" ? (
              <span>Current payout wallet status unavailable</span>
            ) : (
              <span>No current payout wallet registered</span>
            )}
            <Link href="/wallet">Register or update your wallet</Link>
          </div>
        </div>
      </section>
      <ProfilePoints login={login} cycles={state.cycleIndex} />
      <div className="profile-totals">
        {globalRank >= 0 ? (
          <div>
            <strong>#{globalRank + 1}</strong>
            <span>overall rank</span>
          </div>
        ) : null}
        <div>
          <strong>{score}</strong>
          <span>{scoreLabel}</span>
        </div>
        <div>
          <strong>{formatCompact(acceptedOutcomes)}</strong>
          <span>accepted this month</span>
        </div>
        <div>
          <strong>{formatMicroUsdc(projected.toString())}</strong>
          <span>{projectedLabel}</span>
        </div>
        <div>
          <strong>{formatMicroUsdc(paid.toString())}</strong>
          <span>paid</span>
        </div>
      </div>
      <section className="section profile-section">
        <div className="profile-section-heading">
          <h2>Projects</h2>
        </div>
        <div className="profile-projects">
          {matches.length === 0 ? (
            <EmptyState text="No accepted project score in the current cycles yet." />
          ) : (
            matches.map(({ leader, view }) => {
              return (
                <div className="profile-project-block" key={view.project.id}>
                  <Link href={`/projects/${view.project.slug}`}>
                    <span className="profile-project-name">
                      <strong>{view.project.name}</strong>
                      <small>{view.cycle.id}</small>
                    </span>
                    <span className="profile-project-stat">
                      <strong title={`Exact score ${leader.scoreThirds}/3`}>
                        {formatThirds(leader.scoreThirds)} score
                      </strong>
                      <small>
                        {leader.acceptedOutcomeCount} accepted outcome
                        {leader.acceptedOutcomeCount === 1 ? "" : "s"}
                      </small>
                    </span>
                    <span className="profile-project-stat">
                      <RewardValue leader={leader} />
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </section>
      {opportunities.length > 0 ? (
        <section className="section profile-section">
          <div className="profile-section-heading">
            <h2>Open work</h2>
            <span>{opportunities.length} available</span>
          </div>
          <OpportunityList opportunities={opportunities} />
        </section>
      ) : null}
      {history.length > 0 ? (
        <section className="section profile-section">
          <div className="profile-section-heading">
            <h2>Past cycles</h2>
          </div>
          <div className="profile-projects">
            {history.map(({ contributor, cycle }) => (
              <Link
                href={`/cycles/${cycle.projectId}/${cycle.cycleId}`}
                key={`${cycle.projectId}:${cycle.cycleId}`}
              >
                <span>
                  <strong>
                    {findProject(cycle.projectId)?.name ?? cycle.projectId}
                  </strong>
                  <small>
                    {cycle.cycleId} · {cycle.state.replaceAll("-", " ")}
                  </small>
                </span>
                <span>
                  <strong>{contributor.score} score</strong>
                  <small>{contributor.state.replaceAll("-", " ")}</small>
                </span>
                <span>
                  <strong>{formatMicroUsdc(contributor.paidMinor)}</strong>
                  <small>paid</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {preparations.length > 0 ? (
        <section className="section profile-section">
          <div className="profile-section-heading">
            <h2>Frozen months</h2>
            <span>scored, not approved</span>
          </div>
          <div className="profile-projects">
            {preparations.map(({ contributor, review }) => {
              const project = findProject(review.projectId);
              return (
                <Link
                  href={`/projects/${project?.slug ?? review.projectId}/funding`}
                  key={`${review.projectId}:${review.cycleId}`}
                >
                  <span>
                    <strong>{project?.name ?? review.projectId}</strong>
                    <small>{review.cycleId} · preparation</small>
                  </span>
                  <span>
                    <strong title={`Exact score ${contributor.scoreThirds}/3`}>
                      {formatThirds(Number(contributor.scoreThirds))} score
                    </strong>
                    <small>
                      {contributor.eventCount} scored event
                      {contributor.eventCount === 1 ? "" : "s"}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {contributor.simulatedMinor === null
                        ? "External prize share"
                        : formatMicroUsdc(contributor.simulatedMinor)}
                    </strong>
                    <small>
                      {contributor.wallet
                        ? "simulated · wallet on file at freeze"
                        : "simulated · unclaimed, no wallet at freeze"}
                    </small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>
      ) : fundingReviews.status === "error" ? (
        <section className="section profile-section">
          <div className="data-notice data-error" role="alert">
            <CircleAlert aria-hidden="true" size={18} /> Frozen month records
            unavailable: {fundingReviews.message}
          </div>
        </section>
      ) : null}
      {funding.status === "error" ? (
        <section className="section profile-section">
          <div className="data-notice data-error" role="alert">
            <CircleAlert aria-hidden="true" size={18} /> Public donor records
            unavailable: {funding.message}
          </div>
        </section>
      ) : funding.status === "ready" ? (
        <DonorFundingProfile actor={actor} records={funding.index.records} />
      ) : null}
      <section className="section profile-section">
        <div className="profile-section-heading">
          <h2>Accepted work</h2>
          <span>
            {events.length} recent record{events.length === 1 ? "" : "s"}
          </span>
        </div>
        <EventList events={featuredEvents} />
        {remainingEvents.length > 0 ? (
          <details className="profile-work-more">
            <summary>View all {events.length} records</summary>
            <EventList events={remainingEvents} />
          </details>
        ) : null}
      </section>
    </main>
  );
}

function opportunityPointsLabel(opportunity: ScoreOpportunity): string {
  if (
    opportunity.kind === "missing-evidence" ||
    opportunity.kind === "partial-evidence"
  ) {
    return "Evidence guidance";
  }
  return opportunity.kind === "expand-review"
    ? "Review guidance"
    : "Test guidance";
}

function OpportunityList({
  opportunities,
}: {
  opportunities: Array<{
    opportunity: ScoreOpportunity;
    project: ProjectDefinition;
  }>;
}) {
  return (
    <div className="event-list opportunity-list">
      {opportunities.map(({ opportunity, project }) => (
        <ExternalLinkAnchor href={opportunity.source.url} key={opportunity.id}>
          <span className="event-points">
            {opportunityPointsLabel(opportunity)}
          </span>
          <span>
            <strong>{opportunity.hint}</strong>
            <small>
              {opportunity.source.title} · {project.name} ·{" "}
              {formatDate(opportunity.occurredAt)}
            </small>
          </span>
          <ExternalLink aria-hidden="true" size={16} />
        </ExternalLinkAnchor>
      ))}
    </div>
  );
}

function EventList({
  events,
}: {
  events: Array<{ event: ScoreEvent; project: ProjectDefinition }>;
}) {
  if (events.length === 0) return <EmptyState text="No accepted work yet." />;
  return (
    <div className="event-list">
      {events.map(({ event, project }) => (
        <ExternalLinkAnchor
          href={event.evaluation?.decisionUrl ?? event.source.url}
          key={event.id}
        >
          <span className="event-points" title={`Exact points ${event.points}`}>
            +{formatScore(event.points)}
          </span>
          <span>
            <strong>{event.source.title}</strong>
            <small>
              {project.name} · {event.category.replaceAll("-", " ")} ·{" "}
              {formatDate(event.occurredAt)}
              {event.evaluation
                ? ` · reviewed by ${event.evaluation.reviewer}`
                : ""}
            </small>
          </span>
          <ExternalLink aria-hidden="true" size={17} />
        </ExternalLinkAnchor>
      ))}
    </div>
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
                <th scope="col">Suggested</th>
                <th scope="col">Approved</th>
                <th scope="col">Paid</th>
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
                    <strong>{formatMicroUsdc(contributor.paidMinor)}</strong>
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
        <h2>Public files</h2>
      </div>
      <div className="artifact-links">
        {files
          .filter((entry) => entry[1] !== null)
          .map(([label, file]) =>
            file ? (
              <ExternalLinkAnchor href={file.url} key={label}>
                <span>
                  <strong>{label}</strong>
                  <small>{file.sha256.slice(0, 16)}…</small>
                </span>
                <ExternalLink aria-hidden="true" size={17} />
              </ExternalLinkAnchor>
            ) : null,
          )}
      </div>
    </section>
  );
}

function CyclePage({
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
  if (state.status !== "ready")
    return (
      <main className="shell route-main">
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
  const headlineAmount = record
    ? record.kind === "external-prize-share"
      ? `${(record.reward.sharePartsPerMillion ?? 0) / 10_000}%`
      : formatMicroUsdc(
          record.state === "paid"
            ? record.reward.paidMinor
            : record.reward.approvedMinor !== "0"
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
            {project.name} · {cycleId}
          </h1>
          <p>
            {lifecycle.replaceAll("-", " ")} · {formatDate(from)}–
            {formatDate(to)}. Paid means finalized Solana evidence reconciled
            exactly.
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
                : "current cycle amount"}
          </span>
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
      <ol className="cycle-status-grid" aria-label="Cycle progress">
        <li>
          <strong>Contribution</strong>
          <p>Accepted GitHub work is collected; private traces are optional.</p>
        </li>
        <li>
          <strong>Review</strong>
          <p>Owners may set every allocation and total payout.</p>
        </li>
        <li>
          <strong>Approval</strong>
          <p>Wallet-linked amounts become immutable payout intents.</p>
        </li>
        <li>
          <strong>Settlement</strong>
          <p>The 1% fee applies when the approved principal is paid.</p>
        </li>
      </ol>
      {view ? (
        <ProjectLeaderboard
          updatedAt={state.snapshot.generatedAt}
          view={view}
        />
      ) : record ? (
        <ArchivedCycleLeaderboard cycle={record} />
      ) : null}
      {record ? <CycleArtifacts cycle={record} /> : null}
    </main>
  );
}

function exactUsdc(value: string): string | null {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(6, "0"))
  ).toString();
}

function microUsdcInput(value: string): string {
  const minor = BigInt(value);
  const whole = minor / 1_000_000n;
  const fraction = (minor % 1_000_000n).toString().padStart(6, "0");
  return fraction === "000000"
    ? whole.toString()
    : `${whole}.${fraction.replace(/0+$/u, "")}`;
}

interface AllocationDraftRow {
  review?: { amount: string; suggestedMinor: string };
  login: string;
  suggestedMinor: string;
  amount: string;
  reason: string;
}

export function ProjectManagePage({
  project,
  state,
}: {
  project: ProjectDefinition;
  state: Extract<DataState, { status: "ready" }>;
}) {
  const view = state.views.find(
    (candidate) => candidate.project.id === project.id,
  );
  const currentRecord = state.cycleIndex.cycles.find(
    (cycle) =>
      cycle.projectId === project.id && cycle.cycleId === view?.cycle.id,
  );
  const sourceRows: AllocationDraftRow[] = currentRecord
    ? currentRecord.contributors.map((contributor) => ({
        login: contributor.actor.login,
        suggestedMinor:
          contributor.lines?.sharedPool.suggestedMinor ??
          contributor.suggestedMinor,
        amount: microUsdcInput(
          contributor.lines?.sharedPool.approvedMinor ??
            contributor.approvedMinor,
        ),
        ...(contributor.lines
          ? {
              review: {
                suggestedMinor: contributor.lines.reviewBudget.suggestedMinor,
                amount: microUsdcInput(
                  contributor.lines.reviewBudget.approvedMinor,
                ),
              },
            }
          : {}),
        reason: "",
      }))
    : (view?.leaders ?? []).map((leader) => ({
        login: leader.actor.login,
        suggestedMinor: leader.projectedMinor ?? "0",
        amount: microUsdcInput(leader.projectedMinor ?? "0"),
        reason: "",
      }));
  const [headline, setHeadline] = useState(project.headline);
  const [goal, setGoal] = useState(project.description);
  const [criteria, setCriteria] = useState(
    "Describe exactly what must be accepted on GitHub to qualify.",
  );
  const [rows, setRows] = useState(sourceRows);
  const initialTotal = sourceRows.reduce(
    (total, row) =>
      total +
      BigInt(exactUsdc(row.amount) ?? "0") +
      BigInt(exactUsdc(row.review?.amount ?? "0") ?? "0"),
    0n,
  );
  const [total, setTotal] = useState(microUsdcInput(initialTotal.toString()));
  const [copyStatus, setCopyStatus] = useState<{
    kind: "allocation" | "project";
    status: "copied" | "error";
  } | null>(null);
  const [allocationQuery, setAllocationQuery] = useState("");
  const matchingRows = rows.filter((row) =>
    row.login.toLowerCase().includes(allocationQuery.trim().toLowerCase()),
  );
  const visibleRows = matchingRows.slice(0, 10);
  const parsedRows = rows.map((row) => {
    const sharedMinor = exactUsdc(row.amount);
    const reviewMinor = exactUsdc(row.review?.amount ?? "0");
    return {
      ...row,
      sharedMinor,
      reviewMinor,
      approvedMinor:
        sharedMinor === null || reviewMinor === null
          ? null
          : (BigInt(sharedMinor) + BigInt(reviewMinor)).toString(),
    };
  });
  const parsedTotal = exactUsdc(total);
  const allocated = parsedRows.reduce(
    (sum, row) => sum + BigInt(row.approvedMinor ?? "0"),
    0n,
  );
  const changedRowsHaveReasons = parsedRows.every(
    (row) =>
      row.approvedMinor === null ||
      (row.sharedMinor === row.suggestedMinor &&
        row.reviewMinor === (row.review?.suggestedMinor ?? "0")) ||
      row.reason.trim().length > 0,
  );
  const sharedPrincipalMinor = currentRecord
    ? BigInt(currentRecord.reward.capMinor)
    : project.reward.kind === "monthly-pool" && view
      ? allocationFundingMinor(
          deriveAllocationFundingBasis(project, view.cycle.id),
        )
      : 0n;
  const carriedMinor = BigInt(currentRecord?.reward.carriedMinor ?? "0");
  const reviewPrincipalMinor = currentRecord?.reward.lines
    ? BigInt(currentRecord.reward.reviewBudgetCapMinor ?? "0")
    : 0n;
  const allocationLimitMinor = (
    sharedPrincipalMinor +
    carriedMinor +
    reviewPrincipalMinor
  ).toString();
  const sharedAllocated = parsedRows.reduce(
    (sum, row) => sum + BigInt(row.sharedMinor ?? "0"),
    0n,
  );
  const reviewAllocated = parsedRows.reduce(
    (sum, row) => sum + BigInt(row.reviewMinor ?? "0"),
    0n,
  );
  const validAllocation =
    sharedAllocated <= sharedPrincipalMinor + carriedMinor &&
    reviewAllocated <= reviewPrincipalMinor &&
    parsedTotal !== null &&
    BigInt(parsedTotal) <= BigInt(allocationLimitMinor) &&
    parsedRows.every((row) => row.approvedMinor !== null) &&
    allocated === BigInt(parsedTotal) &&
    changedRowsHaveReasons;
  const feeMinor = feeForPrincipal(
    parsedTotal ?? "0",
    PLATFORM_FEE_BASIS_POINTS,
  );
  const cycleId = currentRecord?.cycleId ?? view?.cycle.id ?? "next-cycle";
  const payoutDraftingEnabled =
    project.reward.kind === "monthly-pool" &&
    project.reward.paymentMode === "enabled";
  const allocationDraft = JSON.stringify(
    {
      projectId: project.id,
      cycleId,
      approvedPrincipalMinor: parsedTotal ?? "invalid",
      feeBasisPoints: PLATFORM_FEE_BASIS_POINTS,
      feeMinor,
      allocations: parsedRows.map((row) => ({
        login: row.login,
        suggestedMinor: (
          BigInt(row.suggestedMinor) + BigInt(row.review?.suggestedMinor ?? "0")
        ).toString(),
        approvedMinor: row.approvedMinor ?? "invalid",
        ...(row.review
          ? {
              lines: {
                sharedPool: {
                  suggestedMinor: row.suggestedMinor,
                  approvedMinor: row.sharedMinor ?? "invalid",
                },
                reviewBudget: {
                  suggestedMinor: row.review.suggestedMinor,
                  approvedMinor: row.reviewMinor ?? "invalid",
                },
              },
            }
          : {}),
        reason: row.reason.trim() || null,
      })),
    },
    null,
    2,
  );
  const projectBrief = `Update ${project.id} through a reviewed Slop PR.\n\nHeadline: ${headline}\nGoal: ${goal}\nAcceptance criteria: ${criteria}\n\nKeep the project manifest, contributor skill, reviewer skill, goals, and criteria synchronized. Any model may contribute, but every run must publish its exact provider, model, and client. Signed receipts and permanent operator-private traces are optional; unavailable trace intake must never block ordinary GitHub contribution.`;
  const copy = async (kind: "allocation" | "project", value: string) => {
    try {
      await copyText(value);
      setCopyStatus({ kind, status: "copied" });
    } catch {
      setCopyStatus({ kind, status: "error" });
    }
  };
  return (
    <main className="shell route-main manage-page">
      <p className="breadcrumb">
        <Link href={`/projects/${project.slug}`}>{project.name}</Link>
        <span>/</span>Draft update
      </p>
      <div className="manage-intro">
        <h1>Propose changes to {project.name}.</h1>
        <p>
          This public tool does not save or publish changes. Copy a proposal and
          open a reviewed GitHub pull request; the repository remains the source
          of truth.
        </p>
      </div>

      <section className="owner-section">
        <h2>Project brief</h2>
        <div className="owner-form">
          <label>
            Headline
            <input
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
            />
          </label>
          <label>
            Goal
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </label>
          <label>
            Acceptance criteria
            <textarea
              value={criteria}
              onChange={(event) => setCriteria(event.target.value)}
            />
          </label>
          <button
            className="text-button"
            onClick={() => void copy("project", projectBrief)}
            type="button"
          >
            {copyStatus?.kind === "project"
              ? copyStatus.status === "copied"
                ? "Brief copied"
                : "Copy unavailable; select the fields"
              : "Copy GitHub brief"}
          </button>
        </div>
      </section>

      {payoutDraftingEnabled ? (
        <section className="owner-section allocation-editor">
          <h2>{cycleId} allocation</h2>
          <div className="owner-section-body">
            <p>
              Draft only. This page cannot save, approve, sign, or send USDC.
              Changed amounts need a public reason; the 1% fee applies only if a
              reviewed cycle is later paid.
            </p>
            <label className="total-field">
              Draft total, USDC
              <input
                inputMode="decimal"
                min="0"
                step="0.000001"
                type="number"
                value={total}
                onChange={(event) => setTotal(event.target.value)}
              />
            </label>
            <details className="allocation-details">
              <summary>
                Edit {rows.length} contributor allocation
                {rows.length === 1 ? "" : "s"}
              </summary>
              {rows.length > 10 ? (
                <label className="allocation-search">
                  Find contributor
                  <input
                    onChange={(event) => setAllocationQuery(event.target.value)}
                    placeholder="GitHub login"
                    type="search"
                    value={allocationQuery}
                  />
                </label>
              ) : null}
              {rows.length === 0 ? (
                <EmptyState text="No contributors are available for this cycle." />
              ) : visibleRows.length === 0 ? (
                <EmptyState text="No contributor matches that login." />
              ) : (
                <div className="allocation-rows">
                  {visibleRows.map((row) => (
                    <fieldset key={row.login}>
                      <legend>{row.login}</legend>
                      <label>
                        {row.review ? "Shared reward, USDC" : "Amount, USDC"}
                        <input
                          aria-label={`${row.login} ${row.review ? "shared reward" : "amount"} in USDC`}
                          inputMode="decimal"
                          min="0"
                          step="0.000001"
                          type="number"
                          value={row.amount}
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((candidate) =>
                                candidate.login === row.login
                                  ? {
                                      ...candidate,
                                      amount: event.target.value,
                                    }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </label>
                      {row.review ? (
                        <label>
                          Review reward, USDC
                          <input
                            aria-label={`${row.login} review reward in USDC`}
                            inputMode="decimal"
                            min="0"
                            step="0.000001"
                            type="number"
                            value={row.review.amount}
                            onChange={(event) =>
                              setRows((current) =>
                                current.map((candidate) =>
                                  candidate.login === row.login &&
                                  candidate.review
                                    ? {
                                        ...candidate,
                                        review: {
                                          ...candidate.review,
                                          amount: event.target.value,
                                        },
                                      }
                                    : candidate,
                                ),
                              )
                            }
                          />
                        </label>
                      ) : null}
                      <label>
                        Reason
                        <input
                          aria-label={`${row.login} reason`}
                          value={row.reason}
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((candidate) =>
                                candidate.login === row.login
                                  ? {
                                      ...candidate,
                                      reason: event.target.value,
                                    }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </label>
                    </fieldset>
                  ))}
                </div>
              )}
              {matchingRows.length > visibleRows.length ? (
                <p className="allocation-count">
                  Showing the first 10 contributors. Search by GitHub login to
                  edit another.
                </p>
              ) : null}
            </details>
            <div className="payout-totals" aria-live="polite">
              <span>{formatMicroUsdc(allocated.toString())} allocated</span>
              <span>{formatMicroUsdc(feeMinor)} fee</span>
              <strong>
                {formatMicroUsdc(
                  (BigInt(parsedTotal ?? "0") + BigInt(feeMinor)).toString(),
                )}{" "}
                total debit
              </strong>
            </div>
            {!validAllocation && rows.length > 0 ? (
              <p className="form-error" role="alert">
                Allocations must equal the total and stay within the{" "}
                {formatMicroUsdc(allocationLimitMinor)} draft limit.
                {currentRecord?.reward.lines
                  ? ` Shared rewards cannot exceed ${formatMicroUsdc((sharedPrincipalMinor + carriedMinor).toString())}; review rewards cannot exceed ${formatMicroUsdc(reviewPrincipalMinor.toString())}.`
                  : ""}{" "}
                Add a reason for every changed amount.
              </p>
            ) : null}
            <button
              className="button primary-button"
              disabled={!validAllocation || rows.length === 0}
              onClick={() => void copy("allocation", allocationDraft)}
              type="button"
            >
              {copyStatus?.kind === "allocation"
                ? copyStatus.status === "copied"
                  ? "Allocation copied"
                  : "Copy unavailable"
                : "Copy unsigned allocation"}
            </button>
            <div className="payout-action">
              {currentRecord?.files.executionPlan ? (
                <ExternalLinkAnchor
                  href={currentRecord.files.executionPlan.url}
                >
                  View unsigned plan{" "}
                  <ExternalLink aria-hidden="true" size={14} />
                </ExternalLinkAnchor>
              ) : (
                <span>No reviewed execution plan exists for this cycle.</span>
              )}
              <p>
                Settlement happens outside this page and counts as paid only
                after finalized USDC balance changes pass verification.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="owner-section">
          <h2>Payouts</h2>
          <div className="owner-section-body payout-status">
            <strong>
              {project.reward.kind === "external-prize-share"
                ? "External award"
                : "Payouts disabled"}
            </strong>
            <p>
              {project.reward.kind === "external-prize-share"
                ? "This project publishes contribution shares only. Slop cannot draft, approve, sign, or pay the external award."
                : "Slop cannot draft, approve, sign, or pay allocations while the public project manifest keeps payouts disabled."}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function HowItWorksPage() {
  const protocolRoot = `${SOURCE_REPOSITORY}/blob/develop/protocol`;
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Accepted work in. Auditable allocations out.</h1>
        <p>
          GitHub is the work and review authority. Slop turns accepted public
          evidence into a deterministic score and a reviewable allocation. It
          never pays for agent activity by itself, never holds funds, and never
          signs a transaction.
        </p>
      </section>
      <ol className="mechanism-flow" aria-label="Slop funding mechanism">
        <li>
          <strong>01 · Publish the pool</strong>
          <p>
            A project lands a manifest by pull request: repository authority,
            terms, a monthly cap, a contributor skill, and a separate reviewer
            skill. Nothing goes live from a form or an admin panel. New projects
            start paused, and payments stay disabled until committed funding is
            verified on-chain.
          </p>
        </li>
        <li>
          <strong>02 · Ship on GitHub</strong>
          <p>
            Point any agent at the repository with the project skill. There is
            no task assignment, claiming, or reservation. Maintainers decide
            what merges. Open pull requests, commits, comments, and token volume
            do not score by themselves.
          </p>
        </li>
        <li>
          <strong>03 · Disclose your tools</strong>
          <p>
            Disclose the provider, exact model, and client used for the work.
            Signed receipts and private trace uploads are optional evidence.
            Declining them never blocks submission. Public receipts never show
            prompts, responses, source files, or keys.
          </p>
        </li>
        <li>
          <strong>04 · Score the outcome</strong>
          <p>
            Accepted work is scored under Score v2: reviewed effort tiers stored
            as integer thirds. Every merge starts as a provisional micro unit. A
            review agent may propose a higher tier, but only a maintainer record
            bound to the exact head commit ratifies it. Substantive review
            scores from the same pool.
          </p>
        </li>
        <li>
          <strong>05 · Freeze and review</strong>
          <p>
            At 00:11 UTC on the first of the month a workflow freezes the cycle
            into an immutable proposal. Fourteen days of public review follow.
            The creator may approve, hold, exclude, reduce, or increase, but
            every change needs a public reason, and a wallet change restarts the
            window.
          </p>
        </li>
        <li>
          <strong>06 · Prove payment</strong>
          <p>
            The creator signs Solana USDC transfers from their own wallet. Slop
            calls a cycle paid only when finalized on-chain deltas reconcile
            every approved intent exactly. The 1% platform fee is a separate
            transfer from the creator, never a deduction.
          </p>
        </li>
      </ol>
      <section className="worked-example score-contract">
        <div>
          <h2>Score v2 pays for reviewed effort.</h2>
          <p>
            Since August 2026, accepted work is tiered by effort, complexity,
            impact, and review load instead of counted per merge. Related or
            split pull requests share one work unit. XL, exceptional,
            security-sensitive, and related-party cases need a second
            maintainer.
          </p>
          <p>
            Review is scored work: triage 1/3, standard review 1, deep
            reproduction 3, specialist review 8. Self-review, post-merge review,
            duplicate review, and bot activity do not score. A valid signed
            receipt with a finalized private trace adds a fixed 15% weight.
          </p>
          <p>
            Token volume, cost, lines, commits, confidence, and account count
            stay diagnostic. They never change score, rank, share, or payment.
            No KYC: abuse resistance comes from immutable GitHub IDs, exact-head
            decisions, and append-only public corrections.
          </p>
        </div>
        <section
          className="plain-table-wrap score-tier-wrap"
          aria-label="Contribution score tiers"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
          tabIndex={0}
        >
          <table className="plain-table score-tier-table">
            <caption>Contribution tiers</caption>
            <thead>
              <tr>
                <th scope="col">Tier</th>
                <th scope="col">Thirds</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Micro</th>
                <td>1</td>
                <td>1/3</td>
              </tr>
              <tr>
                <th scope="row">Small</th>
                <td>3</td>
                <td>1</td>
              </tr>
              <tr>
                <th scope="row">Medium</th>
                <td>9</td>
                <td>3</td>
              </tr>
              <tr>
                <th scope="row">Large</th>
                <td>24</td>
                <td>8</td>
              </tr>
              <tr>
                <th scope="row">XL</th>
                <td>45</td>
                <td>15</td>
              </tr>
              <tr>
                <th scope="row">Exceptional</th>
                <td>75</td>
                <td>25</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
      <section className="worked-example">
        <div>
          <h2>One reproducible allocation.</h2>
          <p>
            One Large merge (24 thirds) plus one standard review (3 thirds) is
            27 thirds. If the project accepts 90 thirds that month, the
            projected share is 30%. On a $5,000 committed pool that displays as
            $1,500 projected. The integer weights and source event IDs stay
            inspectable in the cycle files, and the figure stays projected until
            the creator approves it and finalized on-chain evidence reconciles.
          </p>
        </div>
        <dl className="equation-card">
          <div>
            <dt>Committed pool</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Accepted weight</dt>
            <dd>27 / 90 thirds</dd>
          </div>
          <div>
            <dt>Projected share</dt>
            <dd>30% · $1,500</dd>
          </div>
          <div>
            <dt>Precision</dt>
            <dd>integer micro-USDC</dd>
          </div>
        </dl>
      </section>
      <section className="custody-proof money-states">
        <h2>Money has exact states.</h2>
        <dl>
          <div>
            <dt>Projected</dt>
            <dd>
              A live estimate from accepted score at the published cap. Not a
              balance, wage, or guarantee.
            </dd>
          </div>
          <div>
            <dt>Under review</dt>
            <dd>A frozen monthly proposal in its 14-day public window.</dd>
          </div>
          <div>
            <dt>Approved</dt>
            <dd>Immutable payout intents after the creator signs off.</dd>
          </div>
          <div>
            <dt>Scheduled</dt>
            <dd>An unsigned transfer plan exists. No money has moved.</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>
              Finalized Solana evidence reconciles the exact transfers and fee.
            </dd>
          </div>
          <div>
            <dt>Unclaimed, held, excluded</dt>
            <dd>
              Visible unresolved states with public reasons. Awards below $2
              accrue to the next cycle instead of being discarded.
            </dd>
          </div>
        </dl>
        <p>
          A cap is a target, not a balance. A pool is unfunded until a verified
          on-chain commitment backs it, allocation never exceeds the committed
          amount, and unused funds roll over without raising the cap. A project
          may add an optional review budget as a second cash line that pays on
          top of the unchanged shared pool, and only after its own funding is
          committed.
        </p>
      </section>
      <section className="custody-proof">
        <h2>What Slop never holds.</h2>
        <ul>
          <li>No contributor or project private keys.</li>
          <li>No treasury, escrow, or platform token.</li>
          <li>No authority to sign or broadcast payments.</li>
          <li>No paid claim without finalized public evidence.</li>
        </ul>
      </section>
      <section className="custody-proof mechanism-sources">
        <h2>Read the contracts. Inspect the record.</h2>
        <ul>
          <li>
            <ExternalLinkAnchor href={`${protocolRoot}/scoring-v2.md`}>
              Score v2 contract
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor href={`${protocolRoot}/review-budget-v1.md`}>
              Additive review budget v1
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor href={`${protocolRoot}/private-trace-v1.md`}>
              Private trace privacy contract
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor
              href={`${protocolRoot}/funding-record-pr-verification.md`}
            >
              Funding record verification
            </ExternalLinkAnchor>
          </li>
          <li>
            <Link href="/receipts">Public receipts</Link>
          </li>
          <li>
            <Link href="/models">Models and harnesses</Link>
          </li>
          <li>
            <Link href="/cycles">Cycle archive</Link>
          </li>
          <li>
            <Link href="/#leaderboard">Live leaderboard</Link>
          </li>
          <li>
            <Link href="/how-it-works#verification">
              Settlement verification
            </Link>
            <Link href="/sponsors">Fund a pool</Link>
          </li>
          <li>
            <Link href="/projects/new">Add your project</Link>
          </li>
        </ul>
      </section>
      <SettlementVerification embedded />
    </main>
  );
}

function activeFundingAddressCount(
  addresses: ProjectDefinition["funding"]["addresses"],
  now: number,
): number {
  return addresses.filter(
    (route) =>
      Date.parse(route.effectiveAt) <= now &&
      (route.replacedAt === null || now < Date.parse(route.replacedAt)),
  ).length;
}

function sponsorPoolLabel(reward: ProjectDefinition["reward"]): string {
  if (reward.kind === "external-prize-share" && reward.externalOpportunity) {
    return `external prize share · ${reward.externalOpportunity.name}`;
  }
  return monthlyPoolLabel(reward);
}

function WhoBuildsOnSlop({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  const count = new Intl.NumberFormat("en-US");
  const compact = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 0,
  });
  const percentOfRatio = (ratio: number) => {
    if (ratio <= 0) return "0%";
    const rounded = Math.round(100 * ratio);
    return rounded === 0 ? "under 1%" : `${rounded}%`;
  };
  const percent = (part: number, whole: number) =>
    whole <= 0 ? "0%" : percentOfRatio(part / whole);
  const pin = WHO_BUILDS_CROSS_REFERENCE;
  const outside = WHO_BUILDS_SNAPSHOT;
  const all = outside.cohorts[0];
  const focusAreas = outside.focus.filter(
    (area) => area.primaryContributors > 0,
  );
  const knownRepositories = outside.recognizable.slice(0, 10);
  const dateLabel = whoBuildsDateLabel(outside.generatedAt);
  const pinnedFile = (path: string) =>
    `${SOURCE_REPOSITORY}/blob/develop/${path}`;
  const repositoryUrl = (repo: string) => `https://github.com/${repo}`;
  const massCount = outside.massAccounts.length;
  const massNote =
    massCount === 0
      ? ""
      : massCount === 1
        ? ", one mass pull-request account excluded"
        : `, ${massCount === 2 ? "two" : count.format(massCount)} mass pull-request accounts excluded`;
  const footprint =
    state.status === "ready" ? summarizeWhoBuilds(state.snapshot) : null;
  const models =
    state.status === "ready" ? summarizeModelOutcomes(state.snapshot) : null;
  return (
    <section
      aria-labelledby="who-builds-heading"
      className="model-outcomes-section who-builds"
    >
      <h2 id="who-builds-heading">Who builds on Slop.</h2>
      <p>
        Most of the people on the leaderboard spend the rest of their year
        building AI agents and LLM tooling, largely in small repositories, and
        some of them have merged into the best-known projects in the field. This
        is what the {count.format(all.size)} contributors on the leaderboard as
        of {dateLabel} did across the rest of GitHub in 2026. None of it adds
        points, and none of it is a promise about who will show up for your
        pool.
      </p>
      <div className="money-summary model-outcomes-summary">
        <span>
          <strong>{percent(all.aiPrimary, all.classifiable)}</strong> build AI
          agents or LLM tooling as their primary focus (
          {count.format(all.aiPrimary)} of the {count.format(all.classifiable)}{" "}
          with classifiable public work)
        </span>
        <span>
          <strong>{percent(all.aiExternalPr, all.size)}</strong> merged into an
          outside AI repository this year ({count.format(all.aiExternalPr)} of{" "}
          {count.format(all.size)})
        </span>
        <span>
          <strong>{count.format(outside.externalPrsExMass)}</strong> merged pull
          requests across {count.format(outside.externalReposExMass)} outside
          repositories since 1 January 2026
        </span>
        <span>
          <strong>{count.format(outside.aiRepoMedianStars)}</strong> stars is
          the median outside AI repository they work in;{" "}
          {percentOfRatio(outside.aiRepoShareUnder10)} have fewer than ten
        </span>
      </div>
      <div className="who-builds-grid">
        <section
          className="who-builds-block"
          aria-labelledby="who-builds-focus-heading"
        >
          <h3 id="who-builds-focus-heading">What they build elsewhere</h3>
          <section
            className="plain-table-wrap"
            aria-label="Focus areas outside Slop"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
            tabIndex={0}
          >
            <table className="plain-table who-builds-table">
              <thead>
                <tr>
                  <th scope="col">Primary focus</th>
                  <th scope="col" className="who-builds-number">
                    People
                  </th>
                  <th scope="col" className="who-builds-number">
                    Repos
                  </th>
                  <th scope="col" className="who-builds-number">
                    Merged PRs
                  </th>
                </tr>
              </thead>
              <tbody>
                {focusAreas.map((area) => (
                  <tr key={area.area}>
                    <th scope="row">{area.area}</th>
                    <td className="who-builds-number">
                      {count.format(area.primaryContributors)}
                    </td>
                    <td className="who-builds-number">
                      {count.format(area.repos)}
                    </td>
                    <td className="who-builds-number">
                      {count.format(area.prs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>
        <section
          className="who-builds-block"
          aria-labelledby="who-builds-known-heading"
        >
          <h3 id="who-builds-known-heading">
            Well-known repositories they merged into this year
          </h3>
          <section
            className="plain-table-wrap"
            aria-label="Well-known repositories outside Slop"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
            tabIndex={0}
          >
            <table className="plain-table who-builds-table">
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col" className="who-builds-number">
                    Stars
                  </th>
                  <th scope="col" className="who-builds-number">
                    Merged PRs
                  </th>
                </tr>
              </thead>
              <tbody>
                {knownRepositories.map((row) => (
                  <tr key={row.repo}>
                    <th scope="row">
                      <ExternalLinkAnchor href={repositoryUrl(row.repo)}>
                        {row.repo}
                      </ExternalLinkAnchor>
                    </th>
                    <td className="who-builds-number">
                      {compact.format(row.stars)}
                    </td>
                    <td className="who-builds-number">
                      {count.format(row.prs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>
      </div>
      <DataNotice retry={retry} state={state} />
      {footprint && models && footprint.scoredEvents > 0 ? (
        <p className="model-outcomes-note">
          Inside Slop, live: {count.format(footprint.contributors)} contributors
          scored in the last {footprint.windowDays} days, and{" "}
          {percent(
            models.totals.mergedPullRequestsWithModel,
            models.totals.mergedPullRequests,
          )}{" "}
          of merged pull requests name the model that did the work (
          {count.format(models.totals.mergedPullRequestsWithModel)} of{" "}
          {count.format(models.totals.mergedPullRequests)}). Those two figures
          move with every refresh; everything above is frozen to the dated
          snapshot.
        </p>
      ) : null}
      <p className="who-builds-sources">
        Public GitHub data only: merged pull requests since 1 January 2026
        outside the Slop projects plus each contributor&apos;s own public
        repositories, one keyword-assigned focus per repository{massNote}. The
        snapshot is committed to this repository and pinned by hash.{" "}
        <ExternalLinkAnchor href={pinnedFile(pin.snapshotPath)}>
          Snapshot JSON, {pin.date}
        </ExternalLinkAnchor>{" "}
        <code title={`sha256 ${pin.snapshotSha256}`}>
          sha256 {pin.snapshotSha256.slice(0, 12)}
        </code>
        {" · "}
        <ExternalLinkAnchor href={pinnedFile(pin.methodPath)}>
          Method and caveats
        </ExternalLinkAnchor>
        {" · "}
        <ExternalLinkAnchor href={pin.renderedUrl}>
          Rendered view
        </ExternalLinkAnchor>
      </p>
    </section>
  );
}

function SponsorsPage({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  const protocolRoot = `${SOURCE_REPOSITORY}/blob/develop/protocol`;
  const now = Date.now();
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Fund the merges. Keep the keys.</h1>
        <p>
          A sponsor sets a monthly cap for a repository, and only work the
          maintainers accept can draw on it. Slop computes the split, publishes
          every state, and prepares unsigned payment plans. Funds remain in the
          reviewed third-party instrument, governed by its own transfer rules.
          Slop holds no signing keys.
        </p>
      </section>
      <WhoBuildsOnSlop retry={retry} state={state} />
      <ol className="mechanism-flow" aria-label="What funding a pool buys">
        <li>
          <strong>01 · Publish the cap</strong>
          <p>
            A reviewed manifest change sets the monthly cap and the reward
            start. Until a verified on-chain commitment backs it, the pool shows
            as unfunded with a target, never as a balance. Contributors then use
            any agent to contribute. Accepted merges, eligible reviews, and
            separately reviewed awards follow the published scoring policy.
          </p>
        </li>
        <li>
          <strong>02 · The month freezes</strong>
          <p>
            The monthly workflow prepares a proposal under the cap. Publication
            depends on complete source data and successful validation. Fourteen
            days of public review follow. Every row names its source events, its
            integer weights, and the scoring rule version, so anyone can
            recompute it.
          </p>
        </li>
        <li>
          <strong>03 · You decide and sign</strong>
          <p>
            Project owners review proposed awards within the cap and record
            changes with a public reason. Authorized signers execute the
            reviewed transfer plan outside Slop. Slop marks the cycle paid only
            when finalized on-chain evidence reconciles every approved intent
            and the fee.
          </p>
        </li>
      </ol>
      <section className="worked-example sponsor-controls">
        <div>
          <h2>What you decide.</h2>
          <ul>
            <li>The monthly cap, with exact-cycle overrides.</li>
            <li>
              Project owners may adjust proposed awards within the cap, with a
              public reason. Amount changes restart the 14-day review.
            </li>
            <li>Whether to add a named review budget as a second cash line.</li>
            <li>
              Authorized signers approve transfers under the instrument rules.
            </li>
          </ul>
        </div>
        <div>
          <h2>What funding does not buy.</h2>
          <ul>
            <li>
              Turn a donation into control of the repository. Maintainers manage
              work and acceptance on GitHub; sponsorship alone grants no
              maintainer or payout approval authority.
            </li>
            <li>
              Edit history. Corrections append; past cycle records are never
              rewritten.
            </li>
            <li>
              Route money through Slop. There is no platform wallet, treasury,
              or escrow to send to.
            </li>
            <li>
              Pay a related party without a separate approval on the public
              record.
            </li>
          </ul>
        </div>
      </section>
      <section className="custody-proof sponsor-pools">
        <h2>Every pool, in its current state.</h2>
        <p>
          Read from the reviewed manifests. A cap is a target. A pool is funded
          only when a committed amount is backed by an active instrument with
          verifier evidence, and allocation never exceeds that amount.
        </p>
        <section
          className="plain-table-wrap"
          aria-label="Project funding pools"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
          tabIndex={0}
        >
          <table className="plain-table sponsor-pools-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Pool</th>
                <th scope="col">Payments</th>
                <th scope="col">Review line</th>
                <th scope="col">Receiving addresses</th>
              </tr>
            </thead>
            <tbody>
              {PROJECTS.map((project) => {
                const activeAddresses = activeFundingAddressCount(
                  project.funding.addresses,
                  now,
                );
                return (
                  <tr key={project.id}>
                    <th scope="row">
                      <Link href={`/projects/${project.id}`}>
                        {project.name}
                      </Link>
                    </th>
                    <td>{sponsorPoolLabel(project.reward)}</td>
                    <td>{project.reward.paymentMode}</td>
                    <td>
                      {project.reward.reviewBudget
                        ? reviewBudgetLabel(project.reward.reviewBudget)
                        : "none"}
                    </td>
                    <td>
                      {activeAddresses === 0
                        ? "none published"
                        : `${activeAddresses} active`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </section>
      <section className="custody-proof money-states">
        <h2>Your money has exact states.</h2>
        <dl>
          <div>
            <dt>Pledged</dt>
            <dd>
              A public target with no money behind it. Contributors see
              projections at the cap and the word unfunded next to them.
            </dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd>
              A positive amount backed by an active reviewed instrument and
              deterministic verifier evidence. Allocation never exceeds it.
            </dd>
          </div>
          <div>
            <dt>Under review</dt>
            <dd>A frozen monthly proposal in its 14-day public window.</dd>
          </div>
          <div>
            <dt>Approved</dt>
            <dd>
              Immutable payout intents after you sign off, with a public reason
              attached to every change you made.
            </dd>
          </div>
          <div>
            <dt>Scheduled</dt>
            <dd>An unsigned transfer plan exists. No money has moved.</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd>
              Finalized on-chain evidence reconciles the exact transfers and the
              fee.
            </dd>
          </div>
          <div>
            <dt>Unclaimed, held, excluded</dt>
            <dd>
              Visible unresolved states with public reasons. A missing wallet
              stays unclaimed. Rows below $2 accrue to the next cycle.
            </dd>
          </div>
        </dl>
        <p>
          Unused committed funds roll over without raising the cap. A wallet
          registered after a proposal is generated applies to the next cycle and
          never touches the current one.
        </p>
      </section>
      <section className="custody-proof">
        <h2>Commit through an instrument you control.</h2>
        <ul>
          <li>
            A Squads v4 multisig vault on Solana, or a Sablier Lockup v4 stream
            on Base or Ethereum. Both are reviewed, immutable, third-party
            programs. Slop holds no key, admin, or fee position in either.
          </li>
          <li>
            Direct gifts go straight from your wallet to the steward&apos;s
            published address and are recorded append-only under funding
            records, self-reported until a verifier confirms them on-chain.
          </li>
          <li>
            Neither is escrow and nothing is guaranteed. A commitment is a
            balance claim; whether its signers can act is not something this
            protocol can attest to yet, so public surfaces say so.
          </li>
          <li>
            GitHub identity never proves wallet control. A receiving address
            appears on this site only through a reviewed manifest change.
          </li>
        </ul>
      </section>
      <section className="worked-example sponsor-fee">
        <div>
          <h2>The fee is a separate transfer.</h2>
          <p>
            Slop&apos;s fee is 1% of approved principal on a monthly pool. You
            send it as its own transfer when you settle the cycle. Slop never
            deducts, sweeps, or nets it against a contributor&apos;s row, and a
            cycle does not read paid until the fee reconciles with everything
            else.
          </p>
          <p>
            External prize shares use the terms published for that project. The
            prize sponsor controls eligibility and payment.
          </p>
        </div>
        <dl className="equation-card">
          <div>
            <dt>Approved principal</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Contributor transfers</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Slop fee, sent separately</dt>
            <dd>$50</dd>
          </div>
          <div>
            <dt>Deducted from contributors</dt>
            <dd>$0</dd>
          </div>
        </dl>
      </section>
      <section className="custody-proof sponsor-note">
        <h2>Optional: pay for review as its own line.</h2>
        <p>
          Accepted review already scores from the shared pool. A named review
          budget is a second monthly cash line that pays accepted review work on
          top of that unchanged treatment, with its own cap, its own commitment,
          and separate public arithmetic. It becomes operative only after its
          own funding is committed, and it cannot be added in the same change
          that lowers the contributor cap.
        </p>
        <p>
          <ExternalLinkAnchor href={`${protocolRoot}/review-budget-v1.md`}>
            Additive review budget v1
          </ExternalLinkAnchor>
        </p>
      </section>
      <section className="custody-proof mechanism-sources">
        <h2>Verify before you commit.</h2>
        <ul>
          <li>
            <Link href="/#leaderboard">Live leaderboard</Link>
          </li>
          <li>
            <Link href="/receipts">Public receipts</Link>
          </li>
          <li>
            <Link href="/cycles">Cycle archive</Link>
          </li>
          <li>
            <ExternalLinkAnchor
              href={`${SOURCE_REPOSITORY}/blob/develop/funding/README.md`}
            >
              Funding records
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor
              href={`${protocolRoot}/funding-record-pr-verification.md`}
            >
              Funding record verification
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor
              href={`${protocolRoot}/squads-execution-tracking.md`}
            >
              Squads execution tracking
            </ExternalLinkAnchor>
          </li>
        </ul>
      </section>
      <section className="worked-example sponsor-start">
        <div>
          <h2>Start with a pull request.</h2>
          <p>
            New repository: draft the manifest and agent brief at Add a project,
            then open the proposal on GitHub. New projects begin paused, and
            payments stay disabled until funding and signer-accessibility
            requirements are satisfied. A verified balance alone does not enable
            payments.
          </p>
          <p>
            Existing project: the steward publishes a receiving address or a
            commitment instrument through a reviewed manifest change. There is
            no form and no admin panel. Every address on this site renders from
            the reviewed manifest or not at all.
          </p>
        </div>
        <ul>
          <li>
            <Link href="/projects/new">Add a project</Link>
          </li>
          <li>
            <ExternalLinkAnchor
              href={`${SOURCE_REPOSITORY}/tree/develop/projects`}
            >
              Reviewed manifests
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor href={SOCIAL_TELEGRAM}>
              Ask on Telegram
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor href={SOURCE_REPOSITORY}>
              Open an issue on GitHub
            </ExternalLinkAnchor>
          </li>
        </ul>
      </section>
    </main>
  );
}

function ReceiptsPage({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  const receipts =
    state.status === "ready"
      ? state.snapshot.attributions
          .filter((entry) => entry.run !== null)
          .sort((left, right) =>
            (right.run?.completedAt ?? "").localeCompare(
              left.run?.completedAt ?? "",
            ),
          )
      : [];
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Signed runs, without the private trace.</h1>
        <p>
          Public receipts show identity and byte-continuity metadata. Raw
          prompts, responses, source files, private trace bodies, and signing
          material never appear here.
        </p>
        <DataNotice retry={retry} state={state} />
      </section>
      {state.status === "ready" && receipts.length === 0 ? (
        <EmptyState text="No publishable signed receipts in this snapshot." />
      ) : null}
      <div className="receipt-grid">
        {receipts.map((entry) => {
          const run = entry.run;
          if (!run) return null;
          return (
            <article className="receipt-card" key={run.runId}>
              <header>
                <span
                  className="verification-seal"
                  aria-label="Device signature present"
                  role="img"
                >
                  S
                </span>
                <div>
                  <span>Verified receipt</span>
                  <strong>{run.runId}</strong>
                </div>
              </header>
              <dl>
                <div>
                  <dt>Project</dt>
                  <dd>{run.projectId}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>
                    {run.provider}/{run.model}
                  </dd>
                </div>
                <div>
                  <dt>Client</dt>
                  <dd>{run.client}</dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>{formatDate(run.completedAt)}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>
                    {new Intl.NumberFormat("en-US").format(
                      run.usage.totalTokens,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Device key</dt>
                  <dd>
                    <code>{run.deviceKeyId.slice(0, 16)}…</code>
                  </dd>
                </div>
                <div>
                  <dt>Private trace</dt>
                  <dd>
                    {run.traceUpload ? (
                      <code>{run.traceUpload.sha256.slice(0, 16)}…</code>
                    ) : (
                      "not available"
                    )}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </main>
  );
}

function ModelsPage({ state, retry }: { state: DataState; retry: () => void }) {
  const summary =
    state.status === "ready" ? summarizeModelOutcomes(state.snapshot) : null;
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Which models merge. By the receipts.</h1>
        <p>
          Every merged pull request and accepted review on the leaderboard can
          carry a model declaration by the person who did the work. This page
          counts those declarations next to the outcomes they were made on.
          Model identity is self-reported, adds no points, and is never checked
          against the provider. A signed receipt binds a device to its
          declaration; neither form verifies which model produced the work.
        </p>
        <DataNotice retry={retry} state={state} />
      </section>
      {summary ? <ModelOutcomes summary={summary} /> : null}
    </main>
  );
}

function ModelOutcomes({ summary }: { summary: ModelOutcomeSummary }) {
  const { totals } = summary;
  const count = new Intl.NumberFormat("en-US");
  const percent = (part: number, whole: number) =>
    `${whole > 0 ? Math.round((100 * part) / whole) : 0}%`;
  const points = (value: number) => count.format(value);
  const modelRows = summary.models
    .filter((row) => row.mergedPullRequests > 0 || row.acceptedReviews > 0)
    .slice(0, 30);
  const concentrated = modelRows.filter(
    (row) =>
      row.mergedPullRequests >= 40 && (row.topContributorShare ?? 0) > 0.5,
  );
  if (totals.declarations === 0) {
    return <EmptyState text="No model declarations in this snapshot." />;
  }
  return (
    <>
      <div className="money-summary model-outcomes-summary">
        <span>
          <strong>
            {percent(
              totals.mergedPullRequestsWithModel,
              totals.mergedPullRequests,
            )}
          </strong>{" "}
          of merged pull requests name a model (
          {count.format(totals.mergedPullRequestsWithModel)} of{" "}
          {count.format(totals.mergedPullRequests)})
        </span>
        <span>
          <strong>
            {count.format(totals.mergedPullRequestsWithSignedRun)}
          </strong>{" "}
          of those carry a signed receipt
        </span>
        <span>
          <strong>
            {percent(totals.acceptedReviewsWithModel, totals.acceptedReviews)}
          </strong>{" "}
          of accepted reviews name a model
        </span>
        <span>
          <strong>{count.format(totals.declarations)}</strong> declarations by{" "}
          {count.format(totals.declaringContributors)} contributors,{" "}
          {count.format(totals.signedDeclarations)} signed across{" "}
          {count.format(totals.distinctClients)} harnesses
        </span>
      </div>

      <section className="model-outcomes-section">
        <h2>Accepted outcomes by model</h2>
        <p>
          A pull request counts for a model when its author declared that model
          on the pull request; a review counts when the reviewer declared it on
          the review. Declarations by anyone else never count. PR share uses all
          merged PRs in this snapshot, including those without a declared model.
          A PR naming several models counts once for each, so shares overlap.
          The busiest contributor column counts that person’s outcomes for this
          model; it is not the model’s share of all work.
        </p>
        <section
          className="plain-table-wrap"
          aria-label="Accepted outcomes by model"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
          tabIndex={0}
        >
          <table className="plain-table model-outcomes-table">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Merged PRs</th>
                <th scope="col">Share of all merged PRs</th>
                <th scope="col">Signed PRs</th>
                <th scope="col">PR points</th>
                <th scope="col">Accepted reviews</th>
                <th scope="col">Declaring contributors</th>
                <th scope="col">Outcomes from busiest contributor</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map((row) => (
                <tr key={row.key}>
                  <th className="model-identity" scope="row">
                    <span>{row.provider}/</span>
                    {row.model}
                  </th>
                  <td>{count.format(row.mergedPullRequests)}</td>
                  <td>
                    {totals.mergedPullRequests === 0
                      ? "n/a"
                      : row.mergedPullRequests > 0 &&
                          (100 * row.mergedPullRequests) /
                            totals.mergedPullRequests <
                            0.1
                        ? "<0.1%"
                        : `${((100 * row.mergedPullRequests) / totals.mergedPullRequests).toFixed(1)}%`}
                  </td>
                  <td>
                    {row.signedPullRequests > 0
                      ? count.format(row.signedPullRequests)
                      : "none"}
                  </td>
                  <td>{points(row.pullRequestPoints)}</td>
                  <td>{count.format(row.acceptedReviews)}</td>
                  <td>{count.format(row.contributors)}</td>
                  <td
                    className={
                      (row.topContributorShare ?? 0) > 0.5
                        ? "model-share-high"
                        : undefined
                    }
                  >
                    {row.topContributorShare === null
                      ? "n/a"
                      : `${count.format(row.topContributorOutcomes)} of ${count.format(row.mergedPullRequests + row.acceptedReviews)} outcomes`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="model-outcomes-note">
          {count.format(totals.distinctDeclaredIdentifiers)} distinct declared
          strings fold to {count.format(totals.distinctModels)} models by case
          and a short provider alias list. Some rows are still one model under
          two names. The table shows models with at least one accepted outcome,
          up to 30.
        </p>
      </section>

      <section className="model-outcomes-section">
        <h2>Harnesses, from signed receipts only</h2>
        <p>
          The client is known only when a run receipt exists, so this table
          covers signed runs. Output tokens come from receipts that report exact
          usage.
        </p>
        {summary.clients.length === 0 ? (
          <EmptyState text="No signed receipts in this snapshot." />
        ) : (
          <section
            className="plain-table-wrap"
            aria-label="Harness outcomes"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
            tabIndex={0}
          >
            <table className="plain-table model-outcomes-table">
              <thead>
                <tr>
                  <th scope="col">Harness</th>
                  <th scope="col">Signed runs</th>
                  <th scope="col">Contributors</th>
                  <th scope="col">Models on those runs</th>
                  <th scope="col">Merged PRs</th>
                  <th scope="col">Median output tokens</th>
                </tr>
              </thead>
              <tbody>
                {summary.clients.map((row) => (
                  <tr key={row.client}>
                    <th className="model-identity" scope="row">
                      {row.client}
                    </th>
                    <td>{count.format(row.signedRuns)}</td>
                    <td>{count.format(row.contributors)}</td>
                    <td className="model-identity-list">
                      {row.models
                        .slice(0, 3)
                        .map((entry) => `${entry.key} (${entry.count})`)
                        .join(", ")}
                    </td>
                    <td>{count.format(row.mergedPullRequests)}</td>
                    <td>
                      {row.medianOutputTokens === null
                        ? "not reported"
                        : `${count.format(row.medianOutputTokens)} (${row.runsWithExactUsage} runs)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </section>

      <section className="model-outcomes-section">
        <h2>Read before quoting</h2>
        <ul className="model-outcomes-notes">
          <li>
            This is not a benchmark. Contributors choose their own tasks, repos
            and models. A model with many merges is a model that busy
            contributors declared on work they chose. Reviews are not blinded to
            those declarations.
          </li>
          <li>
            Model is confounded with person.{" "}
            {concentrated.length > 0
              ? `Of the models with 40 or more merged PRs, ${concentrated
                  .map(
                    (row) =>
                      `${row.key} (${percent(row.topContributorShare ?? 0, 1)})`,
                  )
                  .join(
                    ", ",
                  )} take over half of their outcomes from one contributor.`
              : "No model with 40 or more merged PRs takes over half of its outcomes from one contributor in this snapshot."}
          </li>
          <li>
            Neither a declaration nor a receipt is verified against the model
            provider. A receipt proves that a device claimed a model at a time;
            it does not prove the API served that model.
          </li>
          <li>
            The leaderboard is a rolling window and regenerates on a schedule,
            so every figure moves. Nothing here describes money. PR points are
            the scoring input; what any pool pays is decided in a separate
            public review.
          </li>
        </ul>
      </section>
    </>
  );
}

function CycleArchivePage({
  state,
  retry,
}: {
  state: CycleIndexState;
  retry: () => void;
}) {
  const cycles =
    state.status === "ready"
      ? [...state.cycleIndex.cycles].sort((left, right) =>
          right.cycleId.localeCompare(left.cycleId),
        )
      : [];
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Every pool gets a dated public record.</h1>
        <p>
          Proposed is not approved. Approved is not paid. Each cycle keeps its
          source snapshot, state, allocation, and settlement evidence distinct.
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
        ) : cycles.length === 0 ? (
          <p>No published cycles yet.</p>
        ) : null}
        {state.status === "ready" && stale(state.cycleIndex) ? (
          <p className="data-notice data-stale" role="status">
            Cycle history may be outdated · updated{" "}
            {formatDate(state.cycleIndex.generatedAt)}
          </p>
        ) : null}
      </section>
      <div className="cycle-archive-list">
        {cycles.map((cycle) => (
          <article
            className="cycle-archive-card"
            key={`${cycle.projectId}-${cycle.cycleId}`}
          >
            <div>
              <span>{cycle.projectId}</span>
              <h2>{formatCycleMonth(cycle.cycleId)}</h2>
            </div>
            <dl>
              <div>
                <dt>State</dt>
                <dd>{cycleStateLabel(cycle.state)}</dd>
              </div>
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
            </dl>
            <Link href={`/cycles/${cycle.projectId}/${cycle.cycleId}`}>
              Inspect cycle <ArrowRight aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}

function NotFound({ title = "Page not found" }: { title?: string }) {
  return (
    <main className="shell not-found">
      <h1>{title}</h1>
      <Link className="button primary-button" href="/">
        See open projects <ArrowRight aria-hidden="true" />
      </Link>
    </main>
  );
}

export function App() {
  const route = useRoute();
  return (
    <PointsProvider
      enabled={["home", "project", "profile", "points"].includes(route.kind)}
    >
      <AppContent />
    </PointsProvider>
  );
}

function AppContent() {
  const route = useRoute();
  const needsSnapshot = ![
    "points",
    "login",
    "how-it-works",
    "new-project",
    "wallet",
    "unknown",
    "verification",
    "cycle-archive",
  ].includes(route.kind);
  const [state, retry] = useSnapshot(needsSnapshot);
  const [archive, retryArchive] = useCycleIndex(route.kind === "cycle-archive");
  let content: ReactNode;
  if (route.kind === "home") content = <HomePage retry={retry} state={state} />;
  else if (route.kind === "points") content = <PointsPage />;
  else if (route.kind === "login") content = <LoginPage />;
  else if (route.kind === "how-it-works") content = <HowItWorksPage />;
  else if (route.kind === "sponsors")
    content = <SponsorsPage retry={retry} state={state} />;
  else if (route.kind === "receipts")
    content = <ReceiptsPage retry={retry} state={state} />;
  else if (route.kind === "models")
    content = <ModelsPage retry={retry} state={state} />;
  else if (route.kind === "verification") content = <SettlementVerification />;
  else if (route.kind === "cycle-archive")
    content = <CycleArchivePage retry={retryArchive} state={archive} />;
  else if (route.kind === "new-project") content = <ProjectProposalPage />;
  else if (route.kind === "manage-project") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      state.status === "ready" ? (
        <ProjectManagePage key={project.id} project={project} state={state} />
      ) : (
        <main className="shell route-main">
          <DataNotice retry={retry} state={state} />
        </main>
      )
    ) : (
      <NotFound title="Project not found" />
    );
  } else if (route.kind === "project") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <ProjectPage project={project} retry={retry} state={state} />
    ) : (
      <NotFound title="Project not found" />
    );
  } else if (route.kind === "wallet") {
    content = (
      <main className="shell route-main">
        <WalletRegistration />
      </main>
    );
  } else if (route.kind === "funding-project") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <ProjectFundingPage project={project} state={state} />
    ) : (
      <NotFound title="Project not found" />
    );
  } else if (route.kind === "profile")
    content = (
      <ProfilePage login={route.login ?? ""} retry={retry} state={state} />
    );
  else if (route.kind === "cycle") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <CyclePage
        cycleId={route.cycleId ?? ""}
        project={project}
        retry={retry}
        state={state}
      />
    ) : (
      <NotFound title="Project not found" />
    );
  } else content = <NotFound />;
  return (
    <>
      <Header isHome={route.kind === "home"} />
      <Suspense
        fallback={
          <main className="shell route-main" role="status">
            Loading page…
          </main>
        }
      >
        {content}
      </Suspense>
      <Footer />
    </>
  );
}
