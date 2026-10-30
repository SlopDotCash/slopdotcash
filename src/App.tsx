import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
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
import { EscrowFunding } from "./EscrowFunding";
import { HomeStandings } from "./HomeStandings";
import { Link, useHashScroll } from "./Link";
import {
  projectRewardSummaries,
  securityBountyAmountLabel,
} from "./lib/project-reward-summary";
import type { SecurityBountyTerms } from "./lib/security-bounty.mjs";
import "./public-records.css";
import { SlopMark, Wordmark } from "./Logo";
import { browserDeployment } from "./lib/browser-deployment";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "./lib/contact";
import { copyText } from "./lib/copy-text";
import { setRouteHead } from "./lib/document-head";
import { GithubIcon } from "./lib/github-icon";
import {
  communityProjects,
  hasBountyOverview,
  homeProjects,
} from "./lib/home-projects";
import {
  findProject,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";
import { pageTitle, STATIC_PAGE_TITLES } from "./lib/site-routes";
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
  EmptyState,
  ExternalLinkAnchor,
  formatCycleMonth,
  formatDate,
  formatDateTime,
  formatMicroUsdc,
  monthlyPoolPointsOnly,
  NotFound,
  RoutePageHeader,
  reviewBudgetLabel,
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
    const project = findProject(route.projectId);
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
  if (project.rewardAsset?.kind === "native") return reward.monthlyCapDisplay;
  if (project.rewardAsset?.kind === "token")
    return reward.monthlyCapDisplay
      .replace(/^[\d,]+(?=\s)/u, (digits) =>
        new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 2,
        })
          .format(BigInt(digits.replaceAll(",", "")))
          .toLowerCase(),
      )
      .replace(
        /\s+(\$?\S+)$/u,
        (_, symbol: string) => ` $${symbol.replace(/^\$/u, "")}`,
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
  return terms.funding.state === "pledged" ? "Pledged" : "Funding verified";
}

