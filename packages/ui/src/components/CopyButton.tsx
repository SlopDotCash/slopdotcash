import { useEffect, useReducer } from "react";
import { Clipboard } from "lucide-react";
import { type CopyStatus, canRest, copyAnnouncement, enabled, initial, step } from "../../gen/ui__copy.ts";
import { cn } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { Button, type ButtonProps } from "./Button.tsx";
import { StatusIcon } from "./Status.tsx";

export type CopyLabels = { ready: string; copied: string; failed: string };

export type CopyButtonProps = Omit<ButtonProps, "children" | "onClick" | "onCopy" | "loading" | "asChild" | "variant" | "size"> & {
  /** The exact text to copy. */
  text: string;
  /** Writes the text to the clipboard; a rejection is reported as a failed copy. */
  onCopy?: (text: string) => Promise<void>;
  /** The control's accessible name, and its visible text when `labeled` without `labels`. */
  label?: string;
  /** An icon alone, or the icon with its text beside it. */
  variant?: "icon" | "labeled";
  /** The visible text by state, such as "Copy", "Copied" and "Select text"; `label` stays the accessible name and the status is read aloud only. */
  labels?: CopyLabels;
  /** `primary` is the page's main action, as the agent prompt's copy control, turning `ok` once copied. */
  tone?: "quiet" | "primary";
  /** How long "Copied" stays before the control is ready again, in milliseconds. */
  restAfter?: number;
};

const visible = (labels: CopyLabels, status: CopyStatus) => (status === "Copied" ? labels.copied : status === "CopyFailed" ? labels.failed : labels.ready);

/**
 * Copies a value and says whether the browser accepted it, without moving focus. `data-copy` carries the state, for
 * a layout that draws the control differently once a copy failed.
 * @model spec/ui/copy.md
 */
export function CopyButton({ text, onCopy = (value) => navigator.clipboard.writeText(value), label = "Copy", variant = "icon", labels, tone = "quiet", restAfter = 2000, disabled, className, ...props }: CopyButtonProps) {
  const [state, send] = useReducer(step, initial);
  const failed = state.status === "CopyFailed";
  const copied = state.status === "Copied";
  const iconOnly = variant === "icon" && !labels;

  // spec/ui/copy.md, "Success settles back to ready; failure stays until the next attempt"
  useEffect(() => {
    if (!canRest(state)) return;
    const timer = setTimeout(() => send({ type: "rest" }), restAfter);
    return () => clearTimeout(timer);
  }, [state, restAfter]);

  // spec/ui/copy.md, "Copying starts from ready and reports the browser's answer"
  const press = async () => {
    if (!enabled(state, { type: "copy" })) return;
    send({ type: "copy" });
    const written = await Promise.resolve(text).then(onCopy).then(() => true, () => false);
    send({ type: "answer", written });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant={tone === "primary" ? "primary" : iconOnly ? "ghost" : "outline"}
        size={tone === "primary" ? "md" : iconOnly ? "icon" : "sm"}
        aria-label={iconOnly || labels ? label : undefined}
        data-copy={state.status}
        className={cn(tone === "primary" && copied && "bg-ok text-primary-foreground hover:bg-ok", className)}
        onClick={() => void press()}
        {...props}
        {...controlState(disabled, state.status === "Copying")}
      >
        {failed ? <StatusIcon icon="Alert" className={tone === "primary" ? undefined : "text-destructive"} /> : copied ? <StatusIcon icon="Check" /> : <Clipboard aria-hidden />}
        {labels ? <span data-copy-label>{visible(labels, state.status)}</span> : variant === "labeled" && label}
      </Button>
      <span role="status" className={failed && !labels ? "text-xs text-destructive" : "sr-only"}>
        {copyAnnouncement(state)}
      </span>
    </span>
  );
}
