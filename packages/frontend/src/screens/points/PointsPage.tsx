// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"; spec/backend/accounts.md, "Public reads show only public open members and never publish anything"; spec/frontend/requests.md, "Only the current request may publish its validated result"
import { DataState, Disclosure, PageHeader, Status } from "@repo/ui";
import type { Effect } from "effect";
import { BookOpen, Download, Users } from "lucide-react";
import type { PageProps } from "../../app/pages.ts";
import type { RegistryBoot } from "../../reads/registry.vibe";
import { useShownRead } from "../projects/hooks.ts";
import { projectRuntime } from "../projects/reads.vibe";
import { ContributionPointTiers } from "../public/index.ts";
import { type Settled, useOnce } from "../security/program/hooks.ts";
import { People, type PeopleMembers } from "./People.tsx";
import { stewardsOf } from "./peopleRows.ts";
import { useQuery } from "./query.ts";
import { type ContributorRuntime, contributorReads, contributorRuntime, origin, registryBoot } from "./reads.vibe";

const pageClass = "mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-8 px-4 py-12";
const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

const reviewTiers: ReadonlyArray<readonly [string, number]> = [
  ["Triage", 10],
  ["Standard", 30],
  ["Deep", 90],
  ["Specialist", 240],
];

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

type Reads = Effect.Success<ReturnType<typeof contributorReads>>;

function Directory({ reads, boot, members }: { reads: Reads; boot: RegistryBoot | undefined; members: PeopleMembers }) {
  const { params } = useQuery();
  const census = useShownRead(reads.profiles, "all");
  return <People census={census} members={members} stewards={stewardsOf(boot?.projects ?? [])} query={params.get("q") ?? ""} />;
}

function PublicMembers({ reads, boot }: { reads: Reads; boot: RegistryBoot | undefined }) {
  const people = useShownRead(reads.people, "all");
  return <Directory reads={reads} boot={boot} members={{ kind: "read", people }} />;
}

function Members({ section, reads, boot }: { section: ContributorRuntime; reads: Reads; boot: RegistryBoot | undefined }) {
  const site = useOnce(section, "origin", () => origin());
  if (site.status === "running") return <DataState status="Loading" />;
  if (site.status === "done" && !site.value.product) return <Directory reads={reads} boot={boot} members={{ kind: "preview", site: site.value.site }} />;
  return <PublicMembers reads={reads} boot={boot} />;
}

function bootOf(read: Settled<RegistryBoot>): RegistryBoot | undefined {
  return read.status === "done" && read.value.error === undefined ? read.value : undefined;
}

/** `/points`: the contributor directory, never a ranking, and the Points rules. */
export function PointsPage({ runtime }: PageProps) {
  const section = contributorRuntime(runtime);
  const reads = useOnce(section, "reads", () => contributorReads());
  const registry = useOnce(projectRuntime(runtime), "registry", () => registryBoot());
  return (
    <main className={pageClass}>
      <PageHeader icon={<Users aria-hidden />} title="Contributors" />
      {reads.status === "running" ? (
        <DataState status="Loading" />
      ) : reads.status === "failed" ? (
        <DataState status="Failed" onRetry={() => location.reload()} retryLabel="Retry contributors" />
      ) : (
        <Members section={section} reads={reads.value} boot={bootOf(registry)} />
      )}
      <Rules />
    </main>
  );
}
