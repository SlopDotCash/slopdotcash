// spec/security/program.md, "A program revision needs current owner authority and exact split rules"; spec/security/program.md, "Funding state comes only from a fresh finalized bounty-vault snapshot"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/ownerMonthly.md, "The funds view is loading, error or ready for the current owner only"
import { Alert, Button, Disclosure, Spinner } from "@repo/ui";
import { useState } from "react";
import type { PageProps } from "../../../app/pages.ts";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { useSession } from "../../../app/useSession.ts";
import { actorNumber } from "../../../session/session.vibe";
import { BountyFunding } from "../../funding/awards/BountyFunding.tsx";
import { bountyProjectOf } from "../../funding/awards/bounty.schema.ts";
import { run, useMounted } from "../program/hooks.ts";
import { type PublishedProgram, SecurityProgramPage } from "../program/SecurityProgramPage.tsx";
import { editorProjectOf } from "./editor.ts";
import { ProgramEditor, type Publish } from "./ProgramEditor.tsx";
import { type CurrentSettings, currentSettings, managementAccess, publishProgram, settingsMessages } from "./runtime.vibe";

type Actor = { readonly githubId: string; readonly githubLogin: string };

type EditorProps = { runtime: PageRuntime; projectId: string; actor: Actor; onPublished: (published: PublishedProgram) => void; onRetry: () => void };

function Refused({ message, label, onRetry }: { message: string; label: string; onRetry: () => void }) {
  return (
    <Alert
      variant="destructive"
      action={
        <Button variant="link" onClick={onRetry}>
          {label}
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

function Editor({ runtime, projectId, actor, onPublished, onRetry }: EditorProps) {
  const read = useMounted(runtime, () => currentSettings(projectId, actor.githubId));
  const [published, setPublished] = useState<CurrentSettings | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  if (lost !== null) return <Refused message={lost} label="Retry management access" onRetry={onRetry} />;
  if (read.status === "running") return <Spinner label="Loading security settings" />;
  if (read.status === "failed") return <Refused message={read.message} label="Try again" onRetry={onRetry} />;
  if (read.value.kind === "lost") return <Refused message={read.value.message} label="Retry management access" onRetry={onRetry} />;
  if (read.value.kind === "failed") return <Refused message={read.value.message} label="Try again" onRetry={onRetry} />;
  const current = published ?? read.value.value;
  const project = editorProjectOf(current.manifest);
  if (project === undefined) return <Refused message={settingsMessages.unreadable} label="Try again" onRetry={onRetry} />;
  const publish: Publish = async (manifest) => {
    const done = await run(runtime, publishProgram({ projectId, manifest, expectedRevision: current.revision, actorId: actor.githubId }));
    if (!done.ok) return done.message;
    if (done.value.kind === "lost") {
      setLost(done.value.message);
      return null;
    }
    if (done.value.kind === "failed") return done.value.message;
    setPublished(done.value.value);
    onPublished(done.value.value);
    return null;
  };
  const vault = bountyProjectOf(current.manifest);
  return (
    <div className="flex flex-col gap-6">
      <ProgramEditor key={`${project.id}:${current.revision}`} project={project} actor={actor} onPublish={publish} />
      {vault ? <BountyFunding project={vault} manager={{ account: actorNumber(actor.githubId), githubId: actor.githubId }} /> : null}
    </div>
  );
}

function Access({ runtime, projectId, actor, onPublished, onRetry }: EditorProps) {
  const access = useMounted(runtime, () => managementAccess(projectId, actor.githubId));
  if (access.status === "running") return <Spinner label="Checking project access" />;
  if (access.status === "failed") return <Refused message={access.message} label="Retry management access" onRetry={onRetry} />;
  if (access.value.kind !== "done") return <Refused message={access.value.message} label="Retry management access" onRetry={onRetry} />;
  return <Editor runtime={runtime} projectId={projectId} actor={actor} onPublished={onPublished} onRetry={onRetry} />;
}

function Settings({ runtime, projectId, actor, onPublished }: Omit<EditorProps, "onRetry">) {
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(() => location.hash === "#security-settings");
  const [opened, setOpened] = useState(open);
  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) setOpened(true);
  };
  return (
    <section id="security-settings" className="flex flex-col gap-2">
      <Disclosure summary="Manage security bounty" open={open} onOpenChange={toggle} />
      {opened ? (
        <div hidden={!open}>
          <Access key={attempt} runtime={runtime} projectId={projectId} actor={actor} onPublished={onPublished} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : null}
    </section>
  );
}

export type SecuritySettingsProps = {
  runtime: PageRuntime;
  projectId: string;
  onPublished: (published: PublishedProgram) => void;
};

/** `#security-settings`: the steward's bounty controls, loaded only once opened and only for current project authority. */
export function SecuritySettings({ runtime, projectId, onPublished }: SecuritySettingsProps) {
  const shown = useSession(runtime);
  if (shown?.view.status !== "signedIn") return null;
  const { githubId, githubLogin } = shown.view.session;
  return <Settings key={`${projectId}:${githubId}`} runtime={runtime} projectId={projectId} actor={{ githubId, githubLogin }} onPublished={onPublished} />;
}

/** `/projects/:slug/security` with the steward's bounty settings below the report path. */
export function SecurityProgramWithSettings({ runtime, route }: PageProps) {
  return <SecurityProgramPage runtime={runtime} route={route} settings={(project, onPublished) => <SecuritySettings runtime={runtime} projectId={project.id} onPublished={onPublished} />} />;
}
