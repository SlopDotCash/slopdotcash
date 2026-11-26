// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"; spec/frontend/poolListing.md, "Home shows the listed Featured and Community projects once the funding read settles, Featured as cards and Community ten to a page"; spec/backend/intakeCap.md, "The lists leave a paused project out, its page says why, and a failed read lists it as before"
import { Button, cn, shell } from "@repo/ui";
import { Plus } from "lucide-react";
import { noProjectsText, showsNoProjects } from "../../../gen/frontend__poolListing.ts";
import { audienceChanges, type HomeAudience } from "../../../gen/frontend__presentation.ts";
import type { PoolRead } from "../../../gen/frontend__projections.ts";
import { pageOrigin } from "../../platform/environment.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useAddress } from "../../app/useAddress.ts";
import { journeyAddress, journeyOf, journeys } from "./audience.ts";
import { CampaignHeading } from "./CampaignHeading.tsx";
import { CommunityRows } from "./CommunityRows.tsx";
import { InstallPanel } from "./InstallPanel.tsx";
import { homeSections, type ListedProject, type Shown } from "./listing.ts";
import { ListedRead, ProjectGrid, sectionHeading, sectionTitle, tierNote, tierTitle } from "./ProjectCards.tsx";
import { copyText } from "./prompt.vibe";
import { SecurityOffers } from "./SecurityOffers.tsx";

export interface HomeReads {
  readonly projects: Shown<ReadonlyArray<ListedProject>>;
  readonly funding: PoolRead;
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
    <fieldset aria-label="Choose your Slop journey" className="mb-8 inline-flex min-w-0 max-w-full flex-wrap gap-1 rounded-lg border border-foreground/22 p-1">
      {journeys.map((option) => (
        <Button
          key={option}
          size="sm"
          variant="ghost"
          aria-pressed={option === journey}
          onClick={() => onJourney(option)}
          className="h-11 flex-auto bg-transparent px-4.5 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-foreground aria-pressed:text-background max-md:px-4.5"
        >
          {journeyLabels[option]}
        </Button>
      ))}
    </fieldset>
  );
}

function Projects({ projects, funding }: HomeReads) {
  const { featured, community } = homeSections(projects.value ?? []);
  return (
    <section id="projects" aria-labelledby="home-projects-title" className="py-24">
      <div className={sectionHeading}>
        <h2 id="home-projects-title" className={sectionTitle}>
          Projects
        </h2>
        <Button asChild>
          <a href="/projects/new">
            <Plus aria-hidden /> Add a project
          </a>
        </Button>
      </div>
      <ListedRead read={projects}>
        {showsNoProjects(funding, featured.length + community.length) ? <p className={tierNote}>{noProjectsText}</p> : null}
        {featured.length > 0 ? (
          <section aria-labelledby="featured-projects">
            <h3 id="featured-projects" className={tierTitle}>
              Featured
            </h3>
            <ProjectGrid projects={featured} />
          </section>
        ) : null}
        <div className={featured.length > 0 && community.length > 0 ? "mt-12" : undefined}>
          <CommunityRows projects={community} />
        </div>
      </ListedRead>
    </section>
  );
}

/** The home page: the journey switch, its campaign and agent setup, then security offers and projects. */
export function HomeView({ projects, funding, origin, journey, onJourney, onCopy }: HomeViewProps) {
  return (
    <main className={cn(shell, "flex-1")}>
      <section className="flex flex-col items-start pt-12 pb-18 lg:pt-13 lg:pb-23 xl:pt-18 xl:pb-32">
        <JourneySwitch journey={journey} onJourney={onJourney} />
        <CampaignHeading key={`heading ${journey}`} journey={journey} />
        <InstallPanel key={`install ${journey}`} journey={journey} origin={origin} onCopy={onCopy} />
      </section>
      <SecurityOffers projects={projects} />
      <Projects projects={projects} funding={funding} />
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
