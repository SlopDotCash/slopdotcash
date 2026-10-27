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
import { PENALTY_TABLE } from "../workers/slopbot/penalties";
import { CycleArchivePage, CyclePage } from "./CyclePages";
import { EarningsPage } from "./Earnings";
import {
  EscrowFunding,
  reservedGross,
  useVaultTotals,
  vaultSnapshotStale,
} from "./EscrowFunding";
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
import { networkLabel } from "./lib/network-names";
import { formatAssetAmount } from "./lib/payments/contracts";
import {
  findProject,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";
import { REWARD_ASSET_NETWORKS } from "./lib/reward-asset.mjs";
import {
  MAX_CREDITED_REVIEWERS,
  VALUE_SCORING_POLICY_EFFECTIVE_AT,
} from "./lib/scoring-policy";
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
} from "./Points";
import {
  cycleLifecycleLabel,
  DataNotice,
  EmptyState,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDate,
  formatDateTime,
  formatMicroUsdc,
  formatPointsFromThirds,
  monthlyPoolLabel,
  monthlyPoolPointsOnly,
  monthlyPoolUnfunded,
  NotFound,
  Pager,
  PaymentLifecycle,
  reviewBudgetLabel,
} from "./Presentation";
import { ProfilePage } from "./ProfilePage";
import { ProjectRiskFlag } from "./ProjectRiskFlag";

/**
 * Renders the GitHub-native Slop network across discovery, project,
 * contributor, cycle, and project-proposal routes. Every fetched snapshot is
 * validated before money, score, work, or usage is presented as healthy data.
 */

import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";

const OwnerAwardsPage = lazy(() => import("./OwnerAwards"));
const ProjectProposalPage = lazy(() => import("./ProjectProposalPage"));
const AdminPage = lazy(() => import("./Admin"));
const InboxPage = lazy(() => import("./Inbox"));
const VettingEvidencePage = lazy(() => import("./VettingEvidence"));
const OperatorTracesPage = lazy(() => import("./OperatorTraces"));
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
// Original campaign rotation restored by owner request (24 October 2026).
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

function publicFooterDomain(hostname: string): "slop.cash" | "slop.tech" {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized === "slop.tech" || normalized === "www.slop.tech"
    ? "slop.tech"
    : "slop.cash";
}

type ProjectRouteKind =
  | "project"
  | "funding-project"
  | "manage-project"
  | "security-program"
  | "owner-awards";
type PageRouteKind =
  | "home"
  | "how-it-works"
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
  | "admin"
  | "new-project"
  | "vetting-evidence"
  | "operator-traces"
  | "security-cases";
type Route =
  | { kind: PageRouteKind }
  | { kind: ProjectRouteKind; projectId: string }
  | { kind: "cycle"; projectId: string; cycleId: string }
  | { kind: "profile"; login: string };

/**
 * Each page's data needs. `snapshot` loads the public snapshot. `registry`
 * says whether the page works without the project registry ("independent"),
 * needs the current registry because it acts on a manifest ("current", PRD
 * section 9), or may show the last good registry ("cached").
 */
const ROUTES: Record<
  Route["kind"],
  {
    snapshot: boolean;
    registry: "independent" | "current" | "cached";
    privateTitle?: string;
  }
> = {
  home: { snapshot: false, registry: "cached" },
  "how-it-works": { snapshot: false, registry: "independent" },
  receipts: { snapshot: true, registry: "cached" },
  models: { snapshot: true, registry: "cached" },
  sponsors: { snapshot: true, registry: "cached" },
  "cycle-archive": { snapshot: false, registry: "cached" },
  unknown: { snapshot: false, registry: "cached" },
  account: {
    snapshot: false,
    registry: "independent",
    privateTitle: "Account",
  },
  points: { snapshot: false, registry: "cached" },
  login: { snapshot: false, registry: "independent", privateTitle: "Log in" },
  earnings: {
    snapshot: false,
    registry: "independent",
    privateTitle: "Your payouts",
  },
  inbox: { snapshot: false, registry: "independent", privateTitle: "Inbox" },
  admin: { snapshot: false, registry: "independent", privateTitle: "Admin" },
  "new-project": { snapshot: false, registry: "independent" },
  "vetting-evidence": {
    snapshot: false,
    registry: "independent",
    privateTitle: "Private vetting evidence",
  },
  "operator-traces": {
    snapshot: false,
    registry: "independent",
    privateTitle: "Private traces",
  },
  "security-cases": {
    snapshot: false,
    registry: "independent",
    privateTitle: "Security cases",
  },
  project: { snapshot: true, registry: "cached" },
  "funding-project": { snapshot: true, registry: "current" },
  "manage-project": { snapshot: false, registry: "current" },
  "security-program": { snapshot: false, registry: "current" },
  "owner-awards": {
    snapshot: false,
    registry: "current",
    privateTitle: "Monthly awards",
  },
  cycle: { snapshot: true, registry: "cached" },
  profile: { snapshot: true, registry: "cached" },
};

