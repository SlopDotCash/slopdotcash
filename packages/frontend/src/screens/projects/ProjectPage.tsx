// spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/backend/listing.md, "A restricted project is closed on every public route and a paused one stays listed"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/rankedSnapshot.md, "A candidate check records score and payment results separately"; spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"; spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/views.md, "Suggested work lists the wanted issues first, unclaimed before taken, at most ten, and a failed wanted read leaves the suggestions as before"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"
import { Alert, Button, DataState, NotFound, PageHeader } from "@repo/ui";
import type { Effect } from "effect";
import { type ReactNode, useState } from "react";
import { reviewBudgetShown } from "../../../gen/frontend__views.ts";
import type { PageProps } from "../../app/pages.ts";
import { NotFoundHead } from "../../app/notFoundHead.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { formatRewardMinor } from "../../kernels/assetText.ts";
import { hasBountyOverview } from "../../kernels/rewardSummary.ts";
import { pageOrigin } from "../../platform/environment.ts";
import { maintainerShareLines } from "../../projections/maintainerShare.ts";
import { findProject, type RegistryBoot } from "../../reads/registry.vibe";
import { BountyFunding, BountyIntroduction, bountyProjectOf } from "../funding/awards/index.ts";
import { ProjectStandings } from "../points/index.ts";
import { FundedMeter } from "../cycles/CycleAllocation.tsx";
import { copyText } from "../home/prompt.vibe";
import type { NetworkPays } from "../public/funding.ts";
import { type Settled, useMounted, useOnce } from "../security/program/hooks.ts";
import { FundsAndAwards } from "./FundsAndAwards.tsx";
import { useShownRead } from "./hooks.ts";
import { clearanceOf, InstallPanel } from "./InstallPanel.tsx";
import { MergeActivity } from "./MergeActivity.tsx";
import { Participation } from "./Participation.tsx";
import { PaymentHistory } from "./PaymentHistory.tsx";
import { ProjectHeader } from "./ProjectHeader.tsx";
import { ProjectLinks } from "./ProjectLinks.tsx";
import { ProjectWork, type WorkShown } from "./ProjectWork.tsx";
import type { ShownProject } from "./project.schema.ts";
import { loadProject, loadWork, type ProjectRuntime, projectName, projectReads, projectRuntime, type RepositoryRegistryOf, type Work } from "./reads.vibe";
import { RewardSummary } from "./RewardSummary.tsx";
import { awardMonths, projectCycles, projectFunding, projectHeld, projectListing, projectPromiseOf, type ShownWanted, suggestedWork, wantedReadOf } from "./summary.ts";

export type ProjectPageProps = PageProps & {
  /** Whether payments run on a network: only vaults on paying networks hold a pool's monthly amount. */
  networkPays: NetworkPays;
  /** The repository registry the public snapshot is checked against, from the project registry. */
  repositoryRegistry: RepositoryRegistryOf;
};

type Reads = Effect.Success<ReturnType<typeof projectReads>>;

type Found = {
  runtime: PageRuntime;
  project: ShownProject;
  boot: RegistryBoot;
  reads: Reads;
  networkPays: NetworkPays;
  repositoryRegistry: RepositoryRegistryOf;
};

const pageClass = "mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-12 px-4 py-12";

function Loading() {
  return (
    <main className={pageClass}>
      <DataState status="Loading" />
    </main>
  );
}

/** "Project not found" for an address that names no listed project; the page is noindex with no canonical while it is mounted. */
export function ProjectNotFound() {
  return (
    <NotFound title="Project not found" className={pageClass}>
      <NotFoundHead />
      <p>This project isn&apos;t listed.</p>
    </NotFound>
  );
}

