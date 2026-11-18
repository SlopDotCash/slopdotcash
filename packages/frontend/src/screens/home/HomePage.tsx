// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/backend/listing.md, "Funding never decides placement and placement never establishes funding"; spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section"
import { Button, DataState } from "@repo/ui";
import { Plus } from "lucide-react";
import { pageOrigin } from "../../platform/environment.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { CampaignHeading } from "./CampaignHeading.tsx";
import { HomeStandings } from "./HomeStandings.tsx";
import type { LifetimeTotal } from "./standings.ts";
import { InstallPanel } from "./InstallPanel.tsx";
import { homeSections, type ListedProject, type Shown } from "./listing.ts";
import { type MergeLine, ProjectGrid } from "./ProjectCards.tsx";
import { copyText } from "./prompt.vibe";
import { SecurityOffers } from "./SecurityOffers.tsx";

export interface HomeReads {
  readonly projects: Shown<ReadonlyArray<ListedProject>>;
  readonly mergeLine: MergeLine;
  readonly totals: Shown<ReadonlyArray<LifetimeTotal>>;
}

export type HomeViewProps = HomeReads & {
  /** The origin the page was reached at. */
  origin: string;
  /** Writes text to the clipboard. */
  onCopy: (text: string) => Promise<void>;
};

function Projects({ projects, mergeLine }: Pick<HomeReads, "projects" | "mergeLine">) {
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
          <p className="text-muted-foreground">No projects yet.</p>
        ) : (
          sections.map(({ tier, projects: entries }) => (
            <section key={tier} aria-labelledby={`${tier}-projects`} className="flex flex-col gap-4">
              <h3 id={`${tier}-projects`} className="text-lg font-semibold text-foreground">
                {tier === "featured" ? "Featured" : "Community"}
              </h3>
              <ProjectGrid projects={entries} mergeLine={mergeLine} />
            </section>
          ))
        )}
      </DataState>
    </section>
  );
}

/** The home page: the campaign and agent setup, then security offers, projects and the top contributors. */
export function HomeView({ projects, mergeLine, totals, origin, onCopy }: HomeViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-16 px-4 py-12">
      <section className="flex flex-col gap-8">
        <CampaignHeading />
        <InstallPanel origin={origin} onCopy={onCopy} />
      </section>
      <SecurityOffers projects={projects} />
      <Projects projects={projects} mergeLine={mergeLine} />
      <HomeStandings totals={totals} />
    </main>
  );
}

export type HomePageProps = HomeReads & {
  runtime: PageRuntime;
};

export function HomePage({ runtime, ...reads }: HomePageProps) {
  return <HomeView {...reads} origin={pageOrigin()} onCopy={(text) => runtime.runPromise(copyText(text))} />;
}
