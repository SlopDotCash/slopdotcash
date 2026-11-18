// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/ui/confirmation.md, "Only an explicit confirm starts the work"; spec/ui/confirmation.md, "The work's answer closes the dialog or keeps it open with the reason"
import { Button, ConfirmDialog, type ConfirmationEvent, useConfirmation } from "@repo/ui";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { adminMessages, delistProject } from "../../flows/projects/admin.vibe";
import { isAdminActionAccessLoss } from "../../session/adminAccess.vibe";
import { act } from "./parts.tsx";
import type { AdminProject } from "./projects.ts";

export type DelistButtonProps = {
  runtime: PageRuntime;
  project: AdminProject;
  actorId: string;
  onAccessLost: () => void;
  onDone: (note: string) => void;
};

/** Delisting keeps history: the project becomes paused and retired, asked for once and started only by the explicit confirm. */
export function DelistButton({ runtime, project, actorId, onAccessLost, onDone }: DelistButtonProps) {
  const [confirmation, send] = useConfirmation();
  const [reason, setReason] = useState<string | null>(null);
  const inFlight = useRef(false);
  if (project.manifest.listingTier === "retired") return null;
  const delist = async () => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setReason(null);
    const acted = await act(runtime, delistProject({ id: project.id, revision: project.revision, manifest: project.raw }, actorId), isAdminActionAccessLoss, "Delisting could not be confirmed.");
    inFlight.current = false;
    if (acted.ok) {
      onDone(adminMessages.saved);
      return true;
    }
    if (acted.accessLost) onAccessLost();
    setReason(acted.message);
    return false;
  };
  const onSend = (event: ConfirmationEvent) => {
    send(event);
    if (event.type === "confirm") void delist().then((succeeded) => send({ type: "finish", succeeded }));
  };
  return (
    <ConfirmDialog
      state={confirmation}
      onSend={onSend}
      title="Delist?"
      confirmLabel="Confirm delist"
      cancelLabel="Cancel"
      destructive
      reason={reason}
      trigger={
        <Button variant="ghost" className="self-start">
          <Trash2 aria-hidden />
          Delist
        </Button>
      }
    >
      {null}
    </ConfirmDialog>
  );
}
