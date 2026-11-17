import type { ComponentMeta } from "vibestack/stories";
import type { AgentMarkProps } from "./AgentMark.tsx";

// Each client once; the name is hidden by default and stays the accessible name.
export const meta: ComponentMeta<AgentMarkProps> = {
  args: { agent: "Cursor" },
  examples: {
    Claude: { agent: "Claude", showName: true },
    ChatGPT: { agent: "ChatGPT", showName: true },
    Grok: { agent: "Grok", showName: true },
    "Meta AI": { agent: "Meta AI (Muse Spark)", showName: true },
    OpenClaw: { agent: "OpenClaw", showName: true },
    "Hermes Agent": { agent: "Hermes Agent", showName: true },
  },
};