/** The project registry could not be read: no project page can be trusted without it. */
export function ProjectsUnavailable({ message }: { message: string }) {
  return (
    <main className={pageClass}>
      <PageHeader title="Projects are unavailable" />
      <Alert
        variant="destructive"
        action={
          <Button variant="outline" size="sm" onClick={() => location.reload()}>
            Try again
          </Button>
        }
      >
        {message}
      </Alert>
      <p>
        <a href="/login" className="text-primary underline underline-offset-4 hover:decoration-2">
          Sign in
        </a>{" "}
        ·{" "}
        <a href="/account" className="text-primary underline underline-offset-4 hover:decoration-2">
          Account
        </a>
      </p>
    </main>
  );
}

function PoolSummary({ project, boot, reads, networkPays }: Pick<Found, "project" | "boot" | "reads" | "networkPays">) {
  const pool = useShownRead(reads.pool, "all");
  const read = { status: pool.status, vaults: pool.value?.get(project.id) };
  const funding = projectFunding({ project, read, networkPays, nowMs: Date.now() });
  const record = findProject(boot, project.id);
  const shareNotice = record === undefined ? null : (maintainerShareLines(record, new Date())?.notice ?? null);
  return <RewardSummary project={project} funding={funding} promise={projectPromiseOf({ project, funding, read, networkPays })} shareNotice={shareNotice} />;
}

function MergeLine({ project, reads }: Pick<Found, "project" | "reads">) {
  const merge = useShownRead(reads.merge, "all");
  return <MergeActivity project={project} merge={merge} nowMs={Date.now()} />;
}

function Install({ runtime, project, reads, networkPays }: Pick<Found, "runtime" | "project" | "reads" | "networkPays">) {
  const discovery = useShownRead(reads.discovery, "all");
  const merge = useShownRead(reads.merge, "all");
  const nowMs = Date.now();
  return (
    <InstallPanel
      key={project.id}
      project={project}
      clearance={clearanceOf(discovery, project.id)}
      listing={projectListing({ project, networkPays, nowMs })}
      held={projectHeld(project, merge, nowMs)}
      origin={pageOrigin()}
      onCopy={(text) => runtime.runPromise(copyText(text))}
    />
  );
}

function workOf(read: Settled<Work>, project: ShownProject, wanted: ReadonlyArray<ShownWanted>): WorkShown {
  if (read.status === "running") return { status: "loading" };
  if (read.status === "failed") return { status: "failed" };
  const { board, stale, refreshFailed } = read.value;
  return { status: "ready", items: suggestedWork(board.snapshot.workQueue, project, wanted), generatedAt: board.snapshot.generatedAt, stale, refreshFailed };
}

function WorkRead({ section, project, boot, reads, repositoryRegistry, force, onRetry }: Pick<Found, "project" | "boot" | "reads" | "repositoryRegistry"> & { section: ProjectRuntime; force: boolean; onRetry: () => void }) {
  const read = useMounted(section, () => loadWork(boot, repositoryRegistry, force));
  const wanted = wantedReadOf(project, useShownRead(reads.merge, "all"));
  return <ProjectWork work={workOf(read, project, wanted.issues)} wanted={wanted} onRetry={onRetry} />;
}

function SuggestedWork(props: Pick<Found, "project" | "boot" | "reads" | "repositoryRegistry"> & { section: ProjectRuntime }) {
  const [attempt, setAttempt] = useState(0);
  return <WorkRead key={attempt} {...props} force={attempt > 0} onRetry={() => setAttempt((count) => count + 1)} />;
}

function History({ runtime, project, reads, networkPays }: Pick<Found, "runtime" | "project" | "reads" | "networkPays">) {
  const cycles = useShownRead(reads.cycles, "index");
  const direct = useShownRead(reads.direct, `project:${project.id}`);
  const listed = cycles.value?.cycles ?? [];
  const externalPrize = project.reward.kind === "external-prize-share";
  return (
    <>
      <FundsAndAwards runtime={runtime} project={project} awardMonths={awardMonths(listed, project.id)} networkPays={networkPays} />
      <PaymentHistory
        project={{ id: project.id, slug: project.slug, name: project.name, externalPrize }}
        cycles={{ ...cycles, value: cycles.value === undefined ? undefined : projectCycles(listed, project.id) }}
        direct={direct}
        nowMs={Date.now()}
      />
    </>
  );
}

