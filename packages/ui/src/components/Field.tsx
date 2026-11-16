import { type ComponentProps, type ReactElement, type ReactNode, useId } from "react";
import { Slot } from "@radix-ui/react-slot";
import { describedBy } from "../../gen/ui__controls.ts";
import { cn } from "../lib/cn.ts";
import { Label } from "./Label.tsx";
import { StatusIcon } from "./Status.tsx";

/**
 * What ties a control to its error and hint: the control's attributes, and the messages in the order they describe it.
 */
// spec/ui/controls.md, "An invalid field is described by its error, then its hint"
export function useDescription(error?: ReactNode, hint?: ReactNode) {
  const id = useId();
  const invalid = Boolean(error);
  const parts = describedBy({ invalid, hasError: invalid, hasHint: Boolean(hint) });
  const ids = parts.map((part) => `${id}-${part}`);
  return {
    id,
    // Only what is set, so a control's own `invalid` is not overridden by an absent error.
    control: { ...(invalid ? { "aria-invalid": true } : {}), ...(ids.length ? { "aria-describedby": ids.join(" ") } : {}) },
    messages: parts.map((part) =>
      part === "ErrorText" ? (
        <p key={part} id={`${id}-${part}`} className="flex items-center gap-2 text-sm text-destructive">
          <StatusIcon icon="Alert" />
          {error}
        </p>
      ) : (
        <p key={part} id={`${id}-${part}`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ),
    ),
  };
}

export type FieldProps = Omit<ComponentProps<"div">, "children"> & {
  /** The control's visible name. */
  label: ReactNode;
  /** One control, such as an `Input`, `Textarea`, `Select` or `FileField`: it receives the id and description. */
  children: ReactElement;
  /** What is wrong with the value; its presence marks the control invalid. */
  error?: ReactNode;
  /** What the value should be, when the label cannot say it. */
  hint?: ReactNode;
};

/**
 * A labelled control with its error and hint beside it, announced with the control.
 * @model spec/ui/controls.md
 */
export function Field({ label, error, hint, className, children, ...props }: FieldProps) {
  const { id, control, messages } = useDescription(error, hint);
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      <Label htmlFor={id}>{label}</Label>
      <Slot id={id} {...control}>
        {children}
      </Slot>
      {messages}
    </div>
  );
}
