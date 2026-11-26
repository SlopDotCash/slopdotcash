// spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"; spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"; spec/ui/copy.md, "Success settles back to ready; failure stays until the next attempt"
import { AgentMark, CommandBlock, cn, focusRing, target } from "@repo/ui";
import { agentLinks } from "./agentLinks.ts";

export type AgentPromptProps = {
  /** The exact prompt an agent is handed. */
  prompt: string;
  /** The origin this site was reached at, which the shortcuts name the skill by. */
  origin: string;
  /** Writes the prompt to the clipboard; a rejection is reported as a failed copy. */
  onCopy: (text: string) => Promise<void>;
  /** Offers the agent shortcuts beside the prompt. */
  openIn?: boolean;
  /** The skill address the shortcuts that take no prompt install, as a path on this site. */
  skillPath?: string;
};

const copyLabels = { ready: "Copy", copied: "Copied", failed: "Select text" } as const;

/** The agent prompt, its copy control and, beside them, the shortcuts that open it in a named agent. */
export function AgentPrompt({ prompt, origin, onCopy, openIn = false, skillPath }: AgentPromptProps) {
  const copyOnOpen = () => void onCopy(prompt).then(undefined, () => undefined);
  return (
    <div className="w-full min-w-0 max-w-220">
      <CommandBlock layout="inline" command={prompt} label="Agent prompt" copyLabel="Copy agent prompt" copyLabels={copyLabels} restAfter={1600} onCopy={onCopy} />
      {openIn ? (
        <div className="mt-4.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-copy leading-page text-muted-foreground">
          <span>Open in</span>
          <ul className="flex flex-wrap gap-1.5">
            {agentLinks(prompt, origin, skillPath).map((link) => (
              <li key={link.agent}>
                <a
                  href={link.href}
                  title={link.agent}
                  target={link.newTab ? "_blank" : undefined}
                  rel={link.newTab ? "noreferrer" : undefined}
                  onClick={copyOnOpen}
                  className={cn(focusRing, target, "grid size-10 place-items-center rounded-lg border border-foreground/22 text-foreground hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary motion-safe:transition-colors motion-safe:duration-fast")}
                >
                  <AgentMark agent={link.agent} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
