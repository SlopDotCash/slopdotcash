// spec/frontend/views.md, "Cycle archive filters keep only selections that a published cycle supports"; spec/frontend/snapshotCache.md, "A cached snapshot is fresh for 60 seconds, stale 8 hours after generation, and a failed read retries once after 400 ms unless aborted"; spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
import type { CycleIndex, CycleIndexEntry } from "@repo/settlement/client";
import { Alert, Button, cn, DataState, Label, PageHeader, Select, shell, Spinner, Status } from "@repo/ui";
import { CalendarDays } from "lucide-react";
import type { Effect } from "effect";
import type { ReactNode } from "react";
import { snapshotStale } from "../../../gen/frontend__snapshotCache.ts";
import type { PageProps } from "../../app/pages.ts";
import type { RegistryBoot } from "../../reads/registry.vibe";
import type { Shown } from "../home/listing.ts";
import { useShownRead } from "../projects/hooks.ts";
import { formatDate, formatMonth, projectName, VaultPaymentHistory } from "../projects/index.ts";
import { type ProjectRuntime, projectReads, projectRuntime } from "../projects/reads.vibe";
import { contributorReads, contributorRuntime, registryBoot } from "../points/reads.vibe";
import { useQuery, writeQuery } from "../points/query.ts";
import { retryOnce, type Settled, useOnce } from "../../app/hooks.ts";
import { nextBoundary, staleFrom, useBoundary } from "./boundary.ts";
import { usdcText } from "./CycleAmountHistory.tsx";
import { archiveOrder, archiveView, type FilterKey, filterLabels, filterQuery, requestedFilter, selected } from "./filters.ts";
import { cycleLifecyclePresentation, cycleStateLabel, percentText } from "./labels.ts";

type ProjectSection = Effect.Success<ReturnType<typeof projectReads>>;
type ContributorSection = Effect.Success<ReturnType<typeof contributorReads>>;

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** @throws {never} */
export function indexStale(index: Pick<CycleIndex, "generatedAt">, nowMs: number): boolean {
  return snapshotStale(nowMs, Date.parse(index.generatedAt));
}

export function StaleSince({ generatedAt, shown = formatDate(generatedAt), onRetry }: { generatedAt: string; shown?: string; onRetry?: () => void }) {
  return <DataState status="Stale" onRetry={onRetry} updatedAt={<time dateTime={generatedAt}>{shown}</time>} />;
}

function CycleRecord({ cycle, name, nowMs }: { cycle: CycleIndexEntry; name: string; nowMs: number }) {
  const stage = cycle.state === "paid" ? "Paid" : cycle.approvedAt !== null ? "Approved" : "Suggested";
  const amount = stage === "Paid" ? cycle.reward.paidMinor : stage === "Approved" ? cycle.reward.approvedMinor : cycle.reward.suggestedMinor;
  return (
    <article className="flex justify-between gap-6 border-b border-border py-4.5 max-md:flex-col max-md:gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-bold">
          <a href={`/cycles/${cycle.projectId}/${cycle.cycleId}`} className={linkClass}>
            {name} · {formatMonth(cycle.cycleId)}
          </a>
        </h2>
        <Status presentation={cycleLifecyclePresentation(cycle, nowMs)} />
      </div>
      {cycle.kind === "external-prize-share" ? (
        <dl>
          <dt className="text-sm text-muted-foreground">Share</dt>
          <dd className="font-mono tabular-nums">{percentText(cycle.reward.sharePartsPerMillion ?? 0)}</dd>
        </dl>
      ) : (
        <p>
          {stage} <strong className="font-mono tabular-nums">{usdcText(amount)}</strong>
        </p>
      )}
    </article>
  );
}

