import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

const marks = {
  "Claude Code": new URL("../assets/agent-logos/claude-code.svg", import.meta.url).href,
  Codex: new URL("../assets/agent-logos/codex.svg", import.meta.url).href,
  Cursor: new URL("../assets/agent-logos/cursor.svg", import.meta.url).href,
  Antigravity: new URL("../assets/agent-logos/antigravity.svg", import.meta.url).href,
  OpenClaw: new URL("../assets/agent-logos/openclaw.svg", import.meta.url).href,
  "Hermes Agent": new URL("../assets/agent-logos/hermes-agent.svg", import.meta.url).href,
  "GitHub Copilot": new URL("../assets/agent-logos/github-copilot.svg", import.meta.url).href,
  "Grok Bot": new URL("../assets/agent-logos/grok-bot.svg", import.meta.url).href,
  "Meta Muse": new URL("../assets/agent-logos/meta-muse.svg", import.meta.url).href,
  OpenCode: new URL("../assets/agent-logos/opencode.svg", import.meta.url).href,
};

export type AgentMarkProps = Omit<ComponentProps<"span">, "children"> & {
  /** The agent client a link opens. */
  agent: keyof typeof marks;
  /** Shows the agent's name beside its mark; hidden, it stays the accessible name. */
  showName?: boolean;
};

/** An agent client's mark, named by the client, in the color of the text around it. */
export function AgentMark({ agent, showName = false, className, ...props }: AgentMarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...props}>
      <span aria-hidden className="size-5.5 shrink-0 bg-current mask-contain mask-center mask-no-repeat" style={{ maskImage: `url("${marks[agent]}")` }} />
      <span className={showName ? undefined : "sr-only"}>{agent}</span>
    </span>
  );
}
