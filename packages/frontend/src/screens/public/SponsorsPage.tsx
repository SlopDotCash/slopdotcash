// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "The merge line stays hidden until a repository is read, and a failed read shows its date"; spec/frontend/views.md, "Who-builds counts come only from the committed 2026-09-17 snapshot pinned by its digest"
import { DataState, Disclosure, ExternalLink, PageHeader } from "@repo/ui";
import { ArrowRight, HandCoins } from "lucide-react";
import type { ReactNode } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useSession } from "../../app/useSession.ts";
import { networkLabel } from "../../kernels/assetText.ts";
import { SOURCE_REPOSITORY } from "../../platform/site.ts";
import { type ListedProject, reviewBudgetLabel, type Shown } from "../home/listing.ts";
import type { MergeLine } from "../home/ProjectCards.tsx";
import { FundingStatus } from "./FundingStatus.tsx";
import { type NetworkPays, sponsorPoolLabel } from "./funding.ts";
import { type LiveFootprint, WhoBuilds, whoBuildsDateLabel, type WhoBuildsSnapshot } from "./WhoBuilds.tsx";

const link = "text-primary underline underline-offset-4 hover:decoration-2";

export interface SponsorsReads {
  readonly projects: Shown<ReadonlyArray<ListedProject>>;
  readonly mergeLine: MergeLine;
  readonly networkPays: NetworkPays;
  readonly whoBuilds: WhoBuildsSnapshot;
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

function SponsorCard({ project, mergeLine, networkPays, reviewBudgets }: { project: ListedProject; mergeLine: MergeLine; networkPays: NetworkPays; reviewBudgets: boolean }) {
  const merge = project.status === "active" ? mergeLine(project) : null;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <a href={`/projects/${project.slug}/funding`} className="inline-flex items-center justify-between gap-2 font-semibold text-foreground hover:text-primary">
        <strong>{project.name}</strong>
        <ArrowRight aria-hidden className="size-4 shrink-0" />
      </a>
      <p className="text-muted-foreground">{sponsorPoolLabel(project)}</p>
      {project.reward.chain ? <p className="text-sm text-muted-foreground">{networkLabel(project.reward.chain)}</p> : null}
      <FundingStatus project={project} networkPays={networkPays} />
      {merge ? <small className="text-sm text-muted-foreground">{merge}</small> : null}
      {reviewBudgets && project.reward.reviewBudget ? <small className="text-sm text-muted-foreground">{reviewBudgetLabel(project.reward.reviewBudget)}</small> : null}
    </li>
  );
}

/** Where to fund a project, what funding decides, and who the money reaches. */
export function SponsorsView({ projects, mergeLine, networkPays, whoBuilds, live, branch }: SponsorsViewProps) {
  const listed = projects.value ?? [];
  const reviewBudgets = listed.some((project) => project.reward.reviewBudget);
  const externalPrize = listed.some((project) => project.reward.kind === "external-prize-share");
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-10 px-4 py-8">
      <div className="flex flex-col gap-3">
        <PageHeader title="Fund a project" icon={<HandCoins className="size-6 text-primary" />} />
        <p className="text-muted-foreground">Deposit into a project’s vault. Funded awards pay monthly when payments are enabled.</p>
      </div>
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold text-foreground">Projects</h2>
          <a className={link} href="/projects/new">
            Add a project
          </a>
        </div>
        <DataState status={projects.status} onRetry={projects.onRetry}>
          <ul aria-label="Project funding pools" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listed.map((project) => (
              <SponsorCard key={project.id} project={project} mergeLine={mergeLine} networkPays={networkPays} reviewBudgets={reviewBudgets} />
            ))}
          </ul>
        </DataState>
      </section>
      <Disclosure summary="Funding rules and fees">
        <div className="flex flex-col gap-8 pt-2">
          <Explained
            title="Fees"
            aside={
              <dl aria-label="Example: $5,000 in gross escrow awards" className="grid gap-3 rounded-lg border border-border p-6">
                {[
                  ["Example gross awards", "$5,000"],
                  ["Slop fee, deducted", "$100"],
                  ["Contributors receive", "$4,900"],
                ].map(([term, value]) => (
                  <div key={term} className="flex flex-wrap items-baseline justify-between gap-2">
                    <dt>{term}</dt>
                    <dd className="font-mono font-medium tabular-nums text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            }
          >
            <p>Ordinary awards deduct 2% in the award asset.</p>
            {externalPrize ? <p>External prize shares use the terms published for that project. The prize sponsor controls eligibility and payment.</p> : null}
          </Explained>
          <Explained title="What you decide">
            <ul className="list-disc pl-5">
              <li>The monthly cap.</li>
              <li>Award changes before the monthly cutoff, and whether automatic payment runs.</li>
            </ul>
            <p>
              <a className={link} href="/how-it-works">
                Payment stages
              </a>
            </p>
          </Explained>
          <Explained title="Custody and keys">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>Funds are held by the project vault contract. Private bounties use a separate vault.</li>
              <li>The owner can withdraw free funds with the 2% fee. Reserved awards cannot be withdrawn.</li>
              <li>
                Slop’s fee key can only claim and convert fees. A compromised identity attester key can redirect unpaid awards, and Slop’s upgrade keys can change the contracts. Read the{" "}
                <ExternalLink className={link} href={`${SOURCE_REPOSITORY}/blob/${branch}/docs/slop-product-requirements.md#11-source-delivery-and-acceptance`}>
                  authority and key risks
                </ExternalLink>
                .
              </li>
            </ul>
          </Explained>
        </div>
      </Disclosure>
      <Disclosure summary={`Audience report · ${whoBuildsDateLabel(whoBuilds.generatedAt)}`}>
        <div className="pt-2">
          <WhoBuilds snapshot={whoBuilds} live={live} branch={branch} />
        </div>
      </Disclosure>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-foreground">Public records</h2>
        <ul className="flex flex-col gap-2">
          <li>
            <a className={link} href="/#leaderboard">
              Live leaderboard
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
