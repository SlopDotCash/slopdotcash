// spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"; spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section"; spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"; spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"; spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import { fromAmount } from "@repo/settlement/kernels/amounts";
import type { Effect } from "effect";
import { promiseWarning } from "../../gen/frontend__projections.ts";
import type { ReadStatus } from "../../gen/frontend__requests.ts";
import { formatRewardMinor } from "../kernels/assetText.ts";
import { networkPays } from "../kernels/payingNetworks.ts";
import { mergeActivityCardLine, summarizeModelOutcomes, summarizeWhoBuilds } from "../projections/statistics.ts";
import { whoBuildsFigures } from "../reads/funding.vibe";
import { loadPointsSummary } from "../reads/points.vibe";
import { listedProjects, loadRegistry, type RegistryBoot } from "../reads/registry.vibe";
import { repositoryRegistryOf } from "../reads/registryTerms.ts";
import { HomePage, projectPromise } from "../screens/home/index.ts";
import type { ListedProject, MergeLine, Shown } from "../screens/home/index.ts";
import { projectFunding, shownReward } from "../screens/projects/summary.ts";
import { projectOf } from "../screens/projects/project.schema.ts";
import { loadWork, type ProjectRuntime, projectReads, projectRuntime } from "../screens/projects/reads.vibe";
import { useShownRead } from "../screens/projects/hooks.ts";
import { type LiveFootprint, SponsorsPage } from "../screens/public/index.ts";
import { type Settled, useMounted, useOnce } from "../screens/security/program/hooks.ts";
import type { PageProps } from "./pages.ts";
import type { PageRuntime } from "./runtime.vibe";

type Reads = Effect.Success<ReturnType<typeof projectReads>>;

const unread: Shown<never> = { status: "Loading", value: undefined };

function settledStatus(settled: Settled<unknown>): ReadStatus {
  return settled.status === "running" ? "Loading" : settled.status === "failed" ? "Failed" : "Current";
}

function registryStatus(boot: RegistryBoot): ReadStatus {
  return boot.error !== undefined ? "Failed" : boot.freshness.tag === "RegistryStale" ? "Stale" : "Current";
}

function useListing(reads: Reads, boot: RegistryBoot): Shown<ReadonlyArray<ListedProject>> {
  const pool = useShownRead(reads.pool, "all");
  const nowMs = Date.now();
  const listed = listedProjects(boot).flatMap((record) => {
    const project = projectOf(record);
    if (project === undefined) return [];
    const vaults = pool.value?.get(project.id);
    const funding = projectFunding({ project, read: { status: pool.status, vaults }, networkPays, nowMs });
    const promise = projectPromise({ pool: funding.facts, honorSystem: project.reward.honorSystem === true, deployments: project.deployments, vaults: vaults ?? [], networkPays });
    const month = fromAmount(funding.facts.amount);
    const shown = promiseWarning(promise) === "NoPromise" ? shownReward(project, funding) : { ...project, reward: { ...project.reward, monthlyCapMinor: month, monthlyCapDisplay: formatRewardMinor(month, project.rewardAsset), cycleCaps: [] } };
    return [{ ...shown, funding: funding.facts, promise, escrow: { deployments: project.deployments } } satisfies ListedProject];
  });
  return { status: registryStatus(boot), value: boot.error === undefined ? listed : undefined };
}

function useMergeLine(reads: Reads): MergeLine {
  const merge = useShownRead(reads.merge, "all");
  const nowMs = Date.now();
  return (project) => (merge.status === "Current" || merge.status === "Stale" ? mergeActivityCardLine(merge.value?.get(project.id), nowMs) : null);
}

function useSection(runtime: PageRuntime): { readonly section: ProjectRuntime; readonly reads: Settled<Reads>; readonly boot: Settled<RegistryBoot> } {
  const section = projectRuntime(runtime);
  return { section, reads: useOnce(section, "reads", () => projectReads()), boot: useOnce(section, "registry", () => loadRegistry()) };
}

function HomeListed({ runtime, section, reads, boot }: { runtime: PageRuntime; section: ProjectRuntime; reads: Reads; boot: RegistryBoot }) {
  const projects = useListing(reads, boot);
  const summary = useOnce(section, "points-summary", () => loadPointsSummary());
  const totals = { status: settledStatus(summary), value: summary.status === "done" ? summary.value.contributors : undefined };
  return <HomePage runtime={runtime} projects={projects} totals={totals} />;
}

const failedRead: Shown<never> = { status: "Failed", value: undefined, onRetry: () => location.reload() };

/** `/`: the home page over the project registry, this month's pool funding and owner promises, and the lifetime Points summary. */
export function HomeRoute({ runtime }: PageProps) {
  const { section, reads, boot } = useSection(runtime);
  if (reads.status === "done" && boot.status === "done") return <HomeListed runtime={runtime} section={section} reads={reads.value} boot={boot.value} />;
  const projects = reads.status === "failed" || boot.status === "failed" ? failedRead : unread;
  return <HomePage runtime={runtime} projects={projects} totals={unread} />;
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

function SponsorsListed({ runtime, section, reads, boot }: { runtime: PageRuntime; section: ProjectRuntime; reads: Reads; boot: RegistryBoot }) {
  const projects = useListing(reads, boot);
  const mergeLine = useMergeLine(reads);
  const whoBuilds = useOnce(section, "who-builds", () => whoBuildsFigures());
  const work = useMounted(section, () => loadWork(boot, repositoryRegistryOf, false));
  if (whoBuilds.status === "running") return null;
  if (whoBuilds.status === "failed") throw new Error(whoBuilds.message);
  return <SponsorsPage runtime={runtime} projects={projects} mergeLine={mergeLine} networkPays={networkPays} whoBuilds={whoBuilds.value} live={liveOf(work)} />;
}

/** `/sponsors`: funded and fundable projects, how sponsorship works, and the audience report with the live footprint. */
export function SponsorsRoute({ runtime }: PageProps) {
  const { section, reads, boot } = useSection(runtime);
  if (reads.status === "failed") throw new Error(reads.message);
  if (boot.status === "failed") throw new Error(boot.message);
  if (reads.status === "running" || boot.status === "running") return null;
  return <SponsorsListed runtime={runtime} section={section} reads={reads.value} boot={boot.value} />;
}
