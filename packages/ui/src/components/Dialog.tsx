import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn, focusRing, target } from "../lib/cn.ts";
import { description, heading, overlay, panel } from "../lib/overlay.ts";
import { CardFooter } from "./Card.tsx";

export type DialogProps = ComponentProps<typeof DialogPrimitive.Root>;
export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> & {
  /** The accessible name of the close button. */
  closeLabel?: string;
};
export type DialogTitleProps = ComponentProps<typeof DialogPrimitive.Title>;
export type DialogDescriptionProps = ComponentProps<typeof DialogPrimitive.Description>;

/** A modal task: holds a `DialogTrigger` and a `DialogContent`. */
export function Dialog(props: DialogProps) {
  return <DialogPrimitive.Root {...props} />;
}

/** Opens the dialog; pass `asChild` to use a `Button`. */
export const DialogTrigger = DialogPrimitive.Trigger;

/** Closes the dialog; pass `asChild` to use a `Button`. */
export const DialogClose = DialogPrimitive.Close;

/** The actions of a `DialogContent`, in a row at its end: the same row as a card's. */
export const DialogFooter = CardFooter;

/** The panel over a dimmed page. Needs a `DialogTitle`; Escape and the close button dismiss it. */
export function DialogContent({ closeLabel = "Close", className, children, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      {/* A `DialogDescription`, when there is one, describes the panel all the same. */}
      <DialogPrimitive.Content aria-describedby={undefined} className={cn(panel, className)} {...props}>
        {children}
        <DialogPrimitive.Close aria-label={closeLabel} className={cn(focusRing, target, "absolute top-4 right-4 rounded-sm text-muted-foreground hover:text-foreground")}>
          <X aria-hidden className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** The dialog's heading and accessible name. */
export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return <DialogPrimitive.Title className={cn(heading, className)} {...props} />;
}

/** What the dialog is about, read with its title. */
export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn(description, className)} {...props} />;
}
