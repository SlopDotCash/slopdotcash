// spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"; spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
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
};

/** The agent prompt, its copy control and, beside them, the shortcuts that open it in a named agent. */
export function AgentPrompt({ prompt, origin, onCopy, openIn = false }: AgentPromptProps) {
  const copyOnOpen = () => void onCopy(prompt).then(undefined, () => undefined);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <CommandBlock command={prompt} label="Agent prompt" copyLabel="Copy" onCopy={onCopy} />
      {openIn ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Open in</span>
          <ul className="flex flex-wrap items-center gap-1">
            {agentLinks(prompt, origin).map((link) => (
              <li key={link.agent}>
                <a
                  href={link.href}
                  title={link.agent}
                  target={link.newTab ? "_blank" : undefined}
                  rel={link.newTab ? "noreferrer" : undefined}
                  onClick={copyOnOpen}
                  className={cn(focusRing, target, "inline-flex items-center justify-center rounded-md text-foreground hover:text-primary")}
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
