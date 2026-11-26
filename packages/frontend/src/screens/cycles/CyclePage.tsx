// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/views.md, "A cycle reminds viewers to check funding from seven days before close only for an unsettled monthly pool with a non-zero cap"; spec/frontend/rankedSnapshot.md, "A candidate check records score and payment results separately"; spec/frontend/requests.md, "Only the current request may publish its validated result"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
import type { CycleIndex, CycleIndexEntry } from "@repo/settlement/client";
import { parsePeriod, type Period } from "@repo/settlement/kernels/calendar";
import { Alert, DataState, Disclosure, EmptyState, NotFound, PageHeader, Status, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { CalendarDays, CircleAlert, History } from "lucide-react";
import type { Effect } from "effect";
import { type ReactNode, useState } from "react";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { pageShellClass } from "../../app/PageShell.tsx";
import type { PageProps } from "../../app/pages.ts";
import { formatDateTime } from "../../app/format.ts";
import { NotFoundHead } from "../../app/notFoundHead.ts";
import { formatRewardMinor } from "../../kernels/assetText.ts";
import { type ProjectCycleView, projectActivityCollected, projectCycleHasOpened, projectCycleView } from "../../projections/projectView.ts";
import { cutsKey } from "../../reads/payments.vibe";
import { findHistoricalProject, findProject, type RegistryBoot } from "../../reads/registry.vibe";
import type { Shown } from "../home/listing.ts";
import { useShownRead } from "../projects/hooks.ts";
import { formatDate, formatMonth, ProjectNotFound, ProjectsUnavailable, projectOf, type ShownProject } from "../projects/index.ts";
import { type ProjectRuntime, projectReads, projectRuntime, type RepositoryRegistryOf, type Work } from "../projects/reads.vibe";
import { capOf } from "../projects/summary.ts";
import { contributorReads, contributorRuntime, registryBoot } from "../points/reads.vibe";
import type { ProjectTermsOf } from "../profiles/profile.ts";
import { type Settled, useMounted, useOnce } from "../security/program/hooks.ts";
import { indexStale, StaleSince } from "./CycleArchivePage.tsx";
import { CycleAllocation } from "./CycleAllocation.tsx";
import { amountPhases, CycleAmountHistory, usdcText } from "./CycleAmountHistory.tsx";
import { contributorStateLabel, cycleLifecyclePresentation, percentText, pointsText } from "./labels.ts";
import { OwnerCuts } from "./OwnerCuts.tsx";
import { reminderLeadMs } from "../../../gen/frontend__views.ts";
import { nextBoundary, staleFrom, useBoundary } from "./boundary.ts";
import { loadLiveCycle } from "./live.vibe";
import { type CycleFacts, cycleTerminal, lifecycleOf, ownerCutoffMs, reminderShown, stagesOf, terminalMessage } from "./stages.ts";

export type CyclePageProps = PageProps & {
  /** The repository registry the public snapshot is checked against, from the project registry. */
  repositoryRegistry: RepositoryRegistryOf;
  /** Every registered project's reward terms, from the project registry. */
  projectTerms: ProjectTermsOf;
};

type ProjectSection = Effect.Success<ReturnType<typeof projectReads>>;
type ContributorSection = Effect.Success<ReturnType<typeof contributorReads>>;

const pageClass = pageShellClass("lg", "8", "py-12");
const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/u;

type Found = {
  props: CyclePageProps;
  boot: RegistryBoot;
  project: ShownProject;
  period: Period;
  section: ProjectRuntime;
  sectionReads: ProjectSection;
  reads: ContributorSection;
};

function CycleUnavailable() {
  return (
    <NotFound title="Cycle unavailable">
      <NotFoundHead />
    </NotFound>
  );
}

function Notice({ project, cycleId, status, onRetry, message }: { project: ShownProject; cycleId: string; status: ReadStatus; onRetry?: () => void; message?: string }) {
  return (
    <main className={pageClass}>
      <h1 className="text-3xl font-semibold text-foreground">
        {project.name} · {formatMonth(cycleId)}
      </h1>
      {message ? <Alert variant="destructive">{message}</Alert> : <DataState status={status} onRetry={onRetry} />}
    </main>
  );
}

function ArchivedContributors({ cycle }: { cycle: CycleIndexEntry }) {
  const external = cycle.kind === "external-prize-share";
  return (
    <section aria-labelledby="cycle-contributors" className="flex flex-col gap-4">
      <h2 id="cycle-contributors" className="text-xl font-semibold text-foreground">
        Contributors
      </h2>
      {cycle.contributors.length === 0 ? (
        <EmptyState title="No awards" />
      ) : (
        <Table label="Archived cycle contributors">
          <TableCaption visuallyHidden>Archived cycle contributors and current award amounts</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Contributor</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>{external ? "Share" : "Amount"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cycle.contributors.map((contributor) => {
              const [label, key] = amountPhases[contributor.state === "paid" ? 2 : cycle.approvedAt === null ? 0 : 1] ?? ["Suggested", "suggestedMinor"];
              return (
                <TableRow key={contributor.actor.id}>
                  <TableHead scope="row">
                    <a href={`/contributors/${encodeURIComponent(contributor.actor.login)}`} className={linkClass}>
                      {contributor.actor.login}
                    </a>
                    <small className="block text-xs font-normal text-muted-foreground">{contributorStateLabel(contributor.state)}</small>
                  </TableHead>
                  <TableCell className="font-mono tabular-nums">{pointsText(contributor.scoreThirds ?? contributor.score * 3)}</TableCell>
                  <TableCell>
                    {external ? (
                      <span className="font-mono tabular-nums">{percentText(contributor.sharePartsPerMillion ?? 0)}</span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <span>
                          {label} <strong className="font-mono tabular-nums">{usdcText(contributor[key])}</strong>
                        </span>
                        <details>
                          <summary aria-label="Amount history" title="Amount history" className="inline-flex cursor-pointer items-center text-muted-foreground">
                            <History aria-hidden className="size-3.5" />
                          </summary>
                          <CycleAmountHistory amounts={contributor} />
                        </details>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** @throws {never} */
function headline(record: CycleIndexEntry | undefined, view: ProjectCycleView | undefined, project: ShownProject): { readonly amount: string; readonly caption: string } {
  if (record) {
    if (record.kind === "external-prize-share") return { amount: percentText(record.reward.sharePartsPerMillion ?? 0), caption: "shares" };
    const paid = record.state === "paid";
    const approved = record.approvedAt !== null;
    return { amount: usdcText(paid ? record.reward.paidMinor : approved ? record.reward.approvedMinor : record.reward.suggestedMinor), caption: paid ? "paid" : approved ? "approved" : "suggested" };
  }
  if (view?.kind === "monthly-pool") return { amount: formatRewardMinor(view.reward.projectedPrincipalMinor, project.rewardAsset), caption: "projected" };
  return { amount: percentText(view?.kind === "external-prize-share" ? view.reward.totalSharePartsPerMillion : 0n), caption: "shares" };
}

function Cuts({ reads, project, cycleId }: { reads: ContributorSection; project: ShownProject; cycleId: string }) {
  const cuts = useShownRead(reads.cuts, cutsKey(project.id, cycleId));
  return <OwnerCuts cuts={cuts} asset={project.rewardAsset} />;
}

function CycleView({ found, record, view, index, snapshotAt, freshness }: { found: Found; record: CycleIndexEntry | undefined; view: ProjectCycleView | undefined; index: CycleIndex | undefined; snapshotAt: string | undefined; freshness: ReactNode }) {
  const { boot, project, period, reads, props, section } = found;
  const cycleId = props.route.cycleId;
  const listed = findProject(boot, project.id) !== undefined;
  const projectHref = listed ? `/projects/${project.slug}` : `/cycles?project=${encodeURIComponent(project.id)}`;
  const from = record?.contributionWindow.from ?? view?.cycle.from;
  const to = record?.contributionWindow.to ?? view?.cycle.endsAt;
  const nowMs = Date.now();
  const reviewEndsMs = record?.state === "review" && record.reviewEndsAt ? Date.parse(record.reviewEndsAt) : undefined;
  useBoundary(section, nextBoundary(nowMs, [reviewEndsMs, ownerCutoffMs(period), index ? staleFrom(index.generatedAt) : undefined, to ? Date.parse(to) - reminderLeadMs : undefined]));
  if (!from || !to) return <CycleUnavailable />;
  const facts: CycleFacts = { record, view, period, capMinor: capOf(project, period), from, to, nowMs };
  const lifecycle = lifecycleOf(facts);
  const { stages, current } = stagesOf(facts);
  const terminal = terminalMessage(record);
  const ended = cycleTerminal(record);
  const top = headline(record, view, project);
  const basis = record?.kind === "monthly-pool" ? record.reward.fundingBasis : undefined;
  const noFunding = record !== undefined && record.state !== "paid" && basis !== undefined && (basis.fundingState !== "committed" || basis.committedMinor === "0");
  return (
    <main className={pageClass}>
      {record && index ? indexStale(index, nowMs) ? <StaleSince generatedAt={index.generatedAt} /> : null : freshness}
      <section className="flex flex-col gap-4">
        <PageHeader
          icon={<CalendarDays aria-hidden />}
          title={`${project.name} · ${formatMonth(cycleId)}`}
          eyebrow={
            <a href={projectHref} className={linkClass}>
              {project.name}
            </a>
          }
          lead={
            <>
              {formatDate(from)}–{formatDate(to)}
            </>
          }
        >
          <Status className="mt-4 self-start" presentation={record ? cycleLifecyclePresentation(record, nowMs) : { tone: lifecycle === "live" ? "Notice" : "Caution", icon: "Clock", label: lifecycle.replaceAll("-", " ") }} />
        </PageHeader>
        <div className="flex flex-col gap-1">
          <strong className="font-mono text-3xl tabular-nums">{top.amount}</strong>
          <span className="text-sm text-muted-foreground">{top.caption}</span>
          {noFunding ? <Status presentation={{ tone: "Caution", icon: "Alert", label: "Unfunded" }} /> : null}
        </div>
      </section>
      {reminderShown(facts) ? (
        <Alert variant="warn" announcement="Polite">
          <span className="inline-flex items-center gap-2">
            <CircleAlert aria-hidden className="size-4" />
            {listed ? (
              <a href={`/projects/${project.slug}/funding`} className={linkClass}>
                Check funding →
              </a>
            ) : (
              <span>Funding unverified</span>
            )}
          </span>
        </Alert>
      ) : null}
      {terminal ? <p>{terminal}</p> : null}
      {ended ? null : (
        <ol aria-label="Cycle progress" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {stages.map((stage, position) => (
            <li key={stage.label} aria-current={position === current ? "step" : undefined} className="flex flex-col gap-1">
              <strong>{stage.label}</strong>
              <p className="text-sm text-muted-foreground">{stage.description}</p>
            </li>
          ))}
        </ol>
      )}
      {ownerCutoffMs(period) !== undefined ? <Cuts reads={reads} project={project} cycleId={cycleId} /> : null}
      {record?.reward.lines ? (
        <Disclosure summary="Breakdown">
          <CycleAmountHistory amounts={record.reward} />
        </Disclosure>
      ) : null}
      {record ? <ArchivedContributors cycle={record} /> : view && snapshotAt ? <CycleAllocation view={view} updatedAt={snapshotAt} project={project} /> : null}
    </main>
  );
}

function workStatus(read: Settled<{ readonly work: Work }>): ReadStatus {
  if (read.status === "running") return "Loading";
  if (read.status === "failed") return "Failed";
  return read.value.work.stale || read.value.work.refreshFailed ? "Stale" : "Current";
}

/** @throws {never} */
function liveView(work: Work, found: Found, cycleId: string): { readonly view?: ProjectCycleView; readonly collected: boolean; readonly message?: string } {
  const terms = found.props.projectTerms(found.boot).find((entry) => entry.id === found.project.id);
  const { snapshot, payment } = work.board;
  if (terms === undefined || !projectActivityCollected(snapshot, terms, cycleId)) return { collected: false };
  if (!projectCycleHasOpened(snapshot, terms, cycleId)) return { collected: true };
  try {
    return { collected: true, view: projectCycleView({ snapshot, payment, registry: found.props.repositoryRegistry(found.boot), project: terms, cycleId }) };
  } catch (error) {
    return { collected: true, message: error instanceof Error ? error.message : "The cycle could not be computed." };
  }
}

function Live({ found, force, onRetry }: { found: Found; force: boolean; onRetry: () => void }) {
  const { props, project, boot, section } = found;
  const cycleId = props.route.cycleId;
  const loaded = useMounted(section, () => loadLiveCycle(boot, props.repositoryRegistry, force));
  if (loaded.status !== "done") return <Notice project={project} cycleId={cycleId} status={workStatus(loaded)} onRetry={onRetry} />;
  const { work, index } = loaded.value;
  const status = workStatus(loaded);
  const freshness = status === "Stale" ? <StaleSince generatedAt={work.board.snapshot.generatedAt} shown={formatDateTime(work.board.snapshot.generatedAt)} onRetry={onRetry} /> : null;
  const record = index.cycles.find((cycle) => cycle.projectId === project.id && cycle.cycleId === cycleId);
  if (record) return <CycleView found={found} record={record} view={undefined} index={index} snapshotAt={work.board.snapshot.generatedAt} freshness={freshness} />;
  const live = liveView(work, found, cycleId);
  if (live.message) return <Notice project={project} cycleId={cycleId} status="Invalid" message={live.message} />;
  if (!live.view) {
    const listed = findProject(boot, project.id) !== undefined;
    return (
      <NotFound title={`No ${formatMonth(cycleId)} cycle record`}>
        <NotFoundHead />
        <p>
          {live.collected ? "" : "Not collected yet · "}
          <a href={listed ? `/projects/${project.slug}` : `/cycles?project=${encodeURIComponent(project.id)}`} className={linkClass}>
            {listed ? "Project" : "Archive"}
          </a>
        </p>
      </NotFound>
    );
  }
  return <CycleView found={found} record={undefined} view={live.view} index={index} snapshotAt={work.board.snapshot.generatedAt} freshness={freshness} />;
}

function Archived({ found }: { found: Found }) {
  const { props, project, sectionReads } = found;
  const cycleId = props.route.cycleId;
  const [attempt, setAttempt] = useState(0);
  const cycles: Shown<CycleIndex> = useShownRead(sectionReads.cycles, "index");
  if (cycles.value === undefined) return <Notice project={project} cycleId={cycleId} status={cycles.status} onRetry={cycles.onRetry} />;
  const record = cycles.value.cycles.find((cycle) => cycle.projectId === project.id && cycle.cycleId === cycleId);
  if (record) return <CycleView found={found} record={record} view={undefined} index={cycles.value} snapshotAt={undefined} freshness={null} />;
  return <Live key={attempt} found={found} force={attempt > 0} onRetry={() => setAttempt((count) => count + 1)} />;
}

/** `/cycles/:project/:month`: the frozen cycle record when one is published, else the month's live projection from the public snapshot. */
export function CyclePage(props: CyclePageProps) {
  const { runtime, route } = props;
  const section = projectRuntime(runtime);
  const registry = useOnce(section, "registry", () => registryBoot());
  const sectionReads = useOnce(section, "reads", () => projectReads());
  const reads = useOnce(contributorRuntime(runtime), "reads", () => contributorReads());
  const period = monthPattern.test(route.cycleId) ? parsePeriod(route.cycleId) : undefined;
  if (period === undefined) return <CycleUnavailable />;
  if (registry.status === "running" || sectionReads.status === "running" || reads.status === "running") {
    return (
      <main className={pageClass}>
        <DataState status="Loading" />
      </main>
    );
  }
  if (registry.status === "failed") return <ProjectsUnavailable message={registry.message} />;
  if (registry.value.error !== undefined) return <ProjectsUnavailable message={registry.value.error} />;
  if (sectionReads.status === "failed") return <ProjectsUnavailable message={sectionReads.message} />;
  if (reads.status === "failed") return <ProjectsUnavailable message={reads.message} />;
  const record = findHistoricalProject(registry.value, route.projectId);
  if (record === undefined) return <ProjectNotFound />;
  const project = projectOf(record);
  if (project === undefined) return <ProjectsUnavailable message="This project's record could not be read." />;
  return <Archived key={`${route.projectId}\n${route.cycleId}`} found={{ props, boot: registry.value, project, period, section, sectionReads: sectionReads.value, reads: reads.value }} />;
}