function BountyOverview({ runtime, project, boot, reads, networkPays }: Pick<Found, "runtime" | "project" | "boot" | "reads" | "networkPays">) {
  const bounty = bountyProjectOf(project.record);
  if (bounty === undefined) return <ProjectsUnavailable message="This project's security bounty terms could not be read." />;
  return (
    <main className={pageClass}>
      <BountyIntroduction
        project={bounty}
        header={
          <>
            <ProjectHeader project={project} />
            <PoolSummary project={project} boot={boot} reads={reads} networkPays={networkPays} />
            <ProjectLinks record={project.record} />
          </>
        }
        origin={pageOrigin()}
        onCopy={(text) => runtime.runPromise(copyText(text))}
      />
      <BountyFunding project={bounty} />
    </main>
  );
}

function ProjectOverview({ section, ...found }: Found & { section: ProjectRuntime }) {
  const { runtime, project, boot, reads, networkPays, repositoryRegistry } = found;
  const active = project.status === "active";
  const successor = project.participation?.state === "archived" ? projectName(boot, project.participation.successorProjectId) : undefined;
  const budget = project.reward.reviewBudget;
  return (
    <main className={pageClass}>
      <section className="flex flex-col gap-6">
        <ProjectHeader project={project} />
        <PoolSummary project={project} boot={boot} reads={reads} networkPays={networkPays} />
        <ProjectLinks record={project.record} />
        {active ? <MergeLine project={project} reads={reads} /> : null}
        {budget && reviewBudgetShown(budget.fundingState === "committed") ? (
          <p>
            <FundedMeter label="Reviews" fundedMinor={budget.committedMinor} funded={formatRewardMinor(budget.committedMinor)} cap={budget.monthlyCapDisplay} />
          </p>
        ) : null}
        <Participation project={project} successorName={successor} install={<Install runtime={runtime} project={project} reads={reads} networkPays={networkPays} />} />
      </section>
      {active ? <SuggestedWork section={section} project={project} boot={boot} reads={reads} repositoryRegistry={repositoryRegistry} /> : null}
      <History runtime={runtime} project={project} reads={reads} networkPays={networkPays} />
      <div id="contributors">
        <ProjectStandings runtime={runtime} projectId={project.id} />
      </div>
    </main>
  );
}

function FoundProject({ section, ...found }: Omit<Found, "reads"> & { section: ProjectRuntime }): ReactNode {
  const reads = useOnce(section, "reads", () => projectReads());
  if (reads.status === "running") return <Loading />;
  if (reads.status === "failed") return <ProjectsUnavailable message={reads.message} />;
  if (hasBountyOverview(found.project)) return <BountyOverview {...found} reads={reads.value} />;
  return <ProjectOverview section={section} {...found} reads={reads.value} />;
}

/** `/projects/:id`: the project from the registry, its rewards, how to take part, suggested work, its vault and its payment history. */
export function ProjectPage({ runtime, route, networkPays, repositoryRegistry }: ProjectPageProps) {
  const section = projectRuntime(runtime);
  const read = useOnce(section, `project:${route.projectId}`, () => loadProject(route.projectId));
  if (read.status === "running") return <Loading />;
  if (read.status === "failed") return <ProjectsUnavailable message={read.message} />;
  if (read.value.kind === "missing") return <ProjectNotFound />;
  if (read.value.kind === "failed") return <ProjectsUnavailable message={read.value.message} />;
  const { project, boot } = read.value;
  return <FoundProject key={project.id} section={section} runtime={runtime} project={project} boot={boot} networkPays={networkPays} repositoryRegistry={repositoryRegistry} />;
}
