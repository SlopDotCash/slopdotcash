// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month's configured amount is positive"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"; spec/frontend/projections.md, "Listings tag a positive current amount as Vaulted, Promised or Configured, and say when it is not vaulted"; spec/frontend/projections.md, "Free funds show how many whole months of the current amount they cover"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"; spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"; spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"
import { fromAmount } from "@repo/settlement/kernels/amounts";
import { isChain } from "@repo/settlement/kernels/networks";
import { cn, DataState, Disclosure, ExternalLink, focusRing, NetworkMark, PageHeader, shell } from "@repo/ui";
import { ArrowRight, HandCoins } from "lucide-react";
import { reviewBudgetShown } from "../../../gen/frontend__views.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useSession } from "../../app/useSession.ts";
import { CHAIN_NAMES, formatRewardMinor, networkLabel } from "../../kernels/assetText.ts";
import { SOURCE_REPOSITORY } from "../../platform/site.ts";
import { Chip } from "../admin/parts.tsx";
import { FundedMeter } from "../cycles/CycleAllocation.tsx";
import { type ListedProject, onSponsors, type Shown, sponsorPoolLine } from "../home/listing.ts";
import type { MergeLine } from "../home/ProjectCards.tsx";
import { FundingStatus } from "./FundingStatus.tsx";
import type { NetworkPays } from "./funding.ts";
import { type LiveFootprint, WhoBuilds, whoBuildsDateLabel, type WhoBuildsSnapshot } from "./WhoBuilds.tsx";

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

const recordLink = "rounded-sm font-bold text-muted-foreground underline decoration-foreground underline-offset-4 hover:text-foreground";
const sectionTitle = "text-xl leading-page font-extrabold tracking-tighter text-foreground uppercase lg:text-2xl xl:text-3xl";
const panel = "my-6 border border-border bg-card p-6 max-md:p-4";
const panelTitle = cn(sectionTitle, "mt-3 mb-4.5 tracking-display");
const twoColumns = "grid list-disc gap-x-10 gap-y-3 pl-5 leading-prose text-muted-foreground marker:text-muted-foreground md:grid-cols-2";
const details = "gap-0 border-t border-foreground py-4 [&>button]:min-h-11 [&>button]:text-base [&>button]:font-bold";

function PoolLabel({ project }: { project: ListedProject }) {
  const prize = project.reward.kind === "external-prize-share" ? project.reward.externalOpportunity : undefined;
  return prize ? <Chip title={prize.name}>External</Chip> : sponsorPoolLine(project);
}

function Network({ chain }: { chain: string }) {
  return <p className="text-ui leading-prose text-foreground/75 [&_svg]:size-2.5 [&>span]:gap-1">{isChain(chain) ? <NetworkMark network={CHAIN_NAMES[chain]} size="sm" /> : networkLabel(chain)}</p>;
}

function SponsorCard({ project, mergeLine, networkPays }: { project: ListedProject; mergeLine: MergeLine; networkPays: NetworkPays }) {
  const merge = project.status === "active" ? mergeLine(project) : null;
  const budget = project.reward.reviewBudget;
  const months = project.coverage?.tag === "Covers" ? fromAmount(project.coverage.months) : 0n;
  const notes = [months > 0n ? `Covers ${months} ${months === 1n ? "month" : "months"}` : null, merge].filter((note) => note !== null);
  return (
    <li className="min-w-0 rounded-xl border border-muted-foreground/20 bg-background p-4.5 leading-body text-muted-foreground">
      <a href={`/projects/${project.slug}/funding`} className={cn(focusRing, "flex items-center justify-between gap-3 rounded-sm text-base leading-prose hover:text-foreground")}>
        <strong className="font-bold">{project.name}</strong>
        <ArrowRight aria-hidden className="size-4 shrink-0 text-primary-hover" />
      </a>
      <p className="my-2.5 text-sm leading-prose text-foreground/80">
        <PoolLabel project={project} />
      </p>
      {project.reward.chain ? <Network chain={project.reward.chain} /> : null}
      <FundingStatus project={project} networkPays={networkPays} className="mt-3" />
      {notes.map((note) => (
        <small key={note} className="mt-2.5 block text-ui leading-prose text-foreground/75">
          {note}
        </small>
      ))}
      {budget && reviewBudgetShown(budget.fundingState === "committed") ? (
        <small className="mt-2.5 block text-foreground/75">
          <FundedMeter label="Reviews" fundedMinor={budget.committedMinor} funded={formatRewardMinor(budget.committedMinor)} cap={budget.monthlyCapDisplay} />
        </small>
      ) : null}
      {project.shareLine ? <small className="mt-2.5 block text-ui leading-prose text-foreground/75">{project.shareLine}</small> : null}
    </li>
  );
}

