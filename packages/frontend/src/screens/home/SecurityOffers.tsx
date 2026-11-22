// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"
import { Button, DataState, ProjectCard } from "@repo/ui";
import { Plus, Shield } from "lucide-react";
import { securityBountyAmountLabel } from "../../kernels/rewardSummary.ts";
import { eligibilityWord, imageOf, type ListedProject, offerHref, openOffers, type Shown } from "./listing.ts";
import { projectGrid, sectionHeading, sectionTitle, tierNote } from "./ProjectCards.tsx";

export type SecurityOffersProps = {
  /** The registry read the offers come from; a failed or loading read shows no offer. */
  projects: Shown<ReadonlyArray<ListedProject>>;
};

const bountyMark = (
  <span role="img" aria-label="Security bounty" title="Security bounty" className="shrink-0">
    <Shield aria-hidden className="size-5.5" />
  </span>
);

function OfferCards({ offers }: { offers: ReadonlyArray<ListedProject> }) {
  return (
    <ul className={projectGrid}>
      {offers.flatMap((project) => {
        const terms = project.securityBounty;
        if (!terms) return [];
        return [
          <li key={project.id} className="flex">
            <ProjectCard className="flex-1" name={project.name} image={imageOf(project)} icon={bountyMark} amount={securityBountyAmountLabel(terms)} unit={`/ ${eligibilityWord(terms)}`}>
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
    <section id="security-bounties" aria-labelledby="home-security-title" className="pb-24">
      <div className={sectionHeading}>
        <h2 id="home-security-title" className={sectionTitle}>
          Security bounties
        </h2>
        <Button asChild>
          <a href="/projects/new">
            <Plus aria-hidden /> Add a bounty
          </a>
        </Button>
      </div>
      <DataState status={projects.status} onRetry={projects.onRetry}>
        {offers.length > 0 ? (
          <OfferCards offers={offers} />
        ) : (
          <p className={tierNote}>
            No open bounties.{" "}
            <a href="#projects" className="text-primary underline underline-offset-4 hover:decoration-2">
              Report privately
            </a>{" "}
            on any project.
          </p>
        )}
      </DataState>
    </section>
  );
}
