// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/poolListing.md, "Home shows the open Featured and Community projects in their own sections whatever this month's funding, leaving bounty cards to the security bounties section"
import { ProjectCard } from "@repo/ui";
import { cardLine, cardNotes, imageOf, type ListedProject, projectHref } from "./listing.ts";

export type MergeLine = (project: ListedProject) => string | null;

export type ProjectGridProps = {
  /** The projects as they are shown, each a link to its page. */
  projects: ReadonlyArray<ListedProject>;
  /** The project's merge activity line, or null while there is none to show. */
  mergeLine: MergeLine;
};

/** The projects in the order given, as cards. */
export function ProjectGrid({ projects, mergeLine }: ProjectGridProps) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const notes = cardNotes(project, mergeLine(project));
        return (
          <li key={project.id} className="flex">
            <ProjectCard className="flex-1" name={project.name} image={imageOf(project)} description={project.description} amount={cardLine(project).amount} note={notes.length ? notes.join(" · ") : undefined}>
              <a href={projectHref(project)} />
            </ProjectCard>
          </li>
        );
      })}
    </ul>
  );
}
