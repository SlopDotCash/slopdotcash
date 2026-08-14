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
import { createGlobalLeaders } from "./lib/global-leaderboard";
import { createInstallCommand } from "./lib/install-command";
import {
  assertLeaderboardSnapshot,
  type GitHubActor,
  type LeaderboardSnapshot,
  PROFILE_OPPORTUNITY_LIMIT,
  type ScoreEvent,
  type ScoreOpportunity,
} from "./lib/leaderboard";
import {
  formatMonthlyCapDisplay,
  MAX_MONTHLY_CAP_MINOR,
} from "./lib/project-schema.mjs";
import {
  createProjectView,
  formatCapUsageLine,
  type ProjectContributor,
  type ProjectView,
  projectCycleHasOpened,
} from "./lib/project-view";
import {
  findProject,
  findProjectByRepositoryId,
  PROJECTS,
  type ProjectDefinition,
} from "./lib/projects.mjs";

const SOURCE_REPOSITORY = "https://github.com/elizaOS/slopdotcash";
const HUB_ORIGIN = "https://git.slop.cash";
const PROJECT_PROPOSAL_ROOT = `${SOURCE_REPOSITORY}/new/develop`;
const SNAPSHOT_TIMEOUT_MS = 12_000;
const SNAPSHOT_RETRIES = 1;
const MAX_LEADERBOARD_BYTES = 32 * 1024 * 1024;
const MAX_CYCLE_INDEX_BYTES = 8 * 1024 * 1024;
const HERO_ACTIONS = [
  "SHIPPING SLOP.",
  "PROVING MATH.",
  "DISCOVERING DRUGS.",
  "HARDENING THE WEB.",
  "FIXING BUGS.",
  "SECURING THE INTERNET.",
  "SOLVING MATH.",
  "ADVANCING SCIENCE.",
  "BUILDING AGENTS.",
] as const;
const HERO_HOLD_MS = 1_800;
const HERO_TYPE_MS = 55;
const HERO_DELETE_MS = 30;
const HERO_GAP_MS = 220;

export function publicFooterDomain(
  hostname: string,
): "slop.cash" | "slop.tech" {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  return normalized === "slop.tech" || normalized.endsWith(".slop.tech")
    ? "slop.tech"
    : "slop.cash";
}

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
  const scrollAfterNavigation = () => {
    window.setTimeout(() => {
      const destination = new URL(href, window.location.href);
      const targetId = destination.hash
        ? decodeURIComponent(destination.hash.slice(1))
        : "";
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.scrollIntoView({ behavior: "auto", block: "start" });
        return;
      }
      window.scrollTo({ top: 0, behavior: "auto" });
    }, 0);
  };
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
        scrollAfterNavigation();
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
        // A project whose pool starts after this snapshot has no cycle to
        // show yet. Skipping it keeps one future-dated registry entry from
        // failing the whole page; every other contract violation still
        // surfaces as a data error rather than being silently swallowed.
        const views = PROJECTS.filter((project) =>
          projectCycleHasOpened(value, project.id),
        ).map((project) => createProjectView(value, project.id));
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

function formatCycleMonth(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function stale(snapshot: LeaderboardSnapshot): boolean {
  return Date.now() - Date.parse(snapshot.generatedAt) > 8 * 60 * 60 * 1_000;
}

function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link ariaLabel="Slop home" className="wordmark" href="/">
          SLOP
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
          <ExternalLinkAnchor href={HUB_ORIGIN}>Slop Git</ExternalLinkAnchor>
          <ExternalLinkAnchor className="nav-source" href={SOURCE_REPOSITORY}>
            Source <ExternalLink aria-hidden="true" size={14} />
          </ExternalLinkAnchor>
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
        <div>
          <div className="wordmark footer-wordmark">{domain}</div>
          <p>Accepted work. Public evidence. Digital-dollar rewards.</p>
        </div>
        <div className="footer-links">
          <ExternalLinkAnchor href={SOURCE_REPOSITORY}>
            GitHub
          </ExternalLinkAnchor>
          <ExternalLinkAnchor href={HUB_ORIGIN}>Slop Git</ExternalLinkAnchor>
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
    <h1 aria-label={`MAKE MONEY ${action}`}>
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
        </span>
      </span>
    </h1>
  );
}

