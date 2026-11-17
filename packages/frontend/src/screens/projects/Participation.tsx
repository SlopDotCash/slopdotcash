// spec/backend/listing.md, "A restricted project is closed on every public route and a paused one stays listed"; spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"
import { ExternalLink } from "@repo/ui";
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section id="start" className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** How to take part: continue at an archived project's successor, ask the steward first, wait while paused, or set up an agent. */
export function Participation({ project, successorName, install }: ParticipationProps) {
  const { participation, steward } = project;
  if (participation?.state === "archived")
    return (
      <Section title="Archived">
        <p>
          Continue with{" "}
          <a href={`/projects/${participation.successorProjectId}`} className={linkClass}>
            {successorName ?? participation.successorProjectId}
          </a>
          .
        </p>
      </Section>
    );
  if (participation?.state === "permission-required")
    return (
      <Section title="Permission required">
        <p>
          Contact{" "}
          <ExternalLink href={steward.github.profileUrl} className={linkClass}>
            {steward.displayName}
          </ExternalLink>{" "}
          about permission before contributing.
        </p>
      </Section>
    );
  if (project.status === "paused")
    return (
      <Section title="Project paused">
        <p>Do not install this project&apos;s skill or start work.</p>
        <p>
          A paused project is not collected or scored. Its steward,{" "}
          <ExternalLink href={steward.github.profileUrl} className={linkClass}>
            {steward.displayName}
          </ExternalLink>
          , can review its status and next steps on the project setup page. Check back here for a change.{" "}
          <a href={`/projects/${project.slug}/manage`} className={linkClass}>
            Project owner: review setup
          </a>
        </p>
      </Section>
    );
  return install;
}
