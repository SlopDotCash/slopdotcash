// spec/frontend/drafts.md, "A draft belongs to one account and project"; spec/frontend/composition.md, "The active draft and navigation share one authenticated actor"; spec/security/intake.md, "A new attempt binds authenticated identity, passes admission and keeps its idempotency key"
import { StatusIcon } from "@repo/ui";
import { useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { SignInPanel } from "../../../app/SignInPanel.tsx";
import { loginHrefFor, useSession } from "../../../app/useSession.ts";
import { useView } from "../../account/useView.ts";
import { run, useOnce } from "./hooks.ts";
import type { ReportDraft } from "../../../flows/security/private.vibe";
import { backToWriting, editCompose, followCompose, submitCompose, watchCompose } from "./compose.vibe";
import { ReportComposer } from "./ReportComposer.tsx";
import type { ProgramRuntime } from "./runtime.vibe";
import type { ProgramProject } from "./terms.schema.ts";

export type ReportFormProps = {
  runtime: PageRuntime;
  section: ProgramRuntime;
  project: ProgramProject;
};

function Opening() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <StatusIcon icon="Spinner" />
      Opening your draft…
    </p>
  );
}

/** The signed-in reporter's draft for this project, or sign-in in place for a visitor. */
export function ReportForm({ runtime, section, project }: ReportFormProps) {
  const shown = useSession(runtime);
  useOnce(section, `compose:${project.id}`, () => followCompose(project.id));
  const view = useView(section, watchCompose);
  const [failure, setFailure] = useState<string | null>(null);
  const [typed, setTyped] = useState<{ readonly revision: number; readonly draft: ReportDraft } | null>(null);
  if (shown === undefined) return <Opening />;
  if (shown.view.status !== "signedIn")
    return <SignInPanel view={shown.view} href={loginHrefFor(shown, `/projects/${project.slug}/security`)} purpose="Sign in to report through Slop." />;
  if (view === undefined || view.owner !== shown.view.session.githubId) return <Opening />;
  const act = (work: Parameters<ProgramRuntime["runPromiseExit"]>[0]) => {
    setFailure(null);
    void run(section, work).then((done) => {
      if (!done.ok) setFailure(done.message);
    });
  };
  return (
    <ReportComposer
      login={view.login}
      projectName={project.name}
      terms={project.securityBounty}
      draft={typed !== null && typed.revision === view.revision ? typed.draft : view.draft}
      attempted={view.attempted}
      storageAvailable={view.storageAvailable}
      phase={view.phase}
      busy={view.busy}
      error={failure ?? view.error}
      onChange={(draft) => {
        setTyped({ revision: view.revision, draft });
        act(editCompose(draft));
      }}
      onEdit={() => act(backToWriting())}
      onSubmit={() => {
        setFailure(null);
        void run(section, submitCompose()).then((done) => {
          if (!done.ok) setFailure(done.message);
          else if (done.value !== undefined) location.assign(done.value);
        });
      }}
    />
  );
}
