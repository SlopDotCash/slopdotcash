import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FolderGit2,
  Plus,
  Wallet,
} from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  EscrowFunding,
  reservedGross,
  useVaultTotals,
  vaultSnapshotStale,
} from "./EscrowFunding";
import { Link, useHashScroll } from "./Link";
import { SlopMark, Wordmark } from "./Logo";
import {
  type PromotionCycle,
  projectPromotionEligible,
} from "./lib/allocation-funding";
import { browserDeployment } from "./lib/browser-deployment";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "./lib/contact";
import { copyText } from "./lib/copy-text";
import { communityProjects, homeProjects } from "./lib/home-projects";
import { networkLabel } from "./lib/network-names";
import { formatAssetAmount } from "./lib/payments/contracts";
import type { ProjectView } from "./lib/project-view";
import { findProject, type ProjectDefinition } from "./lib/projects.mjs";
import { REWARD_ASSET_NETWORKS } from "./lib/reward-asset.mjs";
import { pageTitle, SITE_ORIGIN, STATIC_PAGE_TITLES } from "./lib/site-routes";
import { SOURCE_REPOSITORY } from "./lib/source-repository";
import { useCycleIndex } from "./lib/use-cycle-index";
import { useDirectTransfers } from "./lib/use-direct-transfers";
import { type DataState, useSnapshot } from "./lib/use-snapshot";
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
  MetricGrid,
  MetricTile,
  monthlyPoolPointsOnly,
  NotFound,
  ProjectNav,
  paymentStateLabel,
  RoutePageHeader,
  reviewBudgetLabel,
  StatusBadge,
  stale,
  vaultStateLabel,
} from "./Presentation";
import { ProjectRiskFlag } from "./ProjectRiskFlag";

/**
 * Renders the GitHub-native Slop network across discovery, project,
 * contributor, cycle, and project-proposal routes. Every fetched snapshot is
 * validated before money, score, work, or usage is presented as healthy data.
 */

import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";

const CycleArchivePage = lazy(() =>
  import("./CyclePages").then((module) => ({
    default: module.CycleArchivePage,
  })),
);
const CyclePage = lazy(() =>
  import("./CyclePages").then((module) => ({ default: module.CyclePage })),
);
const EarningsPage = lazy(() =>
  import("./Earnings").then((module) => ({ default: module.EarningsPage })),
);
const ProfilePage = lazy(() =>
  import("./ProfilePage").then((module) => ({ default: module.ProfilePage })),
);
const HowItWorksPage = lazy(() =>
  import("./PublicPages").then((module) => ({
    default: module.HowItWorksPage,
  })),
);
const SponsorsPage = lazy(() =>
  import("./PublicPages").then((module) => ({ default: module.SponsorsPage })),
);
const OwnerAwards = lazy(() => import("./OwnerAwards"));
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
  | "security-program";
type PageRouteKind =
  | "home"
  | "how-it-works"
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
  "security-cases": {
    snapshot: false,
    registry: "independent",
    privateTitle: "Security cases",
  },
  project: { snapshot: true, registry: "cached" },
  "funding-project": { snapshot: false, registry: "current" },
  "manage-project": { snapshot: false, registry: "current" },
  "security-program": { snapshot: false, registry: "current" },
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
  ["sponsors", "sponsors"],
  ["cycles", "cycle-archive"],
]);

