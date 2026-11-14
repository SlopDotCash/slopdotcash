import type { ComponentProps, ReactNode } from "react";
import { ImageUp, X } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { Button, buttonVariants } from "./Button.tsx";
import { Spinner } from "./Spinner.tsx";

export type FileFieldProps = Omit<ComponentProps<"input">, "type" | "children" | "value" | "defaultValue" | "onChange"> & {
  /** Called with the files a person chose. */
  onFiles: (files: File[]) => void;
  /** The chosen file's name; leave out while none is chosen. */
  file?: string;
  /** A picture of the chosen file, such as an `img` the caller made from it. */
  preview?: ReactNode;
  /** Called by the remove action, which is offered while a file is chosen. */
  onRemove?: () => void;
  /** The text of the picker. */
  chooseLabel?: string;
  /** The accessible name of the remove action. */
  removeLabel?: string;
  /** Shows a spinner and refuses another choice while the file is sent; the picker keeps its focus. */
  loading?: boolean;
  /** Marks the file as refused, visibly and through `aria-invalid`. */
  invalid?: boolean;
};

/**
 * A file picker with the chosen file's preview and a remove action. Name it with a `Field`, a `Label` or `aria-label`.
 * @model spec/ui/controls.md
 */
export function FileField({ onFiles, file, preview, onRemove, chooseLabel = "Choose file", removeLabel = "Remove", loading = false, invalid = false, disabled = false, className, ...props }: FileFieldProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4", className)}>
      {preview ? <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted *:size-full *:object-cover">{preview}</div> : null}
      <label
        className={cn(
          buttonVariants({ variant: "outline" }),
          "cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring has-aria-disabled:pointer-events-none has-aria-disabled:opacity-50 has-aria-invalid:border-destructive has-disabled:pointer-events-none has-disabled:opacity-50",
        )}
      >
        <input
          type="file"
          aria-invalid={invalid || undefined}
          className="sr-only"
          onChange={(event) => {
            onFiles([...(event.target.files ?? [])]);
            // The same file chosen again is a new choice.
            event.target.value = "";
          }}
          {...props}
          {...controlState(disabled, loading)}
        />
        {loading ? <Spinner size="sm" aria-hidden /> : <ImageUp aria-hidden className="size-4" />}
        {chooseLabel}
      </label>
      <span aria-live="polite" className="min-w-0 text-sm break-all text-foreground">
        {file}
      </span>
      {file && onRemove ? (
        <Button variant="ghost" size="icon" aria-label={removeLabel} disabled={disabled || loading} onClick={onRemove}>
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