function Filters({ keys, options, filter, nameOf, total, shown }: { keys: ReadonlyArray<FilterKey>; options: Readonly<Record<FilterKey, ReadonlyArray<string>>>; filter: ReturnType<typeof requestedFilter>; nameOf: (projectId: string) => string; total: number; shown: number }) {
  const labelOf = (key: FilterKey, value: string) => (key === "project" ? nameOf(value) : key === "month" ? formatMonth(value) : cycleStateLabel(value as CycleIndexEntry["state"]));
  return (
    <div className="my-4 flex flex-wrap items-end gap-4">
      {keys.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <Label htmlFor={`cycle-filter-${key}`}>{filterLabels[key]}</Label>
          <Select id={`cycle-filter-${key}`} aria-label={filterLabels[key]} value={selected(filter, key)} onChange={(event) => writeQuery({ ...filterQuery(filter), [key]: event.target.value })}>
            <option value="">All</option>
            {options[key].map((value) => (
              <option key={value} value={value}>
                {labelOf(key, value)}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <p role="status" className="text-sm text-muted-foreground">
        {shown} of {total} cycles
      </p>
    </div>
  );
}

function Archive({ cycles, boot, nowMs }: { cycles: Shown<CycleIndex>; boot: RegistryBoot | undefined; nowMs: number }) {
  const { params } = useQuery();
  const requested = requestedFilter(params);
  const all = cycles.value === undefined ? undefined : archiveOrder(cycles.value.cycles);
  const view = archiveView(all, requested);
  if (view.changed) writeQuery(filterQuery(view.filter), false);
  const nameOf = (projectId: string) => (boot === undefined ? undefined : projectName(boot, projectId)) ?? projectId;
  const count = all?.length ?? 0;
  return (
    <>
      {count > 0 ? <Filters keys={view.offered} options={view.options} filter={view.filter} nameOf={nameOf} total={count} shown={view.cycles.length} /> : null}
      {view.noMatch ? (
        <p>
          No matches ·{" "}
          <Button variant="link" size="sm" onClick={() => writeQuery({ project: "", month: "", state: "" })}>
            Clear
          </Button>
        </p>
      ) : null}
      <div className="flex flex-col">
        {view.cycles.map((cycle) => (
          <CycleRecord key={`${cycle.projectId}-${cycle.cycleId}`} cycle={cycle} name={nameOf(cycle.projectId)} nowMs={nowMs} />
        ))}
      </div>
    </>
  );
}

function IndexState({ cycles, nowMs }: { cycles: Shown<CycleIndex>; nowMs: number }) {
  if (cycles.status === "Idle" || cycles.status === "Loading") return <Spinner label="Loading cycle history" />;
  if (cycles.value === undefined) {
    return (
      <Alert
        variant="destructive"
        action={
          <Button variant="outline" size="sm" onClick={cycles.onRetry}>
            Retry
          </Button>
        }
      >
        Cycle history unavailable.
      </Alert>
    );
  }
  return (
    <>
      {cycles.value.cycles.length === 0 ? <p className="mb-4">No cycles yet</p> : null}
      {cycles.status === "Stale" || indexStale(cycles.value, nowMs) ? <StaleSince generatedAt={cycles.value.generatedAt} onRetry={cycles.status === "Stale" ? cycles.onRetry : undefined} /> : null}
    </>
  );
}

function Loaded({ runtime, section, reads, boot }: { runtime: ProjectRuntime; section: ProjectSection; reads: ContributorSection; boot: RegistryBoot | undefined }) {
  const cycles = useShownRead(section.cycles, "index");
  const payments = useShownRead(reads.vault, "all");
  const nowMs = Date.now();
  const reviewEnds = (cycles.value?.cycles ?? []).map((cycle) => (cycle.state === "review" && cycle.reviewEndsAt ? Date.parse(cycle.reviewEndsAt) : undefined));
  useBoundary(runtime, nextBoundary(nowMs, [cycles.value ? staleFrom(cycles.value.generatedAt) : undefined, ...reviewEnds]));
  return (
    <>
      <Header>
        <IndexState cycles={cycles} nowMs={nowMs} />
      </Header>
      <VaultPaymentHistory className="py-24" payments={payments} nameOf={(projectId) => (boot === undefined ? undefined : projectName(boot, projectId))} />
      <Archive cycles={cycles} boot={boot} nowMs={nowMs} />
    </>
  );
}

function Header({ children }: { children: ReactNode }) {
  return (
    <PageHeader icon={<CalendarDays />} title="Payment cycles" className="mb-8 max-md:mb-6">
      {children}
    </PageHeader>
  );
}

function bootOf(read: Settled<RegistryBoot>): RegistryBoot | undefined {
  return read.status === "done" && read.value.error === undefined ? read.value : undefined;
}

export function CycleArchivePage({ runtime }: PageProps) {
  const section = projectRuntime(runtime);
  const contributor = contributorRuntime(runtime);
  const sectionReads = useOnce(section, "reads", () => projectReads());
  const reads = useOnce(contributor, "reads", () => contributorReads());
  const registry = useOnce(section, "registry", () => registryBoot());
  return (
    <main className={cn(shell, "flex flex-1 flex-col pt-12 pb-16 max-md:pt-8 max-md:pb-12")}>
      {sectionReads.status === "done" && reads.status === "done" ? (
        <Loaded runtime={section} section={sectionReads.value} reads={reads.value} boot={bootOf(registry)} />
      ) : (
        <Header>
          <DataState
            status={sectionReads.status === "failed" || reads.status === "failed" ? "Failed" : "Loading"}
            onRetry={() => {
              retryOnce(section, "reads");
              retryOnce(contributor, "reads");
              retryOnce(section, "registry");
            }}
          />
        </Header>
      )}
    </main>
  );
}
