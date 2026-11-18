import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  ExternalLink,
  Lock,
  Pause,
  Plus,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import {
  Fragment,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { EscrowFunding } from "./EscrowFunding";
import { HomeStandings } from "./HomeStandings";
import { Link, useHashScroll } from "./Link";
import {
  hasProjectCardBounty,
  projectRewardSummaries,
  securityBountyAmountLabel,
} from "./lib/project-reward-summary";
import type { SecurityBountyTerms } from "./lib/security-bounty.mjs";
import { ProjectWork } from "./ProjectWork";
import "./public-records.css";
import { SlopMark, Wordmark } from "./Logo";
import { browserDeployment } from "./lib/browser-deployment";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "./lib/contact";
import { setRouteHead } from "./lib/document-head";
import { GithubIcon } from "./lib/github-icon";
import {
  hasBountyOverview,
  homeProjectDescription,
  homeProjectOrder,
  homeProjects,
} from "./lib/home-projects";
import {
  INTAKE_PAUSED_NOTICE,
  intakeCap,
  intakePaused,
} from "./lib/intake-cap.mjs";
import {
  maintainerShareCardLine,
  maintainerShareNotice,
} from "./lib/maintainer-share.mjs";
import { loadMergeActivity, mergeActivityLine } from "./lib/merge-activity";
import {
  homePoolReward,
  listedThisMonth,
  loadPoolFunding,
  monthName,
  NOT_LISTED_NOTICE,
  poolFundingStatus,
  publicPoolReward,
} from "./lib/pool-funding";
import { projectChains, websiteLabel, xHandle } from "./lib/project-links";
import {
  findHistoricalProject,
  findProject,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";
import { formatRewardCapDisplay } from "./lib/reward-amount";
import { pageTitle, STATIC_PAGE_TITLES } from "./lib/site-routes";
import { SOURCE_REPOSITORY } from "./lib/source-repository";
import { useCopyFeedback } from "./lib/use-copy-feedback";
import { useCycleIndex } from "./lib/use-cycle-index";
import { useDirectTransfers } from "./lib/use-direct-transfers";
import { usePublicResource } from "./lib/use-public-resource";
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
  cycleLifecycleTone,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDateTime,
  formatMicroUsdc,
  monthlyPoolPointsOnly,
  NotFound,
  ReviewBudget,
  RoutePageHeader,
  Spinner,
  StatusBadge,
} from "./Presentation";

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
// Vault setup and wallet actions carry the chain adapters; only bounty
// project pages need them, so they stay out of the home page bundle.
const ProjectBountyFunding = lazy(() =>
  import("./OwnerBountyVault").then((module) => ({
    default: module.ProjectBountyFunding,
  })),
);
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
type HomeAudience = "contributor" | "maintainer";
const HOME_AUDIENCES = {
  contributor: {
    heading: "MAKE MONEY",
    accessibleHeading: "MAKE MONEY SHIPPING OPEN SOURCE.",
    actions: HERO_ACTIONS,
    skillPath: "/contribute/SKILL.md",
  },
  maintainer: {
    heading: "SHIP FASTER.",
    accessibleHeading: "SHIP FASTER. WITH CONTRIBUTORS.",
    actions: ["WITH CONTRIBUTORS."],
    skillPath: "/maintain/SKILL.md",
  },
} as const;
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

type ProjectRouteKind = "project" | "manage-project" | "security-program";
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
  const securitySettings = /^\/projects\/([^/]+)\/manage\/?$/.exec(
    window.location.pathname,
  );
  if (securitySettings && window.location.hash === "#security-settings") {
    window.history.replaceState(
      window.history.state,
      "",
      `/projects/${securitySettings[1]}/security${window.location.search}#security-settings`,
    );
  }
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
  const funding = /^\/projects\/([^/]+)\/funding\/?$/.exec(
    window.location.pathname,
  );
  if (funding) {
    window.history.replaceState(
      window.history.state,
      "",
      `/projects/${funding[1]}${window.location.search}${window.location.hash || "#funding"}`,
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
    const project =
      findProject(route.projectId) ??
      (route.kind === "cycle" ? findHistoricalProject(route.projectId) : null);
    if (!project) return notFound;
    if (route.kind === "cycle") {
      return {
        title: pageTitle(`${project.name} ${route.cycleId} cycle`),
        path: `/cycles/${project.id}/${encodeURIComponent(route.cycleId)}`,
      };
    }
    const base = `/projects/${project.slug}`;
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
    return {
      title: pageTitle(
        hasBountyOverview(project)
          ? `${project.name} security bounty`
          : project.name,
      ),
      path: base,
    };
  }
  const path = window.location.pathname.replace(/(.)\/$/u, "$1");
  const title = STATIC_PAGE_TITLES.get(path);
  return title ? { title: pageTitle(title), path } : notFound;
}

function useDocumentHead(route: Route) {
  useEffect(() => {
    const { title, path } = routeHead(route);
    setRouteHead(title, path);
  }, [route]);
}

function Header() {
  const domain = publicFooterDomain(window.location.hostname);
  return (
    <header className="site-header">
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

function HeroHeading({ audience }: { audience: HomeAudience }) {
  const campaign = HOME_AUDIENCES[audience];
  const [index, setIndex] = useState(0);
  const [characters, setCharacters] = useState(campaign.actions[0].length);
  const [phase, setPhase] = useState<"deleting" | "holding" | "typing">(
    "holding",
  );
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = campaign.actions[index];
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
        setIndex((value) => (value + 1) % campaign.actions.length);
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
  }, [campaign.actions, characters, index, phase]);
  const action = campaign.actions[index];
  return (
    <h1 aria-label={campaign.accessibleHeading}>
      <span aria-hidden="true" className="hero-message">
        <span>{campaign.heading}</span>
        <span className="hero-action">
          {campaign.actions.map((candidate) => (
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
  const cap = formatRewardCapDisplay(
    reward.monthlyCapDisplay,
    project.rewardAsset,
  );
  if (project.rewardAsset?.kind === "native") return cap;
  if (project.rewardAsset?.kind === "token")
    return cap.replace(/^[\d,]+(?=\s)/u, (digits) =>
      new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      })
        .format(BigInt(digits.replaceAll(",", "")))
        .toLowerCase(),
    );
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

/**
 * Custom images are the 128px WebP or JPEG avatars that ProjectImageField encodes
 * into the immutable revision, so they arrive inline with the registry and
 * cost no request. Rows below the fold defer GitHub fallback avatars.
 */
function ProjectImage({
  project,
  lazy = false,
}: {
  project: ProjectDefinition;
  lazy?: boolean;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return !project.image || failedImage === project.image ? (
    <ProjectOwnerAvatar project={project} lazy={lazy} />
  ) : (
    <img
      alt=""
      aria-hidden="true"
      className="project-avatar"
      decoding="async"
      width={56}
      height={56}
      src={project.image}
      onError={() => setFailedImage(project.image ?? null)}
    />
  );
}

function ProjectOwnerAvatar({
  project,
  lazy,
}: {
  project: ProjectDefinition;
  lazy: boolean;
}) {
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
      decoding="async"
      height={56}
      loading={lazy ? "lazy" : undefined}
      onError={() => setFailed(true)}
      src={src}
      width={56}
    />
  );
}

function compactPrizeLabel(label: string): string {
  return label.replace(/\$([\d,]+)(?![\d,.])/gu, (_amount, digits: string) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    })
      .format(BigInt(digits.replaceAll(",", "")))
      .toLowerCase(),
  );
}

function bountyFundingLabel(terms: SecurityBountyTerms): string {
  return terms.funding.state === "pledged" ? "Pledged" : "Funded";
}

type HomeProject = ProjectDefinition &
  Pick<ReturnType<typeof homePoolReward>, "fundingTag" | "warning">;

const fundingTagTone = {
  Vaulted: "success",
  Promised: "warning",
  Configured: "neutral",
} as const;

function HomeReward({ project }: { project: HomeProject }) {
  const bounty = hasProjectCardBounty(project)
    ? project.securityBounty
    : undefined;
  const pointsOnly = monthlyPoolPointsOnly(project.reward);
  const amount = bounty
    ? securityBountyAmountLabel(bounty)
    : pointsOnly
      ? "Points only"
      : project.reward.kind === "monthly-pool"
        ? project.fundingTag === "Vaulted"
          ? monthlyPoolCapLabel(project)
          : formatRewardCapDisplay(
              project.reward.monthlyCapDisplay,
              project.rewardAsset,
            )
        : "Points";
  if (project.fundingTag) {
    return (
      <span className="project-monthly-reward">
        <span className="project-monthly-amount">
          <strong>{amount}</strong>{" "}
          <span className="project-monthly-unit">/mo</span>
        </span>
        <StatusBadge
          className="project-funding-tag"
          tone={fundingTagTone[project.fundingTag]}
        >
          {project.fundingTag}
        </StatusBadge>
        {project.warning ? (
          <span className="project-funding-warning">{project.warning}</span>
        ) : null}
      </span>
    );
  }
  return (
    <>
      <strong>{amount}</strong>
      {bounty ? (
        <span>
          {bounty.eligibility === "critical-loss-of-funds"
            ? "/ Critical"
            : "/ Finding"}
        </span>
      ) : project.reward.kind === "external-prize-share" ? (
        <span> + external prize</span>
      ) : null}
    </>
  );
}

function HomeReviewBudget({ project }: { project: HomeProject }) {
  const budget = project.reward.reviewBudget;
  return budget?.fundingState === "committed" ? (
    <small className="project-review-budget">
      +{formatMicroUsdc(budget.committedMinor)} reviews
    </small>
  ) : null;
}

/** The owner's published maintainer share, only beside a shown monthly amount. */
function HomeMaintainerShare({ project }: { project: HomeProject }) {
  const line = monthlyPoolPointsOnly(project.reward)
    ? null
    : maintainerShareCardLine(project, new Date());
  return line ? <small className="project-review-budget">{line}</small> : null;
}

function ProjectCard({ project }: { project: HomeProject }) {
  return (
    <Link className="project-card" href={`/projects/${project.slug}`}>
      <div className="project-card-heading">
        <ProjectImage project={project} />
        <h3>{project.name}</h3>
        <ArrowRight aria-hidden="true" />
      </div>
      <div className="project-card-content">
        <p className="project-summary">
          {homeProjectDescription(project.description)}
        </p>
        <p className="project-bounty">
          <HomeReward project={project} />
        </p>
        <HomeReviewBudget project={project} />
        <HomeMaintainerShare project={project} />
      </div>
    </Link>
  );
}

const COMMUNITY_PAGE_SIZE = 10;

function CommunityProjects({ projects }: { projects: HomeProject[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(projects.length / COMMUNITY_PAGE_SIZE);
  if (pages === 0) return null;
  const current = Math.min(page, pages - 1);
  const start = current * COMMUNITY_PAGE_SIZE;
  return (
    <section aria-labelledby="community-projects" className="project-tier">
      <h3 id="community-projects">Community</h3>
      <ul className="project-rows">
        {projects.slice(start, start + COMMUNITY_PAGE_SIZE).map((project) => (
          <li key={project.id}>
            <Link className="project-row" href={`/projects/${project.slug}`}>
              <ProjectImage lazy project={project} />
              <span className="project-row-name">
                <strong>{project.name}</strong>
                <small>{homeProjectDescription(project.description)}</small>
              </span>
              <span className="project-row-amount">
                <span>
                  <HomeReward project={project} />
                </span>
                <HomeReviewBudget project={project} />
                <HomeMaintainerShare project={project} />
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          </li>
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
          <span aria-live="polite">
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

function bootstrapAgentPrompt(audience?: HomeAudience): string {
  const origin = window.location.origin.replace(/\/$/u, "");
  const path = audience ? HOME_AUDIENCES[audience].skillPath : "/SKILL.md";
  return `Read ${origin}${path} and follow it.`;
}

/** Published bounty terms come from the same registry as project discovery. */
function SecurityBounties() {
  const programs = PROJECTS.filter(
    (project) =>
      project.status === "active" && project.securityBounty?.status === "open",
  );
  return (
    <section
      className={`section shell home-security-section${programs.length === 0 ? " home-security-section--empty" : ""}`}
      aria-labelledby="home-security-title"
      id="security-bounties"
    >
      <div className="home-section-heading">
        <h2 className="home-section-title" id="home-security-title">
          Security bounties
        </h2>
        <Link className="button primary-button" href="/projects/new">
          <Plus aria-hidden="true" /> Add a bounty
        </Link>
      </div>
      {programs.length === 0 ? (
        <p className="project-tier-note">
          No open bounties. <a href="#projects">Report privately</a> on any
          project.
        </p>
      ) : (
        <div className="project-grid">
          {programs.map((project) => {
            const terms = project.securityBounty;
            if (!terms) return null;
            return (
              <Link
                className="project-card"
                key={project.id}
                href={
                  hasBountyOverview(project)
                    ? `/projects/${project.slug}`
                    : `/projects/${project.slug}/security`
                }
              >
                <div className="project-card-heading">
                  <ProjectImage lazy project={project} />
                  <h3>
                    <span
                      role="img"
                      aria-label="Security bounty"
                      title="Security bounty"
                    >
                      <Shield aria-hidden="true" size={22} />
                    </span>{" "}
                    {project.name}
                  </h3>
                  <ArrowRight aria-hidden="true" />
                </div>
                <div className="project-card-content">
                  <p className="project-bounty">
                    <strong>{securityBountyAmountLabel(terms)}</strong>
                    <span>
                      {terms.eligibility === "critical-loss-of-funds"
                        ? "/ Critical"
                        : "/ Finding"}
                    </span>
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HomePage() {
  const audience: HomeAudience =
    new URLSearchParams(window.location.search).get("audience") === "maintainer"
      ? "maintainer"
      : "contributor";
  const selectAudience = (next: HomeAudience) => {
    if (next === audience) return;
    const destination = new URL(window.location.href);
    if (next === "maintainer") destination.searchParams.set("audience", next);
    else destination.searchParams.delete("audience");
    window.history.pushState(window.history.state, "", destination);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  // Funding changes the displayed reward, never homepage discovery.
  const [funding] = usePublicResource(
    true,
    loadPoolFunding,
    "Pool funding unavailable",
  );
  const now = new Date();
  const fundingIndex = funding.status === "ready" ? funding.index : null;
  // A project over its owner's intake cap has paused new contributors and
  // is left out. The counts are read only when a project has a cap; while
  // they load, and when they cannot be read, every project is listed.
  const open = homeProjects();
  const [merge] = usePublicResource(
    open.some((project) => intakeCap(project) !== null),
    loadMergeActivity,
    "Merge activity unavailable",
  );
  const mergeIndex = merge.status === "ready" ? merge.index : null;
  const listedProjects = homeProjectOrder(
    open
      .filter(
        (project) => !intakePaused(project, mergeIndex?.get(project.id), now),
      )
      .map((project) => {
        const {
          project: shown,
          fundingTag,
          warning,
        } = homePoolReward(project, fundingIndex, now);
        return { ...shown, fundingTag, warning };
      }),
  );
  const featured = listedProjects.filter(
    (project) => project.listingTier === "featured",
  );
  const community = listedProjects.filter(
    (project) => project.listingTier === "community",
  );
  return (
    <main>
      <section className="hero shell">
        <fieldset
          aria-label="Choose your Slop journey"
          className="home-audience-switch"
        >
          {(["contributor", "maintainer"] as const).map((option) => (
            <button
              aria-pressed={audience === option}
              className="button"
              key={option}
              onClick={() => selectAudience(option)}
              type="button"
            >
              {option === "contributor" ? "Contributor" : "Maintainer"}
            </button>
          ))}
        </fieldset>
        <HeroHeading audience={audience} key={audience} />
        <InstallPanel audience={audience} />
      </section>

      <SecurityBounties />
      <section className="section shell home-projects-section" id="projects">
        <div className="home-section-heading">
          <h2 className="home-section-title">Projects</h2>
          <Link className="button primary-button" href="/projects/new">
            <Plus aria-hidden="true" /> Add a project
          </Link>
        </div>
        {listedProjects.length === 0 ? (
          <p className="project-tier-note">No projects yet.</p>
        ) : null}
        {featured.length > 0 ? (
          <section aria-labelledby="featured-projects" className="project-tier">
            <h3 id="featured-projects">Featured</h3>
            <div className="project-grid">
              {featured.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </section>
        ) : null}
        <CommunityProjects projects={community} />
      </section>
      <section
        className="section shell home-leaderboard-section"
        id="leaderboard"
      >
        <HomeStandings />
      </section>
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
  skillUrl,
}: {
  prompt: string;
  openIn?: boolean;
  skillUrl?: string;
}) {
  const { feedback: copy, copy: copyPrompt } = useCopyFeedback(prompt, 1_600);
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
            : copy === "failed"
              ? "Copy unavailable; select agent prompt"
              : "Copy agent prompt"
        }
        className={
          copy === "copied"
            ? "button primary-button agent-prompt-copied"
            : "button primary-button"
        }
        data-copy={copy === "failed" ? "error" : copy}
        onClick={copyPrompt}
        type="button"
      >
        {copy === "copied" ? <Check /> : <Clipboard />}
        <span className="agent-prompt-copy-label">
          {copy === "copied"
            ? "Copied"
            : copy === "failed"
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
            const href = agent.href(prompt, skillUrl ?? `${origin}/SKILL.md`);
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

function ProjectParticipation({ project }: { project: ProjectDefinition }) {
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
        <p>
          <span
            role="img"
            aria-label="Permission required"
            title="Permission required"
          >
            <Lock aria-hidden="true" size={16} />
          </span>{" "}
          <ExternalLinkAnchor href={project.steward.github.profileUrl}>
            Ask {project.steward.displayName}
          </ExternalLinkAnchor>
        </p>
      </section>
    );
  }
  if (project.status === "paused") {
    return (
      <section className="section" id="start">
        <p>
          <StatusBadge tone="warning" icon={<Pause />}>
            Paused
          </StatusBadge>{" "}
          <Link href={`/projects/${project.slug}/manage`}>Owner setup</Link>
        </p>
      </section>
    );
  }
  // Clearance gates contribution; missing score or funding history does not.
  return <ProjectInstallPanel key={project.id} project={project} />;
}

function InstallPanel({ audience }: { audience: HomeAudience }) {
  const origin = window.location.origin.replace(/\/$/u, "");
  return (
    <div className="home-agent-setup">
      <p className="hero-copy">Paste into your agent.</p>
      <AgentPromptBox
        openIn
        prompt={bootstrapAgentPrompt(audience)}
        skillUrl={`${origin}${HOME_AUDIENCES[audience].skillPath}`}
      />
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
  // Discovery leaves out an unfunded monthly pool this month; that is not a
  // clearance problem, so the owner setup link does not apply.
  const [funding] = usePublicResource(
    project.reward.kind === "monthly-pool",
    loadPoolFunding,
    "Pool funding unavailable",
  );
  const unlisted =
    funding.status === "ready" &&
    !listedThisMonth(project, funding.index, new Date());
  // Neither is a pause at the owner's intake cap.
  const [merge] = usePublicResource(
    project.status === "active" && intakeCap(project) !== null,
    loadMergeActivity,
    "Merge activity unavailable",
  );
  const paused =
    merge.status === "ready" &&
    intakePaused(project, merge.index.get(project.id), new Date());
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
    <div id="start">
      <div className="install-heading">
        <h2>Start</h2>
      </div>
      {ready ? null : (
        <p>
          {eligibility === "loading" ? (
            <Spinner label="Checking project clearance" />
          ) : eligibility === "blocked" && paused ? (
            "This project has paused new contributors. The prompt below picks only listed projects."
          ) : eligibility === "blocked" && unlisted ? (
            <StatusBadge tone="warning">Not listed this month</StatusBadge>
          ) : eligibility === "blocked" ? (
            <>
              <StatusBadge tone="warning" icon={<ShieldAlert />}>
                Not cleared
              </StatusBadge>{" "}
              <Link href={`/projects/${project.slug}/manage`}>Owner setup</Link>
            </>
          ) : (
            <StatusBadge icon={<ShieldQuestion />}>
              Clearance unknown
            </StatusBadge>
          )}
        </p>
      )}
      <AgentPromptBox
        openIn
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
  const [showHistory, setShowHistory] = useState(false);
  const [directState, retryDirect] = useDirectTransfers({
    projectId: project.id,
  });
  if (state.status !== "ready") return null;
  const cycles = state.cycleIndex.cycles
    .filter((cycle) => cycle.projectId === project.id)
    .sort((left, right) => right.cycleId.localeCompare(left.cycleId));
  const externalPrize = project.reward.kind === "external-prize-share";
  const direct = new Map<string, { amount: bigint; count: number }>();
  for (const payment of directState.status === "ready"
    ? directState.transfers
    : []) {
    const month = direct.get(payment.contributionMonth) ?? {
      amount: 0n,
      count: 0,
    };
    month.amount += BigInt(payment.amountMicro);
    month.count += 1;
    direct.set(payment.contributionMonth, month);
  }
  const directMonths = [...direct].sort(([left], [right]) =>
    right.localeCompare(left),
  );
  const historyLimited = directMonths.length > 3 || cycles.length > 3;
  // Loading is not an empty history: wait for direct payments before saying
  // that nothing has closed.
  const directLoading = directState.status === "loading" && !externalPrize;
  if (
    cycles.length === 0 &&
    directMonths.length === 0 &&
    (externalPrize || directState.status === "ready")
  )
    return null;
  return (
    <section className="section payment-history">
      <div className="simple-heading">
        <h2>{externalPrize ? "Cycle history" : "Payment history"}</h2>
      </div>
      {directState.status === "error" && !externalPrize ? (
        <p role="status">
          Payments unavailable{" "}
          <button
            aria-label="Retry"
            className="button secondary-button button-small icon-button"
            title="Retry"
            type="button"
            onClick={retryDirect}
          >
            <RotateCcw aria-hidden="true" size={15} />
          </button>
        </p>
      ) : null}
      {directLoading ? <p role="status">Loading direct payments…</p> : null}
      {(showHistory ? directMonths : directMonths.slice(0, 3)).map(
        ([month, { amount, count }]) => (
          <p className="money-summary" key={month}>
            <strong>{formatMicroUsdc(amount.toString())}</strong>
            <span>
              {formatCycleMonth(month)} · {count} transfers ·{" "}
              <ExternalLinkAnchor
                href={`${browserDeployment.site}/api/v1/payments/projects/${project.id}/direct-transfers`}
                label="Disclosure"
              >
                <ExternalLink aria-hidden="true" size={15} />
              </ExternalLinkAnchor>
            </span>
          </p>
        ),
      )}
      {cycles.length === 0 ? null : (
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
              {(showHistory ? cycles : cycles.slice(0, 3)).map((cycle) => (
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
                  <td>
                    <StatusBadge tone={cycleLifecycleTone(cycle)}>
                      {cycleLifecycleLabel(cycle)}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {historyLimited ? (
        <button
          className="button secondary-button"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((value) => !value)}
          type="button"
        >
          {showHistory ? "Show less" : "Show all"}
        </button>
      ) : null}
    </section>
  );
}

/** Funding controls share the project overview's reward summary. */
function ProjectFundsAndAwards({
  project,
  state,
}: {
  project: ProjectDefinition;
  state: DataState;
}) {
  return (
    <section
      id="funding"
      className="project-funds-and-awards"
      aria-label="Funds and awards"
    >
      {project.reward.kind !== "external-prize-share" && project.escrow ? (
        <>
          <EscrowFunding readOnly project={project} />
          <OwnerAwards
            key={project.id}
            project={project}
            awardMonths={
              state.status === "ready"
                ? state.cycleIndex.cycles
                    .filter(
                      (cycle) =>
                        cycle.projectId === project.id &&
                        cycle.kind === "monthly-pool" &&
                        cycle.contributors.length > 0,
                    )
                    .map((cycle) => cycle.cycleId)
                : []
            }
          />
        </>
      ) : null}
    </section>
  );
}

function ProjectHeader({ project }: { project: ProjectDefinition }) {
  return (
    <RoutePageHeader
      title={project.name}
      titleAction={
        <a
          className="project-github-link"
          href={project.links.repository}
          aria-label={`View ${project.name} on GitHub`}
          title="View on GitHub"
          target="_blank"
          rel="noopener noreferrer"
        >
          <GithubIcon aria-hidden="true" size={22} />
        </a>
      }
      icon={<ProjectImage key={project.id} project={project} />}
      lead={project.description}
    />
  );
}

/** Shared copy for every registry reward model; no project-specific descriptions. */
function ProjectRewardSummary({
  project: registered,
}: {
  project: ProjectDefinition;
}) {
  const [funding] = usePublicResource(
    registered.reward.kind === "monthly-pool",
    loadPoolFunding,
    "Pool funding unavailable",
  );
  const index = funding.status === "ready" ? funding.index : null;
  const now = new Date();
  const { project, promise } = publicPoolReward(registered, index, now);
  const status = poolFundingStatus(registered, index, now);
  const shareNotice = maintainerShareNotice(registered, now);
  return (
    <div className="project-overview">
      <div className="project-state-summary">
        {status.state === "withdrawn" ? (
          <p className="project-reward-status">
            {`Funds were withdrawn from the vault during ${monthName(status.period)}; it no longer covers this month's amount.`}
          </p>
        ) : null}
        {!promise &&
        index !== null &&
        !listedThisMonth(registered, index, now) ? (
          <p className="project-reward-status">{NOT_LISTED_NOTICE}</p>
        ) : null}
        {projectRewardSummaries(project, promise !== null).map((summary) => (
          <p className="project-reward-status" key={summary.kind}>
            {summary.kind === "monthly-pool" ? (
              <>
                {summary.amount}
                {summary.token ? (
                  <>
                    {" "}
                    <ExternalLinkAnchor href={summary.token.url}>
                      {summary.token.symbol}
                    </ExternalLinkAnchor>
                  </>
                ) : null}
                {promise ? ` /mo · ${promise}` : " /mo"}
              </>
            ) : summary.kind === "security-bounty" ? (
              <>
                {summary.amount}{" "}
                {summary.eligibility === "critical-loss-of-funds"
                  ? "/ critical finding"
                  : "/ finding"}
                {summary.status === "open"
                  ? null
                  : ` · bounty ${summary.status}`}
                {project.securityBounty
                  ? ` · ${bountyFundingLabel(project.securityBounty)}`
                  : ""}
              </>
            ) : summary.kind === "external-prize" ? (
              summary.amount ? (
                `${compactPrizeLabel(summary.amount)} external prize`
              ) : (
                "External prize"
              )
            ) : (
              "Points only"
            )}
          </p>
        ))}
        {promise ? (
          <p className="project-reward-status">
            Promised by the project owner; Slop does not guarantee payment.
          </p>
        ) : null}
        {shareNotice ? (
          <p className="project-reward-status">{shareNotice}</p>
        ) : null}
      </div>
    </div>
  );
}

/** #2295: the vault network, website and X account, each only when present. */
function ProjectLinks({ project }: { project: ProjectDefinition }) {
  const chains = projectChains(project);
  const website = project.links.website;
  const x = project.links.x;
  const handle = xHandle(x);
  const parts: { key: string; node: ReactNode }[] = [];
  if (chains.length > 0)
    parts.push({
      key: "chain",
      node: `Chain: ${chains
        .map((chain) =>
          chain.symbol ? `${chain.name} (${chain.symbol})` : chain.name,
        )
        .join(", ")}`,
    });
  if (website)
    parts.push({
      key: "website",
      node: (
        <>
          Website:{" "}
          <a href={website} target="_blank" rel="noopener noreferrer">
            {websiteLabel(website)}
          </a>
        </>
      ),
    });
  if (x && handle)
    parts.push({
      key: "x",
      node: (
        <>
          X:{" "}
          <a href={x} target="_blank" rel="noopener noreferrer">
            @{handle}
          </a>
        </>
      ),
    });
  if (parts.length === 0) return null;
  return (
    <p className="project-links-line">
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 ? " · " : null}
          {part.node}
        </Fragment>
      ))}
    </p>
  );
}

/** #1993: how promptly the project merges outside work, from the daily D1 read. */
function ProjectMergeActivity({ project }: { project: ProjectDefinition }) {
  const active = project.status === "active";
  const [state] = usePublicResource(
    active,
    loadMergeActivity,
    "Merge activity unavailable",
  );
  if (!active || state.status === "loading") return null;
  if (state.status === "error")
    return (
      <p className="project-merge-activity">Merge activity unavailable.</p>
    );
  // A repository not read yet shows nothing rather than an empty claim.
  const rows = state.index.get(project.id);
  const now = new Date();
  const line = mergeActivityLine(rows, now);
  return (
    <>
      {intakePaused(project, rows, now) ? (
        <p className="project-reward-status">{INTAKE_PAUSED_NOTICE}</p>
      ) : null}
      {line ? <p className="project-merge-activity">{line}</p> : null}
    </>
  );
}

function ProjectBountyIntroduction({
  project,
}: {
  project: ProjectDefinition;
}) {
  const terms = project.securityBounty;
  if (!terms) return null;
  const origin = window.location.origin;
  const prompt = `Read ${origin}/SKILL.md and follow its private security reporting workflow for github.com/${terms.intake.repository}.`;
  return (
    <section className="project-hero">
      <div className="shell">
        <ProjectHeader project={project} />
        <ProjectRewardSummary project={project} />
        <ProjectLinks project={project} />
        <Link
          className="button primary-button"
          href={`/projects/${project.slug}/security`}
        >
          Report privately
        </Link>
        <div id="start">
          <div className="install-heading">
            <h2>Start</h2>
          </div>
          <AgentPromptBox openIn prompt={prompt} />
        </div>
      </div>
    </section>
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
  return (
    <main className="route-project">
      <section className="project-hero">
        <div className="shell">
          <ProjectHeader project={project} />
          <ProjectRewardSummary project={project} />
          <ProjectLinks project={project} />
          <ProjectMergeActivity project={project} />
          {project.reward.reviewBudget?.fundingState === "committed" ? (
            <p>
              <ReviewBudget reviewBudget={project.reward.reviewBudget} />
            </p>
          ) : null}
          <ProjectParticipation project={project} />
        </div>
      </section>
      <div className="shell">
        <ProjectWork
          project={project}
          state={state}
          retry={retry}
          notice={!view?.leaders.length}
        />
        <ProjectFundsAndAwards
          key={`funding:${project.id}`}
          project={project}
          state={state}
        />
        <ProjectPaymentHistory
          key={`history:${project.id}`}
          project={project}
          state={state}
        />
        {view && state.status === "ready" && view.leaders.length > 0 ? (
          <div id="contributors">
            <ContributorStandings
              projectId={project.id}
              scoreState={state}
              retryScore={retry}
              showDataNotice
              compact
            />
          </div>
        ) : null}
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
        // The home table reads the small points summary, not the journal.
        ["project", "profile", "points"].includes(route.kind)
      }
    >
      <AppContent route={route} />
    </PointsProvider>
  );
}

function AppContent({ route }: { route: Route }) {
  const scrollLocation = new URL(window.location.href);
  // Switching the homepage journey keeps the reader at the hero, even when
  // the shared URL has an anchor for the project list or leaderboard.
  if (route.kind === "home") scrollLocation.searchParams.delete("audience");
  useHashScroll(window.location.href, scrollLocation.href);
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
  const project =
    route.kind === "project" ? findProject(route.projectId) : undefined;
  const [archive, retryArchive] = useCycleIndex(
    route.kind === "cycle-archive" || route.kind === "cycle",
  );
  const cycleProjectId =
    route.kind === "cycle"
      ? (findProject(route.projectId)?.id ?? route.projectId)
      : null;
  const cycleNeedsSnapshot =
    route.kind === "cycle" &&
    archive.status === "ready" &&
    !archive.cycleIndex.cycles.some(
      (cycle) =>
        cycle.projectId === cycleProjectId && cycle.cycleId === route.cycleId,
    );
  const needsSnapshot =
    !blocked &&
    snapshot &&
    !(project && hasBountyOverview(project)) &&
    (route.kind !== "cycle" || cycleNeedsSnapshot);
  const [state, retry] = useSnapshot(needsSnapshot);
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
    content = project ? (
      hasBountyOverview(project) ? (
        <main className="route-project">
          <ProjectBountyIntroduction project={project} />
          <div className="shell">
            <ProjectBountyFunding key={project.id} project={project} />
          </div>
        </main>
      ) : (
        <ProjectPage
          key={project.id}
          project={project}
          retry={retry}
          state={state}
        />
      )
    ) : (
      <main className="shell route-main">
        <h1>Project not found</h1>
        <p>
          <Link href="/">See open projects</Link>
        </p>
      </main>
    );
  } else if (route.kind === "profile")
    content = (
      <ProfilePage
        key={route.login.toLowerCase()}
        login={route.login}
        retry={retry}
        state={state}
      />
    );
  else if (route.kind === "cycle") {
    const cycleProject =
      findProject(route.projectId) ?? findHistoricalProject(route.projectId);
    content = cycleProject ? (
      <CyclePage
        archive={archive}
        cycleId={route.cycleId}
        project={cycleProject}
        retry={retry}
        retryArchive={retryArchive}
        state={state}
      />
    ) : (
      <NotFound title="Project not found" />
    );
  } else content = <NotFound />;
  return (
    <>
      <Header />
      {/* Routes render their own main landmark inside this layout container. */}
      <div className="app-content" id="main">
        {staleRegistry && !blocked && !registryIndependent ? (
          <aside
            aria-label="Project data status"
            className="shell registry-stale"
          >
            <p className="data-notice data-stale" role="status">
              <span className="pr-dot pr-bar-open" aria-hidden="true" />
              Projects stale · {formatDateTime(staleRegistry.syncedAt)}
              <button
                aria-label="Try again"
                onClick={() => window.location.reload()}
                title="Try again"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={15} />
              </button>
            </p>
          </aside>
        ) : null}
        <Suspense
          fallback={
            <main className="shell route-main">
              <Spinner label="Loading page" />
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
