// spec/frontend/presentation.md, "Home keeps distinct contribution and report entry points and generic agent setup"
import { AgentPrompt, type AgentPromptProps } from "./AgentPrompt.tsx";
import { bootstrapPrompt } from "./agentLinks.ts";

export type InstallPanelProps = Pick<AgentPromptProps, "origin" | "onCopy">;

/** The generic agent setup: one prompt that works whatever discovery shows. */
export function InstallPanel({ origin, onCopy }: InstallPanelProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-lg text-muted-foreground">Paste this into your coding agent.</p>
      <AgentPrompt openIn prompt={bootstrapPrompt(origin)} origin={origin} onCopy={onCopy} />
    </div>
  );
}