/** Where to fund a project, its fees and custody, and who the money reaches. */
export function SponsorsView({ projects, mergeLine, networkPays, whoBuilds, live, branch }: SponsorsViewProps) {
  const listed = projects.value ?? [];
  return (
    <main className={cn(shell, "flex-1 pt-8 pb-12 md:pt-12 md:pb-16")}>
      <PageHeader title="Fund a project" icon={<HandCoins />} className="mb-6 md:mb-8" />
      <section className="my-6">
        <div className="mb-5.5 grid items-end gap-4 md:mb-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(16.25rem,0.65fr)] lg:gap-8">
          <h2 className={sectionTitle}>Projects</h2>
          <a className={cn(focusRing, "block min-h-11 border-b-2 border-primary py-2.5 text-sm font-heavy text-foreground")} href="/projects/new">
            Add a project
          </a>
        </div>
        <p className="mb-2 max-w-[70ch] leading-prose text-muted-foreground">Anyone can deposit from their own wallet into a project's registered vault. Deposits are public. Depositors have no refund right, and the project owner can withdraw free funds, less a 2% fee.</p>
        <DataState status={projects.status} onRetry={projects.onRetry}>
          <ul aria-label="Project funding pools" className="grid gap-x-10 gap-y-3 pl-5 md:grid-cols-2">
            {listed.filter(onSponsors).map((project) => (
              <SponsorCard key={project.id} project={project} mergeLine={mergeLine} networkPays={networkPays} />
            ))}
          </ul>
        </DataState>
      </section>
      <Disclosure summary="Fees & rules" className={details}>
        <section className={cn(panel, "grid gap-12.5 lg:grid-cols-2")}>
          <div>
            <h2 className={panelTitle}>Fees</h2>
            <p className="mb-3.5 text-sm leading-prose">
              <Chip>2% fee</Chip>
            </p>
          </div>
          <dl aria-label="Example: $5,000 in gross escrow awards" className="grid gap-3 rounded-lg border border-border p-6">
            {[
              ["Awards", "$5,000"],
              ["Fee 2%", "$100"],
              ["Paid out", "$4,900"],
            ].map(([term, value]) => (
              <div key={term} className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-ui font-semibold">{term}</dt>
                <dd className="font-mono text-lg font-medium text-figure tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={panel}>
          <h2 className={panelTitle}>Custody and keys</h2>
          <ul className={twoColumns}>
            <li>Held in the project vault contract.</li>
            <li>Owner withdrawals: 2% fee. Reserved awards locked.</li>
            <li>
              <ExternalLink className={recordLink} href={`${SOURCE_REPOSITORY}/blob/${branch}/docs/slop-product-requirements.md#11-source-delivery-and-acceptance`}>
                Key risks
              </ExternalLink>
            </li>
          </ul>
        </section>
      </Disclosure>
      {whoBuilds === undefined ? null : (
        <Disclosure summary={`Audience report · ${whoBuildsDateLabel(whoBuilds.generatedAt)}`} className={details}>
          <div className="pt-2">
            <WhoBuilds snapshot={whoBuilds} live={live} branch={branch} />
          </div>
        </Disclosure>
      )}
      <section className={panel}>
        <h2 className={panelTitle}>Public records</h2>
        <ul className={cn(twoColumns, "my-4")}>
          <li>
            <a className={recordLink} href="/points">
              Contributors
            </a>
          </li>
          <li>
            <a className={recordLink} href="/cycles">
              Cycle archive
            </a>
          </li>
          <li>
            <a className={recordLink} href="/record">
              Public record
            </a>
          </li>
          <li>
            <a className={recordLink} href="/receipts">
              Receipts
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
