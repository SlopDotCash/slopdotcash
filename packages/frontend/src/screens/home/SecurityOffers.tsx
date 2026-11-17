// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"
import { Button, DataState, ProjectCard } from "@repo/ui";
import { Plus } from "lucide-react";
import { securityBountyAmountLabel } from "../../kernels/rewardSummary.ts";
import { bountyFundingLabel, eligibilityWord, imageOf, type ListedProject, offerHref, openOffers, type Shown } from "./listing.ts";

export type SecurityOffersProps = {
  /** The registry read the offers come from; a failed or loading read shows no offer. */
  projects: Shown<ReadonlyArray<ListedProject>>;
};

function OfferCards({ offers }: { offers: ReadonlyArray<ListedProject> }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {offers.flatMap((project) => {
        const terms = project.securityBounty;
        if (!terms) return [];
        return [
          <li key={project.id} className="flex">
            <ProjectCard
              className="flex-1"
              name={project.name}
              image={imageOf(project)}
              description={terms.eligibility === "critical-loss-of-funds" ? `Find a critical security vulnerability in ${project.name}` : `Find a security vulnerability in ${project.name}`}
              amount={`${securityBountyAmountLabel(terms)} / ${eligibilityWord(terms)}`}
              note={bountyFundingLabel(terms)}
            >
              <a href={offerHref(project)} />
            </ProjectCard>
          </li>,
        ];
      })}
    </ul>
  );
}

/** Current paid security offers, before the project lists, and the private report path that needs none. */
export function SecurityOffers({ projects }: SecurityOffersProps) {
  const offers = openOffers(projects.value ?? []);
  return (
    <section id="security-bounties" aria-labelledby="home-security-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="home-security-title" className="text-2xl font-semibold text-foreground">
          Security bounties
        </h2>
        <Button asChild>
          <a href="/projects/new">
            <Plus aria-hidden className="size-4" /> Add a bounty
          </a>
        </Button>
      </div>
      <p className="text-muted-foreground">
        {projects.status === "Current" && offers.length === 0 ? "No paid security bounties are open. " : null}
        <a href="#projects" className="text-primary underline underline-offset-4 hover:decoration-2">
          Choose a project
        </a>{" "}
        to report a security issue privately without a promised award.
      </p>
      <DataState status={projects.status} onRetry={projects.onRetry}>
        {offers.length > 0 ? <OfferCards offers={offers} /> : null}
      </DataState>
    </section>
  );
}
