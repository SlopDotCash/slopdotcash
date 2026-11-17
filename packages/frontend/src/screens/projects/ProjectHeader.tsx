// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Button, PageHeader } from "@repo/ui";
import { FolderGit2 } from "lucide-react";
import { projectImage } from "../../../gen/frontend__presentation.ts";
import type { ShownProject } from "./project.schema.ts";

export type ProjectHeaderProps = {
  /** The project as the registry lists it. */
  project: Pick<ShownProject, "name" | "description" | "image" | "repositories" | "repositoryUrl">;
};

/** @throws {URIError} */
function imageOf(project: ProjectHeaderProps["project"]): string {
  const repository = project.repositories[0];
  const owner = (repository?.aliases?.at(-1) ?? repository?.id ?? "").split("/")[0] ?? "";
  return projectImage(project.image ?? "", owner ? `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?size=96` : "");
}

/** The project's name, image and description, with its repository on GitHub. */
export function ProjectHeader({ project }: ProjectHeaderProps) {
  const image = imageOf(project);
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={project.name}
        icon={image ? <img src={image} alt="" className="size-12 rounded-md bg-muted" /> : undefined}
        actions={
          <Button asChild variant="ghost" size="icon">
            <a href={project.repositoryUrl} aria-label={`View ${project.name} on GitHub`} title="View on GitHub" target="_blank" rel="noopener noreferrer">
              <FolderGit2 aria-hidden className="size-5" />
            </a>
          </Button>
        }
      />
      <p className="text-lg text-pretty text-muted-foreground">{project.description}</p>
    </div>
  );
}
