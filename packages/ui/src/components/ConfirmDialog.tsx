import { type ReactElement, type ReactNode, useReducer } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { type Confirmation, type Event, enabled, initial, step } from "../../gen/ui__confirmation.ts";
import { description, heading, overlay, panel } from "../lib/overlay.ts";
import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";
import { DialogFooter } from "./Dialog.tsx";

export type { Confirmation };
export type ConfirmationEvent = Event;

export type ConfirmDialogProps = {
  /** The confirmation's phase, from `useConfirmation`. */
  state: Confirmation;
  /** Receives each event the rules allow. The owner starts the work on `confirm`, and sends `finish` with its answer. */
  onSend: (event: ConfirmationEvent) => void;
  /** The step, as a question. */
  title: string;
  /** The consequence, stated plainly. */
  children: ReactNode;
  /** The confirm button's text: the step, as a verb. */
  confirmLabel: string;
  cancelLabel?: string;
  /** For a step that removes or gives up something. */
  destructive?: boolean;
  /** Why the work was refused, shown while the dialog is `Refused`. */
  reason: ReactNode;
  /** The element that opens the dialog, usually a `Button`. */
  trigger?: ReactElement;
};

/** The confirmation of one irreversible step and the one way to change it: the generated confirmation machine. */
export const useConfirmation = (start: Confirmation = initial) => useReducer(step, start);

/**
 * Asks for explicit consent to an irreversible step and stays open, with no way to dismiss it, while the confirmed
 * work is in flight; a refusal keeps it open with the reason, to retry or cancel.
 * spec/ui/confirmation.md, "Only an explicit confirm starts the work"; "The work's answer closes the dialog or keeps it open with the reason".
 * @model spec/ui/confirmation.md
 */
export function ConfirmDialog({ state, onSend, title, children, confirmLabel, cancelLabel = "Cancel", destructive = false, reason, trigger }: ConfirmDialogProps) {
  const send = (event: ConfirmationEvent) => {
    if (enabled(state, event)) onSend(event);
  };
  const working = state.phase === "Working";
  return (
    <AlertDialog.Root open={state.phase !== "Closed"} onOpenChange={(open) => send({ type: open ? "open" : "cancel" })}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlay} />
        <AlertDialog.Content className={panel}>
          <AlertDialog.Title className={heading}>{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className={description}>{children}</div>
          </AlertDialog.Description>
          {state.phase === "Refused" ? <Alert variant="destructive">{reason}</Alert> : null}
          <DialogFooter>
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={!enabled(state, { type: "cancel" })}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <Button variant={destructive ? "destructive" : "primary"} loading={working} onClick={() => send({ type: "confirm" })}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
