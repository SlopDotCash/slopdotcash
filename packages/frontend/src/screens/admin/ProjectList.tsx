// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/frontend/navigation.md, "Administration sections and project selection are parameters of the one Administration page"
import { ExternalLink, Metric, MetricGrid, Status } from "@repo/ui";
import { ArrowRight, FolderGit2 } from "lucide-react";
import { formatDateTime } from "../../app/format.ts";
import { Fact, Facts, openWithin } from "./parts.tsx";
import { type AdminProject, adminHref, networkName, projectCounts, projectPresentation } from "./projects.ts";

export type ProjectListProps = {
  /** The projects to list, in the order shown. */
  projects: ReadonlyArray<AdminProject>;
};

/** The projects as rows that open their administration, those needing a decision first. */
export function ProjectList({ projects }: ProjectListProps) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {projects.map((project) => (
        <li key={project.id}>
          <a href={adminHref(project.id)} onClick={openWithin(adminHref(project.id))} aria-label={`Open ${project.manifest.name}`} className="flex items-center gap-4 p-4 hover:bg-accent">
            <FolderGit2 aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <h3 className="font-semibold text-foreground">{project.manifest.name}</h3>
              <p className="truncate text-sm text-muted-foreground">{project.manifest.repositories.map((repository) => repository.id).join(", ")}</p>
            </div>
            <Status presentation={projectPresentation(project)} />
            <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The counts above the list: every project, the active ones and those that need review. */
export function ProjectCounts({ projects }: { projects: ReadonlyArray<AdminProject> }) {
  const counts = projectCounts(projects);
  return (
    <MetricGrid className="md:grid-cols-3">
      <Metric label="Projects" value={counts.total} />
      <Metric label="Active" value={counts.active} tone="Positive" />
      <Metric label="Need review" value={counts.review} tone="Caution" />
    </MetricGrid>
  );
}

/** The facts an administrator checks first: repositories, placement, revision and reward asset. */
export function ProjectFacts({ project }: { project: AdminProject }) {
  const asset = project.manifest.rewardAsset;
  return (
    <Facts>
      <Fact term="Repositories">
        <span className="flex flex-col gap-1">
          {project.manifest.repositories.map((repository) => (
            <ExternalLink key={repository.id} href={`https://github.com/${repository.id}`}>
              {repository.id}
            </ExternalLink>
          ))}
        </span>
      </Fact>
      <Fact term="Discovery placement">{project.manifest.listingTier}</Fact>
      <Fact term="Revision">
        {project.revision} · updated {formatDateTime(project.updatedAt)}
      </Fact>
      <Fact term="Reward asset">{asset ? `${asset.symbol} · ${networkName(asset.network)}` : "Not set"}</Fact>
    </Facts>
  );
}
