import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";

// The marks the Slop app shipped beside "Open in" (development src/agent-logos): each is a mask over the current text
// color, so a mark takes the role its link has and needs no literal color. One literal URL each, which Vite bundles.
const marks = {
  Cursor: new URL("../assets/agent-logos/cursor.svg", import.meta.url).href,
  Claude: new URL("../assets/agent-logos/claude.svg", import.meta.url).href,
  ChatGPT: new URL("../assets/agent-logos/chatgpt.svg", import.meta.url).href,
  Grok: new URL("../assets/agent-logos/grok.svg", import.meta.url).href,
  "Meta AI (Muse Spark)": new URL("../assets/agent-logos/meta-ai.svg", import.meta.url).href,
  OpenClaw: new URL("../assets/agent-logos/openclaw.svg", import.meta.url).href,
  "Hermes Agent": new URL("../assets/agent-logos/hermes-agent.svg", import.meta.url).href,
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
