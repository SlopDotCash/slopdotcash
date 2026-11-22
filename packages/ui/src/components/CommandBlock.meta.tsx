import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { CommandBlockProps } from "./CommandBlock.tsx";

const command = "git clone https://github.com/example/slop-cli.git && cd slop-cli && pnpm install";

export const meta: ComponentMeta<CommandBlockProps> = {
  args: { command, label: "Setup command" },
  examples: {
    Links: { links: <a href="#source" className="text-primary hover:underline">Source</a> },
    Prompt: {
      layout: "inline",
      command: "Install the Slop skill from https://slop.cash/SKILL.md and contribute to https://github.com/SlopDotCash/slopdotcash",
      label: "Agent prompt",
      copyLabel: "Copy agent prompt",
      copyLabels: { ready: "Copy", copied: "Copied", failed: "Select text" },
      restAfter: 1600,
    },
  },
  play: {
    Default: async ({ args, canvasElement }: { args: CommandBlockProps; canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      // spec/ui/controls.md, "An exact value scrolls rather than wraps, and the keyboard reaches it to scroll"
      await userEvent.tab();
      const code = canvas.getByRole("group", { name: "Setup command" });
      await expect([document.activeElement, code.textContent]).toEqual([code, command]);
      // spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
      await userEvent.tab();
      await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Copy command" }));
      await userEvent.keyboard("{Enter}");
      await expect(args.onCopy).toHaveBeenCalledWith(command);
      await expect(await canvas.findByText("Copied")).toBe(canvas.getByRole("status"));
    },
    Prompt: async ({ args, canvasElement }: { args: CommandBlockProps; canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      // spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt": the prompt reads whole, broken only where it wraps
      await expect(canvas.getByRole("group", { name: "Agent prompt" }).textContent).toBe(args.command);
      // spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
      await userEvent.click(canvas.getByRole("button", { name: "Copy agent prompt" }));
      await expect(args.onCopy).toHaveBeenCalledWith(args.command);
      await expect(await canvas.findByText("Copied", { selector: "[role=status]" })).toBe(canvas.getByRole("status"));
    },
  },
};
