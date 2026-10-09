import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Coins,
  ExternalLink,
  FolderGit2,
  GitPullRequest,
  Plus,
  RotateCcw,
  ShieldCheck,
  Terminal,
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
import {
  type FundingDataState,
  formatFundingAmount,
  formatFundingMinor,
  fundingTransactionExplorer,
  useFundingIndex,
} from "./FundingRecords";
import { Link, useInitialHashScroll } from "./Link";
import { SlopMark, Wordmark } from "./Logo";
import {
  allocationFundingMinor,
  type PromotionCycle,
  projectPromotionEligible,
} from "./lib/allocation-funding";
import { browserDeployment } from "./lib/browser-deployment";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "./lib/contact";
import { copyText } from "./lib/copy-text";
import { currentProjectFundingRecords } from "./lib/funding";
import { commitmentVerifiedNetMinor } from "./lib/funding-commitment";
import { homeProjects } from "./lib/home-projects";
import { createInstallCommand } from "./lib/install-command";
import {
  type ModelOutcomeSummary,
  modelIdentityKey,
  summarizeModelOutcomes,
} from "./lib/model-outcomes";
import {
  findProject,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";
import {
  type PublicSignerReport,
  publicSignerStatus,
} from "./lib/signer-capability";
import { SOURCE_REPOSITORY } from "./lib/source-repository";
import { useCycleIndex } from "./lib/use-cycle-index";
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
  DataNotice,
  EmptyState,
  ExternalLinkAnchor,
  formatDate,
  formatMicroUsdc,
  monthlyPoolLabel,
  monthlyPoolUnfunded,
  NotFound,
  reviewBudgetLabel,
  UNFUNDED_POOL_HEADLINE,
} from "./Presentation";
import { ProfilePage } from "./ProfilePage";
import { ProjectLeaderboard } from "./ProjectLeaderboard";
import { SettlementVerification } from "./SettlementVerification";

export { DonorFundingProfile } from "./FundingRecords";

export {
  rootPublishedTemplateProject,
  safeProposalHttpsUrl,
} from "./lib/project-proposal";
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

export { readBoundedJson } from "./lib/browser-json";

const ProjectProposalPage = lazy(() => import("./ProjectProposalPage"));
const ProjectUpdatePage = lazy(() =>
  import("./ProjectProposalPage").then((module) => ({
    default: module.ProjectUpdatePage,
  })),
);

const FundingReview = lazy(() =>
  import("./FundingReview").then((module) => ({
    default: module.FundingReview,
  })),
);

const SOCIAL_X = "https://x.com/SlopCash";
const SOCIAL_LINKEDIN = "https://www.linkedin.com/company/slop-cash";
const SOCIAL_TELEGRAM = "https://t.me/slopcashofficial";

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
    | "cycle-archive"
    | "unknown"
    | "account"
    | "points"
    | "login"
    | "earnings";
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

/** Legacy pages now live as sections of their canonical routes. */
const LEGACY_SECTIONS = new Map([
  ["wallet", "/account#wallets"],
  ["verification", "/how-it-works#verification"],
]);

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
          <span>Product</span>
          <Link href="/#projects">Projects</Link>
          <Link href="/#leaderboard">Leaderboard</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/how-it-works#faq">FAQ</Link>
          <Link href="/models">Models</Link>
          <Link href="/sponsors">Sponsors</Link>
          <Link href="/projects/new">Add a project</Link>
        </nav>
        <nav className="footer-links footer-records" aria-label="Records">
          <span>Records</span>
          <Link href="/receipts">Run receipts</Link>
          <Link href="/cycles">Cycle archive</Link>
          <Link href="/how-it-works#verification">Verification</Link>
        </nav>
        <nav className="footer-links" aria-label="Community">
          <span>Community</span>
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
        <div className="footer-meta">
          <p className="footer-copyright">
            © {new Date().getUTCFullYear()} slop.cash.
          </p>
          <p>GitHub is the record.</p>
        </div>
      </div>
    </footer>
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

