// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section"; spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
import { ProjectCard } from "@repo/ui";
import { cardAmount, cardNote, imageOf, type ListedProject, projectHref } from "./listing.ts";

export type MergeLine = (project: ListedProject) => string | null;

export type ProjectGridProps = {
  /** The projects as they are shown, each a link to its page. */
  projects: ReadonlyArray<ListedProject>;
};

/** The projects in the order given, as cards. */
export function ProjectGrid({ projects }: ProjectGridProps) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <li key={project.id} className="flex">
          <ProjectCard className="flex-1" name={project.name} image={imageOf(project)} description={project.description} amount={cardAmount(project)} note={cardNote(project)}>
            <a href={projectHref(project)} />
          </ProjectCard>
        </li>
      ))}
    </ul>
  );
}