/** Pages whose whole path is one fixed segment. */
const PAGE_ROUTES = new Map<string, PageRouteKind>([
  ["earnings", "earnings"],
  ["login", "login"],
  ["inbox", "inbox"],
  ["vetting-evidence", "vetting-evidence"],
  ["security", "security-cases"],
  ["admin", "admin"],
  ["account", "account"],
  ["how-it-works", "how-it-works"],
  ["receipts", "receipts"],
  ["models", "models"],
  ["sponsors", "sponsors"],
  ["cycles", "cycle-archive"],
]);

/** Project pages at /projects/<id>/<section>. */
const PROJECT_SECTIONS = new Map<string, ProjectRouteKind>([
  ["awards", "owner-awards"],
  ["manage", "manage-project"],
  ["security", "security-program"],
  ["funding", "funding-project"],
]);

function internalRoute(pathname: string): Route {
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { kind: "unknown" };
  }
  const [first, second, third] = segments;
  if (segments.length === 0) return { kind: "home" };
  if (segments.length === 1) {
    if (first === "points")
      return {
        kind: new URLSearchParams(window.location.search).has("x")
          ? "account"
          : "points",
      };
    const kind = PAGE_ROUTES.get(first);
    if (kind) return { kind };
  }
  if (segments.length === 2 && first === "operator" && second === "traces")
    return { kind: "operator-traces" };
  // Admin emails sent before self-service setup link /admin/applications/<id>.
  if (segments.length === 3 && first === "admin" && second === "applications")
    return { kind: "admin" };
  if (first === "projects" && segments.length === 2)
    return second === "new"
      ? { kind: "new-project" }
      : { kind: "project", projectId: second };
  const section = PROJECT_SECTIONS.get(third);
  if (first === "projects" && segments.length === 3 && section)
    return { kind: section, projectId: second };
  if (first === "contributors" && segments.length === 2)
    return { kind: "profile", login: second };
  if (first === "cycles" && segments.length === 3)
    return { kind: "cycle", projectId: second, cycleId: third };
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