function ProjectCard({
  project,
  funding,
}: {
  project: ProjectDefinition;
  funding: FundingDataState;
}) {
  const vaults =
    project.funding.commitments?.filter(
      (instrument) =>
        instrument.kind === "squads-v4-vault" && instrument.replacedAt === null,
    ) ?? [];
  const vaultRecords =
    funding.status === "ready"
      ? funding.index.commitments.filter(
          (record) =>
            record.projectId === project.id &&
            "vault" in record.instrument &&
            vaults.some(
              (vault) =>
                vault.kind === "squads-v4-vault" &&
                "vault" in record.instrument &&
                vault.vault === record.instrument.vault,
            ),
        )
      : [];
  const vaultBalance =
    vaults.length === 0
      ? "Unavailable"
      : funding.status === "loading"
        ? "Loading…"
        : funding.status === "error" ||
            !vaultRecords.some((record) => record.state === "verified-on-chain")
          ? "Unavailable"
          : formatMicroUsdc(
              commitmentVerifiedNetMinor(vaultRecords).toString(),
            );
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
          {project.reward.kind === "monthly-pool" ? (
            <span>/mo target</span>
          ) : null}
        </p>
        <small className="project-money-state">
          {project.reward.kind === "monthly-pool"
            ? `Vault: ${vaultBalance}`
            : "External prize"}
        </small>
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
  const amount =
    project.reward.kind === "monthly-pool"
      ? `${monthlyPoolCapLabel(project.reward)}/mo target`
      : (project.reward.externalOpportunity?.advertisedAmountDisplay ??
        "External prize");
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
  const [funding] = useFundingIndex();
  const promotedProjects = homeProjects();
  const featuredProjects = promotedProjects.filter(
    (project) => project.listingTier === "featured",
  );
  const communityProjects = promotedProjects.filter(
    (project) => project.listingTier === "community",
  );
  return (
    <main>
      <section className="hero shell">
        <h1 className="hero-message">
          <span>MAKE MONEY</span>{" "}
          <span className="hero-action">SHIPPING OPEN SOURCE.</span>
        </h1>
        <p className="hero-copy">Paste this into your coding agent.</p>
        <AgentPromptBox openIn prompt={bootstrapAgentPrompt()} />
      </section>

      <section className="section shell home-projects-section" id="projects">
        <div className="home-section-heading">
          <h2 className="home-section-title">Projects</h2>
          <Link className="button primary-button" href="/projects/new">
            <Plus aria-hidden="true" /> Add a project
          </Link>
        </div>
        <section className="project-tier" aria-labelledby="featured-projects">
          <h3 id="featured-projects">Featured</h3>
          <div className="project-grid">
            {featuredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                funding={funding}
              />
            ))}
          </div>
        </section>
        <CommunityProjects projects={communityProjects} />
      </section>
      <section className="how-section" id="how-it-works">
        <div className="shell">
          <div className="home-section-heading">
            <h2 className="home-section-title">How it works</h2>
            <Link className="button secondary-button" href="/how-it-works">
              Scores and rewards <ArrowRight aria-hidden="true" />
            </Link>
          </div>
          <div className="how-tracks">
            <article>
              <h3>Contributors</h3>
              <ol className="how-steps">
                <li>
                  <Terminal aria-hidden="true" />
                  <span>
                    <strong>Paste the skill.</strong> Your agent reads the
                    project terms and picks unblocked work on GitHub.
                  </span>
                </li>
                <li>
                  <GitPullRequest aria-hidden="true" />
                  <span>
                    <strong>Ship a PR.</strong> The skill tests the change and
                    prepares the evidence.
                  </span>
                </li>
                <li>
                  <BadgeCheck aria-hidden="true" />
                  <span>
                    <strong>Get merged.</strong> Accepted work raises your Slop
                    Score. Owners approve rewards.
                  </span>
                </li>
              </ol>
            </article>
            <article>
              <h3>Maintainers</h3>
              <ol className="how-steps">
                <li>
                  <FolderGit2 aria-hidden="true" />
                  <span>
                    <strong>Add your repo.</strong> Draft the manifest and the
                    agent brief, then open the PR on GitHub.
                  </span>
                </li>
                <li>
                  <Coins aria-hidden="true" />
                  <span>
                    <strong>Set a monthly pool.</strong> Fund it through a
                    reviewed third-party instrument.
                  </span>
                </li>
                <li>
                  <ShieldCheck aria-hidden="true" />
                  <span>
                    <strong>Review on GitHub.</strong> You merge the work. You
                    approve each payout.
                  </span>
                </li>
              </ol>
            </article>
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

