// spec/backend/projects.md, "An applicant cancels a pending application or update without GitHub access"; spec/backend/projects.md, "Creation and stored-application publication record a paused revision 1"; spec/ui/confirmation.md, "Only an explicit confirm starts the work"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"
import type { SetupApplication, SetupStatus } from "@repo/backend/client";
import { Alert, Button, ConfirmDialog, type ConfirmationEvent, useConfirmation } from "@repo/ui";
import { Exit } from "effect";
import { useState } from "react";
import type { PageRuntime } from "../../../app/runtime.vibe";
import { useSession } from "../../../app/useSession.ts";
import { slopbotInstallUrl } from "../fields/slopbot.ts";
import { useRun } from "../proposal/run.ts";
import { type ApplicationAction, actOnApplication, applicationUnpublished, applicationsUnloaded, cancellationUnconfirmed, pendingApplications } from "./applications.vibe";
import { SetupStatusPanel } from "./SetupStatusPanel.tsx";

type Publication =
  | { readonly status: "idle" | "submitting" | "cancelled" }
  | { readonly status: "failed"; readonly action: ApplicationAction; readonly message: string; readonly installSlopbot: boolean }
  | { readonly status: "published"; readonly projectId: string; readonly setup: SetupStatus };

/** @throws {never} */
export function applicationName(application: Pick<SetupApplication, "id" | "manifest" | "repository">): string {
  const manifest = application.manifest;
  return typeof manifest === "object" && manifest !== null && "name" in manifest && typeof manifest.name === "string" ? manifest.name : (application.repository ?? application.id);
}

export type PendingApplicationProps = {
  runtime: PageRuntime;
  application: SetupApplication;
  actorId: string;
  onAccountLost: (message: string) => void;
};

/** One saved application: create or publish it, or cancel it after an explicit confirm. */
export function PendingApplication({ runtime, application, actorId, onAccountLost }: PendingApplicationProps) {
  const [publication, setPublication] = useState<Publication>({ status: "idle" });
  const [confirmation, sendConfirmation] = useConfirmation();
  const name = applicationName(application);
  const isRevision = application.expectedRevision !== undefined;
  const act = async (action: ApplicationAction): Promise<boolean> => {
    if (action === "publish") setPublication({ status: "submitting" });
    const exit = await runtime.runPromiseExit(actOnApplication(action, application, actorId));
    if (Exit.isSuccess(exit)) {
      setPublication(exit.value.kind === "cancelled" ? { status: "cancelled" } : { status: "published", projectId: exit.value.projectId, setup: exit.value.setup });
      return true;
    }
    const failure = Exit.findErrorOption(exit);
    if (failure._tag === "Some" && failure.value._tag === "ApplicationsLost") {
      onAccountLost(failure.value.message);
      return false;
    }
    const refused = failure._tag === "Some" && failure.value._tag === "ApplicationRefused" ? failure.value : undefined;
    setPublication({ status: "failed", action, message: refused?.message ?? (action === "cancel" ? cancellationUnconfirmed : applicationUnpublished), installSlopbot: refused?.installSlopbot ?? false });
    return false;
  };
  const onConfirmation = (event: ConfirmationEvent) => {
    sendConfirmation(event);
    if (event.type === "confirm") void act("cancel").then((succeeded) => sendConfirmation({ type: "finish", succeeded }));
  };
  const submitting = publication.status === "submitting" || confirmation.phase === "Working";
  const failedAt = publication.status === "failed" ? publication.action : undefined;
  return (
    <article aria-label={`Pending application: ${name}`} data-testid={`pending-application-${application.id}`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        {publication.status === "published" ? (
          <a href={`/projects/${publication.projectId}/manage`} className="font-medium text-primary underline underline-offset-4">
            {name}
          </a>
        ) : (
          <strong className="font-medium text-foreground">{name}</strong>
        )}
        {publication.status === "published" || publication.status === "cancelled" ? null : (
          <>
            {application.publishable === false ? null : (
              <Button variant="secondary" size="sm" loading={publication.status === "submitting"} disabled={submitting} onClick={() => void act("publish")}>
                {publication.status === "submitting" ? (isRevision ? "Publishing…" : "Creating…") : failedAt === "publish" ? "Retry" : isRevision ? "Publish" : "Create"}
              </Button>
            )}
            <ConfirmDialog
              state={confirmation}
              onSend={onConfirmation}
              title={`Cancel the application for ${name}?`}
              confirmLabel="Cancel application"
              cancelLabel="Keep it"
              destructive
              reason={failedAt === "cancel" && publication.status === "failed" ? publication.message : null}
              trigger={
                <Button variant="outline" size="sm" disabled={submitting}>
                  Cancel application
                </Button>
              }
            >
              It will not be published.
            </ConfirmDialog>
          </>
        )}
      </div>
      {publication.status === "cancelled" ? <p role="status">Application cancelled.</p> : null}
      {publication.status === "failed" && publication.action === "publish" ? (
        <Alert variant="destructive">
          {publication.message}
          {publication.installSlopbot ? (
            <>
              {" "}
              <a href={slopbotInstallUrl} target="_blank" rel="noreferrer" className="underline">
                Install Slopbot
              </a>
            </>
          ) : null}
        </Alert>
      ) : null}
      {publication.status === "published" ? <SetupStatusPanel runtime={runtime} projectId={publication.projectId} actorId={actorId} initial={publication.setup} showProjectLink={false} /> : null}
    </article>
  );
}

function AccountApplications({ runtime, actorId }: { runtime: PageRuntime; actorId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [lost, setLost] = useState<string | null>(null);
  const read = useRun(runtime, `applications:${actorId}:${attempt}`, () => pendingApplications(actorId), applicationsUnloaded);
  if (read === undefined || read.status === "running") return null;
  const error = lost ?? (read.status === "failed" ? read.message : null);
  if (error === null && read.status === "done" && read.value.length === 0) return null;
  const retry = () => {
    setLost(null);
    setAttempt((count) => count + 1);
  };
  return (
    <section aria-label="Pending applications" className="flex flex-col gap-3">
      {error !== null ? (
        <Alert
          variant="destructive"
          action={
            <Button variant="link" onClick={retry}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : read.status === "done" ? (
        read.value.map((application) => <PendingApplication key={application.id} runtime={runtime} application={application} actorId={actorId} onAccountLost={setLost} />)
      ) : null}
    </section>
  );
}

/** The signed-in account's saved applications, kept available apart from any inventory of existing projects. */
export function PendingApplications({ runtime }: { runtime: PageRuntime }) {
  const view = useSession(runtime)?.view;
  return view?.status === "signedIn" ? <AccountApplications key={view.session.githubId} runtime={runtime} actorId={view.session.githubId} /> : null;
}
