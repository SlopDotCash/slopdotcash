// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
import { Button, cn, ProjectCard } from "@repo/ui";
import { Plus, Shield } from "lucide-react";
import { readShowsRows } from "../../../gen/ui__status.ts";
import { securityBountyAmountLabel } from "../../kernels/rewardSummary.ts";
import { eligibilityWord, imageOf, type ListedProject, offerHref, openOffers, type Shown } from "./listing.ts";
import { ListedRead, projectGrid, sectionHeading, sectionTitle, tierNote } from "./ProjectCards.tsx";

export type SecurityOffersProps = {
  /** The registry read the offers come from; a loading read shows no offer and a failed one says why. */
  projects: Shown<ReadonlyArray<ListedProject>>;
};

const bountyMark = (
  <span role="img" aria-label="Security bounty" title="Security bounty">
    <Shield aria-hidden size={22} />
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
            <ProjectCard className="flex-1" lazy name={project.name} image={imageOf(project)} icon={bountyMark} amount={securityBountyAmountLabel(terms)} unit={`/ ${eligibilityWord(terms)}`}>
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
  const empty = readShowsRows(projects.status) && offers.length === 0;
  return (
    <section id="security-bounties" aria-labelledby="home-security-title" className={empty ? "pb-6" : "pb-24"}>
      <div className={cn(sectionHeading, empty && "mb-2")}>
        <h2 id="home-security-title" className={sectionTitle}>
          Security bounties
        </h2>
        <Button asChild>
          <a href="/projects/new">
            <Plus aria-hidden /> Add a bounty
          </a>
        </Button>
      </div>
      <ListedRead read={projects}>
        {offers.length > 0 ? (
          <OfferCards offers={offers} />
        ) : (
          <p className={cn(tierNote, "mb-0")}>
            No open bounties.{" "}
            <a href="#projects" className="text-primary underline underline-offset-4 hover:decoration-2">
              Report privately
            </a>{" "}
            on any project.
          </p>
        )}
      </ListedRead>
    </section>
  );
}
