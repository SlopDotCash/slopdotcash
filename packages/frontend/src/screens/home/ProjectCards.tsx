// spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/ui/pagination.md, "The page stays within the pages that exist"
import { cn, focusRing, Pagination, ProjectCard, usePagination } from "@repo/ui";
import { ChevronRight } from "lucide-react";
import { cardLine, cardNotes, imageOf, type ListedProject, projectHref } from "./listing.ts";

export type MergeLine = (project: ListedProject) => string | null;

export const communityPageSize = 10;

export type ProjectGridProps = {
  /** The projects as they are shown, each a link to its page. */
  projects: ReadonlyArray<ListedProject>;
  /** The project's merge activity line, or null while there is none to show. */
  mergeLine: MergeLine;
};

/** The featured projects, as cards. */
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

function CommunityPages({ projects, mergeLine }: ProjectGridProps) {
  const [pages, send] = usePagination({ page: 1, pages: Math.max(1, Math.ceil(projects.length / communityPageSize)) });
  const shown = projects.slice((pages.page - 1) * communityPageSize, pages.page * communityPageSize);
  return (
    <>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {shown.map((project) => {
          const line = cardLine(project);
          const merge = mergeLine(project);
          return (
            <li key={project.id}>
              <a href={projectHref(project)} className={cn(focusRing, "flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-accent")}>
                <img src={imageOf(project)} alt="" loading="lazy" decoding="async" width={40} height={40} className="size-10 shrink-0 rounded-md bg-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className="font-semibold text-foreground">{project.name}</strong>
                  <small className="truncate text-sm text-muted-foreground">{project.description}</small>
                  {merge ? <small className="text-sm text-muted-foreground">{merge}</small> : null}
                </span>
                <span className="shrink-0 text-right font-mono text-sm tabular-nums">{line.state ? `${line.amount} · ${line.state}` : line.amount}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </a>
            </li>
          );
        })}
      </ul>
      <Pagination state={pages} onSend={send} label="Community project pages" />
    </>
  );
}

/** The community projects, ten to a page. */
export function CommunityProjects({ projects, mergeLine }: ProjectGridProps) {
  if (projects.length === 0) return null;
  return (
    <section aria-labelledby="community-projects" className="flex flex-col gap-4">
      <h3 id="community-projects" className="text-lg font-semibold text-foreground">
        Community
      </h3>
      <CommunityPages key={projects.length} projects={projects} mergeLine={mergeLine} />
    </section>
  );
}
