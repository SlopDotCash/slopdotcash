// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"
import { Button, Card, CardTitle, cn, DataState, focusRing } from "@repo/ui";
import { Plus, Shield } from "lucide-react";
import { securityBountyAmountLabel } from "../../kernels/rewardSummary.ts";
import { eligibilityWord, imageOf, type ListedProject, offerHref, openOffers, type Shown } from "./listing.ts";

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
        const image = imageOf(project);
        return [
          <li key={project.id} className="flex">
            <Card asChild className={cn("flex-1 gap-3", focusRing, "hover:bg-accent motion-safe:transition-colors motion-safe:duration-fast")}>
              <a href={offerHref(project)}>
                <div className="flex items-center gap-3">
                  {image ? <img src={image} alt="" loading="lazy" className="size-10 shrink-0 rounded-md bg-muted" /> : null}
                  <CardTitle className="flex min-w-0 items-center gap-2 break-words">
                    <span role="img" aria-label="Security bounty" title="Security bounty">
                      <Shield aria-hidden className="size-5" />
                    </span>
                    {project.name}
                  </CardTitle>
                </div>
                <p className="font-mono text-lg font-medium tabular-nums">{`${securityBountyAmountLabel(terms)} / ${eligibilityWord(terms)}`}</p>
              </a>
            </Card>
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
      <DataState status={projects.status} onRetry={projects.onRetry}>
        {offers.length > 0 ? (
          <OfferCards offers={offers} />
        ) : (
          <p className="text-muted-foreground">
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
