// spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"; spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"; spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"
import { Spinner, Status } from "@repo/ui";
import { type ListingFacts, notListedInstallText, showsNotListed } from "../../../gen/frontend__poolListing.ts";
import { bootstrapPrompt } from "../home/agentLinks.ts";
import { AgentPrompt } from "../home/AgentPrompt.tsx";
import type { Shown } from "../home/listing.ts";
import { type Clearance, clearanceFor } from "./history.ts";
import type { ShownProject } from "./project.schema.ts";
import { projectPrompt } from "./summary.ts";

export type InstallPanelProps = {
  /** The project an agent would contribute to. */
  project: Pick<ShownProject, "slug" | "repositories">;
  /** Whether agent discovery lists the project as cleared. */
  clearance: Clearance;
  /** This month's listing facts; a project the funding read leaves out is not listed, which is not a clearance problem. */
  listing: ListingFacts;
  /** The origin the page was reached at, which the prompt names the skill by. */
  origin: string;
  /** Writes the prompt to the clipboard; a rejection is reported as a failed copy. */
  onCopy: (text: string) => Promise<void>;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** Whether the discovery registry, read whole, lists the project as cleared for agents. @throws {never} */
export function clearanceOf(discovery: Shown<ReadonlySet<string>>, projectId: string): Clearance {
  return clearanceFor(discovery.status, discovery.value?.has(projectId) ?? false);
}

function ClearanceState({ project, clearance, listing }: Pick<InstallPanelProps, "project" | "clearance" | "listing">) {
  switch (clearance) {
    case "ready":
      return null;
    case "loading":
      return <Spinner size="sm" label="Checking project clearance" />;
    case "blocked":
      return showsNotListed(listing, false) ? (
        <Status presentation={{ tone: "Caution", icon: "Alert", label: notListedInstallText }} />
      ) : (
        <>
          <Status presentation={{ tone: "Caution", icon: "Alert", label: "Not cleared" }} />{" "}
          <a href={`/projects/${project.slug}/manage`} className={linkClass}>
            Owner setup
          </a>
        </>
      );
    case "error":
      return <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Clearance unknown" }} />;
    default: {
      const _exhaustive: never = clearance;
      return _exhaustive;
    }
  }
}

/** The project's agent setup: its own prompt once discovery lists it as cleared, else the generic prompt, which picks only cleared projects. */
export function InstallPanel({ project, clearance, listing, origin, onCopy }: InstallPanelProps) {
  const ready = clearance === "ready";
  return (
    <div id="start" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xl font-semibold text-foreground">Start</h2>
      {ready ? null : (
        <p className="flex flex-wrap items-center gap-1">
          <ClearanceState project={project} clearance={clearance} listing={listing} />
        </p>
      )}
      <AgentPrompt openIn prompt={ready ? projectPrompt(project, origin) : bootstrapPrompt(origin)} origin={origin} onCopy={onCopy} />
    </div>
  );
}
