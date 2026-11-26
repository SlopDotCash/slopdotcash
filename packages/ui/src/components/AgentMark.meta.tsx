import type { ComponentMeta } from "vibestack/stories";
import type { AgentMarkProps } from "./AgentMark.tsx";

export const meta: ComponentMeta<AgentMarkProps> = {
  args: { agent: "Claude Code" },
  examples: {
    Codex: { agent: "Codex", showName: true },
    Cursor: { agent: "Cursor", showName: true },
    Antigravity: { agent: "Antigravity", showName: true },
    OpenClaw: { agent: "OpenClaw", showName: true },
    "Hermes Agent": { agent: "Hermes Agent", showName: true },
    "GitHub Copilot": { agent: "GitHub Copilot", showName: true },
    "Grok Bot": { agent: "Grok Bot", showName: true },
    "Meta Muse": { agent: "Meta Muse", showName: true },
    OpenCode: { agent: "OpenCode", showName: true },
  },
};
