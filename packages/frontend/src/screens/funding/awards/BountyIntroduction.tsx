// spec/frontend/presentation.md, "Agent shortcuts sit beside the generic agent setup and opening one also copies the prompt"; spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
import { Button } from "@repo/ui";
import type { ReactNode } from "react";
import { AgentPrompt, siteOrigin } from "../../home/index.ts";
import type { BountyProject } from "./bounty.schema.ts";

export type BountyIntroductionProps = {
  /** A project whose page is its security bounty. */
  project: BountyProject;
  /** The project's header and reward summary, from the project page. */
  header: ReactNode;
  /** The origin this site was reached at, which the prompt names the skill by. */
  origin: string;
  /** Writes the prompt to the clipboard; a rejection is reported as a failed copy. */
  onCopy: (text: string) => Promise<void>;
};

/** @throws {never} */
export function bountyPrompt(origin: string, repository: string): string {
  return `Read ${siteOrigin(origin)}/SKILL.md and follow its private security reporting workflow for github.com/${repository}.`;
}

/** The opening of a security bounty's project page: how to report privately, and the prompt that hands the reporting workflow to an agent. */
export function BountyIntroduction({ project, header, origin, onCopy }: BountyIntroductionProps) {
  return (
    <section className="flex flex-col gap-6">
      {header}
      <Button asChild className="self-start">
        <a href={`/projects/${project.slug}/security`}>Report privately</a>
      </Button>
      <div id="start" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-foreground">Copy this into your agent.</h2>
        <AgentPrompt openIn prompt={bountyPrompt(origin, project.securityBounty.intake.repository)} origin={origin} onCopy={onCopy} />
      </div>
    </section>
  );
}
