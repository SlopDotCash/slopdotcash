// spec/backend/projects.md, "A current maintainer removes a project and a lost reply can be retried"; spec/ui/confirmation.md, "Only an explicit confirm starts the work"
import { Button, ConfirmDialog, type ConfirmationEvent, PageHeader, useConfirmation } from "@repo/ui";
import type { ReactNode } from "react";

export type RemoveProjectProps = {
  name: string;
  disabled: boolean;
  /** Runs the removal once confirmed; true when it is done. */
  remove: () => Promise<boolean>;
  /** Why the last removal was refused, with its recovery. */
  reason: ReactNode;
};

/** Removing a project, asked for once and started only by the explicit confirm; a refusal keeps the dialog open with its reason. */
export function RemoveProject({ name, disabled, remove, reason }: RemoveProjectProps) {
  const [confirmation, send] = useConfirmation();
  const onSend = (event: ConfirmationEvent) => {
    send(event);
    if (event.type === "confirm") void remove().then((succeeded) => send({ type: "finish", succeeded }));
  };
  return (
    <ConfirmDialog
      state={confirmation}
      onSend={onSend}
      title={`Remove ${name} from Slop?`}
      confirmLabel="Remove project"
      cancelLabel="Keep project"
      destructive
      reason={reason}
      trigger={
        <Button variant="outline" disabled={disabled}>
          Remove project
        </Button>
      }
    >
      This stops new work and hides its listing and skills. History, earned Points, private cases, and funded obligations remain.
    </ConfirmDialog>
  );
}

/** The page once the project is removed. */
export function ProjectRemoved({ name }: { name: string }) {
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-lg) flex-1 flex-col gap-6 px-4 py-8">
      <PageHeader title="Project removed" />
      <p role="status">{name} is removed from Slop. History, earned Points, private cases, and funded obligations are preserved.</p>
      <a href="/projects" className="text-primary underline underline-offset-4">
        Browse projects
      </a>
    </main>
  );
}
