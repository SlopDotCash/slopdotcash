import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "../lib/cn.ts";
import { CopyButton, type CopyButtonProps } from "./CopyButton.tsx";

export type CommandBlockProps = Omit<ComponentProps<"div">, "onCopy" | "children"> & {
  /** The command or output, exactly as it is to be copied. */
  command: string;
  /** The accessible name of the scrolling code. */
  label?: string;
  /** The copy control's accessible name. */
  copyLabel?: string;
  /** Writes to the clipboard (CopyButton). */
  onCopy?: CopyButtonProps["onCopy"];
  /** Links beside the copy control, such as the source or a download. */
  links?: ReactNode;
};

/** A command or code a person copies and runs, kept whole and scrolled rather than wrapped. */
export function CommandBlock({ command, label = "Command", copyLabel = "Copy command", onCopy, links, className, ...props }: CommandBlockProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted p-3", className)} {...props}>
      <pre role="group" aria-label={label} tabIndex={0} className={cn(focusRing, "overflow-x-auto rounded-sm font-mono text-sm")}>
        <code>{command}</code>
      </pre>
      <div className="flex items-center justify-end gap-3 text-sm">
        {links}
        <CopyButton text={command} label={copyLabel} onCopy={onCopy} variant="labeled" />
      </div>
    </div>
  );
}
