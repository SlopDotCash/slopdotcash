// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"; spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section"
import { Button, DataState } from "@repo/ui";
import { Plus } from "lucide-react";
import { noProjectsText } from "../../../gen/frontend__poolListing.ts";
import { audienceChanges, type HomeAudience } from "../../../gen/frontend__presentation.ts";
import { pageOrigin } from "../../platform/environment.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useAddress } from "../../app/useAddress.ts";
import { journeyAddress, journeyOf, journeys } from "./audience.ts";
import { CampaignHeading } from "./CampaignHeading.tsx";
import { HomeStandings } from "./HomeStandings.tsx";
import type { LifetimeTotal } from "./standings.ts";
import { InstallPanel } from "./InstallPanel.tsx";
import { homeSections, type ListedProject, type Shown } from "./listing.ts";
import { ProjectGrid } from "./ProjectCards.tsx";
import { copyText } from "./prompt.vibe";
import { SecurityOffers } from "./SecurityOffers.tsx";

export interface HomeReads {
  readonly projects: Shown<ReadonlyArray<ListedProject>>;
  readonly totals: Shown<ReadonlyArray<LifetimeTotal>>;
}

export type HomeViewProps = HomeReads & {
  /** The origin the page was reached at. */
  origin: string;
  /** The journey the address names. */
  journey: HomeAudience;
  /** Chooses a journey. */
  onJourney: (journey: HomeAudience) => void;
  /** Writes text to the clipboard. */
  onCopy: (text: string) => Promise<void>;
};

const journeyLabels = { Contributor: "Contributor", Maintainer: "Maintainer" } as const satisfies Record<HomeAudience, string>;

function JourneySwitch({ journey, onJourney }: Pick<HomeViewProps, "journey" | "onJourney">) {
  return (
    <fieldset aria-label="Choose your Slop journey" className="flex flex-wrap gap-2">
      {journeys.map((option) => (
        <Button key={option} size="sm" variant={option === journey ? "primary" : "outline"} aria-pressed={option === journey} onClick={() => onJourney(option)}>
          {journeyLabels[option]}
        </Button>
      ))}
    </fieldset>
  );
}

function Projects({ projects }: Pick<HomeReads, "projects">) {
  const sections = homeSections(projects.value ?? []);
  return (
    <section id="projects" aria-labelledby="home-projects-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="home-projects-title" className="text-2xl font-semibold text-foreground">
          Projects
        </h2>
        <Button asChild>
          <a href="/projects/new">
            <Plus aria-hidden className="size-4" /> Add a project
          </a>
        </Button>
      </div>
      <DataState status={projects.status} onRetry={projects.onRetry}>
        {sections.length === 0 ? (
          <p className="text-muted-foreground">{noProjectsText}</p>
        ) : (
          sections.map(({ tier, projects: entries }) => (
            <section key={tier} aria-labelledby={`${tier}-projects`} className="flex flex-col gap-4">
              <h3 id={`${tier}-projects`} className="text-lg font-semibold text-foreground">
                {tier === "featured" ? "Featured" : "Community"}
              </h3>
              <ProjectGrid projects={entries} />
            </section>
          ))
        )}
      </DataState>
    </section>
  );
}

/** The home page: the journey switch, its campaign and agent setup, then security offers, projects and the top contributors. */
export function HomeView({ projects, totals, origin, journey, onJourney, onCopy }: HomeViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-16 px-4 py-12">
      <section className="flex flex-col gap-8">
        <JourneySwitch journey={journey} onJourney={onJourney} />
        <CampaignHeading key={journey} journey={journey} />
        <InstallPanel key={journey} journey={journey} origin={origin} onCopy={onCopy} />
      </section>
      <SecurityOffers projects={projects} />
      <Projects projects={projects} />
      <HomeStandings totals={totals} />
    </main>
  );
}

export type HomePageProps = HomeReads & {
  runtime: PageRuntime;
};

export function HomePage({ runtime, ...reads }: HomePageProps) {
  const journey = journeyOf(new URL(useAddress(), "https://slop.invalid"));
  const onJourney = (chosen: HomeAudience) => {
    if (!audienceChanges(journey, chosen)) return;
    history.pushState(history.state, "", journeyAddress(new URL(location.href), chosen));
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return <HomeView {...reads} origin={pageOrigin()} journey={journey} onJourney={onJourney} onCopy={(text) => runtime.runPromise(copyText(text))} />;
}
