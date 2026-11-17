// spec/frontend/projections.md, "Project visibility, collection and installation have separate predicates"; spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"; spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"
import { bootstrapPrompt } from "../home/agentLinks.ts";
import { AgentPrompt } from "../home/AgentPrompt.tsx";
import type { Shown } from "../home/listing.ts";
import type { ShownProject } from "./project.schema.ts";
import { projectPrompt } from "./summary.ts";

export type Clearance = "loading" | "ready" | "blocked" | "error";

export type InstallPanelProps = {
  /** The project an agent would contribute to. */
  project: Pick<ShownProject, "slug" | "repositories">;
  /** Whether agent discovery lists the project as cleared. */
  clearance: Clearance;
  /** The origin the page was reached at, which the prompt names the skill by. */
  origin: string;
  /** Writes the prompt to the clipboard; a rejection is reported as a failed copy. */
  onCopy: (text: string) => Promise<void>;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** Whether the discovery registry, read whole, lists the project as cleared for agents. @throws {never} */
export function clearanceOf(discovery: Shown<ReadonlySet<string>>, projectId: string): Clearance {
  switch (discovery.status) {
    case "Idle":
    case "Loading":
      return "loading";
    case "Current":
    case "Stale":
    case "Empty":
      return discovery.value?.has(projectId) ? "ready" : "blocked";
    default:
      return "error";
  }
}

const notices = {
  loading: "Checking project clearance…",
  blocked: "This project is not cleared for agents. The prompt below picks only cleared projects.",
  error: "Project clearance could not be checked. The prompt below picks only cleared projects.",
} as const;

/** The project's agent setup: its own prompt once discovery lists it as cleared, else the generic prompt, which picks only cleared projects. */
export function InstallPanel({ project, clearance, origin, onCopy }: InstallPanelProps) {
  const ready = clearance === "ready";
  return (
    <div id="start" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xl font-semibold text-foreground">Copy this into your agent.</h2>
      {ready ? null : (
        <p role="status" className="text-muted-foreground">
          {notices[clearance]}
          {clearance === "blocked" ? (
            <>
              {" "}
              <a href={`/projects/${project.slug}/manage`} className={linkClass}>
                Project owner: review setup
              </a>
            </>
          ) : null}
        </p>
      )}
      <AgentPrompt openIn prompt={ready ? projectPrompt(project, origin) : bootstrapPrompt(origin)} origin={origin} onCopy={onCopy} />
    </div>
  );
}
