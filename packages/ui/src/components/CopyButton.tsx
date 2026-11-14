import { useEffect, useReducer } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { canRest, copyAnnouncement, enabled, initial, step } from "../../gen/ui__copy.ts";
import { cn } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { Button, type ButtonProps } from "./Button.tsx";

export type CopyButtonProps = Omit<ButtonProps, "children" | "onClick" | "onCopy" | "loading" | "asChild" | "variant" | "size"> & {
  /** The exact text to copy. */
  text: string;
  /** Writes the text to the clipboard; a rejection is reported as a failed copy. */
  onCopy?: (text: string) => Promise<void>;
  /** The control's accessible name, and its visible text when `labeled`. */
  label?: string;
  /** An icon alone, or the icon with `label` beside it. */
  variant?: "icon" | "labeled";
  /** How long "Copied" stays before the control is ready again, in milliseconds. */
  restAfter?: number;
};

const icons = { Ready: Copy, Copying: Copy, Copied: Check, CopyFailed: TriangleAlert };

/**
 * Copies a value and says whether the browser accepted it, without moving focus.
 * @model spec/ui/copy.md
 */
export function CopyButton({ text, onCopy = (value) => navigator.clipboard.writeText(value), label = "Copy", variant = "icon", restAfter = 2000, disabled, className, ...props }: CopyButtonProps) {
  // The spec owns this state: the generated pure step is the reducer, so an event applies exactly when `enabled` allows it.
  const [state, send] = useReducer(step, initial);
  const failed = state.status === "CopyFailed";
  const Icon = icons[state.status];

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
        variant={variant === "icon" ? "ghost" : "outline"}
        size={variant === "icon" ? "icon" : "sm"}
        aria-label={variant === "icon" ? label : undefined}
        className={className}
        onClick={() => void press()}
        {...props}
        {...controlState(disabled, state.status === "Copying")}
      >
        <Icon aria-hidden className={cn("size-4", failed && "text-destructive")} />
        {variant === "labeled" && label}
      </Button>
      <span role="status" className={failed ? "text-xs text-destructive" : "sr-only"}>
        {copyAnnouncement(state)}
      </span>
    </span>
  );
}
