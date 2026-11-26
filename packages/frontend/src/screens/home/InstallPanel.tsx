// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"; spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"
import { type HomeAudience, skillPath } from "../../../gen/frontend__presentation.ts";
import { AgentPrompt, type AgentPromptProps } from "./AgentPrompt.tsx";
import { bootstrapPrompt } from "./agentLinks.ts";

export type InstallPanelProps = Pick<AgentPromptProps, "origin" | "onCopy"> & {
  /** The Home journey whose skill the prompt and every shortcut name. */
  journey: HomeAudience;
};

/** The generic agent setup for the chosen journey: one prompt that works whatever discovery shows. */
export function InstallPanel({ origin, onCopy, journey }: InstallPanelProps) {
  const path = skillPath(journey);
  return (
    <div className="max-w-full min-w-0">
      <p className="mt-10 mb-5 max-w-172 text-lg leading-body font-medium text-muted-foreground xl:text-lead">Paste into your agent.</p>
      <AgentPrompt openIn prompt={bootstrapPrompt(origin, path)} origin={origin} onCopy={onCopy} skillPath={path} />
    </div>
  );
}
