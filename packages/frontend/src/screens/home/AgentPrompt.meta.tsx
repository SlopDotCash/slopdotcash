import type { ComponentMeta } from "vibestack/stories";
import { bootstrapPrompt } from "./agentLinks.ts";
import type { AgentPromptProps } from "./AgentPrompt.tsx";
import { copied, origin, refused } from "./fixtures.ts";

export const meta: ComponentMeta<AgentPromptProps> = {
  args: { prompt: bootstrapPrompt(origin), origin, onCopy: copied, openIn: true },
  examples: { PromptOnly: { openIn: false }, CopyRefused: { onCopy: refused } },
};