function ProjectCard({ project }: { project: ProjectDefinition }) {
  const bounty = hasBountyOverview(project)
    ? project.securityBounty
    : undefined;
  const amount = bounty
    ? securityBountyAmountLabel(bounty)
    : project.reward.kind === "monthly-pool"
      ? monthlyPoolCapLabel(project)
      : compactPrizeLabel(
          project.reward.externalOpportunity?.advertisedAmountDisplay ??
            "External",
        );
  return (
    <Link className="project-card" href={`/projects/${project.slug}`}>
      <div className="project-card-heading">
        <ProjectImage project={project} />
        <h3>{project.name}</h3>
        <ArrowRight aria-hidden="true" />
      </div>
      <div className="project-card-content">
        <p className="project-summary">{project.description}</p>
        <p className="project-bounty">
          <strong>{amount}</strong>
          {bounty ? (
            <span>
              {bounty.eligibility === "critical-loss-of-funds"
                ? "/ Critical"
                : "/ Finding"}
            </span>
          ) : monthlyPoolPointsOnly(project.reward) ||
            project.reward.kind === "external-prize-share" ? (
            <span> + points</span>
          ) : (
            <span>/mo</span>
          )}
        </p>
        {bounty ? (
          <small className="project-money-state">
            {bountyFundingLabel(bounty)}
          </small>
        ) : monthlyPoolPointsOnly(project.reward) ? (
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
  const bounty = hasBountyOverview(project)
    ? project.securityBounty
    : undefined;
  const amount = bounty
    ? `${securityBountyAmountLabel(bounty)} / ${bounty.eligibility === "critical-loss-of-funds" ? "Critical" : "Finding"} · ${bountyFundingLabel(bounty)}`
    : monthlyPoolPointsOnly(project.reward)
      ? "Points only"
      : project.reward.kind === "monthly-pool"
        ? `${monthlyPoolCapLabel(project)}/mo`
        : `${project.reward.externalOpportunity?.advertisedAmountDisplay ?? "External prize"} + points`;
  return (
    <li>
      <Link className="project-row" href={`/projects/${project.slug}`}>
        <ProjectImage lazy project={project} />
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

function bootstrapAgentPrompt(): string {
  const origin = window.location.origin.replace(/\/$/u, "");
  return `Read ${origin}/SKILL.md and follow it.`;
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
      </div>
      {programs.length === 0 ? (
        <p className="project-tier-note">
          No paid security bounties are open.{" "}
          <a href="#projects">Choose a project</a> to report a security issue
          privately without a promised award.
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
                  <h3>{project.name}</h3>
                  <ArrowRight aria-hidden="true" />
                </div>
                <div className="project-card-content">
                  <p className="project-summary">
                    {terms.eligibility === "critical-loss-of-funds"
                      ? `Find a critical security vulnerability in ${project.name}`
                      : `Find a security vulnerability in ${project.name}`}
                  </p>
                  <p className="project-bounty">
                    <strong>{securityBountyAmountLabel(terms)}</strong>
                    <span>
                      {terms.eligibility === "critical-loss-of-funds"
                        ? "/ Critical"
                        : "/ Finding"}
                    </span>
                  </p>
                  <small className="project-money-state">
                    {bountyFundingLabel(terms)}
                  </small>
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
  const featuredProjects = homeProjects();
  const listedCommunityProjects = communityProjects();
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
      <SecurityBounties />
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
        <p>
          A paused project is not collected or scored. Its steward,{" "}
          <ExternalLinkAnchor href={project.steward.github.profileUrl}>
            {project.steward.displayName}
          </ExternalLinkAnchor>
          , can review its status and next steps on the project setup page.
          Check back here for a change.{" "}
          <Link href={`/projects/${project.slug}/manage`}>
            Project owner: review setup
          </Link>
        </p>
      </section>
    );
  }
  // Clearance gates contribution; missing score or funding history does not.
  return <ProjectInstallPanel key={project.id} project={project} />;
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
    <div id="start">
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
  const directMonths = [...direct].sort(([left], [right]) =>
    right.localeCompare(left),
  );
  const historyLimited = directMonths.length > 3 || cycles.length > 3;
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
      {(showHistory ? directMonths : directMonths.slice(0, 3)).map(
        ([month, { amount, count, paidOn }]) => (
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
        ),
      )}
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
                  <td>{cycleLifecycleLabel(cycle)}</td>
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
          {showHistory
            ? "Show recent history"
            : `Show complete ${externalPrize ? "cycle" : "payment"} history`}
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
      {project.reward.kind === "external-prize-share" ? (
        <p>The organizer pays this prize.</p>
      ) : project.escrow ? (
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
function ProjectRewardSummary({ project }: { project: ProjectDefinition }) {
  return (
    <div className="project-overview">
      <div className="project-state-summary">
        {projectRewardSummaries(project).map((summary) => (
          <p className="project-reward-status" key={summary.kind}>
            {summary.kind === "monthly-pool" ? (
              <>
                {summary.amount}
                {summary.token ? (
                  <>
                    {" "}
                    <ExternalLinkAnchor href={summary.token.url}>
                      ${summary.token.symbol}
                    </ExternalLinkAnchor>
                  </>
                ) : null}
                {" monthly, split between contributors"}
              </>
            ) : summary.kind === "security-bounty" ? (
              <>
                {summary.amount}{" "}
                {summary.eligibility === "critical-loss-of-funds"
                  ? "per critical vulnerability that would result in loss of funds"
                  : "per accepted security finding"}
                {summary.status === "open"
                  ? null
                  : ` · bounty ${summary.status}`}
                {project.securityBounty
                  ? ` · ${bountyFundingLabel(project.securityBounty)}`
                  : ""}
              </>
            ) : summary.kind === "external-prize" ? (
              <>
                {summary.amount
                  ? `${compactPrizeLabel(summary.amount)} external prize pool`
                  : "External prize"}{" "}
                · organizer decides awards
              </>
            ) : (
              "Points only · no cash rewards"
            )}
          </p>
        ))}
      </div>
    </div>
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
        <Link
          className="button primary-button"
          href={`/projects/${project.slug}/security`}
        >
          Report privately
        </Link>
        <div id="start">
          <div className="install-heading">
            <h2>Copy this into your agent.</h2>
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
          {project.reward.reviewBudget ? (
            <p>{reviewBudgetLabel(project.reward.reviewBudget)}</p>
          ) : null}
          <ProjectParticipation project={project} />
        </div>
      </section>
      <div className="shell">
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
  const project =
    route.kind === "project" ? findProject(route.projectId) : undefined;
  const needsSnapshot =
    !blocked && snapshot && !(project && hasBountyOverview(project));
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
        <p>This project isn&apos;t listed.</p>
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
      {/* Routes render their own main landmark inside this layout container. */}
      <div className="app-content" id="main">
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