const AGENT_DEEP_LINKS = [
  { name: "Cursor", href: "https://cursor.com/link/prompt?text=" },
  { name: "ChatGPT", href: "https://chatgpt.com/?q=" },
  { name: "Claude", href: "https://claude.ai/new?q=" },
] as const;

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
  return (
    <div className="agent-prompt">
      {box}
      <p className="agent-open-in">
        <span>Open in</span>
        {AGENT_DEEP_LINKS.map((agent) => (
          <ExternalLinkAnchor
            href={`${agent.href}${encodeURIComponent(prompt)}`}
            key={agent.name}
            onClick={() => void copyText(prompt).catch(() => undefined)}
          >
            {agent.name}
          </ExternalLinkAnchor>
        ))}
        <span>or any desktop agent</span>
      </p>
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
        <p>Activation requires a reviewed manifest change on GitHub.</p>
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

/** Dollars are simulated only against committed funds; otherwise a share. */

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
  const externalPrize = project.reward.kind === "external-prize-share";
  return (
    <section className="section payment-history">
      <div className="simple-heading">
        <h2>{externalPrize ? "Cycle history" : "Payment history"}</h2>
        {externalPrize ? null : (
          <Link href={`/projects/${project.slug}/funding#payouts`}>
            Manage payouts
          </Link>
        )}
        <Link href={`/projects/${project.slug}/manage`}>
          Draft a project update
        </Link>
      </div>
      {externalPrize ? null : (
        <p className="money-summary">
          <strong>{formatMicroUsdc(paid.toString())} paid</strong>
          <span>{formatMicroUsdc(approved.toString())} approved</span>
          <span>{formatMicroUsdc(fees.toString())} in 1% payout fees</span>
        </p>
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
  if (project.escrow) return <EscrowFunding project={project} />;
  const now = Date.now();
  const activeRoutes = project.funding.addresses.filter(
    (route) =>
      Date.parse(route.effectiveAt) <= now &&
      (route.replacedAt === null || now < Date.parse(route.replacedAt)),
  );
  if (activeRoutes.length === 0) {
    return project.reward.kind === "external-prize-share" ? null : (
      <p className="project-funding-unavailable">
        Direct funding unavailable. No reviewed receiving address is published.
      </p>
    );
  }
  return (
    <section className="section project-funding">
      <details>
        <summary>Fund this project</summary>
        <p>
          Funding: {project.reward.fundingState} · Committed:{" "}
          {formatMicroUsdc(project.reward.committedMinor)} · Payments:{" "}
          {project.reward.paymentMode}
        </p>
        <p>{project.funding.disclosure}</p>
        <p>
          Check the network, asset, and full address in your wallet before
          sending. Transfers are irreversible. GitHub identity does not prove
          wallet ownership.
        </p>
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
                    : state === "creator-and-independent-current"
                      ? "Creator and independent signer reported capability"
                      : state === "recipient-current"
                        ? "Stream recipient reported capability"
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

type FundingView = "records" | "payouts";
const FUNDING_VIEWS: { id: FundingView; label: string }[] = [
  { id: "records", label: "Funding records" },
  { id: "payouts", label: "Manage payouts" },
];
const FUNDING_RECORD_GROUPS = [
  { state: "verified-on-chain", title: "Verified on-chain" },
  { state: "self-reported", title: "Self-reported" },
  { state: "disputed", title: "Disputed" },
] as const;

function fundingViewFromHash(): FundingView {
  return window.location.hash === "#payouts" ? "payouts" : "records";
}

function fundingStateLabel(project: ProjectDefinition): string {
  if (project.reward.kind === "external-prize-share")
    return "External prize, not held by Slop";
  return project.reward.fundingState === "committed"
    ? "Committed"
    : "Pledged, not committed";
}

function ProjectFundingPage({
  project,
  state,
}: {
  project: ProjectDefinition;
  state: DataState;
}) {
  const [funding, retryFunding] = useFundingIndex();
  const [view, setView] = useState<FundingView>(fundingViewFromHash);
  const [payoutsOpened, setPayoutsOpened] = useState(() => view === "payouts");
  useEffect(() => {
    const sync = () => {
      const next = fundingViewFromHash();
      setView(next);
      if (next === "payouts") setPayoutsOpened(true);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const select = (next: FundingView) => {
    setView(next);
    if (next === "payouts") setPayoutsOpened(true);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${next === "payouts" ? "#payouts" : ""}`,
    );
  };
  const records =
    funding.status === "ready"
      ? currentProjectFundingRecords(
          funding.index.records.filter(
            (record) => record.projectId === project.id,
          ),
        )
      : [];
  const now = Date.now();
  const activeAddresses = project.funding.addresses.filter(
    (route) =>
      Date.parse(route.effectiveAt) <= now &&
      (route.replacedAt === null || now < Date.parse(route.replacedAt)),
  );
  const projectVaults = (project.funding.commitments ?? []).filter(
    (instrument) =>
      instrument.kind === "squads-project-vault" &&
      instrument.replacedAt === null,
  );
  const signerReports =
    funding.status === "ready"
      ? (funding.index.signerReports ?? []).filter(
          (report) => report.projectId === project.id,
        )
      : [];
  return (
    <main className="shell route-main funding-page">
      <p className="breadcrumb">
        <Link href={`/projects/${project.slug}`}>{project.name}</Link>
        <span>/</span>Funding
      </p>
      <h1>{project.name} funding</h1>
      <div aria-label="Funding views" className="funding-tabs" role="tablist">
        {FUNDING_VIEWS.map((option, index) => (
          <button
            aria-controls={`funding-panel-${option.id}`}
            aria-selected={view === option.id}
            id={`funding-tab-${option.id}`}
            key={option.id}
            onClick={() => select(option.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight" || event.key === "ArrowLeft"
                  ? FUNDING_VIEWS[(index + 1) % FUNDING_VIEWS.length]
                  : event.key === "Home"
                    ? FUNDING_VIEWS[0]
                    : event.key === "End"
                      ? FUNDING_VIEWS[FUNDING_VIEWS.length - 1]
                      : null;
              if (!next) return;
              event.preventDefault();
              select(next.id);
              document.getElementById(`funding-tab-${next.id}`)?.focus();
            }}
            role="tab"
            tabIndex={view === option.id ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <section
        hidden={view !== "records"}
        aria-labelledby="funding-tab-records"
        className="funding-records"
        id="funding-panel-records"
        role="tabpanel"
      >
        <dl className="funding-status-grid">
          <div>
            <dt>
              {project.reward.kind === "monthly-pool"
                ? "Monthly target"
                : "Advertised prize"}
            </dt>
            <dd>
              {project.reward.kind === "monthly-pool"
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
              {project.escrow?.deployments.length || projectVaults.length
                ? "Reviewed deployment published"
                : "Not deployed"}
            </dd>
          </div>
          <div>
            <dt>Direct addresses</dt>
            <dd>
              {activeAddresses.length === 0
                ? "None published"
                : `${activeAddresses.length} published`}
            </dd>
          </div>
        </dl>
        <p>{project.funding.disclosure}</p>
        {funding.status === "loading" ? (
          <div className="data-notice" role="status">
            <span className="pulse" /> Reading funding records…
          </div>
        ) : funding.status === "error" ? (
          <div className="data-notice data-error" role="alert">
            <CircleAlert aria-hidden="true" size={18} />
            <span>Funding records unavailable: {funding.message}</span>
            <button onClick={retryFunding} type="button">
              <RotateCcw aria-hidden="true" size={15} /> Retry
            </button>
          </div>
        ) : records.length === 0 ? (
          <EmptyState text="No reviewed public funding transactions have been published yet." />
        ) : (
          FUNDING_RECORD_GROUPS.map((group) => {
            const groupRecords = records.filter(
              (record) => record.state === group.state,
            );
            if (groupRecords.length === 0 && group.state === "disputed")
              return null;
            const assets = [
              ...new Set(groupRecords.map((record) => record.asset)),
            ];
            return (
              <section
                aria-labelledby={`funding-${group.state}`}
                className="funding-record-group"
                key={group.state}
              >
                <h2 id={`funding-${group.state}`}>{group.title}</h2>
                {groupRecords.length === 0 ? (
                  <p>No records.</p>
                ) : (
                  <>
                    <p className="money-summary">
                      {assets.map((asset) => (
                        <strong key={asset}>
                          {formatFundingAmount(
                            asset,
                            groupRecords
                              .filter((record) => record.asset === asset)
                              .reduce(
                                (sum, record) =>
                                  sum + BigInt(record.amountMinor),
                                0n,
                              )
                              .toString(),
                          )}
                        </strong>
                      ))}
                    </p>
                    <div className="plain-table-wrap">
                      <table className="plain-table">
                        <caption className="visually-hidden">
                          {project.name} {group.title.toLowerCase()} funding
                          transactions
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Transaction</th>
                            <th scope="col">Amount</th>
                            <th scope="col">Attribution</th>
                            <th scope="col">Network</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupRecords.map((record) => (
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
                              <td>{record.network}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            );
          })
        )}
        {signerReports.length > 0 ? (
          <SignerReports reports={signerReports} />
        ) : null}
        <p className="funding-records-note">
          A GitHub login or a submitted transaction ID does not prove wallet
          ownership or payment. A balance does not prove signer capability.
          Monthly payout states are in the{" "}
          <Link href="/cycles">cycle archive</Link>.
        </p>
      </section>
      <section
        hidden={view !== "payouts"}
        aria-labelledby="funding-tab-payouts"
        id="funding-panel-payouts"
        role="tabpanel"
      >
        {payoutsOpened ? (
          <Suspense fallback={<p role="status">Loading funding review…</p>}>
            <FundingReview
              key={project.id}
              project={project}
              sourceRepositoryUrl={SOURCE_REPOSITORY}
              cycleIndex={state.status === "ready" ? state.cycleIndex : null}
              funding={funding.status === "ready" ? funding.index : null}
            />
          </Suspense>
        ) : null}
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
                {project.status === "paused" ? (
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
              <p className="hero-copy">{project.description}</p>
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
              {project.terms.externalPrize ? (
                <p className="project-policy-warning">
                  Organizer rules decide eligibility, amount, and payment.
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
            ) : promotionEligible ? (
              <aside className="reward-card">
                <strong
                  className={
                    project.reward.kind === "monthly-pool" &&
                    !monthlyPoolUnfunded(project.reward)
                      ? "reward-amount-monthly"
                      : undefined
                  }
                >
                  {project.reward.kind === "monthly-pool"
                    ? monthlyPoolUnfunded(project.reward)
                      ? UNFUNDED_POOL_HEADLINE
                      : `${monthlyPoolCapLabel(project.reward)} / mo`
                    : project.reward.externalOpportunity
                        ?.advertisedAmountDisplay}
                </strong>
                <p>
                  {project.reward.kind === "monthly-pool"
                    ? monthlyPoolUnfunded(project.reward)
                      ? `Target ${project.reward.monthlyCapDisplay} per month. No payments scheduled.`
                      : `${formatMicroUsdc(project.reward.committedMinor)} committed against a ${project.reward.monthlyCapDisplay} monthly target. Accessibility is unknown; no payment is enabled.`
                    : project.terms.externalPrize?.allocationAuthority}
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
        <ProjectPaymentHistory project={project} state={state} />
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
              <strong>1. Propose a project</strong>
              <p>
                <Link href="/projects/new">Add a project</Link> through a
                reviewed manifest PR. New projects start paused.
              </p>
            </li>
            <li>
              <strong>2. Fund the pool</strong>
              <p>
                A cap is a target. Only a verified commitment funds awards.{" "}
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
                Follow the approved signing policy. Approval alone does not
                prove payment.
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
              reproduction 3, specialist review 8. Self-review, post-merge
              review, duplicate review, and bot activity do not score. A valid
              signed receipt with a finalized private trace adds a fixed 15%
              weight.
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
        <p>
          Each stage needs its own evidence. A person or a verifier must act
          before the next stage; nothing moves forward automatically.
        </p>
        <ol className="payment-stages" aria-label="Payment stages">
          <li>
            <strong>Projected</strong>
            <span>
              A live estimate from accepted score at the published cap. Not a
              balance, wage, or guarantee.
            </span>
          </li>
          <li>
            <small className="payment-gate">Monthly freeze</small>
            <strong>Under review</strong>
            <span>A frozen monthly proposal in its 14-day public window.</span>
          </li>
          <li>
            <small className="payment-gate">Creator approval</small>
            <strong>Approved</strong>
            <span>Immutable payout intents after the creator signs off.</span>
          </li>
          <li>
            <small className="payment-gate">Unsigned plan</small>
            <strong>Scheduled</strong>
            <span>An unsigned transfer plan exists. No money has moved.</span>
          </li>
          <li>
            <small className="payment-gate">Finalized evidence</small>
            <strong>Paid</strong>
            <span>
              Finalized on-chain evidence reconciles the exact transfers and
              fee.
            </span>
          </li>
        </ol>
        <section
          className="payment-branches"
          aria-labelledby="payment-branches-title"
        >
          <h3 className="payment-branches-title" id="payment-branches-title">
            Unresolved outcomes: not steps toward payment
          </h3>
          <dl>
            <div>
              <dt>Held</dt>
              <dd>A decision or requirement remains unresolved.</dd>
            </div>
            <div>
              <dt>Unclaimed</dt>
              <dd>A required wallet is missing. The row carries forward.</dd>
            </div>
            <div>
              <dt>Excluded</dt>
              <dd>The row keeps its public reason and is not paid.</dd>
            </div>
          </dl>
        </section>
        <details>
          <summary>Funding and cycle rules</summary>
          <p>
            A cap is a target, not a balance. A pool is unfunded until a
            verified on-chain commitment backs it, allocation never exceeds the
            committed amount, and unused funds roll over without raising the
            cap. A project may add an optional review budget as a second cash
            line that pays on top of the unchanged shared pool, and only after
            its own funding is committed.
          </p>
          <p>
            For monthly v1 cycles, the first-of-month workflow freezes a
            proposal for 14 days of public review. Wallet changes restart
            review. Awards below $2 accrue to the next cycle. Historical records
            keep their recorded fee and authority rules.
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
            collected yet, and pull requests anywhere else, including the Slop
            repository itself, are not in any pool.
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
          <p>Yes. A review counts as a standard review, 1 point, when:</p>
          <ul>
            <li>
              It is submitted as Approve or Request changes. A plain Comment
              review does not score.
            </li>
            <li>It is on someone else&apos;s pull request.</li>
            <li>
              It has at least 20 characters of written reasoning or an inline
              comment.
            </li>
            <li>
              It is submitted before the pull request merges, and the pull
              request does merge.
            </li>
          </ul>
          <p>
            One review scores per person per pull request, and reviews by or of
            bot accounts do not score. If you left a Comment review, you can
            submit a new Approve or Request changes review while the pull
            request is still open.
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
          <summary>Why does my merge show only 1/3 of a point?</summary>
          <p>
            Every merge starts as a provisional micro unit. A review agent may
            propose a higher tier from the table above, and the score moves up
            only when a maintainer ratifies that tier on the exact merged
            commit. Related or split pull requests share one work unit.
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
            Register a public Base or Solana address in{" "}
            <Link href="/account#wallets">Account wallets</Link> with your
            GitHub account. No wallet connection or signing is needed. Payments
            are USDC on the project's settlement network, Base or Solana, sent
            by the project creator, never by Slop. A wallet must be registered
            before a month freezes to apply to that month. Without one, your row
            stays unclaimed and carries forward.
          </p>
        </details>
        <details>
          <summary>When are payments sent?</summary>
          <p>
            At 00:11 UTC on the first of each month, the previous month freezes
            into a proposal. After 14 days of public review the creator approves
            it and sends USDC from their own wallet. Slop shows a payment as
            paid only after the transfers are confirmed on-chain. Amounts below
            $2 carry to the next month.
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
            the proposal is public for 14 days, and the creator may approve,
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
          </li>
          <li>
            <Link href="/sponsors">Sponsors</Link>
          </li>
          <li>
            <Link href="/projects/new">Add your project</Link>
          </li>
        </ul>
      </details>
      <details
        className="how-details"
        open={window.location.hash === "#verification"}
      >
        <summary>Verify a payment</summary>
        <SettlementVerification />
      </details>
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
  const now = Date.now();
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
      <section className="worked-example sponsor-fee">
        <div>
          <h2>Awards, fee and total.</h2>
          <p>
            Monthly pools add a separate 1% fee to approved awards. Contributors
            receive the full approved amount. Paid requires finalized evidence
            for both the awards and fee.
          </p>
          <p>
            External prize shares use the terms published for that project. The
            prize sponsor controls eligibility and payment.
          </p>
        </div>
        <dl
          className="equation-card"
          aria-label="Example: $5,000 in approved awards"
        >
          <div>
            <dt>Example approved awards</dt>
            <dd>$5,000</dd>
          </div>
          <div>
            <dt>Slop fee, sent separately</dt>
            <dd>$50</dd>
          </div>
          <div>
            <dt>Total to send</dt>
            <dd>$5,050</dd>
          </div>
        </dl>
      </section>
      <section className="worked-example sponsor-start">
        <div>
          <h2>Start with a pull request.</h2>
          <p>
            Add a project to prepare a GitHub proposal. New projects start
            paused. Existing stewards update receiving addresses and funding
            instruments through a reviewed manifest change.
          </p>
        </div>
        <ul>
          <li>
            <Link href="/projects/new">Add a project</Link>
          </li>
          <li>
            <ExternalLinkAnchor
              href={`${SOURCE_REPOSITORY}/tree/${browserDeployment.branch}/projects`}
            >
              Reviewed manifests
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
              Open an issue on GitHub
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
              A reviewed manifest change sets the monthly cap and the reward
              start. Until a verified on-chain commitment backs it, the pool
              shows as unfunded with a target, never as a balance. Contributors
              then use any agent to contribute. Accepted merges, eligible
              reviews, and separately reviewed awards follow the published
              scoring policy.
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
              Project owners review proposed awards within the cap and record
              changes with a public reason. Authorized signers execute the
              reviewed transfer plan outside Slop. Slop marks the cycle paid
              only when finalized on-chain evidence reconciles every approved
              intent and the fee.
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
              <li>
                Whether to add a named review budget as a second cash line.
              </li>
              <li>
                Authorized signers approve transfers under the instrument rules.
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
                Immutable payout intents after you sign off, with a public
                reason attached to every change you made.
              </dd>
            </div>
            <div>
              <dt>Scheduled</dt>
              <dd>An unsigned transfer plan exists. No money has moved.</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>
                Finalized on-chain evidence reconciles the exact transfers and
                the fee.
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
            registered after a proposal is generated applies to the next cycle
            and never touches the current one.
          </p>
        </section>
        <section className="custody-proof">
          <h2>Commit through an instrument you control.</h2>
          <ul>
            <li>
              A Squads v4 multisig vault on Solana, or a Sablier Lockup v4
              stream on Base or Ethereum. Both are reviewed, immutable,
              third-party programs. Slop holds no admin or fee position in
              either, and no key in a 2-of-2 vault or a stream. An opt-in 2-of-3
              project vault gives Slop one vote-only key that cannot propose,
              execute, redirect, or block a transfer.
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
        <p>
          Device signatures attest byte continuity. Model and usage declarations
          are self-reported; private traces stay private.
        </p>
        <DataNotice retry={retry} state={state} />
      </section>
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
      {state.status === "ready" ? (
        <p className="receipt-count" role="status">
          {matching.length} of {receipts.length} receipts
        </p>
      ) : null}
      {state.status === "ready" && matching.length === 0 ? (
        <EmptyState
          text={
            receipts.length === 0
              ? "No publishable signed receipts in this snapshot."
              : "No receipts match this search."
          }
        />
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
            more state that the exact model was unavailable and count toward no
            model
          </span>
        ) : null}
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

export function App() {
  const route = useRoute();
  return (
    <PointsProvider
      enabled={["home", "project", "profile", "points"].includes(route.kind)}
    >
      <AppContent route={route} />
    </PointsProvider>
  );
}

function AppContent({ route }: { route: Route }) {
  useInitialHashScroll();
  const needsSnapshot = ![
    "home",
    "points",
    "account",
    "login",
    "earnings",
    "how-it-works",
    "new-project",
    "manage-project",
    "wallet",
    "unknown",
    "verification",
    "cycle-archive",
  ].includes(route.kind);
  const [state, retry] = useSnapshot(needsSnapshot);
  const [archive, retryArchive] = useCycleIndex(route.kind === "cycle-archive");
  let content: ReactNode;
  if (route.kind === "home") content = <HomePage />;
  else if (route.kind === "points") content = <PointsPage />;
  else if (route.kind === "account") content = <AccountPage />;
  else if (route.kind === "login") content = <LoginPage />;
  else if (route.kind === "earnings") content = <EarningsPage />;
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
  else if (route.kind === "manage-project") {
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
      <Header />
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