/** Project pages at /projects/<id>/<section>. */
const PROJECT_SECTIONS = new Map<string, ProjectRouteKind>([
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

function canonicalLocation(): string {
  const awards = /^\/projects\/([^/]+)\/awards\/?$/.exec(
    window.location.pathname,
  );
  if (awards) {
    window.history.replaceState(
      window.history.state,
      "",
      `/projects/${awards[1]}/funding${window.location.search}${window.location.hash || "#monthly-awards"}`,
    );
  }
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
  return window.location.href;
}

function useRoute(): Route {
  const [href, setHref] = useState(canonicalLocation);
  useEffect(() => {
    const update = () => setHref(canonicalLocation());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  return useMemo(() => internalRoute(new URL(href).pathname), [href]);
}

/** The title and canonical path of a route; a missing page has no canonical. */
function routeHead(route: Route): { title: string; path: string | null } {
  const notFound = { title: pageTitle("Page not found"), path: null };
  const privateTitle = ROUTES[route.kind].privateTitle;
  if (privateTitle) {
    return {
      title: pageTitle(privateTitle),
      path: route.kind === "security-cases" ? "/security" : `/${route.kind}`,
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
          How It Works
        </Link>
        <PointsNav />
      </div>
    </header>
  );
}

function Footer({ marketing }: { marketing: boolean }) {
  return (
    <footer
      className={`site-footer${marketing ? "" : " site-footer--compact"}`}
    >
      <div className="shell footer-grid">
        <div className="footer-brand-row">
          <SlopMark inverse size={104} />
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
        data-copy={copy}
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
                  onClick={() => void copyPrompt()}
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
  view,
  outdated = false,
}: {
  project: ProjectDefinition;
  cycles: readonly PromotionCycle[] | null;
  displayCycleId: string | null;
  view?: ProjectView;
  outdated?: boolean;
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
    return (
      <ProjectInstallPanel
        key={project.id}
        project={project}
        view={view}
        outdated={outdated}
      />
    );
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

function InstallPanel() {
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
function ProjectInstallPanel({
  project,
  view,
  outdated,
}: {
  project: ProjectDefinition;
  view: ProjectView | undefined;
  outdated: boolean;
}) {
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
      {ready && view ? (
        <ProjectOpenWork project={project} view={view} outdated={outdated} />
      ) : null}
    </div>
  );
}

const OPEN_WORK_LIMIT = 5;

/**
 * PRD section 7: the contributor goes from the project to eligible work. Only
 * items whose published selection decision is "candidate" appear, so
 * assignees, claims, drafts, review requests, approvals, requested changes,
 * security labels, blocked or untriaged issues and epics stay out. The list
 * appears only for a project cleared for agents, and agents recheck GitHub.
 */
function ProjectOpenWork({
  project,
  view,
  outdated,
}: {
  project: ProjectDefinition;
  view: ProjectView;
  outdated: boolean;
}) {
  const candidates = [
    ...view.workQueue.issues,
    ...view.workQueue.pullRequests,
  ].filter((item) => item.selection.status === "candidate");
  const shown = candidates.slice(0, OPEN_WORK_LIMIT);
  return (
    <section aria-labelledby="open-work-heading" className="open-work">
      <h3 id="open-work-heading">Open work</h3>
      <p>
        {outdated ? "May be outdated. " : ""}Issues ready for a fix and pull
        requests ready for review, read from GitHub{" "}
        {formatDateTime(view.generatedAt)}. Your agent checks each item again
        before it starts.
      </p>
      {shown.length === 0 ? (
        <EmptyState text="No open issue or pull request is ready for new work now." />
      ) : (
        <ul className="project-rows">
          {shown.map((item) => (
            <li key={item.id}>
              <ExternalLinkAnchor className="project-row" href={item.url}>
                <span className="project-row-name">
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind === "issue" ? "Issue" : "Pull request to review"}{" "}
                    · {item.repository}#{item.number}
                  </small>
                </span>
                <ExternalLink aria-hidden="true" />
              </ExternalLinkAnchor>
            </li>
          ))}
        </ul>
      )}
      <p className="open-work-more">
        {candidates.length > shown.length
          ? `${shown.length} of ${candidates.length} shown. `
          : ""}
        <ExternalLinkAnchor href={project.links.issues}>
          All issues on GitHub
        </ExternalLinkAnchor>
      </p>
    </section>
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
              href={`${browserDeployment.site}/api/v1/payments/projects/${project.id}/direct-transfers`}
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
          {totals.refreshError !== null ||
          vaultSnapshotStale(snapshot, totals.vault.staleAfterMs)
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
    <main className="shell route-main funding-page route-funding">
      <RoutePageHeader
        title={<>{project.name} funding</>}
        icon={<Wallet />}
        eyebrow={
          <>
            <Link href={`/projects/${project.slug}`}>{project.name}</Link>
            <span> / </span>Funding
          </>
        }
        actions={
          <MetricGrid
            className={`route-funding-summary${project.escrow ? "" : " route-funding-summary--unfunded"}`}
          >
            <MetricTile
              label={
                project.reward.kind === "monthly-pool"
                  ? "Monthly target"
                  : "Advertised prize"
              }
              value={
                monthlyPoolPointsOnly(project.reward)
                  ? "Points only"
                  : project.reward.kind === "monthly-pool"
                    ? project.reward.monthlyCapDisplay
                    : (project.reward.externalOpportunity
                        ?.advertisedAmountDisplay ?? "External")
              }
            />
            {!project.escrow ? (
              <MetricTile
                label="Committed"
                value={formatMicroUsdc(project.reward.committedMinor)}
                detail={fundingStateLabel(project)}
              />
            ) : null}
          </MetricGrid>
        }
      />
      <ProjectNav project={project} current="funding" />
      <section className="funding-records">
        {!project.escrow ? (
          <div className="route-funding-status">
            <StatusBadge>Payments: {paymentStateLabel(project)}</StatusBadge>
            <StatusBadge>Project vault: {vaultStateLabel(project)}</StatusBadge>
          </div>
        ) : null}
        {project.reward.kind === "external-prize-share" ? (
          <p>The organizer pays this prize.</p>
        ) : project.escrow ? (
          <EscrowFunding project={project} onRegistered={setRegistered} />
        ) : (
          <div className="route-empty">
            <Wallet aria-hidden="true" />
            <div>
              <p>This project has no vault yet.</p>
              <Link
                className="button secondary-button"
                href={`/projects/${project.slug}/manage`}
              >
                Set up funding
              </Link>
            </div>
          </div>
        )}
      </section>
      {project.escrow ? (
        <OwnerAwards key={project.id} project={project} />
      ) : null}
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
  const externalPrize = project.reward.kind === "external-prize-share";
  const pointsOnly = monthlyPoolPointsOnly(project.reward);
  return (
    <main className="route-project">
      <section className="project-hero">
        <div className="shell">
          <DataNotice state={state} retry={retry} />
          <RoutePageHeader
            title={project.name}
            icon={<FolderGit2 />}
            eyebrow={<Link href="/">Projects</Link>}
            lead={project.description}
          >
            <ProjectNav project={project} current="overview" />
          </RoutePageHeader>
          <div
            className={`project-overview${externalPrize ? " project-overview--prize" : ""}`}
          >
            <div>
              <div className="project-state-summary">
                <p className="project-reward-status">
                  {pointsOnly
                    ? "Points only · no cash rewards"
                    : externalPrize
                      ? "External prize · organizer decides awards"
                      : `${project.reward.monthlyCapDisplay} monthly target${project.escrow ? "" : ` · ${fundingStateLabel(project)}`} · ${project.reward.paymentMode === "enabled" ? "payments enabled" : "payments not active"}`}
                </p>
                <ProjectFunding project={project} />
              </div>
              <div className="project-resource-links">
                <ExternalLinkAnchor href={project.links.repository}>
                  View in GitHub <ExternalLink aria-hidden="true" size={14} />
                </ExternalLinkAnchor>
                <Link href={`/projects/${project.slug}/security`}>
                  {project.securityBounty
                    ? "Security bounty"
                    : "Report a security issue"}
                </Link>
              </div>
              {project.rewardAsset ? (
                <details className="asset-details">
                  <summary>
                    {project.rewardAsset.symbol} on{" "}
                    {REWARD_ASSET_NETWORKS[project.rewardAsset.network].name} ·
                    Asset details
                  </summary>
                  <p>
                    Token contract: <code>{project.rewardAsset.address}</code>
                  </p>
                </details>
              ) : null}
            </div>
            {externalPrize ? (
              <aside className="reward-card">
                <strong>
                  <span className="reward-exact-amount">
                    {
                      project.reward.externalOpportunity
                        ?.advertisedAmountDisplay
                    }
                  </span>
                  {" + points"}
                </strong>
                <details>
                  <summary>Prize allocation terms</summary>
                  <p>{project.terms.externalPrize?.allocationAuthority}</p>
                  <a href={`/projects/${project.id}/terms.json`}>
                    Full prize terms
                  </a>
                </details>
              </aside>
            ) : null}
          </div>
          {project.reward.reviewBudget ? (
            <p>{reviewBudgetLabel(project.reward.reviewBudget)}</p>
          ) : null}
          {project.status === "paused" || state.status === "ready" ? (
            <ProjectParticipation
              project={project}
              displayCycleId={view?.cycle.id ?? null}
              cycles={state.status === "ready" ? state.cycleIndex.cycles : null}
              view={view}
              outdated={
                state.status === "ready" &&
                (state.refreshError !== undefined || stale(state.snapshot))
              }
            />
          ) : null}
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
  useHashScroll(window.location.href);
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
  else if (route.kind === "cycle-archive")
    content = <CycleArchivePage retry={retryArchive} state={archive} />;
  else if (route.kind === "new-project") content = <ProjectProposalPage />;
  else if (route.kind === "vetting-evidence") content = <VettingEvidencePage />;
  else if (route.kind === "security-cases") content = <SecurityCasesPage />;
  else if (route.kind === "security-program")
    content = withProject(route, (project) => (
      <SecurityProgramPage key={project.id} project={project} />
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
      <Footer marketing={route.kind === "home"} />
    </>
  );
}
