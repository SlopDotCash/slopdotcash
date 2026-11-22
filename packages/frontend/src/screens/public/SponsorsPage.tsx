// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month's configured amount is positive"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/projections.md, "Free funds show how many whole months of the current amount they cover"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"; spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"; spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"
import { fromAmount } from "@repo/settlement/kernels/amounts";
import { DataState, Disclosure, ExternalLink, PageHeader } from "@repo/ui";
import { ArrowRight, HandCoins } from "lucide-react";
import type { ReactNode } from "react";
import { reviewBudgetShown } from "../../../gen/frontend__views.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useSession } from "../../app/useSession.ts";
import { formatRewardMinor, networkLabel } from "../../kernels/assetText.ts";
import { SOURCE_REPOSITORY } from "../../platform/site.ts";
import { Chip } from "../admin/parts.tsx";
import { FundedMeter } from "../cycles/CycleAllocation.tsx";
import { type ListedProject, onSponsors, type Shown, sponsorPoolLine } from "../home/listing.ts";
import type { MergeLine } from "../home/ProjectCards.tsx";
import { FundingStatus } from "./FundingStatus.tsx";
import type { NetworkPays } from "./funding.ts";
import { type LiveFootprint, WhoBuilds, whoBuildsDateLabel, type WhoBuildsSnapshot } from "./WhoBuilds.tsx";

const link = "text-primary underline underline-offset-4 hover:decoration-2";

export interface SponsorsReads {
  readonly projects: Shown<ReadonlyArray<ListedProject>>;
  readonly mergeLine: MergeLine;
  readonly networkPays: NetworkPays;
  readonly whoBuilds: WhoBuildsSnapshot | undefined;
  readonly live: Shown<LiveFootprint>;
}

export type SponsorsViewProps = SponsorsReads & {
  /** The source branch this deployment links its documents on. */
  branch: string;
};

function Explained({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {children}
      </div>
      {aside}
    </section>
  );
}

function PoolLabel({ project }: { project: ListedProject }) {
  const prize = project.reward.kind === "external-prize-share" ? project.reward.externalOpportunity : undefined;
  return prize ? <Chip title={prize.name}>External</Chip> : sponsorPoolLine(project);
}

function SponsorCard({ project, mergeLine, networkPays }: { project: ListedProject; mergeLine: MergeLine; networkPays: NetworkPays }) {
  const merge = project.status === "active" ? mergeLine(project) : null;
  const budget = project.reward.reviewBudget;
  const months = project.coverage?.tag === "Covers" ? fromAmount(project.coverage.months) : 0n;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <a href={`/projects/${project.slug}/funding`} className="inline-flex items-center justify-between gap-2 font-semibold text-foreground hover:text-primary">
        <strong>{project.name}</strong>
        <ArrowRight aria-hidden className="size-4 shrink-0" />
      </a>
      <p className="text-muted-foreground">
        <PoolLabel project={project} />
      </p>
      {project.reward.chain ? <p className="text-sm text-muted-foreground">{networkLabel(project.reward.chain)}</p> : null}
      <FundingStatus project={project} networkPays={networkPays} />
      {months > 0n ? <small className="text-sm text-muted-foreground">{`Covers ${months} ${months === 1n ? "month" : "months"}`}</small> : null}
      {merge ? <small className="text-sm text-muted-foreground">{merge}</small> : null}
      {budget && reviewBudgetShown(budget.fundingState === "committed") ? (
        <small className="text-muted-foreground">
          <FundedMeter label="Reviews" fundedMinor={budget.committedMinor} funded={formatRewardMinor(budget.committedMinor)} cap={budget.monthlyCapDisplay} />
        </small>
      ) : null}
      {project.shareLine ? <small className="text-sm text-muted-foreground">{project.shareLine}</small> : null}
    </li>
  );
}

/** Where to fund a project, its fees and custody, and who the money reaches. */
export function SponsorsView({ projects, mergeLine, networkPays, whoBuilds, live, branch }: SponsorsViewProps) {
  const listed = projects.value ?? [];
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-10 px-4 py-8">
      <PageHeader title="Fund a project" icon={<HandCoins className="size-6 text-primary" />} />
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold text-foreground">Projects</h2>
          <a className={link} href="/projects/new">
            Add a project
          </a>
        </div>
        <p className="text-muted-foreground">Anyone can deposit from their own wallet into a project's registered vault. Deposits are public. Depositors have no refund right, and the project owner can withdraw free funds, less a 2% fee.</p>
        <DataState status={projects.status} onRetry={projects.onRetry}>
          <ul aria-label="Project funding pools" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listed.filter(onSponsors).map((project) => (
              <SponsorCard key={project.id} project={project} mergeLine={mergeLine} networkPays={networkPays} />
            ))}
          </ul>
        </DataState>
      </section>
      <Disclosure summary="Fees & rules">
        <div className="flex flex-col gap-8 pt-2">
          <Explained
            title="Fees"
            aside={
              <dl aria-label="Example: $5,000 in gross escrow awards" className="grid gap-3 rounded-lg border border-border p-6">
                {[
                  ["Awards", "$5,000"],
                  ["Fee 2%", "$100"],
                  ["Paid out", "$4,900"],
                ].map(([term, value]) => (
                  <div key={term} className="flex flex-wrap items-baseline justify-between gap-2">
                    <dt>{term}</dt>
                    <dd className="font-mono font-medium tabular-nums text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            }
          >
            <p>
              <Chip>2% fee</Chip>
            </p>
          </Explained>
          <Explained title="Custody and keys">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>Held in the project vault contract.</li>
              <li>Owner withdrawals: 2% fee. Reserved awards locked.</li>
              <li>
                <ExternalLink className={link} href={`${SOURCE_REPOSITORY}/blob/${branch}/docs/slop-product-requirements.md#11-source-delivery-and-acceptance`}>
                  Key risks
                </ExternalLink>
              </li>
            </ul>
          </Explained>
        </div>
      </Disclosure>
      {whoBuilds === undefined ? null : (
        <Disclosure summary={`Audience report · ${whoBuildsDateLabel(whoBuilds.generatedAt)}`}>
          <div className="pt-2">
            <WhoBuilds snapshot={whoBuilds} live={live} branch={branch} />
          </div>
        </Disclosure>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-foreground">Public records</h2>
        <ul className="flex flex-col gap-2">
          <li>
            <a className={link} href="/points">
              Contributors
            </a>
          </li>
          <li>
            <a className={link} href="/cycles">
              Cycle archive
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}

export type SponsorsPageProps = SponsorsReads & {
  runtime: PageRuntime;
};

export function SponsorsPage({ runtime, ...reads }: SponsorsPageProps) {
  const shown = useSession(runtime);
  return shown ? <SponsorsView {...reads} branch={shown.deployment.origins.branch} /> : null;
}
