// spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"; spec/frontend/projections.md, "Free funds show how many whole months of the current amount they cover"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"; spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"; spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"; spec/frontend/requests.md, "Empty and denied never display retained rows as current data"
import type { Effect } from "effect";
import { minCap } from "../../gen/backend__intakeCap.ts";
import type { PoolRead } from "../../gen/frontend__projections.ts";
import type { ReadStatus } from "../../gen/frontend__requests.ts";
import { networkPays } from "../kernels/payingNetworks.ts";
import { maintainerShareLines } from "../projections/maintainerShare.ts";
import { mergeActivityCardLine, summarizeModelOutcomes, summarizeWhoBuilds } from "../projections/statistics.ts";
import { whoBuildsFigures } from "../reads/funding.vibe";
import { listedProjects, loadRegistry, type RegistryBoot } from "../reads/registry.vibe";
import { repositoryRegistryOf } from "../reads/registryTerms.ts";
import { HomePage, projectCoverage } from "../screens/home/index.ts";
import type { ListedProject, MergeLine, Shown } from "../screens/home/index.ts";
import { poolReadOf } from "../screens/projects/history.ts";
import { type MergeIndex, projectFunding, projectHeld, projectPromiseOf, slopbotSettings } from "../screens/projects/summary.ts";
import { projectOf } from "../screens/projects/project.schema.ts";
import { loadWork, type ProjectRuntime, projectReads, projectRuntime } from "../screens/projects/reads.vibe";
import { useShownRead } from "../screens/projects/hooks.ts";
import { type LiveFootprint, SponsorsPage } from "../screens/public/index.ts";
import { retryOnce, type Settled, useMounted, useNow, useOnce } from "./hooks.ts";
import type { PageProps } from "./pages.ts";
import type { PageRuntime } from "./runtime.vibe";

type Reads = Effect.Success<ReturnType<typeof projectReads>>;

interface Listing {
  readonly projects: Shown<ReadonlyArray<ListedProject>>;
  readonly funding: PoolRead;
  readonly capped: boolean;
}

const unread: Shown<never> = { status: "Loading", value: undefined };

const unmerged: Shown<MergeIndex> = { status: "Loading", value: undefined };

function settledStatus(settled: Settled<unknown>): ReadStatus {
  return settled.status === "running" ? "Loading" : settled.status === "failed" ? "Failed" : "Current";
}

function registryStatus(boot: RegistryBoot): ReadStatus {
  return boot.error !== undefined ? "Failed" : boot.freshness.tag === "RegistryStale" ? "Stale" : "Current";
}

function useListing(reads: Reads, boot: RegistryBoot, merge: Shown<MergeIndex>, nowMs: number): Listing {
  const pool = useShownRead(reads.pool, "all");
  const now = new Date(nowMs);
  const shown = listedProjects(boot).flatMap((record) => {
    const project = projectOf(record);
    return project === undefined ? [] : [{ record, project }];
  });
  const listed = shown.map(({ record, project }) => {
    const read = { status: pool.status, vaults: pool.value?.get(project.id) };
    const funding = projectFunding({ project, read, networkPays, nowMs });
    const promise = projectPromiseOf({ project, funding, read, networkPays });
    const coverage = projectCoverage({ pool: funding.facts, deployments: project.deployments, vaults: read.vaults ?? [], networkPays });
    const shareLine = maintainerShareLines(record, now)?.card;
    return {
      ...project,
      funding: funding.facts,
      promise,
      coverage,
      held: projectHeld(project, merge, nowMs),
      ...(shareLine === undefined ? {} : { shareLine }),
      escrow: { deployments: project.deployments },
    } satisfies ListedProject;
  });
  return {
    projects: { status: registryStatus(boot), value: boot.error === undefined ? listed : undefined },
    funding: poolReadOf(pool.status),
    capped: shown.some(({ project }) => slopbotSettings(project).intakeCap >= minCap),
  };
}

function useMergeLine(merge: Shown<MergeIndex>, nowMs: number): MergeLine {
  return (project) => (merge.status === "Current" || merge.status === "Stale" ? mergeActivityCardLine(merge.value?.get(project.id), nowMs) : null);
}

function useSection(runtime: PageRuntime): { readonly section: ProjectRuntime; readonly reads: Settled<Reads>; readonly boot: Settled<RegistryBoot> } {
  const section = projectRuntime(runtime);
  return { section, reads: useOnce(section, "reads", () => projectReads()), boot: useOnce(section, "registry", () => loadRegistry()) };
}

type ListedProps = { runtime: PageRuntime; reads: Reads; boot: RegistryBoot };

function HomeListed({ runtime, reads, boot }: ListedProps) {
  const nowMs = useNow();
  const merge = useShownRead(reads.merge, "all");
  const { projects, funding } = useListing(reads, boot, merge, nowMs);
  return <HomePage runtime={runtime} projects={projects} funding={funding} />;
}

function retrySection(section: ProjectRuntime): Shown<never> {
  return {
    status: "Failed",
    value: undefined,
    onRetry: () => {
      retryOnce(section, "reads");
      retryOnce(section, "registry");
    },
  };
}

export function HomeRoute({ runtime }: PageProps) {
  const { section, reads, boot } = useSection(runtime);
  if (reads.status === "done" && boot.status === "done") return <HomeListed runtime={runtime} reads={reads.value} boot={boot.value} />;
  const projects = reads.status === "failed" || boot.status === "failed" ? retrySection(section) : unread;
  return <HomePage runtime={runtime} projects={projects} funding="PoolLoading" />;
}

function liveOf(work: Settled<Effect.Success<ReturnType<typeof loadWork>>>): Shown<LiveFootprint> {
  if (work.status !== "done") return { status: settledStatus(work), value: undefined };
  const { snapshot } = work.value.board;
  const footprint = summarizeWhoBuilds(snapshot, () => undefined);
  const { mergedPullRequests, mergedPullRequestsWithModel } = summarizeModelOutcomes(snapshot).totals;
  return {
    status: work.value.stale ? "Stale" : "Current",
    value: { contributors: footprint.contributors, windowDays: footprint.windowDays, scoredEvents: footprint.scoredEvents, mergedPullRequests, mergedPullRequestsWithModel },
  };
}

const noMergeLine: MergeLine = () => null;

function SponsorsListed({ runtime, section, reads, boot }: ListedProps & { section: ProjectRuntime }) {
  const nowMs = useNow();
  const merge = useShownRead(reads.merge, "all");
  const { projects } = useListing(reads, boot, merge, nowMs);
  const mergeLine = useMergeLine(merge, nowMs);
  const whoBuilds = useOnce(section, "who-builds", () => whoBuildsFigures());
  const work = useMounted(section, () => loadWork(boot, repositoryRegistryOf, false));
  return <SponsorsPage runtime={runtime} projects={projects} mergeLine={mergeLine} networkPays={networkPays} whoBuilds={whoBuilds.status === "done" ? whoBuilds.value : undefined} live={liveOf(work)} />;
}

export function SponsorsRoute({ runtime }: PageProps) {
  const { section, reads, boot } = useSection(runtime);
  if (reads.status === "done" && boot.status === "done") return <SponsorsListed runtime={runtime} section={section} reads={reads.value} boot={boot.value} />;
  const projects = reads.status === "failed" || boot.status === "failed" ? retrySection(section) : unread;
  return <SponsorsPage runtime={runtime} projects={projects} mergeLine={noMergeLine} networkPays={networkPays} whoBuilds={undefined} live={unread} />;
}