function ProjectCard({ project }: { project: ProjectDefinition }) {
  const amount =
    project.reward.kind === "monthly-pool"
      ? project.reward.monthlyCapDisplay
      : (project.reward.externalOpportunity?.advertisedAmountDisplay ??
        "External");
  return (
    <Link className="project-card" href={`/projects/${project.slug}`}>
      <div className="project-card-heading">
        <h3>{project.name}</h3>
        <ArrowRight aria-hidden="true" />
      </div>
      <div className="project-card-content">
        <p className="project-summary">{project.description}</p>
        <p className="project-bounty">
          <strong>{amount}</strong>
          <span>
            {project.reward.kind === "monthly-pool"
              ? "/ month"
              : "external prize"}
          </span>
        </p>
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
  snapshot,
  views,
}: {
  cycleIndex: CycleIndex;
  snapshot: LeaderboardSnapshot;
  views: readonly ProjectView[];
}) {
  const leaders = createGlobalLeaders(snapshot, views, cycleIndex);
  const [mode, setMode] = useState<"current" | "record">("current");
  const [selectedProjectId, setSelectedProjectId] = useState(
    views[0]?.project.id ?? "",
  );
  const selectedView =
    views.find((view) => view.project.id === selectedProjectId) ?? views[0];
  const cycleMonth = selectedView
    ? formatCycleMonth(selectedView.cycle.id)
    : "Current month";
  const selectedRewardLabel = selectedView
    ? selectedView.reward.kind === "monthly-pool"
      ? `${selectedView.project.reward.monthlyCapDisplay} share simulation`
      : `${selectedView.reward.advertisedAmountDisplay} external opportunity`
    : "Current reward cycle";
  return (
    <section
      className="section shell home-leaderboard-section"
      id="leaderboard"
    >
      <div className="home-leaderboard-heading">
        <h2 className="home-section-title">Leaderboard</h2>
        <p>
          This month is the default because every project runs its own reward
          cycle. Choose one project to see the rank that determines its current
          estimate. The all-time record is separate history.
        </p>
      </div>
      <div
        aria-label="Leaderboard timeframe"
        className="leaderboard-mode-tabs"
        role="tablist"
      >
        <button
          aria-controls="leaderboard-current-panel"
          aria-selected={mode === "current"}
          id="leaderboard-current-tab"
          onClick={() => setMode("current")}
          role="tab"
          type="button"
        >
          This month
        </button>
        <button
          aria-controls="leaderboard-record-panel"
          aria-selected={mode === "record"}
          id="leaderboard-record-tab"
          onClick={() => setMode("record")}
          role="tab"
          type="button"
        >
          All-time record
        </button>
      </div>
      <details className="leaderboard-methodology">
        <summary>How the simulation works</summary>
        <p>
          Accepted outcomes—not commits, lines, hours, or token volume—earn
          score under each project's published rules. The displayed amounts
          simulate how the advertised cap would divide today. Payments are
          disabled and no allocation is approved. Signed local usage remains
          visible as diagnostic evidence only.
        </p>
      </details>
      {mode === "current" ? (
        <div
          aria-labelledby="leaderboard-current-tab"
          id="leaderboard-current-panel"
          role="tabpanel"
        >
          <div
            aria-label="Current reward project"
            className="leaderboard-project-tabs"
            role="tablist"
          >
            {views.map((view) => {
              const rewardLabel =
                view.reward.kind === "monthly-pool"
                  ? `${view.project.reward.monthlyCapDisplay} simulation`
                  : "External prize share";
              return (
                <button
                  aria-controls="leaderboard-project-panel"
                  aria-label={`${view.project.name}, ${rewardLabel}`}
                  aria-selected={view.project.id === selectedView?.project.id}
                  id={`leaderboard-project-${view.project.id}`}
                  key={view.project.id}
                  onClick={() => setSelectedProjectId(view.project.id)}
                  role="tab"
                  type="button"
                >
                  <strong>{view.project.name}</strong>
                  <span>{rewardLabel}</span>
                </button>
              );
            })}
          </div>
          {selectedView ? (
            <div
              aria-labelledby={`leaderboard-project-${selectedView.project.id}`}
              id="leaderboard-project-panel"
              role="tabpanel"
            >
              <div className="leaderboard-cycle-summary">
                <div>
                  <strong>
                    {cycleMonth} · {selectedView.project.name}
                  </strong>
                  <span>{selectedRewardLabel}</span>
                </div>
                <p>
                  {selectedView.reward.kind === "monthly-pool"
                    ? "Rank and simulated share use only this project's accepted work in the current UTC month. Payments are off."
                    : "This is a provisional contribution share, not a Slop-funded dollar payout."}
                </p>
              </div>
              {selectedView.leaders.length === 0 ? (
                <EmptyState text="No accepted outcomes in this project cycle yet." />
              ) : (
                <>
                  <div className="leader-table global-leader-table">
                    <table className="leader-grid global-leader-grid">
                      <caption className="visually-hidden">
                        {selectedView.project.name} {cycleMonth} reward
                        leaderboard
                      </caption>
                      <thead>
                        <tr className="leader-row leader-head global-leader-head">
                          <th scope="col">Rank</th>
                          <th scope="col">Contributor</th>
                          <th scope="col">Accepted score</th>
                          <th scope="col">Simulated share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedView.leaders.slice(0, 20).map((leader) => (
                          <tr
                            className="leader-row global-leader-row"
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
                                    {leader.acceptedOutcomeCount} accepted event
                                    {leader.acceptedOutcomeCount === 1
                                      ? ""
                                      : "s"}
                                  </small>
                                </span>
                              </Link>
                            </td>
                            <td data-label="Accepted score">
                              <strong>{leader.score}</strong>
                            </td>
                            <td data-label="Simulated share">
                              <strong>
                                <RewardValue leader={leader} />
                              </strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Link
                    className="leaderboard-project-link"
                    href={`/projects/${selectedView.project.slug}`}
                  >
                    View the full {selectedView.project.name} cycle
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </>
              )}
            </div>
          ) : (
            <EmptyState text="No current project cycle is published yet." />
          )}
        </div>
      ) : (
        <div
          aria-labelledby="leaderboard-record-tab"
          id="leaderboard-record-panel"
          role="tabpanel"
        >
          <div className="leaderboard-record-summary">
            <strong>Accepted-work record</strong>
            <p>
              Cumulative score across published cycles. This rank does not
              determine any current monthly pool.
            </p>
          </div>
          {leaders.length === 0 ? (
            <EmptyState text="No accepted outcomes in the published record yet." />
          ) : (
            <div className="leader-table global-leader-table">
              <table className="leader-grid global-leader-grid">
                <caption className="visually-hidden">
                  All-time accepted-work record
                </caption>
                <thead>
                  <tr className="leader-row leader-head global-leader-head global-record-row">
                    <th scope="col">Rank</th>
                    <th scope="col">Contributor</th>
                    <th scope="col">Accepted score</th>
                    <th scope="col">Paid to date</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.slice(0, 20).map((leader, index) => (
                    <tr
                      className="leader-row global-leader-row global-record-row"
                      key={leader.actor.id}
                    >
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
                              {leader.projects === 1 ? "" : "s"} ·{" "}
                              {leader.cycles} scored cycle
                              {leader.cycles === 1 ? "" : "s"}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td data-label="Accepted score">
                        <strong>{leader.score}</strong>
                      </td>
                      <td data-label="Paid to date">
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
        </div>
      )}
    </section>
  );
}

function HomePage({ state, retry }: { state: DataState; retry: () => void }) {
  const views = state.status === "ready" ? state.views : [];
  return (
    <main>
      <section className="hero shell">
        {state.status === "ready" ? null : (
          <DataNotice state={state} retry={retry} />
        )}
        <TypewriterHeroHeading />
        <p className="beta-status">
          <strong>Public beta.</strong> Scoring and share simulations are live.
          Payouts are disabled.
        </p>
      </section>

      <section className="section shell home-projects-section" id="projects">
        <h2 className="home-section-title">Projects</h2>
        <div className="project-grid">
          {PROJECTS.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </section>
      {state.status === "ready" ? (
        <GlobalLeaderboard
          cycleIndex={state.cycleIndex}
          snapshot={state.snapshot}
          views={views}
        />
      ) : null}
    </main>
  );
}

function projectInstallCommand(project: ProjectDefinition): string {
  const origin = `${window.location.origin.replace(/\/$/u, "")}/projects/${project.slug}`;
  return createInstallCommand(origin, `\${HOME}/.agents/skills`, {
    skillName: project.skill.id,
    skillRepositoryPath: project.skill.sourcePath,
  });
}

function InstallPanel({ project }: { project: ProjectDefinition }) {
  const [copy, setCopy] = useState<
    "manual-copied" | "prompt-copied" | "error" | "idle"
  >("idle");
  const origin = window.location.origin.replace(/\/$/u, "");
  const repository = project.repositories[0]?.id;
  if (!repository) {
    throw new TypeError(`Project ${project.id} has no contribution repository`);
  }
  const agentPrompt = `Read ${origin}/SKILL.md and follow it to contribute to github.com/${repository}.`;
  const manualCommand = projectInstallCommand(project);
  const copyText = async (
    value: string,
    copiedState: "manual-copied" | "prompt-copied",
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopy(copiedState);
    } catch {
      // error-policy:J4 Clipboard denial remains visibly distinct and selectable text stays available.
      setCopy("error");
    }
  };
  useEffect(() => {
    if (copy !== "manual-copied" && copy !== "prompt-copied") return;
    const timer = window.setTimeout(() => setCopy("idle"), 1_600);
    return () => window.clearTimeout(timer);
  }, [copy]);
  return (
    <div className="install-panel" id="start">
      <div className="install-heading">
        <div>
          <h2>Copy this into your agent.</h2>
          <p>
            One prompt handles the contribution, evidence, and optional payout
            setup.
          </p>
        </div>
      </div>
      <div className="command-box agent-prompt-box">
        <output aria-label="Agent prompt" className="agent-prompt-copy">
          <code>{agentPrompt}</code>
        </output>
        <button
          aria-label={
            copy === "prompt-copied"
              ? "Copied agent prompt"
              : copy === "error"
                ? "Copy unavailable; select agent prompt"
                : "Copy agent prompt"
          }
          onClick={() => void copyText(agentPrompt, "prompt-copied")}
          type="button"
        >
          {copy === "prompt-copied" ? <Check /> : <Clipboard />}
          <span className="agent-prompt-copy-label">
            {copy === "prompt-copied"
              ? "Copied"
              : copy === "error"
                ? "Select text"
                : "Copy"}
          </span>
        </button>
      </div>
      <p className="install-note">
        Works in Codex and Claude Code. If you choose payout setup, the skill
        asks only for a public Solana address and waits before writing to
        GitHub.
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
            onClick={() => void copyText(manualCommand, "manual-copied")}
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
  return leader.projectedMinor !== null ? (
    formatMicroUsdc(leader.projectedDisplayMinor ?? leader.projectedMinor)
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
  return (
    <section className="section project-leader-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Cycle {view.cycle.id}</p>
          <h2>Contribution leaderboard.</h2>
        </div>
        <p className="data-freshness">Updated {formatDate(updatedAt)}</p>
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
                        <small>
                          {leader.acceptedOutcomeCount} accepted events
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <strong>{leader.score}</strong>
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
  const acceptedOutcomes = view.leaders.reduce(
    (sum, leader) => sum + leader.acceptedOutcomeCount,
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
            ? "simulated monthly pool"
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
        <strong>{formatCompact(acceptedOutcomes)}</strong>
        <span>accepted outcomes</span>
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
  const loginOpportunities = state.views.flatMap((view) =>
    view.opportunities
      .filter(
        (opportunity) =>
          opportunity.actor.login.toLowerCase() === login.toLowerCase(),
      )
      .map((opportunity) => ({ opportunity, project: view.project })),
  );
  const globalLeader = createGlobalLeaders(
    state.snapshot,
    state.views,
    state.cycleIndex,
  ).find((leader) => leader.actor.login.toLowerCase() === login.toLowerCase());
  if (
    matches.length === 0 &&
    history.length === 0 &&
    !globalLeader &&
    loginOpportunities.length === 0
  ) {
    return <NotFound title="Contributor not found" />;
  }
  const historicalActor = history[0]?.contributor.actor;
  const opportunityActor = loginOpportunities[0]?.opportunity.actor;
  const actor: GitHubActor = globalLeader?.actor ??
    matches[0]?.leader.actor ??
    opportunityActor ?? {
      id: historicalActor?.id ?? `historical:${login.toLowerCase()}`,
      login: historicalActor?.login ?? login,
      avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=160`,
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
  const score = globalLeader?.score ?? 0;
  const acceptedOutcomes = matches.reduce(
    (total, match) => total + match.leader.acceptedOutcomeCount,
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
          <strong>{formatCompact(acceptedOutcomes)}</strong>
          <span>current accepted outcomes</span>
        </div>
        <div>
          <strong>{formatMicroUsdc(projected.toString())}</strong>
          <span>current simulated share</span>
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
          {matches.length === 0 ? (
            <EmptyState text="No accepted project score in the current cycles yet." />
          ) : (
            matches.map(({ leader, view }) => {
              const capLine = formatCapUsageLine(leader.capUsage);
              return (
                <div className="profile-project-block" key={view.project.id}>
                  <Link href={`/projects/${view.project.slug}`}>
                    <span>
                      <strong>{view.project.name}</strong>
                      <small>{view.cycle.id}</small>
                    </span>
                    <span>
                      <strong>{leader.score} score</strong>
                      <small>
                        {leader.acceptedOutcomeCount} accepted outcome
                        {leader.acceptedOutcomeCount === 1 ? "" : "s"}
                      </small>
                    </span>
                    <span>
                      <RewardValue leader={leader} />
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                  {capLine ? (
                    <p className="profile-cap-line">{capLine}</p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
      {opportunities.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Still open</p>
              <h2>Things that could be worked on.</h2>
            </div>
            <p>
              Concrete next actions on still-open work that can still change the
              score if they qualify under the published rules.
            </p>
          </div>
          <OpportunityList opportunities={opportunities} />
        </section>
      ) : null}
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

function opportunityPointsLabel(opportunity: ScoreOpportunity): string {
  if (
    opportunity.kind === "missing-evidence" ||
    opportunity.kind === "partial-evidence"
  ) {
    // Evidence is the least certain category: each attachment must still pass
    // remote structure and head-binding verification after merge.
    return `+${opportunity.potentialPoints} if it verifies`;
  }
  return `+${opportunity.potentialPoints} if it qualifies`;
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
        paymentMode: "disabled",
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
  const agentBrief = `In a fork of elizaOS/slopdotcash, add the Slop project "${name || "New project"}" for the public repository ${repository || "owner/repository"}. Read AGENTS.md, README.md, projects/eliza/project.json, skills/contribute-to-eliza, and skills/review-eliza-contributions before editing. Add projects/${slug}/project.json using the manifest below, a project-specific contributor skill with authenticated atomic update and signed ccusage receipt, a separate adversarial CI reviewer skill, and focused tests. Adapt the mission and repository instructions; do not copy Eliza-specific work criteria. Run projects:check, evaluations:check, every skill validator, typecheck, tests, build, and browser checks. Never add credentials, private keys, raw prompts, or autonomous payout/ban authority.\n\n${manifestText}`;
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
