// spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/backend/accounts.md, "Public reads show only public open members and never publish anything"; spec/frontend/requests.md, "Only the current request may publish its validated result"
import { DataState, Disclosure, PageHeader, SegmentedControl, Status } from "@repo/ui";
import type { Effect } from "effect";
import { BookOpen, ChartNoAxesColumnIncreasing, Download } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PageProps } from "../../app/pages.ts";
import { findProject, type RegistryBoot } from "../../reads/registry.vibe";
import { useShownRead } from "../projects/hooks.ts";
import { projectRuntime } from "../projects/reads.vibe";
import { ContributionPointTiers } from "../public/index.ts";
import { nextBoundary, useBoundary } from "../cycles/boundary.ts";
import { type Settled, useOnce } from "../security/program/hooks.ts";
import { ContributorStandings } from "./ContributorStandings.tsx";
import { useStandingHistory } from "./hooks.ts";
import { People, type PeopleMembers } from "./People.tsx";
import { stewardsOf } from "./peopleRows.ts";
import { useQuery, writeQuery } from "./query.ts";
import { type ContributorRuntime, contributorReads, contributorRuntime, origin, registryBoot } from "./reads.vibe";
import type { Period } from "./standings.ts";

const pageClass = "mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-8 px-4 py-12";
const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

const periods = [
  { value: "month", label: "This month" },
  { value: "lifetime", label: "All time" },
];

const reviewTiers: ReadonlyArray<readonly [string, number]> = [
  ["Triage", 10],
  ["Standard", 30],
  ["Deep", 90],
  ["Specialist", 240],
];

/** `period=new` was an earlier link to recorded history. @throws {never} */
export function periodOf(value: string | null): Period {
  return value === "lifetime" || value === "new" ? "lifetime" : "month";
}

/** @throws {never} */
function pageOf(value: string | null): number {
  return Math.max(1, Number.parseInt(value ?? "1", 10) || 1);
}

function Header({ controls }: { controls?: ReactNode }) {
  return <PageHeader icon={<ChartNoAxesColumnIncreasing aria-hidden />} title="Leaderboard" actions={controls} />;
}

function Rules() {
  return (
    <Disclosure id="rules" summary="Rules">
      <div className="flex flex-col gap-4">
        <ContributionPointTiers />
        <p className="flex flex-wrap gap-2">
          {reviewTiers.map(([tier, points]) => (
            <Status key={tier} title={`${tier} review: ${points} points`} presentation={{ tone: "Neutral", icon: "Eye", label: `${tier} ${points}` }} />
          ))}
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <a href="/protocol/points-v1.md" className={linkClass}>
            <BookOpen aria-hidden className="inline size-4" /> Rules
          </a>
          ·
          <a href="/data/points.json" download className={linkClass}>
            <Download aria-hidden className="inline size-4" /> JSON
          </a>
        </p>
      </div>
    </Disclosure>
  );
}

type Section = { section: ContributorRuntime; reads: Effect.Success<ReturnType<typeof contributorReads>>; boot: RegistryBoot | undefined; members: PeopleMembers };

function Standings({ section, reads, boot }: Pick<Section, "section" | "reads" | "boot">) {
  const { params } = useQuery();
  const nowMs = Date.now();
  useBoundary(section, nextBoundary(nowMs, []));
  const journal = useShownRead(reads.journal, "all");
  const requested = params.get("project") ?? "";
  const found = boot === undefined || requested === "" ? undefined : findProject(boot, requested);
  const project = typeof found?.id === "string" ? found.id : "";
  const history = useStandingHistory(journal, project || undefined);
  const period = periodOf(params.get("period"));
  const query = params.get("q") ?? "";
  const controls = (
    <SegmentedControl
      aria-label="Leaderboard period"
      options={periods}
      value={period}
      onValueChange={(value) => writeQuery({ sort: "", period: value === "lifetime" ? "lifetime" : "", page: "" })}
    />
  );
  return (
    <>
      <Header controls={controls} />
      <ContributorStandings
        key={`${period}\n${project}\n${query}`}
        history={history}
        period={period}
        query={query}
        page={pageOf(params.get("page"))}
        onPage={(page) => writeQuery({ page: page > 1 ? String(page) : "" })}
        nowMs={nowMs}
      />
    </>
  );
}

function PeopleView({ reads, boot, members }: Omit<Section, "section">) {
  const { params } = useQuery();
  const journal = useShownRead(reads.journal, "all");
  const history = useStandingHistory(journal);
  const census = useShownRead(reads.profiles, "all");
  return <People census={census} members={members} history={history} stewards={stewardsOf(boot?.projects ?? [])} query={params.get("q") ?? ""} />;
}

function PublicMembers({ reads, ...rest }: Omit<Section, "section" | "members">) {
  const people = useShownRead(reads.people, "all");
  return <PeopleView reads={reads} {...rest} members={{ kind: "read", people }} />;
}

function Views({ section, reads, boot }: Omit<Section, "members">) {
  const { params, hash } = useQuery();
  const people = params.get("view") === "people" || hash === "#people";
  const [visited, setVisited] = useState(people);
  if (people && !visited) setVisited(true);
  const site = useOnce(section, "origin", () => origin());
  return (
    <>
      {people ? <Header /> : null}
      <div hidden={people}>
        <Standings section={section} reads={reads} boot={boot} />
      </div>
      {visited ? (
        <div hidden={!people}>
          {site.status === "running" ? (
            <DataState status="Loading" />
          ) : site.status === "done" && !site.value.product ? (
            <PeopleView reads={reads} boot={boot} members={{ kind: "preview", site: site.value.site }} />
          ) : (
            <PublicMembers reads={reads} boot={boot} />
          )}
        </div>
      ) : null}
    </>
  );
}

function bootOf(read: Settled<RegistryBoot>): RegistryBoot | undefined {
  return read.status === "done" && read.value.error === undefined ? read.value : undefined;
}

/** `/points`: contributor standings this month or of all time, the people directory under `#people`, and the Points rules. */
export function PointsPage({ runtime }: PageProps) {
  const section = contributorRuntime(runtime);
  const reads = useOnce(section, "reads", () => contributorReads());
  const registry = useOnce(projectRuntime(runtime), "registry", () => registryBoot());
  return (
    <main className={pageClass}>
      {reads.status === "running" ? <DataState status="Loading" /> : reads.status === "failed" ? <DataState status="Failed" onRetry={() => location.reload()} retryLabel="Retry points" /> : <Views section={section} reads={reads.value} boot={bootOf(registry)} />}
      <Rules />
    </main>
  );
}
