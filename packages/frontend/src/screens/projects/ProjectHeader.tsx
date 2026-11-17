// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Button, PageHeader } from "@repo/ui";
import { FolderGit2 } from "lucide-react";
import { useState } from "react";
import { projectImage } from "../../../gen/frontend__presentation.ts";
import type { ShownProject } from "./project.schema.ts";

export type ProjectHeaderProps = {
  /** The project as the registry lists it. */
  project: Pick<ShownProject, "name" | "description" | "image" | "repositories" | "repositoryUrl">;
};

/** @throws {URIError} */
function ownerAvatar(project: ProjectHeaderProps["project"]): string {
  const repository = project.repositories[0];
  const owner = (repository?.aliases?.at(-1) ?? repository?.id ?? "").split("/")[0] ?? "";
  return owner ? `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?size=96` : "";
}

/** The custom image, then the GitHub owner's avatar when it fails, then the project's initial. */
function ProjectImage({ project }: ProjectHeaderProps) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const avatar = ownerAvatar(project);
  const src = [projectImage(project.image ?? "", avatar), avatar].find((choice) => choice !== "" && !failed.has(choice));
  if (src === undefined) {
    return (
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-md bg-muted text-xl font-medium text-muted-foreground">
        {project.name.slice(0, 1)}
      </span>
    );
  }
  return <img key={src} src={src} alt="" aria-hidden="true" decoding="async" width={48} height={48} className="size-12 rounded-md bg-muted" onError={() => setFailed((known) => new Set(known).add(src))} />;
}

/** The project's name, image and description, with its repository on GitHub. */
export function ProjectHeader({ project }: ProjectHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={project.name}
        icon={<ProjectImage project={project} />}
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
