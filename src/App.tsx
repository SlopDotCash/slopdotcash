import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  ExternalLink,
  Plus,
} from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CycleArchivePage, CyclePage } from "./CyclePages";
import { EarningsPage } from "./Earnings";
import { EscrowFunding } from "./EscrowFunding";
import { Link, useInitialHashScroll } from "./Link";
import { SlopMark, Wordmark } from "./Logo";
import {
  type PromotionCycle,
  projectPromotionEligible,
} from "./lib/allocation-funding";
import { browserDeployment } from "./lib/browser-deployment";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "./lib/contact";
import { copyText } from "./lib/copy-text";
import { communityProjects, homeProjects } from "./lib/home-projects";
import {
  type ModelOutcomeSummary,
  modelIdentityKey,
  summarizeModelOutcomes,
} from "./lib/model-outcomes";
import { projectLinks } from "./lib/project-links";
import {
  findProject,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";
import { REWARD_ASSET_NETWORKS } from "./lib/reward-asset.mjs";
import { pageTitle, SITE_ORIGIN, STATIC_PAGE_TITLES } from "./lib/site-routes";
import { SOURCE_REPOSITORY } from "./lib/source-repository";
import { useCycleIndex } from "./lib/use-cycle-index";
import { useDirectTransfers } from "./lib/use-direct-transfers";
import { type DataState, useSnapshot } from "./lib/use-snapshot";
import {
  summarizeWhoBuilds,
  WHO_BUILDS_CROSS_REFERENCE,
  WHO_BUILDS_SNAPSHOT,
  whoBuildsDateLabel,
} from "./lib/who-builds";
import {
  AccountPage,
  ContributorStandings,
  LoginPage,
  PointsNav,
  PointsPage,
  PointsProvider,
  PublicXLink,
} from "./Points";
import {
  cycleLifecycleLabel,
  DataNotice,
  EmptyState,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
  monthlyPoolLabel,
  monthlyPoolPointsOnly,
  monthlyPoolUnfunded,
  NotFound,
  PaymentLifecycle,
  reviewBudgetLabel,
  UNFUNDED_POOL_HEADLINE,
} from "./Presentation";
import { ProfilePage } from "./ProfilePage";
import { ProjectLeaderboard } from "./ProjectLeaderboard";

export { safeProposalHttpsUrl } from "./lib/project-proposal";
export {
  monthlyPoolLabel,
  monthlyPoolUnfunded,
  reviewBudgetLabel,
} from "./Presentation";

/**
 * Renders the GitHub-native Slop network across discovery, project,
 * contributor, cycle, and project-proposal routes. Every fetched snapshot is
 * validated before money, score, work, or usage is presented as healthy data.
 */

import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";

export { readBoundedJson } from "./lib/browser-json";

const OwnerAwardsPage = lazy(() => import("./OwnerAwards"));
const ProjectProposalPage = lazy(() => import("./ProjectProposalPage"));
const AdminPage = lazy(() => import("./Admin"));
const InboxPage = lazy(() => import("./Inbox"));
const VettingEvidencePage = lazy(() => import("./VettingEvidence"));
const SecurityCasesPage = lazy(() => import("./SecurityBounty"));
const SecurityProgramPage = lazy(() =>
  import("./SecurityBounty").then((module) => ({
    default: module.SecurityProgramPage,
  })),
);
const ProjectUpdatePage = lazy(() =>
  import("./ProjectProposalPage").then((module) => ({
    default: module.ProjectUpdatePage,
  })),
);

const SOCIAL_X = "https://x.com/SlopCash";
const SOCIAL_LINKEDIN = "https://www.linkedin.com/company/slop-cash";
const SOCIAL_TELEGRAM = "https://t.me/slopcashofficial";
// DSC-01: the hero names only launched work; add a phrase here only when it
// describes a shipped program.
const HERO_ACTIONS = ["SHIPPING OPEN SOURCE."] as const;
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
    | "admin"
    | "cycle"
    | "funding-project"
    | "home"
    | "how-it-works"
    | "owner-awards"
    | "manage-project"
    | "new-project"
    | "profile"
    | "project"
    | "receipts"
    | "models"
    | "sponsors"
    | "cycle-archive"
    | "unknown"
    | "account"
    | "points"
    | "login"
    | "earnings"
    | "inbox"
    | "vetting-evidence"
    | "security-cases"
    | "security-program";
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
  if (segments.length === 1 && segments[0] === "earnings")
    return { kind: "earnings" };
  if (segments.length === 1 && segments[0] === "login")
    return { kind: "login" };
  if (segments.length === 1 && segments[0] === "inbox")
    return { kind: "inbox" };
  if (segments.length === 1 && segments[0] === "vetting-evidence")
    return { kind: "vetting-evidence" };
  if (segments.length === 1 && segments[0] === "security")
    return { kind: "security-cases" };
  if (
    segments.length === 3 &&
    segments[0] === "projects" &&
    segments[2] === "awards"
  )
    return { kind: "owner-awards", projectId: segments[1] };
  // Admin emails sent before self-service setup link /admin/applications/<id>.
  if (
    segments[0] === "admin" &&
    (segments.length === 1 ||
      (segments.length === 3 && segments[1] === "applications"))
  )
    return { kind: "admin" };
  if (segments.length === 1 && segments[0] === "account")
    return { kind: "account" };
  if (segments.length === 1 && segments[0] === "points")
    return {
      kind: new URLSearchParams(window.location.search).has("x")
        ? "account"
        : "points",
    };
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
  if (segments.length === 1 && segments[0] === "cycles") {
    return { kind: "cycle-archive" };
  }
  if (
    segments.length === 2 &&
    segments[0] === "projects" &&
    segments[1] === "new"
  ) {
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
    segments[2] === "security"
  ) {
    return { kind: "security-program", projectId: segments[1] };
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

/** Legacy pages now live as sections of their canonical routes. */
const LEGACY_SECTIONS = new Map([["wallet", "/account#wallets"]]);

function canonicalPath(): string {
  const legacy = LEGACY_SECTIONS.get(
    window.location.pathname.replace(/^\/|\/$/gu, ""),
  );
  if (legacy) {
    const [path, hash] = legacy.split("#");
    window.history.replaceState(
      window.history.state,
      "",
      `${path}${window.location.search}#${hash}`,
    );
  }
  return window.location.pathname;
}

function useRoute(): Route {
  const [path, setPath] = useState(canonicalPath);
  useEffect(() => {
    const update = () => setPath(canonicalPath());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return useMemo(() => internalRoute(path), [path]);
}

const PRIVATE_PAGE_TITLES = new Map<Route["kind"], string>([
  ["admin", "Admin"],
  ["owner-awards", "Review awards"],
  ["account", "Account"],
  ["login", "Log in"],
  ["earnings", "Your payouts"],
  ["inbox", "Inbox"],
  ["security-cases", "Security cases"],
  ["vetting-evidence", "Private vetting evidence"],
]);

/** The title and canonical path of a route; a missing page has no canonical. */
function routeHead(route: Route): { title: string; path: string | null } {
  const notFound = { title: pageTitle("Page not found"), path: null };
  const privateTitle = PRIVATE_PAGE_TITLES.get(route.kind);
  if (privateTitle) {
    return {
      title: pageTitle(privateTitle),
      path:
        route.kind === "owner-awards"
          ? null
          : route.kind === "security-cases"
            ? "/security"
            : `/${route.kind}`,
    };
  }
  if (route.kind === "profile") {
    const login = route.login ?? "";
    return {
      title: pageTitle(login),
      path: `/contributors/${encodeURIComponent(login)}`,
    };
  }
  if (
    route.kind === "project" ||
    route.kind === "funding-project" ||
    route.kind === "manage-project" ||
    route.kind === "security-program" ||
    route.kind === "cycle"
  ) {
    const project = findProject(route.projectId ?? "");
    if (!project) return notFound;
    if (route.kind === "cycle") {
      return {
        title: pageTitle(`${project.name} ${route.cycleId} cycle`),
        path: `/cycles/${project.id}/${encodeURIComponent(route.cycleId ?? "")}`,
      };
    }
    const base = `/projects/${project.slug}`;
    if (route.kind === "funding-project") {
      return {
        title: pageTitle(`${project.name} funding`),
        path: `${base}/funding`,
      };
    }
    if (route.kind === "security-program") {
      return {
        title: pageTitle(`${project.name} security bounty`),
        path: `${base}/security`,
      };
    }
    if (route.kind === "manage-project") {
      return {
        title: pageTitle(`Manage ${project.name}`),
        path: `${base}/manage`,
      };
    }
    return { title: pageTitle(project.name), path: base };
  }
  const path = window.location.pathname.replace(/(.)\/$/u, "$1");
  const title = STATIC_PAGE_TITLES.get(path);
  return title ? { title: pageTitle(title), path } : notFound;
}

function useDocumentHead(route: Route) {
  useEffect(() => {
    const { title, path } = routeHead(route);
    document.title = title;
    const canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    const ogUrl = document.head.querySelector<HTMLMetaElement>(
      'meta[property="og:url"]',
    );
    if (path === null) {
      canonical?.remove();
      return;
    }
    const href = `${SITE_ORIGIN}${path}`;
    if (canonical) canonical.href = href;
    else {
      const link = document.createElement("link");
      link.rel = "canonical";
      link.href = href;
      document.head.append(link);
    }
    ogUrl?.setAttribute("content", href);
  }, [route]);
}

function Header() {
  const domain = publicFooterDomain(window.location.hostname);
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell header-inner">
        <Link ariaLabel="Slop home" className="wordmark" href="/">
          <SlopMark size={36} />
          <span className="wordmark-text">
            <Wordmark domain={domain} />
          </span>
        </Link>
        <Link className="header-nav-link" href="/how-it-works">
          How It Works
        </Link>
        <PointsNav />
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
          <SlopMark inverse size={104} />
          <div className="wordmark footer-wordmark">{domain}</div>
        </div>
        <nav className="footer-links" aria-label="Product">
          <Link href="/">Projects</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/projects/new">Add a project</Link>
          <Link href="/account">Account</Link>
        </nav>
        <nav className="footer-links" aria-label="Records">
          <Link href="/points">Leaderboard</Link>
          <Link href="/cycles">Cycles</Link>
          <Link href="/models">Models</Link>
          <Link href="/receipts">Run receipts</Link>
        </nav>
        <nav className="footer-links" aria-label="Community">
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
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
        </nav>
      </div>
    </footer>
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
    if (HERO_ACTIONS.length < 2) return;
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
        <span className="hero-action">
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

function ProjectOwnerAvatar({ project }: { project: ProjectDefinition }) {
  const repository = project.repositories[0];
  const owner = (repository?.aliases?.at(-1) ?? repository?.id ?? "").split(
    "/",
  )[0];
  const src = owner
    ? `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?size=96`
    : "";
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span aria-hidden="true" className="project-avatar">
        {project.name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      className="project-avatar"
      height={56}
      onError={() => setFailed(true)}
      src={src}
      width={56}
    />
  );
}

function ProjectCard({ project }: { project: ProjectDefinition }) {
  const amount =
    project.reward.kind === "monthly-pool"
      ? monthlyPoolCapLabel(project.reward)
      : (project.reward.externalOpportunity?.advertisedAmountDisplay ??
        "External");
  return (
    <Link className="project-card" href={`/projects/${project.slug}`}>
      <div className="project-card-heading">
        <ProjectOwnerAvatar project={project} />
        <h3>{project.name}</h3>
        <ArrowRight aria-hidden="true" />
      </div>
      <div className="project-card-content">
        <p className="project-summary">{project.description}</p>
        <p className="project-bounty">
          <strong>{amount}</strong>
          {monthlyPoolPointsOnly(project.reward) ||
          project.reward.kind === "external-prize-share" ? (
            <span> + points</span>
          ) : (
            <span>/mo target</span>
          )}
        </p>
        {monthlyPoolPointsOnly(project.reward) ? (
          <small className="project-money-state">Points only</small>
        ) : project.reward.kind === "monthly-pool" ? (
          project.reward.paymentMode !== "enabled" ? (
            <small className="project-money-state">Payments not active</small>
          ) : null
        ) : (
          <small className="project-money-state">External prize</small>
        )}
        {project.reward.reviewBudget ? (
          <small className="project-review-budget">
            + {reviewBudgetLabel(project.reward.reviewBudget)}
          </small>
        ) : null}
      </div>
    </Link>
  );
}

function ProjectRow({ project }: { project: ProjectDefinition }) {
  const amount = monthlyPoolPointsOnly(project.reward)
    ? "$0 + points (Points only)"
    : project.reward.kind === "monthly-pool"
      ? `${monthlyPoolCapLabel(project.reward)}/mo target`
      : `${project.reward.externalOpportunity?.advertisedAmountDisplay ?? "External prize"} + points`;
  return (
    <li>
      <Link className="project-row" href={`/projects/${project.slug}`}>
        <ProjectOwnerAvatar project={project} />
        <span className="project-row-name">
          <strong>{project.name}</strong>
          <small>{project.description}</small>
          {project.status === "paused" ? (
            <small className="project-money-state">Paused</small>
          ) : project.reward.kind === "monthly-pool" &&
            !monthlyPoolPointsOnly(project.reward) &&
            project.reward.paymentMode !== "enabled" ? (
            <small className="project-money-state">Payments not active</small>
          ) : null}
        </span>
        <span className="project-row-amount">
          {project.status === "paused" ? null : amount}
        </span>
        <ChevronRight aria-hidden="true" />
      </Link>
    </li>
  );
}

const COMMUNITY_PAGE_SIZE = 10;

function CommunityProjects({ projects }: { projects: ProjectDefinition[] }) {
  const [page, setPage] = useState(0);
  if (projects.length === 0) return null;
  const pages = Math.ceil(projects.length / COMMUNITY_PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const visible = projects.slice(
    current * COMMUNITY_PAGE_SIZE,
    (current + 1) * COMMUNITY_PAGE_SIZE,
  );
  return (
    <section
      className="project-tier community-projects"
      aria-labelledby="community-projects"
    >
      <h3 id="community-projects">Community</h3>
      <p className="project-tier-note">
        Listed by their owners, not featured by Slop. Paused projects are listed
        but not collected yet.
      </p>
      <ul className="project-rows">
        {visible.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </ul>
      {pages > 1 ? (
        <nav aria-label="Community project pages" className="pagination">
          <button
            aria-label="Previous page"
            className="button secondary-button icon-button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            type="button"
          >
            <ArrowLeft aria-hidden="true" />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            aria-label="Next page"
            className="button secondary-button icon-button"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
            type="button"
          >
            <ArrowRight aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function GlobalLeaderboard() {
  return (
    <section
      className="section shell home-leaderboard-section"
      id="leaderboard"
    >
      <ContributorStandings compact title="Top sloperators" />
    </section>
  );
}

function bootstrapAgentPrompt(): string {
  const origin = window.location.origin.replace(/\/$/u, "");
  return `Read ${origin}/SKILL.md and follow it.`;
}

function HomePage() {
  const featuredProjects = homeProjects();
  const listedCommunityProjects = communityProjects();
  return (
    <main>
      <section className="hero shell">
        <TypewriterHeroHeading />
        <InstallPanel />
      </section>

      <section className="section shell home-projects-section" id="projects">
        <div className="home-section-heading">
          <h2 className="home-section-title">Projects</h2>
          <Link className="button primary-button" href="/projects/new">
            <Plus aria-hidden="true" /> Add a project
          </Link>
        </div>
        {featuredProjects.length + listedCommunityProjects.length === 0 ? (
          <p className="project-tier-note">
            No projects are listed yet. Maintainers add one with GitHub sign-in;
            it goes live when its setup checks pass.
          </p>
        ) : (
          <>
            {featuredProjects.length > 0 ? (
              <section
                className="project-tier"
                aria-labelledby="featured-projects"
              >
                <h3 id="featured-projects">Featured</h3>
                <div className="project-grid">
                  {featuredProjects.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              </section>
            ) : null}
            <CommunityProjects projects={listedCommunityProjects} />
          </>
        )}
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

// Each link hands the prompt to the agent's own launch surface. Web chats
// prefill a new conversation; OpenClaw asks before it runs the message; Hermes
// has no prompt link, so it opens its confirmed skill install for SKILL.md.
const AGENT_DEEP_LINKS: readonly {
  name: string;
  logo: string;
  href: (prompt: string, skillUrl: string) => string;
}[] = [
  {
    name: "Cursor",
    logo: "cursor",
    href: (prompt) =>
      `https://cursor.com/link/prompt?text=${encodeURIComponent(prompt)}`,
  },
  {
    name: "Claude",
    logo: "claude",
    href: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  },
  {
    name: "ChatGPT",
    logo: "chatgpt",
    href: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  },
  {
    name: "Grok",
    logo: "grok",
    href: (prompt) => `https://grok.com/?q=${encodeURIComponent(prompt)}`,
  },
  {
    name: "Meta AI (Muse Spark)",
    logo: "meta-ai",
    href: (prompt) =>
      `https://www.meta.ai/?prompt=${encodeURIComponent(prompt)}`,
  },
  {
    name: "OpenClaw",
    logo: "openclaw",
    href: (prompt) => `openclaw://agent?message=${encodeURIComponent(prompt)}`,
  },
  {
    name: "Hermes Agent",
    logo: "hermes-agent",
    href: (_prompt, skillUrl) =>
      `hermes://skill/install?identifier=${encodeURIComponent(skillUrl)}`,
  },
];

function AgentPromptBox({
  prompt,
  openIn = false,
}: {
  prompt: string;
  openIn?: boolean;
}) {
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
  const box = (
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
        className={
          copy === "copied"
            ? "button primary-button agent-prompt-copied"
            : "button primary-button"
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
  if (!openIn) return box;
  const origin = window.location.origin.replace(/\/$/u, "");
  return (
    <div className="agent-prompt">
      {box}
      <div className="agent-open-in">
        <span>Open in</span>
        <ul>
          {AGENT_DEEP_LINKS.map((agent) => {
            const href = agent.href(prompt, `${origin}/SKILL.md`);
            const web = href.startsWith("https://");
            return (
              <li key={agent.name}>
                <a
                  href={href}
                  onClick={() => void copyText(prompt).catch(() => undefined)}
                  rel={web ? "noreferrer" : undefined}
                  target={web ? "_blank" : undefined}
                  title={agent.name}
                >
                  <span
                    aria-hidden="true"
                    className={`agent-logo agent-logo-${agent.logo}`}
                  />
                  <span className="visually-hidden">{agent.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ProjectLinksLine({ project }: { project: ProjectDefinition }) {
  const links = projectLinks(project);
  return (
    <nav aria-label="Project links" className="project-links-line">
      {links.map((link, index) => (
        <span key={link.href}>
          {index > 0 ? " · " : null}
          <ExternalLinkAnchor href={link.href}>{link.label}</ExternalLinkAnchor>
        </span>
      ))}
    </nav>
  );
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
  if (project.participation?.state === "archived") {
    const successor = findProject(project.participation.successorProjectId);
    return (
      <section className="section" id="start">
        <h2>Archived</h2>
        <p>
          Continue with{" "}
          <Link href={`/projects/${project.participation.successorProjectId}`}>
            {successor?.name ?? project.participation.successorProjectId}
          </Link>
          .
        </p>
      </section>
    );
  }
  if (project.participation?.state === "permission-required") {
    return (
      <section className="section" id="start">
        <h2>Permission required</h2>
        <p>
          Contact{" "}
          <ExternalLinkAnchor href={project.steward.github.profileUrl}>
            {project.steward.displayName}
          </ExternalLinkAnchor>{" "}
          about permission before contributing. Project activation remains
          paused.
        </p>
      </section>
    );
  }
  if (project.status === "paused") {
    return (
      <section className="section" id="start">
        <h2>Project paused</h2>
        <p>A Slop admin opens the project after review.</p>
      </section>
    );
  }
  if (projectPromotionEligible(project, cycles, displayCycleId))
    return <InstallPanel project={project} />;
  return (
    <section className="section" id="start">
      <h2>Contribution record remains open</h2>
      <p>
        {cycles === null
          ? "Funding history must load before skill promotion is available."
          : displayCycleId === null
            ? "Contribution data for this project is not available yet."
            : "Skill promotion is paused after two unfunded cycles. Accepted work and scores continue to be recorded; committed funding is required to resume promotion."}
      </p>
    </section>
  );
}

function InstallPanel({ project }: { project?: ProjectDefinition }) {
  const projectId = project?.id;
  const [eligibility, setEligibility] = useState<
    "loading" | "ready" | "blocked" | "error"
  >("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setEligibility("loading");
    fetchWithDeadline("/.well-known/slop/projects.json", {
      cache: attempt > 0 ? "reload" : "default",
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Discovery unavailable");
        const body = (await readBoundedJson(
          response,
          4 * 1024 * 1024,
          "Agent setup",
        )) as { schemaVersion?: unknown; projects?: { project_id: string }[] };
        if (body.schemaVersion !== "1" || !Array.isArray(body.projects))
          throw new Error("Invalid discovery registry");
        if (active)
          setEligibility(
            (
              projectId
                ? body.projects.some((entry) => entry.project_id === projectId)
                : body.projects.length > 0
            )
              ? "ready"
              : "blocked",
          );
      })
      .catch(() => {
        if (active) setEligibility("error");
      });
    return () => {
      active = false;
    };
  }, [projectId, attempt]);
  return (
    <div
      className={project ? "install-panel" : "home-agent-setup"}
      id={project ? "start" : undefined}
    >
      {eligibility === "ready" ? (
        <>
          {project ? (
            <div className="install-heading">
              <h2>Copy this into your agent.</h2>
            </div>
          ) : (
            <p className="hero-copy">Paste this into your coding agent.</p>
          )}
          <AgentPromptBox
            openIn={!project}
            prompt={
              project ? projectAgentPrompt(project) : bootstrapAgentPrompt()
            }
          />
        </>
      ) : (
        <>
          <h2>
            {eligibility === "loading"
              ? "Checking agent setup…"
              : eligibility === "blocked"
                ? "Agent setup awaiting security review"
                : "Agent setup unavailable"}
          </h2>
          {eligibility === "blocked" ? (
            project ? (
              <p>
                The current project revision is not cleared for agent
                installation.{" "}
                <Link href={`/projects/${project.slug}/manage`}>
                  Project owner: review setup
                </Link>
              </p>
            ) : (
              <p>
                No projects are cleared for agent setup yet. Browse the projects
                below.
              </p>
            )
          ) : null}
          {eligibility !== "loading" ? (
            <button
              className="button secondary-button"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Check again
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Dollars are simulated only against committed funds; otherwise a share. */

function ProjectPaymentHistory({
  project,
  state,
}: {
  project: ProjectDefinition;
  state: DataState;
}) {
  const [directState, retryDirect] = useDirectTransfers({
    projectId: project.id,
  });
  if (state.status !== "ready") return null;
  const cycles = state.cycleIndex.cycles
    .filter((cycle) => cycle.projectId === project.id)
    .sort((left, right) => right.cycleId.localeCompare(left.cycleId));
  const externalPrize = project.reward.kind === "external-prize-share";
  const direct = new Map<
    string,
    { amount: bigint; count: number; paidOn: string }
  >();
  for (const payment of directState.status === "ready"
    ? directState.transfers
    : []) {
    const month = direct.get(payment.contributionMonth) ?? {
      amount: 0n,
      count: 0,
      paidOn: payment.blockTime,
    };
    month.amount += BigInt(payment.amountMicro);
    month.count += 1;
    if (payment.blockTime > month.paidOn) month.paidOn = payment.blockTime;
    direct.set(payment.contributionMonth, month);
  }
  return (
    <section className="section payment-history">
      <div className="simple-heading">
        <h2>{externalPrize ? "Cycle history" : "Payment history"}</h2>
        {externalPrize ? null : (
          <Link href={`/projects/${project.slug}/funding`}>Manage funding</Link>
        )}
        <Link href={`/projects/${project.slug}/manage`}>
          Draft a project update
        </Link>
        {project.escrow && (
          <Link href={`/projects/${project.slug}/awards`}>Review awards</Link>
        )}
      </div>
      {directState.status === "error" && !externalPrize ? (
        <p role="status">
          Direct payment records are unavailable.{" "}
          <button type="button" onClick={retryDirect}>
            Retry direct payments
          </button>
        </p>
      ) : null}
      {[...direct].map(([month, { amount, count, paidOn }]) => (
        <p className="money-summary" key={month}>
          <strong>{formatMicroUsdc(amount.toString())} paid directly</strong>
          <span>
            Paid {formatDate(paidOn)} for {formatCycleMonth(month)} work ·{" "}
            {count} transfers ·{" "}
            <ExternalLinkAnchor
              href={`${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/disclosures/${project.id}-${month}-direct-payments.json`}
            >
              Disclosure
            </ExternalLinkAnchor>
          </span>
        </p>
      ))}
      {cycles.length === 0 ? (
        <EmptyState text="No cycles have closed yet." />
      ) : (
        <div className="plain-table-wrap">
          <table className="plain-table">
            <caption className="visually-hidden">{project.name} cycles</caption>
            <thead>
              <tr>
                <th scope="col">Cycle</th>
                {externalPrize ? null : (
                  <>
                    <th scope="col">Approved</th>
                    <th scope="col">Fee</th>
                    <th scope="col">Paid</th>
                  </>
                )}
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
                  {externalPrize ? null : (
                    <>
                      <td>{formatMicroUsdc(cycle.reward.approvedMinor)}</td>
                      <td>{formatMicroUsdc(cycle.reward.feeMinor)}</td>
                      <td>{formatMicroUsdc(cycle.reward.paidMinor)}</td>
                    </>
                  )}
                  <td>{cycleLifecycleLabel(cycle)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ProjectFunding({ project }: { project: ProjectDefinition }) {
  return project.escrow ? <EscrowFunding project={project} /> : null;
}

function fundingStateLabel(project: ProjectDefinition): string {
  if (project.reward.kind === "external-prize-share")
    return "External prize, not held by Slop";
  return project.reward.fundingState === "committed"
    ? "Committed"
    : "Pledged, not committed";
}

function ProjectFundingPage({ project }: { project: ProjectDefinition }) {
  return (
    <main className="shell route-main funding-page">
      <p className="breadcrumb">
        <Link href={`/projects/${project.slug}`}>{project.name}</Link>
        <span>/</span>Funding
      </p>
      <h1>{project.name} funding</h1>
      <section className="funding-records">
        <dl className="funding-status-grid">
          <div>
            <dt>
              {project.reward.kind === "monthly-pool"
                ? "Monthly target"
                : "Advertised prize"}
            </dt>
            <dd>
              {monthlyPoolPointsOnly(project.reward)
                ? "$0 (Points only)"
                : project.reward.kind === "monthly-pool"
                  ? project.reward.monthlyCapDisplay
                  : (project.reward.externalOpportunity
                      ?.advertisedAmountDisplay ?? "External")}
            </dd>
          </div>
          <div>
            <dt>Funding</dt>
            <dd>{fundingStateLabel(project)}</dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd>{formatMicroUsdc(project.reward.committedMinor)}</dd>
          </div>
          <div>
            <dt>Payments</dt>
            <dd>
              {project.reward.paymentMode === "enabled"
                ? "Enabled"
                : "Disabled"}
            </dd>
          </div>
          <div>
            <dt>Project vault</dt>
            <dd>
              {project.escrow?.deployments.length
                ? "Reviewed deployment published"
                : "Not deployed"}
            </dd>
          </div>
        </dl>
        {project.escrow ? (
          <EscrowFunding project={project} />
        ) : (
          <div>
            <EmptyState text="Funding setup requires a reviewed project vault." />
            <p>
              Ask a Slop admin to review the vault deployment and funding
              authority. <a href={CONTACT_MAILTO}>Contact Slop</a>
            </p>
          </div>
        )}
        <p className="funding-records-note">
          A GitHub login does not prove wallet ownership or payment. Monthly
          cycle states are in the <Link href="/cycles">cycle archive</Link>.
        </p>
      </section>
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
                {project.status === "paused" ||
                (project.reward.kind === "monthly-pool" &&
                  project.reward.paymentMode !== "enabled") ||
                monthlyPoolPointsOnly(project.reward) ? (
                  project.name
                ) : headlineAction ? (
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
              <p className="hero-copy">
                {monthlyPoolPointsOnly(project.reward)
                  ? project.contribution?.approvedScope ||
                    headlineAction ||
                    project.headline
                  : project.description}
              </p>
              <p className="project-reward-status">
                {monthlyPoolPointsOnly(project.reward)
                  ? "Points only · no cash rewards"
                  : project.reward.kind === "monthly-pool"
                    ? `${project.reward.monthlyCapDisplay} monthly target · ${formatMicroUsdc(project.reward.committedMinor)} committed · ${project.reward.paymentMode === "enabled" ? "payments enabled" : "payments not active"}`
                    : "External prize · organizer decides awards"}
              </p>
              {project.status === "paused" ? (
                <ProjectParticipation
                  project={project}
                  displayCycleId={view?.cycle.id ?? null}
                  cycles={
                    state.status === "ready" ? state.cycleIndex.cycles : null
                  }
                />
              ) : null}
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
                {project.securityBounty ? (
                  <>
                    {" · "}
                    <Link href={`/projects/${project.slug}/security`}>
                      Security bounty
                    </Link>
                  </>
                ) : null}
                {project.steward.github.type === "User" ? (
                  <PublicXLink actorId={project.steward.github.nodeId} />
                ) : null}
                {view ? (
                  <>
                    {" · "}
                    <Link href={`/projects/${project.slug}#contributors`}>
                      Contributors
                    </Link>
                  </>
                ) : null}
              </p>
              <ProjectLinksLine project={project} />
              {project.rewardAsset ? (
                <p className="project-terms-line">
                  Reward asset: {project.rewardAsset.symbol} on{" "}
                  {REWARD_ASSET_NETWORKS[project.rewardAsset.network].name} ·{" "}
                  <code>{project.rewardAsset.address}</code> ·{" "}
                  {project.rewardAsset.decimals} decimals
                </p>
              ) : null}
            </div>
            {project.status === "paused" ? null : state.status !== "ready" ? (
              <aside className="reward-card">
                <strong>
                  {state.status === "loading"
                    ? "Loading funding history…"
                    : "Funding history unavailable"}
                </strong>
                <p>
                  Funding promotion cannot be determined until the records load.
                </p>
              </aside>
            ) : project.reward.kind === "monthly-pool" &&
              monthlyPoolUnfunded(project.reward) ? null : promotionEligible ? (
              <aside className="reward-card">
                <strong
                  className={
                    project.reward.kind === "monthly-pool" &&
                    !monthlyPoolUnfunded(project.reward)
                      ? "reward-amount-monthly"
                      : undefined
                  }
                >
                  {monthlyPoolPointsOnly(project.reward) ? (
                    "$0 + points"
                  ) : project.reward.kind === "monthly-pool" ? (
                    monthlyPoolUnfunded(project.reward) ? (
                      UNFUNDED_POOL_HEADLINE
                    ) : (
                      `${monthlyPoolCapLabel(project.reward)} / mo`
                    )
                  ) : (
                    <>
                      <span className="reward-exact-amount">
                        {
                          project.reward.externalOpportunity
                            ?.advertisedAmountDisplay
                        }
                      </span>
                      {" + points"}
                    </>
                  )}
                </strong>
                {project.reward.kind === "external-prize-share" ? (
                  <details>
                    <summary>Prize allocation terms</summary>
                    <p>{project.terms.externalPrize?.allocationAuthority}</p>
                    <a href={`/projects/${project.id}/terms.json`}>
                      Full prize terms
                    </a>
                  </details>
                ) : (
                  <p>
                    {monthlyPoolPointsOnly(project.reward)
                      ? "Points only. Accepted work earns Slop points. This project has no money pool."
                      : project.reward.kind === "monthly-pool"
                        ? monthlyPoolUnfunded(project.reward)
                          ? `Target ${project.reward.monthlyCapDisplay} per month. No payments scheduled.`
                          : `${formatMicroUsdc(project.reward.committedMinor)} committed against a ${project.reward.monthlyCapDisplay} monthly target. Accessibility is unknown; no payment is enabled.`
                        : null}
                  </p>
                )}
                <div>
                  {project.reward.reviewBudget ? (
                    <small>
                      + {reviewBudgetLabel(project.reward.reviewBudget)}
                    </small>
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
                <strong>Funding promotion paused</strong>
                <p>
                  Accepted work and cycle history remain available. No payment
                  is enabled.
                </p>
              </aside>
            )}
          </div>
          {project.status !== "paused" && state.status === "ready" ? (
            <ProjectParticipation
              project={project}
              displayCycleId={view?.cycle.id ?? null}
              cycles={state.cycleIndex.cycles}
            />
          ) : null}
          <ProjectFunding project={project} />
        </div>
      </section>
      <div className="shell">
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
        <ProjectPaymentHistory
          key={project.id}
          project={project}
          state={state}
        />
        {view && state.status === "ready" ? (
          <ProjectLeaderboard
            state={state}
            retry={retry}
            updatedAt={state.snapshot.generatedAt}
            view={view}
          />
        ) : null}
      </div>
    </main>
  );
}

function HowItWorksPage() {
  const protocolRoot = `${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/protocol`;
  return (
    <main className="shell evidence-page how-it-works">
      <section className="evidence-page-hero">
        <h1>How Slop works</h1>
        <p>
          Ship useful work on GitHub. Maintainers accept it; Slop publishes the
          score and payment record.
        </p>
      </section>
      <div className="how-paths">
        <section aria-labelledby="contributor-path">
          <h2 id="contributor-path">For contributors</h2>
          <ol className="mechanism-flow">
            <li>
              <strong>1. Choose work</strong>
              <p>
                Find an active <Link href="/#projects">project</Link>, read its
                skill and choose unblocked work. No token is required.
              </p>
            </li>
            <li>
              <strong>2. Submit a PR</strong>
              <p>
                Use any agent. Test the result and disclose the exact provider,
                model and client.
              </p>
            </li>
            <li>
              <strong>3. Maintainer review</strong>
              <p>
                The repository decides what merges. Open PRs and agent activity
                do not earn accepted-work credit.
              </p>
            </li>
            <li>
              <strong>4. Score and reward review</strong>
              <p>
                Accepted outcomes receive Slop Score. Points are nonfinancial; a
                payment requires separate funding, approval and verified
                settlement.
              </p>
            </li>
          </ol>
        </section>
        <section aria-labelledby="maintainer-path">
          <h2 id="maintainer-path">For maintainers</h2>
          <ol className="mechanism-flow">
            <li>
              <strong>1. Add a project</strong>
              <p>
                <Link href="/projects/new">
                  Add your repository and contribution rules
                </Link>
                . Install Slopbot; the project goes live when the security scan
                passes. No admin approval is needed.
              </p>
            </li>
            <li>
              <strong>2. Fund the pool</strong>
              <p>
                A cap is a target. Only funds in the project escrow pay awards.{" "}
                <Link href="/sponsors">Funding options</Link>
              </p>
            </li>
            <li>
              <strong>3. Review awards</strong>
              <p>
                Check each monthly proposal within the funded cap. Record
                changes and holds with public reasons.
              </p>
            </li>
            <li>
              <strong>4. Send payment</strong>
              <p>
                Commit approved awards to the project escrow. Approval alone
                does not prove payment.
              </p>
            </li>
          </ol>
        </section>
      </div>
      <section className="worked-example score-contract">
        <div>
          <h2>Slop Score</h2>
          <p>
            Maintainers ratify effort tiers for accepted work. Related or split
            PRs share one work unit. Score is separate from{" "}
            <Link href="/points">participation Points</Link> and money received.
          </p>
          <details>
            <summary>Scoring rules and evidence</summary>
            <p>
              Signed receipts and reviewed private trace uploads are optional.
              Declining them does not block submission. Public receipts do not
              expose prompts, responses, source files or keys.
            </p>
            <p>
              Since August 2026, accepted work is tiered by effort, complexity,
              impact, and review load instead of counted per merge. Related or
              split pull requests share one work unit. XL, exceptional,
              security-sensitive, and related-party cases need a second
              maintainer.
            </p>
            <p>
              Review is scored work: triage 1/3, standard review 1, deep
              reproduction 3, specialist review 8. Since October 2026, an
              ordinary review scores only when the merged code answered its
              request for changes, once per pull request. Self-review,
              post-merge review, duplicate review, and bot activity do not
              score. A valid signed receipt with a finalized private trace adds
              a fixed 15% weight.
            </p>
            <p>
              Token volume, cost, lines, commits, confidence, and account count
              stay diagnostic. They never change score, rank, share, or payment.
              No KYC: abuse resistance comes from immutable GitHub IDs,
              exact-head decisions, and append-only public corrections.
            </p>
          </details>
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
                <th scope="col">Slop Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Micro</th>
                <td>1/3</td>
              </tr>
              <tr>
                <th scope="row">Small</th>
                <td>1</td>
              </tr>
              <tr>
                <th scope="row">Medium</th>
                <td>3</td>
              </tr>
              <tr>
                <th scope="row">Large</th>
                <td>8</td>
              </tr>
              <tr>
                <th scope="row">XL</th>
                <td>15</td>
              </tr>
              <tr>
                <th scope="row">Exceptional</th>
                <td>25</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
      <section className="worked-example">
        <div>
          <h2>Example allocation</h2>
          <p>
            Accepted weight ÷ total weight × funded pool = projected allocation.
          </p>
          <p>
            This example is a projection, not an approved award or a payment.
            The cycle records the applicable fees and exact amounts.
          </p>
          <details>
            <summary>Exact calculation</summary>
            <p>
              A Large contribution and a standard review have a combined weight
              of 9: 27 integer thirds. Against 30 total weight (90 thirds), the
              share is 30%. Allocations use integer USDC micro-units; original
              weights and event IDs remain in the cycle records.
            </p>
          </details>
        </div>
        <dl className="equation-card" aria-label="Example projected allocation">
          <div>
            <dt>Accepted share</dt>
            <dd>9 ÷ 30 = 30%</dd>
          </div>
          <div>
            <dt>Funded pool</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Projected allocation</dt>
            <dd>30% × $5,000 = $1,500</dd>
          </div>
        </dl>
      </section>
      <section className="custody-proof money-states">
        <h2>Payment stages</h2>
        <PaymentLifecycle />
        <details>
          <summary>Funding and cycle rules</summary>
          <p>
            A cap is a target, not a balance. A pool is unfunded until its
            project escrow holds funds, awards never exceed the free escrow
            balance, and unused funds roll over without raising the cap. A
            project may add an optional review budget as a second cash line that
            pays on top of the unchanged shared pool, and only after its own
            funding is committed.
          </p>
          <p>
            Monthly proposals have a 14-day public review. A funded award can
            wait for a wallet; confirming one later does not require another
            monthly cycle. Historical records keep their recorded fee and
            authority rules.
          </p>
        </details>
      </section>
      <section
        className="custody-proof faq"
        id="faq"
        aria-labelledby="faq-title"
      >
        <h2 id="faq-title">Questions</h2>
        <details>
          <summary>Which repositories count?</summary>
          <p>
            Repositories listed by an active project on Slop. Each project page
            names them and links its skill. Paused projects are listed but not
            collected yet, and pull requests anywhere else are not in any pool.
          </p>
        </details>
        <details>
          <summary>Do I need to claim an issue first?</summary>
          <p>
            No. There is no assignment, claiming, or reservation. Pick unblocked
            work, open a pull request, and the maintainers decide what merges.
            Only merged work scores.
          </p>
        </details>
        <details>
          <summary>Do reviews score?</summary>
          <p>
            Only when it changes what merges. Since October 2026, a review
            scores 1/3 of a point when:
          </p>
          <ul>
            <li>
              It is submitted as Request changes. Approve and Comment reviews do
              not score.
            </li>
            <li>It is on someone else&apos;s pull request.</li>
            <li>
              It has at least 20 characters of written reasoning or an inline
              comment.
            </li>
            <li>
              The author pushes new code after it, and the pull request then
              merges.
            </li>
          </ul>
          <p>
            Each pull request gives one review award, to the latest request for
            changes that the merged code answered. Reviews by or of bot accounts
            do not score. A maintainer can award a higher review tier for an
            unusually valuable review.
          </p>
        </details>
        <details>
          <summary>Does work outside code score?</summary>
          <p>
            On projects that opt in. The{" "}
            <Link href="/projects/slopdotcash">Slop project</Link> does: a
            tutorial, explainer, video, or support answer about Slop can receive
            a reviewed award of 1 to 8 points.
          </p>
          <p>
            A maintainer opens each award as its own public pull request, with
            an archived copy of the work and the concrete result it produced.
            Only your newest three awards on a project count. Likes, views, and
            follower counts are never a reason for an award. To put your work in
            front of a maintainer, post the link and tag @SlopCash.
          </p>
        </details>
        <details>
          <summary>When will my work show up?</summary>
          <p>
            Open pull requests do not score. Once a pull request merges, it and
            its qualifying reviews appear at the next data refresh, which runs
            every 6 hours. Each one is dated when it happened, so points can
            appear spread through the day. There is no waiting period and no
            minimum account age.
          </p>
        </details>
        <details>
          <summary>
            What is my merge worth before a maintainer scores it?
          </summary>
          <p>
            Since October 2026, every merge starts as a provisional small unit,
            1 point; earlier merges started at 1/3. A review agent may propose
            another tier from the table above, and the score changes only when a
            maintainer ratifies that tier on the exact merged commit. Related or
            split pull requests share one work unit.
          </p>
        </details>
        <details>
          <summary>Does the model I use matter?</summary>
          <p>
            Not to your score. Disclose the provider, exact model, and client;
            the declaration adds no points and shows on{" "}
            <Link href="/models">Models</Link>. A valid signed receipt with a
            finalized private trace adds a fixed 15% to that outcome.
          </p>
        </details>
        <details>
          <summary>How do I get paid?</summary>
          <p>
            Connect and confirm a wallet in{" "}
            <Link href="/account#wallets">Account wallets</Link> for your
            award's network: Base, Solana, Robinhood Chain or Ethereum. Wallet
            confirmation requires your signature. An approved award also needs
            reserved funding and a verified wallet binding before payment.
            Missing wallets do not erase awards.
          </p>
        </details>
        <details>
          <summary>When are payments sent?</summary>
          <p>
            The previous month becomes a proposal for public review. After owner
            approval and funding, eligible awards can be executed from the
            project vault. Submitted means verification is pending; paid means
            finalized evidence reconciles the award and fee.
          </p>
        </details>
        <details>
          <summary>What does projected mean? Is the pool funded?</summary>
          <p>
            Projected is a live estimate from accepted score at the
            project&apos;s cap. It is not a balance or a guarantee. A cap is a
            target, and a pool can allocate only funds committed on-chain. Funds
            committed after a month freezes apply to later months, not to that
            one.
          </p>
        </details>
        <details>
          <summary>What is the 14-day review?</summary>
          <p>
            It reviews the monthly allocation, not your code. After the freeze
            the proposal is public for 14 days, and the maintainer may approve,
            hold, exclude, reduce, or increase rows, each with a public reason.
            It is separate from pull request reviews on GitHub.
          </p>
        </details>
      </section>
      <details className="mechanism-sources how-details">
        <summary>Technical references</summary>
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
            <Link href="/sponsors">Sponsors</Link>
          </li>
          <li>
            <Link href="/projects/new">Add your project</Link>
          </li>
        </ul>
      </details>
    </main>
  );
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
    `${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/${path}`;
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
  const protocolRoot = `${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/protocol`;
  const hasReviewBudget = PROJECTS.some(
    (project) => project.reward.reviewBudget,
  );
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Fund a project.</h1>
        <p>
          Choose a project or add your repository. Maintainers accept the work;
          authorized signers approve payments outside Slop. Funding does not
          grant repository control or guarantee a payout.
        </p>
      </section>
      <section className="custody-proof sponsor-pools">
        <h2>Projects</h2>
        <p>
          Targets are not balances. Committed amounts need verified funding;
          payment availability is separate.
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
                {hasReviewBudget ? <th scope="col">Review line</th> : null}
                <th scope="col">Escrow vault</th>
              </tr>
            </thead>
            <tbody>
              {PROJECTS.map((project) => {
                return (
                  <tr key={project.id}>
                    <th scope="row">
                      <Link href={`/projects/${project.slug}/funding`}>
                        {project.name}
                      </Link>
                    </th>
                    <td>{sponsorPoolLabel(project.reward)}</td>
                    <td>{project.reward.paymentMode}</td>
                    {hasReviewBudget ? (
                      <td>
                        {project.reward.reviewBudget
                          ? reviewBudgetLabel(project.reward.reviewBudget)
                          : "none"}
                      </td>
                    ) : null}
                    <td>
                      {project.escrow?.deployments.length
                        ? "reviewed deployment"
                        : "not deployed"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </section>
      <section className="worked-example sponsor-fee">
        <div>
          <h2>Awards, fee and total.</h2>
          <p>
            Escrow payouts deduct 2% from the gross award: 100 USDC becomes 98
            USDC for the contributor and 2 USDC in fees. Each cycle keeps its
            recorded policy. Paid requires finalized evidence for both the award
            and the fee.
          </p>
          <p>
            External prize shares use the terms published for that project. The
            prize sponsor controls eligibility and payment.
          </p>
        </div>
        <dl
          className="equation-card"
          aria-label="Example: $5,000 in gross escrow awards"
        >
          <div>
            <dt>Example gross awards</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Slop fee, deducted</dt>
            <dd>$100</dd>
          </div>
          <div>
            <dt>Contributors receive</dt>
            <dd>$4,900</dd>
          </div>
        </dl>
      </section>
      <section className="worked-example sponsor-start">
        <div>
          <h2>Add your own project.</h2>
          <p>
            Sign in with GitHub and add a project. It goes live when you have
            installed Slopbot and the security scan passes. Escrow deployments
            change only through a reviewed admin revision.
          </p>
        </div>
        <ul>
          <li>
            <Link href="/projects/new">Add a project</Link>
          </li>
          <li>
            <ExternalLinkAnchor href="/api/v1/project-revisions">
              Reviewed project revisions
            </ExternalLinkAnchor>
          </li>
          <li>
            <a href={CONTACT_MAILTO}>Email {CONTACT_EMAIL}</a>
          </li>
          <li>
            <ExternalLinkAnchor href={SOCIAL_TELEGRAM}>
              Ask on Telegram
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor href={SOURCE_REPOSITORY}>
              View the repository on GitHub
            </ExternalLinkAnchor>
          </li>
        </ul>
      </section>
      <details className="sponsor-details">
        <summary>Funding rules and payment stages</summary>
        <ol className="mechanism-flow" aria-label="What funding a pool buys">
          <li>
            <strong>01 · Publish the cap</strong>
            <p>
              A reviewed admin revision sets the monthly cap and the reward
              start. Until the project escrow holds funds, the pool shows as
              unfunded with a target, never as a balance. Contributors then use
              any agent to contribute. Accepted merges, eligible reviews, and
              separately reviewed awards follow the published scoring policy.
            </p>
          </li>
          <li>
            <strong>02 · The month freezes</strong>
            <p>
              The monthly workflow prepares a proposal under the cap.
              Publication depends on complete source data and successful
              validation. Fourteen days of public review follow. Every row names
              its source events, its integer weights, and the scoring rule
              version, so anyone can recompute it.
            </p>
          </li>
          <li>
            <strong>03 · You decide and sign</strong>
            <p>
              Maintainers review proposed awards within the cap and record
              changes with a public reason. The project owner commits approved
              awards to the project escrow, which pays them from reserved funds.
              Slop marks an award paid only when finalized on-chain evidence
              reconciles the award and the fee.
            </p>
          </li>
        </ol>
        <section className="worked-example sponsor-controls">
          <div>
            <h2>What you decide.</h2>
            <ul>
              <li>The monthly cap, with exact-cycle overrides.</li>
              <li>
                Maintainers may adjust proposed awards within the cap, with a
                public reason. Amount changes restart the 14-day review.
              </li>
              <li>
                Whether to add a named review budget as a second cash line.
              </li>
              <li>
                The project owner authorizes each award and each withdrawal of
                unused funds.
              </li>
            </ul>
          </div>
          <div>
            <h2>What funding does not buy.</h2>
            <ul>
              <li>
                Turn a donation into control of the repository. Maintainers
                manage work and acceptance on GitHub; sponsorship alone grants
                no maintainer or payout approval authority.
              </li>
              <li>
                Edit history. Corrections append; past cycle records are never
                rewritten.
              </li>
              <li>
                Route money through Slop. Funds stay in the project&apos;s own
                escrow contract; Slop holds no balance and cannot move them.
              </li>
              <li>
                Pay a related party without a separate approval on the public
                record.
              </li>
            </ul>
          </div>
        </section>
        <section className="custody-proof money-states">
          <h2>Awards and payments</h2>
          <PaymentLifecycle />
          <p>
            A target is not a balance. Deposits fund the vault; approved awards
            require their own reservation. A wallet added later can unlock an
            eligible reserved award without waiting for another cycle.
          </p>
        </section>
        <section className="custody-proof">
          <h2>Fund the project escrow.</h2>
          <ul>
            <li>
              Each project has one escrow vault on its settlement network. The
              contract enforces reserved awards, fees and exact-once payment.
            </li>
            <li>
              Slop holds no balance and cannot move funds. Its identity attester
              key only co-signs a binding that the contributor&apos;s own wallet
              also signs.
            </li>
            <li>
              The owner can withdraw free funds under the disclosed fee.
              Reserved awards cannot be withdrawn. Nothing is guaranteed.
            </li>
            <li>
              GitHub identity never proves wallet control. An escrow deployment
              appears on this site only through a reviewed admin revision.
            </li>
          </ul>
        </section>
        <section className="custody-proof sponsor-note">
          <h2>Optional: pay for review as its own line.</h2>
          <p>
            Accepted review already scores from the shared pool. A named review
            budget is a second monthly cash line that pays accepted review work
            on top of that unchanged treatment, with its own cap, its own
            commitment, and separate public arithmetic. It becomes operative
            only after its own funding is committed, and it cannot be added in
            the same change that lowers the contributor cap.
          </p>
          <p>
            <ExternalLinkAnchor href={`${protocolRoot}/review-budget-v1.md`}>
              Additive review budget v1
            </ExternalLinkAnchor>
          </p>
        </section>
      </details>
      <details className="sponsor-details">
        <summary>
          Audience report ·{" "}
          {whoBuildsDateLabel(WHO_BUILDS_SNAPSHOT.generatedAt)}
        </summary>
        <p>
          This report shows sponsors the public GitHub work of the people on the
          leaderboard. It does not change points or payments.
        </p>
        <WhoBuildsOnSlop retry={retry} state={state} />
      </details>
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
              href={`${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/funding/README.md`}
            >
              Escrow funding
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
  const [query, setQuery] = useState(
    () => new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const search = query.trim().toLowerCase();
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
  const matching = receipts.filter((entry) =>
    [
      entry.actor?.login,
      entry.sourceUrl,
      entry.run?.runId,
      entry.run?.repositoryId,
      entry.identifier,
      modelIdentityKey(entry.provider, entry.model).key,
      entry.client,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search),
  );
  return (
    <main className="shell evidence-page receipt-page">
      <section className="evidence-page-hero">
        <h1>Run receipts</h1>
        <details>
          <summary>About receipts</summary>
          <p>
            Device signatures attest byte continuity. Model and usage
            declarations are self-reported; private traces stay private.
          </p>
        </details>
        <DataNotice retry={retry} state={state} />
      </section>
      {state.status === "ready" && receipts.length > 0 ? (
        <label className="receipt-search">
          Find a receipt
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Contributor, model, client or run ID"
            disabled={state.status !== "ready"}
          />
        </label>
      ) : null}
      {state.status === "ready" && receipts.length > 0 ? (
        <p className="receipt-count" role="status">
          {matching.length} of {receipts.length} receipts
        </p>
      ) : null}
      {state.status === "ready" && matching.length === 0 ? (
        <EmptyState
          text={
            receipts.length === 0
              ? "No receipts published yet."
              : "No receipts match this search."
          }
        />
      ) : null}
      {state.status === "ready" && receipts.length === 0 ? (
        <Link href="/#projects">Browse projects</Link>
      ) : null}
      <div className="receipt-list">
        {matching.map((entry) => {
          const run = entry.run;
          if (!run) return null;
          const workLabel = new URL(entry.sourceUrl).pathname
            .slice(1)
            .replace(/\/(?:pull|issues)\//u, " #");
          return (
            <article className="receipt-record" key={run.runId}>
              <div className="receipt-links">
                <strong>
                  {entry.actor ? (
                    <Link
                      href={`/contributors/${encodeURIComponent(entry.actor.login)}`}
                    >
                      {entry.actor.login}
                    </Link>
                  ) : (
                    "Unknown contributor"
                  )}
                </strong>
                <ExternalLinkAnchor href={entry.sourceUrl}>
                  {workLabel}
                </ExternalLinkAnchor>
              </div>
              <details>
                <summary>
                  <span>
                    {run.provider}/{run.model}
                  </span>
                  <time dateTime={run.completedAt}>
                    {formatDate(run.completedAt)}
                  </time>
                  <ChevronRight aria-hidden="true" />
                </summary>
                <div className="receipt-details">
                  <dl>
                    <div>
                      <dt>Run ID</dt>
                      <dd>
                        <code>{run.runId}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Project</dt>
                      <dd>{run.projectId}</dd>
                    </div>
                    <div>
                      <dt>Client</dt>
                      <dd>{run.client}</dd>
                    </div>
                    <div>
                      <dt>Tokens</dt>
                      <dd>
                        {run.usage.confidence === "unavailable"
                          ? "Unavailable"
                          : new Intl.NumberFormat("en-US").format(
                              run.usage.totalTokens,
                            )}
                      </dd>
                    </div>
                    <div>
                      <dt>Usage evidence</dt>
                      <dd>{run.usage.confidence}</dd>
                    </div>
                    <div>
                      <dt>Skill revision</dt>
                      <dd>
                        <code>{run.skillRevision}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Skill digest</dt>
                      <dd>
                        <code>{run.skillSha256}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Device key</dt>
                      <dd>
                        <code>{run.deviceKeyId}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Private trace digest</dt>
                      <dd>
                        {run.traceUpload ? (
                          <code>{run.traceUpload.sha256}</code>
                        ) : (
                          "Not available"
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </details>
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
        <h1>Models</h1>
        <p>
          Accepted work, grouped by self-reported model. Declarations and device
          signatures do not verify the provider or change the score.
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
  const largestMergedCount = Math.max(
    1,
    ...modelRows.map((row) => row.mergedPullRequests),
  );
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
        <details>
          <summary>Declaration coverage</summary>
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
          {totals.declarationsWithoutExactModel > 0 ? (
            <span>
              <strong>
                {count.format(totals.declarationsWithoutExactModel)}
              </strong>{" "}
              more state that the exact model was unavailable and count toward
              no model
            </span>
          ) : null}
        </details>
      </div>

      <section className="model-outcomes-section">
        <h2>Accepted outcomes by model</h2>
        <p>
          Counts use declarations by the person who authored the work. Bars
          compare merged PR counts. Shares include all merged PRs and can
          overlap for multi-model work.
        </p>
        <ol
          className="model-outcome-list"
          aria-label="Accepted outcomes by model"
        >
          {modelRows.map((row) => (
            <li key={row.key}>
              <h3 className="model-identity">
                <span>{row.provider}/</span>
                {row.model}
              </h3>
              <div className="model-outcome-metrics">
                <span>
                  <strong>{count.format(row.mergedPullRequests)}</strong> merged
                  PRs
                </span>
                <span>
                  <strong>
                    {totals.mergedPullRequests === 0
                      ? "n/a"
                      : row.mergedPullRequests > 0 &&
                          (100 * row.mergedPullRequests) /
                            totals.mergedPullRequests <
                            0.1
                        ? "<0.1%"
                        : `${((100 * row.mergedPullRequests) / totals.mergedPullRequests).toFixed(1)}%`}
                  </strong>{" "}
                  of all merged PRs
                </span>
                <span>
                  <strong>{count.format(row.acceptedReviews)}</strong> accepted
                  reviews
                </span>
              </div>
              <div className="model-outcome-bar" aria-hidden="true">
                <span
                  style={{
                    width: `${(100 * row.mergedPullRequests) / largestMergedCount}%`,
                  }}
                />
              </div>
              <details className="model-outcome-details">
                <summary>Evidence and diagnostics</summary>
                <dl>
                  <div>
                    <dt>Signed PRs</dt>
                    <dd>
                      {row.signedPullRequests > 0 ? (
                        <Link
                          href={`/receipts?q=${encodeURIComponent(row.key)}`}
                        >
                          {count.format(row.signedPullRequests)}
                        </Link>
                      ) : (
                        "none"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>PR points</dt>
                    <dd>{points(row.pullRequestPoints)}</dd>
                  </div>
                  <div>
                    <dt>Declaring contributors</dt>
                    <dd>{count.format(row.contributors)}</dd>
                  </div>
                  <div>
                    <dt>Outcomes from busiest contributor</dt>
                    <dd
                      className={
                        (row.topContributorShare ?? 0) > 0.5
                          ? "model-share-high"
                          : undefined
                      }
                    >
                      {row.topContributorShare === null
                        ? "n/a"
                        : `${count.format(row.topContributorOutcomes)} of ${count.format(row.mergedPullRequests + row.acceptedReviews)} outcomes`}
                    </dd>
                  </div>
                  <div>
                    <dt>Exact declarations</dt>
                    <dd>
                      <ul>
                        {row.declaredAs.map((declaration) => (
                          <li key={declaration.identifier}>
                            <code>{declaration.identifier}</code> (
                            {count.format(declaration.count)})
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ol>
        <p className="model-outcomes-note">
          {count.format(totals.distinctDeclaredIdentifiers)} distinct declared
          strings fold to {count.format(totals.distinctModels)} models by case
          and a short provider alias list. Some rows are still one model under
          two names. Bars compare merged PR counts. The list shows models with
          at least one accepted outcome, up to 30.
        </p>
      </section>

      <details className="model-outcomes-section model-clients">
        <summary>Clients from signed receipts</summary>
        <p>
          Client counts cover signed runs only. Output tokens use receipts with
          exact usage.
        </p>
        {summary.clients.length === 0 ? (
          <EmptyState text="No signed receipts in this snapshot." />
        ) : (
          <ul className="model-outcome-list" aria-label="Client outcomes">
            {summary.clients.map((row) => (
              <li key={row.client}>
                <h3 className="model-identity">{row.client}</h3>
                <div className="model-outcome-metrics">
                  <span>
                    <strong>{count.format(row.signedRuns)}</strong> signed runs
                  </span>
                  <span>
                    <strong>{count.format(row.mergedPullRequests)}</strong>{" "}
                    merged PRs
                  </span>
                  <span>
                    <strong>{count.format(row.contributors)}</strong>{" "}
                    contributors
                  </span>
                </div>
                <details className="model-outcome-details">
                  <summary>Models and usage</summary>
                  <dl>
                    <div>
                      <dt>Declared models</dt>
                      <dd>
                        <ul>
                          {row.models.map((model) => (
                            <li key={model.key}>
                              <code>{model.key}</code> (
                              {count.format(model.count)})
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                    <div>
                      <dt>Median output tokens</dt>
                      <dd>
                        {row.medianOutputTokens === null
                          ? "not reported"
                          : `${count.format(row.medianOutputTokens)} (${count.format(row.runsWithExactUsage)} runs)`}
                      </dd>
                    </div>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
      </details>

      <details className="model-outcomes-section">
        <summary>Methodology and limitations</summary>
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
            so every figure moves. Nothing here describes money. Slop Score
            measures accepted work; awards require separate funding and
            approval.
          </li>
        </ul>
      </details>
    </>
  );
}

const REGISTRY_INDEPENDENT_ROUTES: Route["kind"][] = [
  "login",
  "account",
  "admin",
  "inbox",
  "earnings",
  "security-cases",
  "vetting-evidence",
  "new-project",
  "how-it-works",
];

export function App() {
  const route = useRoute();
  return (
    <PointsProvider
      enabled={
        !globalThis.__SLOP_PROJECT_REGISTRY_ERROR__ &&
        ["home", "project", "profile", "points"].includes(route.kind)
      }
    >
      <AppContent route={route} />
    </PointsProvider>
  );
}

function AppContent({ route }: { route: Route }) {
  useInitialHashScroll();
  useDocumentHead(route);
  const snapshotFree: Route["kind"][] = [
    "admin",
    "home",
    "points",
    "account",
    "login",
    "earnings",
    "inbox",
    "how-it-works",
    "new-project",
    "manage-project",
    "owner-awards",
    "security-cases",
    "vetting-evidence",
    "security-program",
    "unknown",
    "cycle-archive",
  ];
  const registryError = globalThis.__SLOP_PROJECT_REGISTRY_ERROR__;
  const blocked =
    Boolean(registryError) && !REGISTRY_INDEPENDENT_ROUTES.includes(route.kind);
  const needsSnapshot = !blocked && !snapshotFree.includes(route.kind);
  const [state, retry] = useSnapshot(needsSnapshot);
  const [archive, retryArchive] = useCycleIndex(route.kind === "cycle-archive");
  let content: ReactNode;
  if (blocked)
    content = (
      <main className="shell route-main">
        <h1>Projects are unavailable</h1>
        <div role="alert">
          <p>{registryError}</p>
          <button
            className="button primary-button"
            type="button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
        <p>
          <Link href="/login">Sign in</Link> ·{" "}
          <Link href="/account">Account</Link>
        </p>
      </main>
    );
  else if (route.kind === "home") content = <HomePage />;
  else if (route.kind === "points") content = <PointsPage />;
  else if (route.kind === "account") content = <AccountPage />;
  else if (route.kind === "login") content = <LoginPage />;
  else if (route.kind === "admin") content = <AdminPage />;
  else if (route.kind === "earnings") content = <EarningsPage />;
  else if (route.kind === "inbox") content = <InboxPage />;
  else if (route.kind === "how-it-works") content = <HowItWorksPage />;
  else if (route.kind === "sponsors")
    content = <SponsorsPage retry={retry} state={state} />;
  else if (route.kind === "receipts")
    content = <ReceiptsPage retry={retry} state={state} />;
  else if (route.kind === "models")
    content = <ModelsPage retry={retry} state={state} />;
  else if (route.kind === "cycle-archive")
    content = <CycleArchivePage retry={retryArchive} state={archive} />;
  else if (route.kind === "new-project") content = <ProjectProposalPage />;
  else if (route.kind === "vetting-evidence") content = <VettingEvidencePage />;
  else if (route.kind === "security-cases") content = <SecurityCasesPage />;
  else if (route.kind === "security-program") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <SecurityProgramPage project={project} />
    ) : (
      <NotFound title="Project not found" />
    );
  } else if (route.kind === "owner-awards") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <OwnerAwardsPage key={project.id} project={project} />
    ) : (
      <NotFound title="Project not found" />
    );
  } else if (route.kind === "manage-project") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <ProjectUpdatePage key={project.id} project={project} />
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
  } else if (route.kind === "funding-project") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <ProjectFundingPage project={project} />
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
      <Header />
      {/* Routes render their own main; the skip link lands on this container. */}
      <div className="skip-target" id="main" tabIndex={-1}>
        <Suspense
          fallback={
            <main className="shell route-main" role="status">
              Loading page…
            </main>
          }
        >
          {content}
        </Suspense>
      </div>
      <Footer />
    </>
  );
}
