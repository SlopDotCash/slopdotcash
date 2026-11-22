// spec/backend/listing.md, "A restricted project is closed on every public route and a paused one stays listed"; spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
import { ExternalLink, Status, StatusIcon } from "@repo/ui";
import type { ReactNode } from "react";
import type { ShownProject } from "./project.schema.ts";

export type ParticipationProps = {
  /** The project as the registry lists it. */
  project: Pick<ShownProject, "slug" | "status" | "participation" | "steward">;
  /** The name of an archived project's successor, when the registry lists it. */
  successorName?: string;
  /** The agent setup, shown only while the project takes contributions. */
  install: ReactNode;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

function Start({ children }: { children: ReactNode }) {
  return (
    <section id="start" className="flex flex-col gap-2">
      {children}
    </section>
  );
}

/** How to take part: continue at an archived project's successor, ask the steward first, wait while paused, or set up an agent. */
export function Participation({ project, successorName, install }: ParticipationProps) {
  const { participation, steward } = project;
  if (participation?.state === "archived")
    return (
      <Start>
        <h2 className="text-xl font-semibold text-foreground">Archived</h2>
        <p>
          Continue with{" "}
          <a href={`/projects/${participation.successorProjectId}`} className={linkClass}>
            {successorName ?? participation.successorProjectId}
          </a>
          .
        </p>
      </Start>
    );
  if (participation?.state === "permission-required")
    return (
      <Start>
        <p className="flex flex-wrap items-center gap-1">
          <StatusIcon icon="Lock" role="img" aria-label="Permission required" />{" "}
          <ExternalLink href={steward.github.profileUrl} className={linkClass}>
            Ask {steward.displayName}
          </ExternalLink>
        </p>
      </Start>
    );
  if (project.status === "paused")
    return (
      <Start>
        <p className="flex flex-wrap items-center gap-1">
          <Status presentation={{ tone: "Caution", icon: "Pause", label: "Paused" }} />{" "}
          <a href={`/projects/${project.slug}/manage`} className={linkClass}>
            Owner setup
          </a>
        </p>
      </Start>
    );
  return install;
}
