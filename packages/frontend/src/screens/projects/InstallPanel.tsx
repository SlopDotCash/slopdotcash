// spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"; spec/frontend/poolListing.md, "A monthly pool is listed only while this month's configured amount is positive"; spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"; spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"
import { Spinner, Status } from "@repo/ui";
import { installNotice, type ListingFacts, listedThisMonth, notListedInstallText, pausedInstallText } from "../../../gen/frontend__poolListing.ts";
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
  /** This month's listing facts from the registry; a project with no amount this month is not listed, which is not a clearance problem. */
  listing: ListingFacts;
  /** Whether the merge activity read shows the project held at its intake cap or out of rotation under the backlog rule. */
  held: boolean;
  origin: string;
  /** Writes the prompt to the clipboard; a rejection is reported as a failed copy. */
  onCopy: (text: string) => Promise<void>;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** Whether the discovery registry, read whole, lists the project as cleared for agents. @throws {never} */
export function clearanceOf(discovery: Shown<ReadonlySet<string>>, projectId: string): Clearance {
  return clearanceFor(discovery.status, discovery.value?.has(projectId) ?? false);
}

function ClearanceState({ project, clearance, listing, held }: Pick<InstallPanelProps, "project" | "clearance" | "listing" | "held">) {
  switch (clearance) {
    case "ready":
      return null;
    case "loading":
      return <Spinner size="sm" label="Checking project clearance" />;
    case "blocked": {
      const notice = installNotice(true, held, listedThisMonth(listing));
      switch (notice) {
        case "PausedInstall":
          return pausedInstallText;
        case "NotListedInstall":
          return <Status presentation={{ tone: "Caution", icon: "Alert", label: notListedInstallText }} />;
        case "NoListingNotice":
          return (
            <>
              <Status presentation={{ tone: "Caution", icon: "Alert", label: "Not cleared" }} />{" "}
              <a href={`/projects/${project.slug}/manage`} className={linkClass}>
                Owner setup
              </a>
            </>
          );
        default: {
          const _exhaustive: never = notice;
          return _exhaustive;
        }
      }
    }
    case "error":
      return <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Clearance unknown" }} />;
    default: {
      const _exhaustive: never = clearance;
      return _exhaustive;
    }
  }
}

export function InstallPanel({ project, clearance, listing, held, origin, onCopy }: InstallPanelProps) {
  const ready = clearance === "ready";
  return (
    <div id="start" className="flex min-w-0 flex-col gap-2 pt-4">
      <h2 className="text-lg font-extrabold tracking-amount text-gold uppercase">Start</h2>
      {ready ? null : (
        <p className="flex flex-wrap items-center gap-1">
          <ClearanceState project={project} clearance={clearance} listing={listing} held={held} />
        </p>
      )}
      <AgentPrompt openIn prompt={ready ? projectPrompt(project, origin) : bootstrapPrompt(origin)} origin={origin} onCopy={onCopy} />
    </div>
  );
}