/** The title and canonical path of a route; a missing page has no canonical. */
function routeHead(route: Route): { title: string; path: string | null } {
  const notFound = { title: pageTitle("Page not found"), path: null };
  const privateTitle = ROUTES[route.kind].privateTitle;
  if (privateTitle) {
    return {
      title: pageTitle(privateTitle),
      path:
        route.kind === "owner-awards"
          ? null
          : route.kind === "security-cases"
            ? "/security"
            : route.kind === "operator-traces"
              ? "/operator/traces"
              : `/${route.kind}`,
    };
  }
  if (route.kind === "profile") {
    return {
      title: pageTitle(route.login),
      path: `/contributors/${encodeURIComponent(route.login)}`,
    };
  }
  if ("projectId" in route) {
    const project = findProject(route.projectId);
    if (!project) return notFound;
    if (route.kind === "cycle") {
      return {
        title: pageTitle(`${project.name} ${route.cycleId} cycle`),
        path: `/cycles/${project.id}/${encodeURIComponent(route.cycleId)}`,
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
        <Link
          ariaLabel="How it works"
          className="header-nav-link"
          href="/how-it-works"
        >
          <span className="header-nav-full">How It Works</span>
          <span aria-hidden="true" className="header-nav-short">
            ?
          </span>
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
        <nav className="footer-links" aria-label="Community">
          <ExternalLinkAnchor href={SOURCE_REPOSITORY}>
            GitHub
          </ExternalLinkAnchor>
          <ExternalLinkAnchor href={SOCIAL_X}>X</ExternalLinkAnchor>
          <ExternalLinkAnchor href={SOCIAL_LINKEDIN}>
            LinkedIn
          </ExternalLinkAnchor>
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
        </nav>
      </div>
    </footer>
  );
}

function HeroHeading() {
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
        <span className="hero-action">
          {HERO_ACTIONS.map((candidate) => (
            <span className="hero-switch-sizer" key={candidate}>
              {candidate}
              <span className="hero-typewriter-caret" />
            </span>
          ))}
          <span className="hero-typewriter">
            {action.slice(0, characters)}
            <span className="hero-typewriter-caret" />
          </span>
        </span>
      </span>
    </h1>
  );
}

/** A token pool names its asset; only a stablecoin pool reads as dollars. */
function monthlyPoolCapLabel(project: ProjectDefinition): string {
  const reward = project.reward;
  const minor = BigInt(reward.monthlyCapMinor);
  if (project.rewardAsset?.kind === "token" || minor % 1_000_000n !== 0n)
    return reward.monthlyCapDisplay;
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
      ? monthlyPoolCapLabel(project)
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
        ) : project.reward.kind === "monthly-pool" ? null : (
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
    ? "Points only"
    : project.reward.kind === "monthly-pool"
      ? `${monthlyPoolCapLabel(project)}/mo target`
      : `${project.reward.externalOpportunity?.advertisedAmountDisplay ?? "External prize"} + points`;
  return (
    <li>
      <Link className="project-row" href={`/projects/${project.slug}`}>
        <ProjectOwnerAvatar project={project} />
        <span className="project-row-name">
          <strong>{project.name}</strong>
          <small>{project.description}</small>
        </span>
        <span className="project-row-amount">{amount}</span>
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

function GlobalLeaderboard({
  state,
  retry,
}: {
  state: DataState;
  retry: () => void;
}) {
  return (
    <section
      className="section shell home-leaderboard-section"
      id="leaderboard"
    >
      <ContributorStandings
        compact
        retryScore={retry}
        scoreState={state}
        showDataNotice
        title="Top sloperators"
      />
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
  // One shared read feeds the leaderboard; project cards never wait for it.
  const [scores, retryScores] = useSnapshot(true);
  return (
    <main>
      <section className="hero shell">
        <HeroHeading />
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
          <p className="project-tier-note">No projects yet.</p>
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
      <GlobalLeaderboard retry={retryScores} state={scores} />
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

function ProjectParticipation({
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
          about permission before contributing.
        </p>
      </section>
    );
  }
  if (project.status === "paused") {
    return (
      <section className="section" id="start">
        <h2>Project paused</h2>
        <p>Do not install this project's skill or start work.</p>
      </section>
    );
  }
  if (projectPromotionEligible(project, cycles, displayCycleId))
    return <InstallPanel project={project} />;
  return (
    <section className="section" id="start">
      <h2>Agent setup</h2>
      <p>
        {cycles === null
          ? "Loading funding history…"
          : displayCycleId === null
            ? "No contribution data yet."
            : "Agent setup is paused after two unfunded cycles. Accepted work still earns Points."}
      </p>
    </section>
  );
}

function InstallPanel({ project }: { project?: ProjectDefinition }) {
  if (project) return <ProjectInstallPanel project={project} />;
  return (
    <div className="home-agent-setup">
      <p className="hero-copy">Paste this into your coding agent.</p>
      <AgentPromptBox openIn prompt={bootstrapAgentPrompt()} />
    </div>
  );
}

/**
 * PRD section 4: project-specific installation checks restrictions and
 * clearance. Discovery lists only cleared, unrestricted projects. Until it
 * confirms this project, the panel offers the generic agent prompt, which
 * selects only cleared projects itself.
 */
function ProjectInstallPanel({ project }: { project: ProjectDefinition }) {
  const projectId = project.id;
  const [eligibility, setEligibility] = useState<
    "loading" | "ready" | "blocked" | "error"
  >("loading");
  useEffect(() => {
    let active = true;
    setEligibility("loading");
    fetchWithDeadline("/.well-known/slop/projects.json", {
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
            body.projects.some((entry) => entry.project_id === projectId)
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
  }, [projectId]);
  const ready = eligibility === "ready";
  return (
    <div className="install-panel" id="start">
      <div className="install-heading">
        <h2>Copy this into your agent.</h2>
      </div>
      {ready ? null : (
        <p>
          {eligibility === "loading"
            ? "Checking project clearance…"
            : eligibility === "blocked"
              ? "This project is not cleared for agents. The prompt below picks only cleared projects."
              : "Project clearance could not be checked. The prompt below picks only cleared projects."}
          {eligibility === "blocked" ? (
            <>
              {" "}
              <Link href={`/projects/${project.slug}/manage`}>
                Project owner: review setup
              </Link>
            </>
          ) : null}
        </p>
      )}
      <AgentPromptBox
        prompt={ready ? projectAgentPrompt(project) : bootstrapAgentPrompt()}
      />
    </div>
  );
}

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
        <Link href={`/projects/${project.slug}/manage`}>Manage project</Link>
        {project.escrow && (
          <Link href={`/projects/${project.slug}/awards`}>Monthly awards</Link>
        )}
      </div>
      {directState.status === "error" && !externalPrize ? (
        <p role="status">
          Direct payments unavailable.{" "}
          <button
            className="button secondary-button button-small"
            type="button"
            onClick={retryDirect}
          >
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

/**
 * The project page's one funding line (PRD section 7: one status summary per
 * project). Deposits, withdrawals and full vault totals live on the funding
 * page only.
 */
function ProjectFunding({ project }: { project: ProjectDefinition }) {
  const totals = useVaultTotals(project);
  if (!project.escrow) return null;
  const href = `/projects/${project.slug}/funding`;
  let summary: ReactNode;
  if (totals.status === "none")
    summary = `No project vault yet · ${fundingStateLabel(project)}`;
  else if (totals.status === "loading")
    summary = <span role="status">Loading vault totals…</span>;
  else if (totals.status === "error")
    summary = <span role="alert">Vault totals unavailable</span>;
  else if (totals.vault.snapshots.length === 0)
    summary = "Vault totals not read yet";
  else
    summary = totals.vault.snapshots.map((snapshot, index) => {
      const amount = (value: string | null) =>
        value === null ? "not reported" : formatAssetAmount(value, snapshot);
      return (
        <span key={`${snapshot.network}:${snapshot.vault}`}>
          {index > 0 ? " · " : null}
          {networkLabel(snapshot.network)}: {amount(snapshot.freeBalance)}{" "}
          available · {amount(reservedGross(snapshot))} reserved
          {vaultSnapshotStale(snapshot, totals.vault.staleAfterMs)
            ? ` (stale, read ${formatDateTime(snapshot.observedAt)})`
            : null}
        </span>
      );
    });
  return (
    <section
      className="section project-funding-summary"
      aria-label="Project funding"
    >
      <p>
        <strong>Funding</strong> {summary}{" "}
        <Link href={href}>Fund this project</Link>
      </p>
    </section>
  );
}

function paymentStateLabel(project: ProjectDefinition): string {
  return project.reward.paymentMode === "enabled" ? "Enabled" : "Disabled";
}

/** "Live" only when a recorded vault can pay: payments must be enabled too. */
function vaultStateLabel(project: ProjectDefinition): string {
  if (project.reward.kind === "external-prize-share") return "Not applicable";
  if (!project.escrow?.deployments.length) return "Not set up";
  return project.reward.paymentMode === "enabled" ? "Live" : "Set up";
}

function fundingStateLabel(project: ProjectDefinition): string {
  if (project.reward.kind === "external-prize-share") return "External prize";
  return project.reward.fundingState === "committed"
    ? "Committed"
    : "Not funded yet";
}

function ProjectFundingPage({
  project: original,
}: {
  project: ProjectDefinition;
}) {
  const [registered, setRegistered] = useState<ProjectDefinition | null>(null);
  const project = registered ?? original;
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
          {!project.escrow ? (
            <>
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
                <dd>{paymentStateLabel(project)}</dd>
              </div>
              <div>
                <dt>Project vault</dt>
                <dd>{vaultStateLabel(project)}</dd>
              </div>
            </>
          ) : null}
        </dl>
        {project.reward.kind === "external-prize-share" ? (
          <p>The organizer pays this prize.</p>
        ) : project.escrow ? (
          <EscrowFunding project={project} onRegistered={setRegistered} />
        ) : (
          <div>
            <EmptyState text="This project has no vault yet." />
            <p>
              Choose a monthly amount in{" "}
              <Link href={`/projects/${project.slug}/manage`}>
                project settings
              </Link>{" "}
              to enable vault setup.
            </p>
          </div>
        )}
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
                    ? `${project.reward.monthlyCapDisplay} monthly target · ${monthlyPoolUnfunded(project.reward) ? "not funded yet" : `${formatMicroUsdc(project.reward.committedMinor)} funded`} · ${project.reward.paymentMode === "enabled" ? "payments enabled" : "payments not active"}`
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
                <Link href={`/projects/${project.slug}/security`}>
                  {project.securityBounty
                    ? "Security bounty"
                    : "Report a security issue"}
                </Link>
              </p>
              {project.rewardAsset ? (
                <p className="project-terms-line">
                  Reward asset: {project.rewardAsset.symbol} on{" "}
                  {REWARD_ASSET_NETWORKS[project.rewardAsset.network].name} ·{" "}
                  <code>{project.rewardAsset.address}</code>
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
                    `${monthlyPoolCapLabel(project)} / mo`
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
                ) : null}
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
                <strong>Not funded this month</strong>
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
            No activity collected yet.
          </p>
        ) : null}
        <ProjectPaymentHistory
          key={project.id}
          project={project}
          state={state}
        />
        {view && state.status === "ready" ? (
          <div id="contributors">
            <ContributorStandings
              projectId={project.id}
              scoreState={state}
              retryScore={retry}
              compact
            />
          </div>
        ) : null}
        <ProjectRiskFlag key={`flag:${project.id}`} projectId={project.id} />
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
      </section>
      <div className="how-paths">
        <section aria-labelledby="contributor-path">
          <h2 id="contributor-path">For contributors</h2>
          <ol className="mechanism-flow">
            <li>
              <strong>1. Choose work</strong>
              <p>
                Find an active <Link href="/#projects">project</Link>, read its
                skill and choose unblocked work.
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
                Maintainers decide what merges. Only merged work earns points.
              </p>
            </li>
            <li>
              <strong>4. Points and payout</strong>
              <p>
                Merged work earns points. Funded projects with payments enabled
                pay monthly by points share.
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
                . Install the free Slopbot; the project goes live when the
                security scan passes.
              </p>
            </li>
            <li>
              <strong>2. Fund the pool</strong>
              <p>
                Only funds in the project vault pay awards. Unused funds roll
                over. <Link href="/sponsors">Funding options</Link>
              </p>
            </li>
            <li>
              <strong>3. Adjust awards</strong>
              <p>
                Change proposed amounts within the cap before the monthly
                cutoff.
              </p>
            </li>
            <li>
              <strong>4. Automatic payment</strong>
              <p>
                When payments are enabled, funded awards pay automatically 72
                hours after the month ends, unless you turn this off.
              </p>
            </li>
          </ol>
        </section>
      </div>
      <section className="worked-example score-contract" id="points">
        <div>
          <h2>Points</h2>
          <p>
            Slopbot sizes each accepted pull request with the tiers in this
            table and awards points. Every accepted merge earns at least 10
            points. Only accepted-work points count toward payouts. Joining and
            connecting X earn no points.
          </p>
          <details>
            <summary>Points rules and evidence</summary>
            <p>
              A useful review can find a correction or validate the change. A
              request for changes is not required. Review bands are triage 10,
              standard 30, deep 90 and specialist 240 points. The first{" "}
              {MAX_CREDITED_REVIEWERS} distinct qualifying reviewers share one
              review pool per pull request: the sum of their highest bands,
              capped at the pull request's own size and never less than 10
              points. Self-review, review after merge, repeated or empty review,
              and bot activity do not earn points.
            </p>
            <p>
              Slopbot debits a closed pull request once, from its published
              penalty table: spam{" "}
              {formatPointsFromThirds(PENALTY_TABLE.spam.debitThirds)}, scam or
              malicious {formatPointsFromThirds(PENALTY_TABLE.scam.debitThirds)}
              , a clear violation of a quoted project rule{" "}
              {formatPointsFromThirds(PENALTY_TABLE.gaming.debitThirds)}. A
              debit lowers only that project and UTC month, never below zero,
              and never changes an approved, scheduled or paid award. An upheld
              appeal or a maintainer reopen removes it.
            </p>
            <p>
              Owners, funded employees and related parties may be excluded from
              payouts. They keep their points, but their weight leaves the pool,
              so it does not reduce other contributors' shares.
            </p>
            <p>
              These rules apply to work accepted from{" "}
              {formatDate(VALUE_SCORING_POLICY_EFFECTIVE_AT)} UTC. Earlier work
              keeps its recorded terms. Signed receipts and private traces are
              optional. Token use, cost, lines and commits never change points
              or payment.
            </p>
          </details>
        </div>
        <section
          className="plain-table-wrap score-tier-wrap"
          aria-label="Contribution point tiers"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
          tabIndex={0}
        >
          <table className="plain-table score-tier-table">
            <caption>Contribution tiers</caption>
            <thead>
              <tr>
                <th scope="col">Tier</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Micro</th>
                <td>10</td>
              </tr>
              <tr>
                <th scope="row">Small</th>
                <td>30</td>
              </tr>
              <tr>
                <th scope="row">Medium</th>
                <td>90</td>
              </tr>
              <tr>
                <th scope="row">Large</th>
                <td>240</td>
              </tr>
              <tr>
                <th scope="row">XL</th>
                <td>450</td>
              </tr>
              <tr>
                <th scope="row">Exceptional</th>
                <td>750</td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
      <section className="worked-example">
        <div>
          <h2>Example allocation</h2>
          <p>
            Your points ÷ project points × funded pool = projected allocation.
          </p>
          <details>
            <summary>Exact calculation</summary>
            <p>
              A Large contribution (240 points) plus a standard review (30)
              makes 270 points. Against 900 project points, the share is 30%.
            </p>
          </details>
        </div>
        <dl className="equation-card" aria-label="Example projected allocation">
          <div>
            <dt>Accepted share</dt>
            <dd>270 ÷ 900 = 30%</dd>
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
            Repositories listed by an active project. Each project page names
            them.
          </p>
        </details>
        <details>
          <summary>Do I need to claim an issue first?</summary>
          <p>No. Pick unblocked work and open a pull request.</p>
        </details>
        <details>
          <summary>Does work outside code earn points?</summary>
          <p>
            On projects that opt in. The{" "}
            <Link href="/projects/slopdotcash">Slop project</Link> does: a
            tutorial, explainer, video, or support answer about Slop can receive
            a reviewed award of 1 to 8 points.
          </p>
          <p>
            Only your newest three awards on a project count. To submit work,
            post the link and tag @SlopCash.
          </p>
        </details>
        <details>
          <summary>When will my work show up?</summary>
          <p>
            Merged pull requests and their qualifying reviews appear at the next
            site update. There is no waiting period or minimum account age.
          </p>
        </details>
        <details>
          <summary>What is my merge worth before Slopbot sizes it?</summary>
          <p>
            At least 10 points. After Slopbot sizes it, points follow the tier
            table above. Related or split pull requests count as one work unit.
          </p>
        </details>
        <details>
          <summary>Does the model I use matter?</summary>
          <p>
            Not to your points. Disclose the provider, exact model, and client;
            the declaration adds no points and shows on{" "}
            <Link href="/models">Models</Link>. From November 2026, monthly and
            external-prize reward shares use accepted-work Points only. Optional
            traces add no payment weight. Older calculations and funded awards
            stay unchanged; unpaid September–October work stays subject to the
            reviewed historical reconciliation.
          </p>
        </details>
        <details>
          <summary>How do I get paid?</summary>
          <p>
            Add a wallet for your award's network (Base, Solana, Robinhood Chain
            or Ethereum) in <Link href="/account#wallets">Account wallets</Link>
            . Wallet confirmation requires your signature. Awards wait for your
            wallet.
          </p>
        </details>
        <details>
          <summary>When are payments sent?</summary>
          <p>
            Monthly. After a UTC month ends, the owner has 72 hours to adjust
            awards. Then, if payments are enabled, the vault pays funded awards
            automatically unless the owner turned that off.
          </p>
        </details>
        <details>
          <summary>What does projected mean? Is the pool funded?</summary>
          <p>
            A live estimate at the project&apos;s cap. It is not a balance or a
            guarantee: a cap is a target, and only funds in the vault can be
            allocated. Funds added after a month freezes count toward later
            months.
          </p>
        </details>
        <details>
          <summary>Who decides the monthly amounts?</summary>
          <p>
            The project owner, until the monthly cutoff. Slop publishes final
            awards and payment evidence, not the changes.
          </p>
        </details>
      </section>
      <details className="mechanism-sources how-details">
        <summary>References</summary>
        <ul>
          <li>
            <ExternalLinkAnchor href={`${protocolRoot}/scoring-v2.md`}>
              Points rules
            </ExternalLinkAnchor>
          </li>
          <li>
            <ExternalLinkAnchor href={`${protocolRoot}/private-trace-v1.md`}>
              Private trace policy
            </ExternalLinkAnchor>
          </li>
          <li>
            <Link href="/receipts">Public receipts</Link>
          </li>
          <li>
            <Link href="/models">Models</Link>
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
        What the {count.format(all.size)} contributors on the leaderboard as of{" "}
        {dateLabel} did elsewhere on GitHub in 2026.
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
          {count.format(models.totals.mergedPullRequests)}).
        </p>
      ) : null}
      <p className="who-builds-sources">
        Public GitHub data since 1 January 2026{massNote}.{" "}
        <ExternalLinkAnchor href={pinnedFile(pin.snapshotPath)}>
          Snapshot JSON, {pin.date}
        </ExternalLinkAnchor>
        {" · "}
        <ExternalLinkAnchor href={pinnedFile(pin.methodPath)}>
          Method and caveats
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
  const hasReviewBudget = PROJECTS.some(
    (project) => project.reward.reviewBudget,
  );
  const hasExternalPrize = PROJECTS.some(
    (project) => project.reward.kind === "external-prize-share",
  );
  return (
    <main className="shell evidence-page">
      <section className="evidence-page-hero">
        <h1>Fund a project.</h1>
        <p>
          Deposit into a project&apos;s vault. When payments are enabled, funded
          awards pay contributors automatically each month.
        </p>
      </section>
      <section className="custody-proof sponsor-pools">
        <h2>Projects</h2>
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
                <th scope="col">Vault</th>
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
                    <td>{paymentStateLabel(project)}</td>
                    {hasReviewBudget ? (
                      <td>
                        {project.reward.reviewBudget
                          ? reviewBudgetLabel(project.reward.reviewBudget)
                          : "none"}
                      </td>
                    ) : null}
                    <td>{vaultStateLabel(project)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </section>
      <section className="worked-example sponsor-fee">
        <div>
          <h2>Fees</h2>
          <p>
            Payouts deduct a 2% fee: a 100 USDC award pays 98 USDC to the
            contributor and 2 USDC in fees.
          </p>
          {hasExternalPrize ? (
            <p>
              External prize shares use the terms published for that project.
              The prize sponsor controls eligibility and payment.
            </p>
          ) : null}
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
        </div>
        <ul>
          <li>
            <Link href="/projects/new">Add a project</Link>
          </li>
        </ul>
      </section>
      <details className="sponsor-details">
        <summary>Funding rules</summary>
        <section className="worked-example sponsor-controls">
          <div>
            <h2>What you decide</h2>
            <ul>
              <li>The monthly cap.</li>
              <li>
                Award changes before the monthly cutoff, and whether automatic
                payment runs.
              </li>
            </ul>
            <p>
              <Link href="/how-it-works">Payment stages</Link>
            </p>
          </div>
        </section>
        <section className="custody-proof">
          <h2>Custody and keys</h2>
          <ul>
            <li>
              Funds are held by the project vault contract. Private bounties use
              a separate vault.
            </li>
            <li>
              The owner can withdraw free funds with the 2% fee. Reserved awards
              cannot be withdrawn.
            </li>
            <li>
              Slop’s fee key can only claim and convert fees. A compromised
              identity attester key can redirect unpaid awards, and Slop’s
              upgrade keys can change the contracts. Read the{" "}
              <ExternalLinkAnchor
                href={`${SOURCE_REPOSITORY}/blob/${browserDeployment.branch}/docs/slop-product-requirements.md#11-source-delivery-and-acceptance`}
              >
                authority and key risks
              </ExternalLinkAnchor>
              .
            </li>
          </ul>
        </section>
      </details>
      <details className="sponsor-details">
        <summary>
          Audience report ·{" "}
          {whoBuildsDateLabel(WHO_BUILDS_SNAPSHOT.generatedAt)}
        </summary>
        <WhoBuildsOnSlop retry={retry} state={state} />
      </details>
      <section className="custody-proof mechanism-sources">
        <h2>Public records</h2>
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
        </ul>
      </section>
    </main>
  );
}

const RECEIPTS_PAGE_SIZE = 25;

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
  const [page, setPage] = useState(0);
  const search = query.trim().toLowerCase();
  const receipts =
    state.status === "ready"
      ? state.snapshot.attributions
          .filter(
            (
              entry,
            ): entry is typeof entry & { run: NonNullable<typeof entry.run> } =>
              entry.run !== null,
          )
          .sort((left, right) =>
            right.run.completedAt.localeCompare(left.run.completedAt),
          )
      : [];
  const matching = receipts.filter((entry) =>
    [
      entry.actor?.login,
      entry.sourceUrl,
      entry.run.runId,
      entry.run.repositoryId,
      entry.identifier,
      modelIdentityKey(entry.provider, entry.model).key,
      entry.client,
    ]
      .join(" ")
      .toLowerCase()
      .includes(search),
  );
  // One page of receipts keeps the page short and its links large enough.
  const pages = Math.max(1, Math.ceil(matching.length / RECEIPTS_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = matching.slice(
    current * RECEIPTS_PAGE_SIZE,
    (current + 1) * RECEIPTS_PAGE_SIZE,
  );
  return (
    <main className="shell evidence-page receipt-page">
      <section className="evidence-page-hero">
        <h1>Run receipts</h1>
        <p>
          Model and usage are self-reported and not verified with the provider.
        </p>
        <DataNotice retry={retry} state={state} />
      </section>
      {state.status === "ready" && receipts.length > 0 ? (
        <label className="receipt-search">
          Find a receipt
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
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
        {shown.map((entry) => {
          const run = entry.run;
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
                      <dt>Skill revision</dt>
                      <dd>
                        <code>{run.skillRevision}</code>
                      </dd>
                    </div>
                  </dl>
                </div>
              </details>
            </article>
          );
        })}
      </div>
      {pages > 1 ? (
        <Pager onPage={setPage} page={current} pages={pages} />
      ) : null}
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
    return <EmptyState text="No model declarations yet." />;
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
        </details>
      </div>

      <section className="model-outcomes-section">
        <h2>Accepted outcomes by model</h2>
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
                <summary>Details</summary>
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
                </dl>
              </details>
            </li>
          ))}
        </ol>
        <p className="model-outcomes-note">
          Shows up to 30 models with at least one accepted outcome.
        </p>
      </section>

      <details className="model-outcomes-section model-clients">
        <summary>Clients from signed receipts</summary>
        {summary.clients.length === 0 ? (
          <EmptyState text="No signed receipts yet." />
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
            and models.
          </li>
          <li>
            Results reflect who uses each model.
            {concentrated.length > 0
              ? ` Of the models with 40 or more merged PRs, ${concentrated
                  .map(
                    (row) =>
                      `${row.key} (${percent(row.topContributorShare ?? 0, 1)})`,
                  )
                  .join(
                    ", ",
                  )} take over half of their outcomes from one contributor.`
              : ""}
          </li>
          <li>
            Declarations and receipts are not verified with the model provider.
          </li>
          <li>Points record contributions; they are not money.</li>
        </ul>
      </details>
    </>
  );
}

/** A project page, or "Project not found" for an unknown project id. */
function withProject(
  route: { projectId: string },
  render: (project: ProjectDefinition) => ReactNode,
): ReactNode {
  const project = findProject(route.projectId);
  return project ? render(project) : <NotFound title="Project not found" />;
}

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
  const { registry, snapshot } = ROUTES[route.kind];
  const staleRegistry = globalThis.__SLOP_PROJECT_REGISTRY_STALE__;
  const registryIndependent = registry === "independent";
  const registryError =
    globalThis.__SLOP_PROJECT_REGISTRY_ERROR__ ??
    (staleRegistry && registry === "current"
      ? "This page needs current project data."
      : undefined);
  const blocked = Boolean(registryError) && !registryIndependent;
  const needsSnapshot = !blocked && snapshot;
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
  else if (route.kind === "operator-traces") content = <OperatorTracesPage />;
  else if (route.kind === "security-cases") content = <SecurityCasesPage />;
  else if (route.kind === "security-program")
    content = withProject(route, (project) => (
      <SecurityProgramPage key={project.id} project={project} />
    ));
  else if (route.kind === "owner-awards")
    content = withProject(route, (project) => (
      <OwnerAwardsPage key={project.id} project={project} />
    ));
  else if (route.kind === "manage-project")
    content = withProject(route, (project) => (
      <ProjectUpdatePage key={project.id} project={project} />
    ));
  else if (route.kind === "project") {
    const project = findProject(route.projectId);
    content = project ? (
      <ProjectPage project={project} retry={retry} state={state} />
    ) : (
      <main className="shell route-main">
        <h1>Project not found</h1>
        <p>This project isn&apos;t listed.</p>
        <ProjectRiskFlag
          key={`flag:${route.projectId}`}
          projectId={route.projectId}
        />
        <p>
          <Link href="/">See open projects</Link>
        </p>
      </main>
    );
  } else if (route.kind === "funding-project")
    content = withProject(route, (project) => (
      <ProjectFundingPage key={project.id} project={project} />
    ));
  else if (route.kind === "profile")
    content = <ProfilePage login={route.login} retry={retry} state={state} />;
  else if (route.kind === "cycle")
    content = withProject(route, (project) => (
      <CyclePage
        cycleId={route.cycleId}
        project={project}
        retry={retry}
        state={state}
      />
    ));
  else content = <NotFound />;
  return (
    <>
      <Header />
      {/* Routes render their own main; the skip link lands on this container. */}
      <div className="skip-target" id="main" tabIndex={-1}>
        {staleRegistry && !blocked && !registryIndependent ? (
          <aside
            aria-label="Project data status"
            className="shell registry-stale"
          >
            <p className="data-notice data-stale" role="status">
              Projects may be outdated · updated{" "}
              {formatDateTime(staleRegistry.syncedAt)}.
              <button onClick={() => window.location.reload()} type="button">
                Try again
              </button>
            </p>
          </aside>
        ) : null}
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
