/**
 * Renders the GitHub-native open-work network across discovery, project,
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
  GitPullRequest,
  Menu,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  assertCycleIndex,
  type CycleIndex,
  type CycleIndexEntry,
} from "./lib/cycle-index";
import { createInstallCommand } from "./lib/install-command";
import {
  assertLeaderboardSnapshot,
  type GitHubActor,
  type LeaderboardSnapshot,
  type ScoreEvent,
  type WorkItem,
} from "./lib/leaderboard";
import {
  formatMonthlyCapDisplay,
  MAX_MONTHLY_CAP_MINOR,
} from "./lib/project-schema.mjs";
import {
  createProjectView,
  type ProjectContributor,
  type ProjectView,
} from "./lib/project-view";
import {
  findProject,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";
import { isSolanaAddress } from "./lib/wallets";

const SOURCE_REPOSITORY = "https://github.com/elizaOS/army";
const PROJECT_PROPOSAL_ROOT = `${SOURCE_REPOSITORY}/new/develop`;
const SNAPSHOT_TIMEOUT_MS = 12_000;
const SNAPSHOT_RETRIES = 1;
const MAX_LEADERBOARD_BYTES = 32 * 1024 * 1024;
const MAX_CYCLE_INDEX_BYTES = 8 * 1024 * 1024;
const HERO_LINES = [
  "MAKE MONEY BUILDING AGENTS.",
  "MAKE MONEY SOLVING MATH.",
  "MAKE MONEY PROVING OPEN SOURCE.",
] as const;

type DataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      snapshot: LeaderboardSnapshot;
      views: ProjectView[];
      cycleIndex: CycleIndex;
    };

async function readBoundedJson(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error(`${label} returned an invalid content length`);
    }
    if (parsedLength > maxBytes) {
      throw new Error(`${label} exceeded the ${maxBytes}-byte limit`);
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`${label} returned no readable body`);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let source = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteLength += chunk.value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeded the ${maxBytes}-byte limit`);
    }
    source += decoder.decode(chunk.value, { stream: true });
  }
  source += decoder.decode();

  try {
    return JSON.parse(source) as unknown;
  } catch (error: unknown) {
    // error-policy:J1 Invalid public JSON becomes an explicit unavailable state.
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}

interface Route {
  kind: "cycle" | "home" | "new-project" | "profile" | "project" | "unknown";
  projectId?: string;
  cycleId?: string;
  login?: string;
}

function internalRoute(pathname: string): Route {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) return { kind: "home" };
  if (segments[0] === "projects" && segments[1] === "new") {
    return { kind: "new-project" };
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

function Link({
  ariaLabel,
  children,
  className,
  href,
}: {
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <a
      aria-label={ariaLabel}
      className={className}
      href={href}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        window.history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.scrollTo({ top: 0, behavior: "auto" });
      }}
    >
      {children}
    </a>
  );
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

function useSnapshot(): [DataState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DataState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let retryTimer: number | null = null;
    setState({ status: "loading" });

    const load = async (retry: number): Promise<void> => {
      controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller?.abort(new Error("snapshot request timed out")),
        SNAPSHOT_TIMEOUT_MS,
      );
      try {
        const request = {
          cache: "no-store" as const,
          headers: { Accept: "application/json" },
          signal: controller.signal,
        };
        const [response, cycleResponse] = await Promise.all([
          fetch(
            `/data/leaderboard.json?attempt=${attempt}&retry=${retry}`,
            request,
          ),
          fetch(
            `/data/cycles/index.json?attempt=${attempt}&retry=${retry}`,
            request,
          ),
        ]);
        if (!response.ok)
          throw new Error(`snapshot returned ${response.status}`);
        if (!cycleResponse.ok) {
          throw new Error(`cycle index returned ${cycleResponse.status}`);
        }
        const [value, cycleValue]: [unknown, unknown] = await Promise.all([
          readBoundedJson(response, MAX_LEADERBOARD_BYTES, "snapshot"),
          readBoundedJson(cycleResponse, MAX_CYCLE_INDEX_BYTES, "cycle index"),
        ]);
        assertLeaderboardSnapshot(value);
        assertCycleIndex(cycleValue);
        const views = PROJECTS.map((project) =>
          createProjectView(value, project.id),
        );
        if (active) {
          setState({
            status: "ready",
            snapshot: value,
            views,
            cycleIndex: cycleValue,
          });
        }
      } catch (error: unknown) {
        if (!active) return;
        if (retry < SNAPSHOT_RETRIES) {
          retryTimer = window.setTimeout(() => void load(retry + 1), 400);
        } else {
          // error-policy:J1 The browser boundary renders invalid or unavailable public data explicitly.
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "snapshot could not be read",
          });
        }
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void load(0);
    return () => {
      active = false;
      controller?.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [attempt]);

  return [state, useCallback(() => setAttempt((value) => value + 1), [])];
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1_000 ? "compact" : "standard",
  }).format(value);
}

function formatMicroUsdc(value: string): string {
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = amount % 1_000_000n;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: fraction === 0n ? 0 : 2,
    style: "currency",
  }).format(Number(whole) + Number(fraction) / 1_000_000);
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

function stale(snapshot: LeaderboardSnapshot): boolean {
  return Date.now() - Date.parse(snapshot.generatedAt) > 8 * 60 * 60 * 1_000;
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link ariaLabel="Open Work home" className="wordmark" href="/">
          OPEN<span>/</span>WORK
        </Link>
        <button
          aria-expanded={open}
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="menu-button"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <nav className={open ? "nav-links nav-links-open" : "nav-links"}>
          <Link href="/#projects">Projects</Link>
          <Link href="/#leaderboard">Leaderboard</Link>
          <Link href="/projects/new">Add a project</Link>
          <ExternalLinkAnchor className="nav-source" href={SOURCE_REPOSITORY}>
            Source <ExternalLink aria-hidden="true" size={14} />
          </ExternalLinkAnchor>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div>
          <div className="wordmark footer-wordmark">
            OPEN<span>/</span>WORK
          </div>
          <p>Accepted work. Public evidence. Digital-dollar rewards.</p>
        </div>
        <div className="footer-links">
          <ExternalLinkAnchor href={SOURCE_REPOSITORY}>
            GitHub
          </ExternalLinkAnchor>
          <Link href="/projects/new">Add a project</Link>
          <ExternalLinkAnchor href={`${SOURCE_REPOSITORY}/issues/9`}>
            Protocol
          </ExternalLinkAnchor>
        </div>
        <p className="footer-fine">
          Projections are estimates, not wages or guarantees. Project owners
          approve rewards; public manifests and Solana settlement signatures are
          the record.
        </p>
      </div>
    </footer>
  );
}

function DataNotice({ state, retry }: { state: DataState; retry: () => void }) {
  if (state.status === "loading") {
    return (
      <div className="data-notice" role="status">
        <span className="pulse" /> Reading the public GitHub ledger…
      </div>
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
  return (
    <div
      className={
        stale(state.snapshot) ? "data-notice data-stale" : "data-notice"
      }
      role="status"
    >
      <span
        className={
          stale(state.snapshot) ? "status-dot stale-dot" : "status-dot"
        }
      />
      {stale(state.snapshot)
        ? "Snapshot stale"
        : "GitHub ledger + reward records live"}{" "}
      · updated {formatDate(state.snapshot.generatedAt)}
    </div>
  );
}

function RotatingHeroLine() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(
      () => setIndex((value) => (value + 1) % HERO_LINES.length),
      2_800,
    );
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="hero-switch" aria-live="polite">
      {HERO_LINES[index]}
    </span>
  );
}

function rewardLabel(project: ProjectDefinition): string {
  return project.reward.kind === "monthly-pool"
    ? `${project.reward.monthlyCapDisplay} / month`
    : `${project.reward.externalOpportunity?.advertisedAmountDisplay ?? "External"} opportunity`;
}

function ProjectCard({
  project,
  view,
}: {
  project: ProjectDefinition;
  view?: ProjectView;
}) {
  const contributors = view?.leaders.length ?? null;
  const score = view?.leaders.reduce(
    (total, leader) => total + leader.score,
    0,
  );
  return (
    <Link className="project-card" href={`/projects/${project.slug}`}>
      <div className="card-topline">
        <span className="project-index">0{PROJECTS.indexOf(project) + 1}</span>
        <span
          className={
            project.reward.kind === "monthly-pool"
              ? "funding-chip"
              : "funding-chip external-chip"
          }
        >
          {project.reward.kind === "monthly-pool"
            ? "PLEDGED"
            : "EXTERNAL PRIZE"}
        </span>
      </div>
      <p className="eyebrow">{project.eyebrow}</p>
      <h3>{project.headline}</h3>
      <p className="project-description">{project.description}</p>
      <div className="project-card-stats">
        <span>
          <strong>{rewardLabel(project)}</strong>
          <small>reward</small>
        </span>
        <span>
          <strong>{contributors === null ? "—" : contributors}</strong>
          <small>contributors</small>
        </span>
        <span>
          <strong>{score === undefined ? "—" : score}</strong>
          <small>cycle score</small>
        </span>
      </div>
      <span className="card-action">
        View project <ArrowRight aria-hidden="true" size={18} />
      </span>
    </Link>
  );
}

interface GlobalLeader {
  actor: GitHubActor;
  score: number;
  tokens: number;
  projectedMinor: bigint;
  paidMinor: bigint;
  projects: number;
  cycles: number;
}

function globalLeaders(
  views: readonly ProjectView[],
  cycleIndex: CycleIndex,
): GlobalLeader[] {
  type MutableGlobalLeader = Omit<GlobalLeader, "cycles" | "projects"> & {
    cycleKeys: Set<string>;
    projectIds: Set<string>;
  };
  const byActor = new Map<string, MutableGlobalLeader>();
  for (const view of views) {
    for (const leader of view.leaders) {
      const current = byActor.get(leader.actor.id) ?? {
        actor: leader.actor,
        score: 0,
        tokens: 0,
        projectedMinor: 0n,
        paidMinor: 0n,
        cycleKeys: new Set<string>(),
        projectIds: new Set<string>(),
      };
      current.score += leader.score;
      current.tokens += leader.usage.relevantTokens;
      current.projectedMinor += BigInt(leader.projectedMinor ?? "0");
      current.cycleKeys.add(`${view.project.id}\0${view.cycle.id}`);
      current.projectIds.add(view.project.id);
      byActor.set(leader.actor.id, current);
    }
  }
  for (const cycle of cycleIndex.cycles) {
    for (const contributor of cycle.contributors) {
      const current = byActor.get(contributor.actor.id) ?? {
        actor: {
          ...contributor.actor,
          avatarUrl: `https://github.com/${encodeURIComponent(contributor.actor.login)}.png?size=96`,
          url: `https://github.com/${encodeURIComponent(contributor.actor.login)}`,
          kind: "User" as const,
        },
        score: 0,
        tokens: 0,
        projectedMinor: 0n,
        paidMinor: 0n,
        cycleKeys: new Set<string>(),
        projectIds: new Set<string>(),
      };
      const cycleKey = `${cycle.projectId}\0${cycle.cycleId}`;
      if (!current.cycleKeys.has(cycleKey)) {
        current.score += contributor.score;
        current.cycleKeys.add(cycleKey);
        current.projectIds.add(cycle.projectId);
      }
      current.paidMinor += BigInt(contributor.paidMinor);
      byActor.set(contributor.actor.id, current);
    }
  }
  return [...byActor.values()]
    .map<GlobalLeader>((leader) => ({
      actor: leader.actor,
      score: leader.score,
      tokens: leader.tokens,
      projectedMinor: leader.projectedMinor,
      paidMinor: leader.paidMinor,
      projects: leader.projectIds.size,
      cycles: leader.cycleKeys.size,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.actor.login
          .toLowerCase()
          .localeCompare(right.actor.login.toLowerCase()),
    );
}

function Avatar({
  actor,
  size = "medium",
}: {
  actor: GitHubActor;
  size?: "large" | "medium" | "small";
}) {
  return (
    <img
      alt=""
      className={`avatar avatar-${size}`}
      height={size === "large" ? 80 : size === "small" ? 30 : 42}
      loading="lazy"
      src={actor.avatarUrl}
      width={size === "large" ? 80 : size === "small" ? 30 : 42}
    />
  );
}

function GlobalLeaderboard({
  cycleIndex,
  views,
}: {
  cycleIndex: CycleIndex;
  views: readonly ProjectView[];
}) {
  const leaders = globalLeaders(views, cycleIndex);
  return (
    <section className="section shell" id="leaderboard">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Across every project</p>
          <h2>People shipping work.</h2>
        </div>
        <p>
          Ranked by accepted outcome score. Tokens are public supporting
          evidence.
        </p>
      </div>
      {leaders.length === 0 ? (
        <EmptyState text="No accepted outcomes in the active cycles yet." />
      ) : (
        <div className="leader-table">
          <table className="leader-grid">
            <caption className="visually-hidden">
              Global contributor leaderboard
            </caption>
            <thead>
              <tr className="leader-row leader-head">
                <th scope="col">Rank</th>
                <th scope="col">Contributor</th>
                <th scope="col">Score</th>
                <th scope="col">Tokens</th>
                <th scope="col">Projected</th>
                <th scope="col">Total paid</th>
              </tr>
            </thead>
            <tbody>
              {leaders.slice(0, 20).map((leader, index) => (
                <tr className="leader-row" key={leader.actor.id}>
                  <td className="rank-cell">#{index + 1}</td>
                  <td className="person-cell">
                    <Link
                      className="person-link"
                      href={`/contributors/${encodeURIComponent(leader.actor.login)}`}
                    >
                      <Avatar actor={leader.actor} />
                      <span>
                        <strong>{leader.actor.login}</strong>
                        <small>
                          {leader.projects} project
                          {leader.projects === 1 ? "" : "s"} · {leader.cycles}{" "}
                          scored cycle{leader.cycles === 1 ? "" : "s"}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <strong>{leader.score}</strong>
                  </td>
                  <td>{formatCompact(leader.tokens)}</td>
                  <td>
                    <strong>
                      {formatMicroUsdc(leader.projectedMinor.toString())}
                    </strong>
                  </td>
                  <td>
                    <strong>
                      {formatMicroUsdc(leader.paidMinor.toString())}
                    </strong>
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

function HowItWorks() {
  const steps = [
    [
      "01",
      "Pick a project",
      "See the money, goal, repositories, active work, and exact rules before you start.",
    ],
    [
      "02",
      "Run one command",
      "Install the project skill. It selects the frontier model and starts bounded usage capture.",
    ],
    [
      "03",
      "Ship proof",
      "Open a PR, add real tests and evidence, and publish the signed run receipt GitHub can index.",
    ],
    [
      "04",
      "Get reviewed",
      "Automated checks propose credit. Maintainers review, adjust with reasons, then settle publicly.",
    ],
  ] as const;
  return (
    <section className="how-section">
      <div className="shell">
        <div className="section-heading light-heading">
          <div>
            <p className="eyebrow">The complete loop</p>
            <h2>Work in. Money out.</h2>
          </div>
          <p>
            No new work tracker. No opaque claim system. GitHub is the operating
            surface.
          </p>
        </div>
        <div className="step-grid">
          {steps.map(([number, title, body]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HomePage({ state, retry }: { state: DataState; retry: () => void }) {
  const views = state.status === "ready" ? state.views : [];
  return (
    <main>
      <section className="hero shell">
        <DataNotice state={state} retry={retry} />
        <p className="eyebrow hero-eyebrow">THE OPEN WORK NETWORK</p>
        <h1>
          <RotatingHeroLine />
        </h1>
        <p className="hero-copy">
          Give the best agents a hard problem. Ship accepted work on GitHub.
          Build a public reputation and earn from clearly labeled project pools.
        </p>
        <div className="hero-actions">
          <a className="button primary-button" href="#projects">
            Find work <ArrowRight aria-hidden="true" />
          </a>
          <Link className="button text-button" href="/projects/new">
            Fund a project
          </Link>
        </div>
        <div className="hero-proof">
          <span>
            <ShieldCheck aria-hidden="true" /> Device-signed usage
          </span>
          <span>
            <GitPullRequest aria-hidden="true" /> GitHub-native proof
          </span>
          <span>
            <Check aria-hidden="true" /> Public payout records
          </span>
        </div>
      </section>

      <section className="section shell" id="projects">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Open projects</p>
            <h2>Choose something real.</h2>
          </div>
          <p>
            Funded work sorts first. Pledges and external opportunities stay
            visibly labeled.
          </p>
        </div>
        <div className="project-grid">
          {PROJECTS.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              view={views.find((view) => view.project.id === project.id)}
            />
          ))}
        </div>
      </section>
      <HowItWorks />
      {state.status === "ready" ? (
        <GlobalLeaderboard cycleIndex={state.cycleIndex} views={views} />
      ) : null}
      <section className="creator-cta">
        <div className="shell creator-cta-inner">
          <div>
            <p className="eyebrow">Have an open problem?</p>
            <h2>Put money behind the work.</h2>
          </div>
          <div>
            <p>
              Define a public repository, project skill, evaluation policy, and
              monthly cap. Submit one reviewable proposal through GitHub.
            </p>
            <Link className="button inverse-button" href="/projects/new">
              Add a project <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function projectInstallCommand(project: ProjectDefinition): string {
  const origin = `${window.location.origin.replace(/\/$/u, "")}/projects/${project.slug}`;
  return createInstallCommand(
    origin,
    `\${CODEX_HOME:-\${HOME}/.codex}/skills`,
    {
      skillName: project.skill.id,
      skillRepositoryPath: project.skill.sourcePath,
    },
  );
}

function InstallPanel({ project }: { project: ProjectDefinition }) {
  const [mode, setMode] = useState<"codex" | "prompt">("codex");
  const [copy, setCopy] = useState<"copied" | "error" | "idle">("idle");
  const command =
    mode === "codex"
      ? projectInstallCommand(project)
      : `Read ${window.location.origin}/projects/${project.slug}/mission.md and follow it exactly.`;
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopy("copied");
    } catch {
      // error-policy:J4 Clipboard denial remains visibly distinct and selectable text stays available.
      setCopy("error");
    }
  };
  useEffect(() => {
    if (copy !== "copied") return;
    const timer = window.setTimeout(() => setCopy("idle"), 1_600);
    return () => window.clearTimeout(timer);
  }, [copy]);
  return (
    <div className="install-panel" id="start">
      <div className="install-heading">
        <div>
          <p className="eyebrow">One-command start</p>
          <h2>Give this to your agent.</h2>
        </div>
        <div
          className="install-tabs"
          role="tablist"
          aria-label="Installation method"
        >
          <button
            aria-selected={mode === "codex"}
            onClick={() => setMode("codex")}
            role="tab"
            type="button"
          >
            Install
          </button>
          <button
            aria-selected={mode === "prompt"}
            onClick={() => setMode("prompt")}
            role="tab"
            type="button"
          >
            Read only
          </button>
        </div>
      </div>
      <div className="command-box">
        <textarea
          aria-label="Install command"
          readOnly
          spellCheck={false}
          value={command}
        />
        <button
          aria-label={
            copy === "copied"
              ? "Copied install command"
              : copy === "error"
                ? "Copy unavailable; select install command"
                : "Copy install command"
          }
          onClick={() => void copyCommand()}
          type="button"
        >
          {copy === "copied" ? <Check /> : <Clipboard />}
          {copy === "copied"
            ? "Copied"
            : copy === "error"
              ? "Select text"
              : "Copy"}
        </button>
      </div>
      <p className="install-note">
        Installs or updates atomically from GitHub-verified bytes. The skill
        starts ccusage locally, restricts the approved model, and prints a
        signed contribution footer when the run finishes.
      </p>
    </div>
  );
}

function WalletPanel() {
  const [address, setAddress] = useState("");
  const [copy, setCopy] = useState<"copied" | "error" | "idle">("idle");
  const valid = isSolanaAddress(address.trim());
  const marker = valid
    ? `<!-- open-work-wallet:v1 {"chain":"solana","address":"${address.trim()}"} -->`
    : "Enter a valid Solana public address to generate your marker.";
  const copyMarker = async () => {
    if (!valid) return;
    try {
      await navigator.clipboard.writeText(marker);
      setCopy("copied");
    } catch {
      // error-policy:J4 Clipboard denial remains visible and the marker stays selectable.
      setCopy("error");
    }
  };
  return (
    <section className="wallet-panel" id="wallet">
      <div>
        <p className="eyebrow">Get paid on Solana</p>
        <h2>Publish one wallet marker.</h2>
        <p>
          Add the generated comment to the source of your public GitHub profile
          README. At cycle proposal time, Open Work records the exact README
          commit and address. You can change it later; a change restarts the
          14-day review for that allocation.
        </p>
        <p className="wallet-warning">
          <CircleAlert aria-hidden="true" size={17} /> Public address only.
          Never paste a seed phrase or private key.
        </p>
      </div>
      <div className="wallet-generator">
        <label htmlFor="solana-wallet">Solana public address</label>
        <input
          autoComplete="off"
          id="solana-wallet"
          onChange={(event) => {
            setAddress(event.target.value);
            setCopy("idle");
          }}
          placeholder="Your public Solana address"
          spellCheck="false"
          value={address}
        />
        <div
          className={
            valid ? "wallet-marker" : "wallet-marker wallet-marker-empty"
          }
        >
          <code>{marker}</code>
          <button
            disabled={!valid}
            onClick={() => void copyMarker()}
            type="button"
          >
            {copy === "copied" ? <Check /> : <Clipboard />}{" "}
            {copy === "copied"
              ? "Copied"
              : copy === "error"
                ? "Select text"
                : "Copy marker"}
          </button>
        </div>
        <ol>
          <li>
            Create a public repository named exactly like your GitHub login.
          </li>
          <li>
            Add the marker anywhere in its <code>README.md</code> source.
          </li>
          <li>Commit it before the reward proposal is generated.</li>
        </ol>
      </div>
    </section>
  );
}

function RewardValue({ leader }: { leader: ProjectContributor }) {
  return leader.projectedMinor !== null ? (
    formatMicroUsdc(leader.projectedMinor)
  ) : (
    <>{formatPercent(leader.projectedSharePartsPerMillion ?? 0)} share</>
  );
}

function ProjectLeaderboard({ view }: { view: ProjectView }) {
  return (
    <section className="section project-leader-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Cycle {view.cycle.id}</p>
          <h2>Contribution leaderboard.</h2>
        </div>
        <p>
          Outcome score leads. Relevant signed compute adds a diminishing bonus
          capped at 20%.
        </p>
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
                <th scope="col">Relevant tokens</th>
                <th scope="col">Projection</th>
                <th scope="col">Weight bonus</th>
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
                        <small>
                          {leader.acceptedOutcomeCount} accepted events
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <strong>{leader.score}</strong>
                  </td>
                  <td>{formatCompact(leader.usage.relevantTokens)}</td>
                  <td>
                    <strong>
                      <RewardValue leader={leader} />
                    </strong>
                  </td>
                  <td>+{(leader.computeBonusBasisPoints / 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WorkQueue({ view }: { view: ProjectView }) {
  const items = [...view.workQueue.issues, ...view.workQueue.pullRequests]
    .filter((item) => item.selection.status === "candidate")
    .slice(0, 8);
  return (
    <section className="section work-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Live from GitHub</p>
          <h2>Work worth doing.</h2>
        </div>
        <p>No platform claims. Recheck the issue or PR before beginning.</p>
      </div>
      {items.length === 0 ? (
        <EmptyState text="No unblocked candidates passed the public filter." />
      ) : (
        <div className="work-list">
          {items.map((item) => (
            <WorkRow item={item} key={item.id} />
          ))}
        </div>
      )}
      <ExternalLinkAnchor
        className="inline-link"
        href={view.project.links.issues}
      >
        See every GitHub issue <ArrowRight aria-hidden="true" size={17} />
      </ExternalLinkAnchor>
    </section>
  );
}

function WorkRow({ item }: { item: WorkItem }) {
  return (
    <ExternalLinkAnchor className="work-row" href={item.url}>
      <span
        className={`work-kind ${item.kind === "pull-request" ? "pr-kind" : ""}`}
      >
        {item.kind === "pull-request" ? "PR" : "ISSUE"}
      </span>
      <span>
        <strong>{item.title}</strong>
        <small>
          #{item.number} · {item.priority} priority · {item.commentCount}{" "}
          comments
        </small>
      </span>
      <ChevronRight aria-hidden="true" />
    </ExternalLinkAnchor>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function ProjectStats({ view }: { view: ProjectView }) {
  const totalScore = view.leaders.reduce(
    (sum, leader) => sum + leader.score,
    0,
  );
  const projected =
    view.reward.kind === "monthly-pool"
      ? formatMicroUsdc(view.reward.projectedPrincipalMinor)
      : `${view.reward.advertisedAmountDisplay} external`;
  return (
    <div className="project-stat-strip">
      <div>
        <strong>{projected}</strong>
        <span>
          {view.reward.kind === "monthly-pool"
            ? "cycle projection"
            : "opportunity size"}
        </span>
      </div>
      <div>
        <strong>{view.leaders.length}</strong>
        <span>scored contributors</span>
      </div>
      <div>
        <strong>{totalScore}</strong>
        <span>accepted score</span>
      </div>
      <div>
        <strong>{formatCompact(view.usage.relevantTokens)}</strong>
        <span>relevant tokens</span>
      </div>
    </div>
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
              <p className="eyebrow">{project.eyebrow}</p>
              <h1>{project.headline}</h1>
              <p className="hero-copy">{project.description}</p>
              <div className="hero-actions">
                <a className="button primary-button" href="#start">
                  Start in one command <ArrowRight aria-hidden="true" />
                </a>
                <ExternalLinkAnchor
                  className="button text-button"
                  href={project.links.repository}
                >
                  View repository
                </ExternalLinkAnchor>
              </div>
            </div>
            <aside className="reward-card">
              <span>
                {project.reward.kind === "monthly-pool"
                  ? "MONTHLY POOL"
                  : "EXTERNAL OPPORTUNITY"}
              </span>
              <strong>
                {project.reward.kind === "monthly-pool"
                  ? project.reward.monthlyCapDisplay
                  : project.reward.externalOpportunity?.advertisedAmountDisplay}
              </strong>
              <p>
                {project.reward.kind === "monthly-pool"
                  ? "Maximum principal allocated each UTC month. Unused funding rolls forward without raising the next cap."
                  : "The platform publishes contribution percentages only. The prize sponsor controls eligibility and payment."}
              </p>
              <div>
                <small>
                  {project.reward.kind === "monthly-pool"
                    ? "1% platform fee · Solana"
                    : "No platform pool · no dollar projection"}
                </small>
                <Link
                  href={`/cycles/${project.slug}/${view?.cycle.id ?? new Date().toISOString().slice(0, 7)}`}
                >
                  View cycle <ArrowRight aria-hidden="true" size={15} />
                </Link>
              </div>
            </aside>
          </div>
          {view ? <ProjectStats view={view} /> : null}
        </div>
      </section>
      <div className="shell">
        <InstallPanel project={project} />
        {project.reward.kind === "monthly-pool" ? <WalletPanel /> : null}
        {view ? (
          <>
            <ProjectLeaderboard view={view} />
            <WorkQueue view={view} />
            <TrustSection view={view} />
          </>
        ) : null}
      </div>
    </main>
  );
}

function TrustSection({ view }: { view: ProjectView }) {
  return (
    <section className="section trust-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">How credit survives review</p>
          <h2>Useful work wins.</h2>
        </div>
        <p>
          Automation proposes; maintainers retain judgment. Every reduction
          needs a public reason and review delay.
        </p>
      </div>
      <div className="trust-grid">
        <article>
          <ShieldCheck aria-hidden="true" />
          <h3>Verify the outcome</h3>
          <p>
            Merged PRs, linked fixes, material tests, evidence, and substantive
            reviews score. Unmerged work can earn only through an explicit
            evaluator finding.
          </p>
        </article>
        <article>
          <CircleAlert aria-hidden="true" />
          <h3>Detect abuse</h3>
          <p>
            Invalid signatures, replayed runs, copied markers, wrong
            repositories, wrong models, unrelated usage, duplicate work, and
            suspicious flooding are held for review.
          </p>
        </article>
        <article>
          <Check aria-hidden="true" />
          <h3>Approve and settle</h3>
          <p>
            Proposals remain editable for 14 days. Approved wallet rows become
            immutable payout intents; finalized Solana signatures close the
            cycle.
          </p>
        </article>
      </div>
      {view.receiptConflicts.length > 0 ? (
        <p className="risk-note">
          {view.receiptConflicts.length} conflicting run receipt
          {view.receiptConflicts.length === 1 ? " is" : "s are"} excluded from
          this view.
        </p>
      ) : null}
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
  if (state.status !== "ready")
    return (
      <main className="shell route-main">
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
  if (matches.length === 0 && history.length === 0) {
    return <NotFound title="Contributor not found" />;
  }
  const historicalActor = history[0]?.contributor.actor;
  const actor: GitHubActor = matches[0]?.leader.actor ?? {
    id: historicalActor?.id ?? `historical:${login.toLowerCase()}`,
    login: historicalActor?.login ?? login,
    avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=160`,
    url: `https://github.com/${encodeURIComponent(login)}`,
    kind: "User",
  };
  const events = state.views.flatMap((view) =>
    view.ledger
      .filter((event) => event.actor.id === actor.id)
      .map((event) => ({ event, project: view.project })),
  );
  const currentCycleKeys = new Set(
    matches.map(({ view }) => `${view.project.id}\0${view.cycle.id}`),
  );
  const score =
    matches.reduce((total, match) => total + match.leader.score, 0) +
    history
      .filter(
        ({ cycle }) =>
          !currentCycleKeys.has(`${cycle.projectId}\0${cycle.cycleId}`),
      )
      .reduce((total, { contributor }) => total + contributor.score, 0);
  const tokens = matches.reduce(
    (total, match) => total + match.leader.usage.relevantTokens,
    0,
  );
  const projected = matches.reduce(
    (total, match) => total + BigInt(match.leader.projectedMinor ?? "0"),
    0n,
  );
  const paid = history.reduce(
    (total, { contributor }) => total + BigInt(contributor.paidMinor),
    0n,
  );
  const wallet = history.find(({ contributor }) => contributor.wallet)
    ?.contributor.wallet;
  return (
    <main className="shell route-main profile-page">
      <DataNotice state={state} retry={retry} />
      <p className="breadcrumb">
        <Link href="/">Leaderboard</Link>
        <span>/</span>
        {actor.login}
      </p>
      <section className="profile-hero">
        <Avatar actor={actor} size="large" />
        <div>
          <p className="eyebrow">Public contributor portfolio</p>
          <h1>{actor.login}</h1>
          <div className="profile-links">
            <ExternalLinkAnchor href={actor.url}>
              GitHub profile <ExternalLink aria-hidden="true" size={15} />
            </ExternalLinkAnchor>
            {wallet ? (
              <ExternalLinkAnchor href={wallet.sourceUrl}>
                Solana wallet {wallet.address}{" "}
                <ExternalLink aria-hidden="true" size={15} />
              </ExternalLinkAnchor>
            ) : null}
          </div>
        </div>
      </section>
      <div className="profile-totals">
        <div>
          <strong>{score}</strong>
          <span>recorded score</span>
        </div>
        <div>
          <strong>{formatCompact(tokens)}</strong>
          <span>current relevant tokens</span>
        </div>
        <div>
          <strong>{formatMicroUsdc(projected.toString())}</strong>
          <span>current projection</span>
        </div>
        <div>
          <strong>{formatMicroUsdc(paid.toString())}</strong>
          <span>total paid</span>
        </div>
      </div>
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Active cycles</p>
            <h2>Project record.</h2>
          </div>
        </div>
        <div className="profile-projects">
          {matches.map(({ leader, view }) => (
            <Link href={`/projects/${view.project.slug}`} key={view.project.id}>
              <span>
                <strong>{view.project.name}</strong>
                <small>{view.cycle.id}</small>
              </span>
              <span>
                <strong>{leader.score} score</strong>
                <small>
                  {formatCompact(leader.usage.relevantTokens)} tokens
                </small>
              </span>
              <span>
                <RewardValue leader={leader} />
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
      {history.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Permanent public record</p>
              <h2>Reward history.</h2>
            </div>
            <p>
              Approved and paid amounts come from immutable cycle manifests.
            </p>
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
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Accepted evidence</p>
            <h2>Contribution ledger.</h2>
          </div>
        </div>
        <EventList events={events} />
      </section>
    </main>
  );
}

function EventList({
  events,
}: {
  events: Array<{ event: ScoreEvent; project: ProjectDefinition }>;
}) {
  if (events.length === 0)
    return <EmptyState text="No accepted evidence is available." />;
  return (
    <div className="event-list">
      {events.map(({ event, project }) => (
        <ExternalLinkAnchor
          href={event.evaluation?.decisionUrl ?? event.source.url}
          key={event.id}
        >
          <span className="event-points">+{event.points}</span>
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
        <div>
          <p className="eyebrow">Immutable allocation record</p>
          <h2>Cycle contributors.</h2>
        </div>
        <p>Amounts reflect this cycle’s latest verified public state.</p>
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
                  <td>{contributor.score}</td>
                  <td>{formatMicroUsdc(contributor.suggestedMinor)}</td>
                  <td>{formatMicroUsdc(contributor.approvedMinor)}</td>
                  <td>
                    <strong>{formatMicroUsdc(contributor.paidMinor)}</strong>
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
        <div>
          <p className="eyebrow">Digest-linked record</p>
          <h2>Public cycle files.</h2>
        </div>
        <p>Each file is immutable evidence, not a dashboard-only balance.</p>
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
          <p className="eyebrow">{lifecycle.replaceAll("-", " ")}</p>
          <h1>
            {project.name} · {cycleId}
          </h1>
          <p>
            {formatDate(from)} through {formatDate(to)}. Projections can change
            until the reviewed allocation is approved; paid means finalized
            Solana evidence reconciled exactly.
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
      <div className="cycle-status-grid">
        <article>
          <span>1</span>
          <strong>Contribution</strong>
          <p>
            GitHub events and signed usage are collected for the UTC window.
          </p>
        </article>
        <article>
          <span>2</span>
          <strong>14-day review</strong>
          <p>Maintainers can hold or reduce rows with a public reason.</p>
        </article>
        <article>
          <span>3</span>
          <strong>Approval</strong>
          <p>Wallet-linked allocations freeze into immutable payout intents.</p>
        </article>
        <article>
          <span>4</span>
          <strong>Settlement</strong>
          <p>Finalized Solana transaction signatures reconcile each intent.</p>
        </article>
      </div>
      {view ? (
        <ProjectLeaderboard view={view} />
      ) : record ? (
        <ArchivedCycleLeaderboard cycle={record} />
      ) : null}
      {view ? (
        <section className="section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Public record</p>
              <h2>Cycle evidence.</h2>
            </div>
            <p>
              {view.ledger.length} score events ·{" "}
              {formatInteger(view.usage.reportedTokens)} reported tokens ·{" "}
              {formatInteger(view.usage.ambiguousTokens)} ambiguous
            </p>
          </div>
          <EventList
            events={view.ledger.map((event) => ({ event, project }))}
          />
        </section>
      ) : null}
      {record ? <CycleArtifacts cycle={record} /> : null}
    </main>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
}

function monthlyPoolValue(value: string): {
  display: string;
  minor: string;
  valid: boolean;
} {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u.test(value)) {
    return { display: "$0", minor: "0", valid: false };
  }
  const [whole, fraction = ""] = value.split(".");
  const minor = (
    BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(2, "0")) * 10_000n
  ).toString();
  if (BigInt(minor) > MAX_MONTHLY_CAP_MINOR) {
    return { display: "$0", minor: "0", valid: false };
  }
  return {
    display: formatMonthlyCapDisplay(minor),
    minor,
    valid: true,
  };
}

function ProjectProposalPage() {
  const [name, setName] = useState("");
  const [repository, setRepository] = useState("");
  const [headline, setHeadline] = useState("");
  const [monthlyPool, setMonthlyPool] = useState("0");
  const [integrationBranch, setIntegrationBranch] = useState("main");
  const [copied, setCopied] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);
  const slug = slugify(name || repository.split("/").at(-1) || "new-project");
  const pool = monthlyPoolValue(monthlyPool);
  const manifest = useMemo(
    () => ({
      schemaVersion: "1",
      id: slug,
      slug,
      name: name || "New project",
      eyebrow: "Open-source project",
      headline: headline || "Make money solving something hard.",
      description:
        "Describe the concrete open-source goal and what accepted progress means.",
      status: "active",
      repositories: [
        {
          id: repository || "owner/repository",
          displayName: repository || "owner/repository",
          githubUrl: `https://github.com/${repository || "owner/repository"}`,
          description:
            "Describe the public repository and its role in this project.",
          integrationBranch,
        },
      ],
      skill: {
        id: `contribute-to-${slug}`,
        sourcePath: `skills/contribute-to-${slug}`,
        publicPath: `/projects/${slug}/skill.md`,
      },
      reviewSkill: {
        id: `review-${slug}-contributions`,
        sourcePath: `skills/review-${slug}-contributions`,
      },
      reward: {
        kind: "monthly-pool",
        currency: "USDC",
        chain: "solana",
        rewardStartAt: new Date().toISOString(),
        cycle: "calendar-month-utc",
        monthlyCapMinor: pool.minor,
        monthlyCapDisplay: pool.display,
        committedMinor: "0",
        feeBasisPoints: 100,
        unusedFunds: "rollover-without-cap-increase",
        fundingState: "pledged",
      },
      modelPolicy: {
        mode: "frontier-only",
        approved: [
          { client: "codex", provider: "openai", model: "gpt-5.6-sol" },
          {
            client: "claude-code",
            provider: "anthropic",
            model: "claude-fable-5",
          },
        ],
      },
      links: {
        repository: `https://github.com/${repository || "owner/repository"}`,
        issues: `https://github.com/${repository || "owner/repository"}/issues`,
      },
    }),
    [
      headline,
      integrationBranch,
      name,
      pool.display,
      pool.minor,
      repository,
      slug,
    ],
  );
  const manifestText = JSON.stringify(manifest, null, 2);
  const agentBrief = `In a fork of elizaOS/army, add the Open Work project "${name || "New project"}" for the public repository ${repository || "owner/repository"}. Read AGENTS.md, README.md, projects/eliza/project.json, skills/contribute-to-eliza, and skills/review-eliza-contributions before editing. Add projects/${slug}/project.json using the manifest below, a project-specific contributor skill with authenticated atomic update and signed ccusage receipt, a separate adversarial CI reviewer skill, and focused tests. Adapt the mission and repository instructions; do not copy Eliza-specific work criteria. Run projects:check, evaluations:check, every skill validator, typecheck, tests, build, and browser checks. Never add credentials, private keys, raw prompts, or autonomous payout/ban authority.\n\n${manifestText}`;
  const githubUrl = `${PROJECT_PROPOSAL_ROOT}?filename=${encodeURIComponent(`projects/${slug}/project.json`)}&value=${encodeURIComponent(`${manifestText}\n`)}`;
  const valid =
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) &&
    /^(?!.*(?:\.\.|\s|~|\^|:|\?|\*|\[|\\))[A-Za-z0-9._/-]+$/u.test(
      integrationBranch,
    ) &&
    name.trim().length > 1 &&
    headline.trim().length > 5 &&
    pool.valid;
  return (
    <main className="shell route-main proposal-page">
      <p className="breadcrumb">
        <Link href="/">Projects</Link>
        <span>/</span>Add a project
      </p>
      <section className="proposal-intro">
        <p className="eyebrow">GitHub-native creation</p>
        <h1>Put money behind an open problem.</h1>
        <p>
          No creator account or private dashboard. Generate the public manifest,
          add contributor and reviewer skills in a fork, and submit one PR. New
          projects pass automated safety checks and maintainer review before
          listing.
        </p>
      </section>
      <div className="proposal-grid">
        <form>
          <label>
            Project name
            <input
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: Open Protein"
              required
              value={name}
            />
          </label>
          <label>
            Public GitHub repository
            <input
              onChange={(event) => setRepository(event.target.value)}
              placeholder="owner/repository"
              required
              value={repository}
            />
          </label>
          <label>
            Integration branch
            <input
              onChange={(event) => setIntegrationBranch(event.target.value)}
              placeholder="main"
              required
              value={integrationBranch}
            />
          </label>
          <label>
            Money-forward headline
            <input
              onChange={(event) => setHeadline(event.target.value)}
              placeholder="Make money proving proteins fold."
              required
              value={headline}
            />
          </label>
          <label>
            Maximum monthly pool, digital dollars
            <input
              inputMode="decimal"
              max="1000000000"
              min="0"
              onChange={(event) => setMonthlyPool(event.target.value)}
              step="0.01"
              type="number"
              value={monthlyPool}
            />
          </label>
          <div className="proposal-rules">
            <p>
              <Check aria-hidden="true" /> Public repository only
            </p>
            <p>
              <Check aria-hidden="true" /> 1% platform fee on settled principal
            </p>
            <p>
              <Check aria-hidden="true" /> 14-day review before approval
            </p>
            <p>
              <Check aria-hidden="true" /> Project skill plus separate CI review
              skill
            </p>
          </div>
          {valid ? (
            <a className="button primary-button" href={githubUrl}>
              Continue on GitHub <ArrowRight aria-hidden="true" />
            </a>
          ) : (
            <button
              className="button primary-button disabled-button"
              disabled
              type="button"
            >
              Continue on GitHub <ArrowRight aria-hidden="true" />
            </button>
          )}
        </form>
        <div className="manifest-preview">
          <div>
            <span>projects/{slug}/project.json</span>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(manifestText)
                  .then(() => setCopied(true))
              }
              type="button"
            >
              {copied ? <Check /> : <Clipboard />}{" "}
              {copied ? "Copied" : "Copy JSON"}
            </button>
          </div>
          <textarea
            aria-label="Project manifest JSON"
            readOnly
            spellCheck={false}
            value={manifestText}
          />
        </div>
      </div>
      <section className="proposal-checklist">
        <h2>What the PR must include.</h2>
        <div>
          <article>
            <span>01</span>
            <h3>Project manifest</h3>
            <p>
              Goal, public repositories, reward type, monthly cap, links, and
              model policy.
            </p>
          </article>
          <article>
            <span>02</span>
            <h3>Contributor skill</h3>
            <p>
              One-command setup, precise work loop, repository rules, evidence,
              and run receipt.
            </p>
          </article>
          <article>
            <span>03</span>
            <h3>Review skill</h3>
            <p>
              CI evaluator rubric, adversarial checks, duplicate detection, and
              score evidence.
            </p>
          </article>
          <article>
            <span>04</span>
            <h3>Funding status</h3>
            <p>
              V1 labels creator pools as pledges. Only a later verifiable escrow
              path may use the committed label.
            </p>
          </article>
        </div>
      </section>
      <section className="agent-handoff">
        <div>
          <p className="eyebrow">Agent-native setup</p>
          <h2>Let an agent build the project PR.</h2>
          <p>
            The brief points at the live repository contracts, supplies this
            manifest, and keeps the project-specific judgment with you.
          </p>
        </div>
        <button
          className="button primary-button"
          onClick={() =>
            void navigator.clipboard
              .writeText(agentBrief)
              .then(() => setBriefCopied(true))
          }
          type="button"
        >
          {briefCopied ? <Check /> : <Clipboard />}{" "}
          {briefCopied ? "Brief copied" : "Copy agent brief"}
        </button>
      </section>
    </main>
  );
}

function NotFound({ title = "Page not found" }: { title?: string }) {
  return (
    <main className="shell not-found">
      <p className="eyebrow">404</p>
      <h1>{title}</h1>
      <Link className="button primary-button" href="/">
        See open projects <ArrowRight aria-hidden="true" />
      </Link>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const [state, retry] = useSnapshot();
  let content: ReactNode;
  if (route.kind === "home") content = <HomePage retry={retry} state={state} />;
  else if (route.kind === "new-project") content = <ProjectProposalPage />;
  else if (route.kind === "project") {
    const project = findProject(route.projectId ?? "");
    content = project ? (
      <ProjectPage project={project} retry={retry} state={state} />
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
      {content}
      <Footer />
    </>
  );
}
