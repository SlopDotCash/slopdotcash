import type { ComponentMeta } from "vibestack/stories";
import type { CommandBlockProps } from "./CommandBlock.tsx";

export const meta: ComponentMeta<CommandBlockProps> = {
  args: { command: "git clone https://github.com/example/slop-cli.git && cd slop-cli && pnpm install", label: "Setup command" },
  examples: {
    Links: { links: <a href="#source" className="text-primary hover:underline">Source</a> },
  },
};
