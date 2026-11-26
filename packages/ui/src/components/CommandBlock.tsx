import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { exactValue } from "../lib/exact.ts";
import { CopyButton, type CopyButtonProps } from "./CopyButton.tsx";

export type CommandBlockProps = Omit<ComponentProps<"div">, "onCopy" | "children"> & {
  /** The command or output, exactly as it is to be copied. */
  command: string;
  /** The accessible name of the code. */
  label?: string;
  /** The copy control's accessible name. */
  copyLabel?: string;
  /** Writes to the clipboard (CopyButton). */
  onCopy?: CopyButtonProps["onCopy"];
  /** Links beside the copy control, such as the source or a download. */
  links?: ReactNode;
  /** `block` scrolls a command whole above its copy control; `inline` wraps a prompt beside the page's main copy action, as development's agent prompt box. */
  layout?: "block" | "inline";
  /** The copy control's visible text by state (CopyButton). */
  copyLabels?: CopyButtonProps["labels"];
  /** How long "Copied" stays (CopyButton). */
  restAfter?: number;
};

const breaks = /(https?:\/\/[^/\s]+\/|github\.com\/)/u;

function commandSegments(command: string) {
  const parts = command.split(breaks);
  const result: Array<{ readonly key: string; readonly segment: string; readonly breakAfter: boolean }> = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const segment = parts[i] ?? "";
    result.push({ key: `${offset}:${segment.length}`, segment, breakAfter: i % 2 === 1 });
    offset += segment.length;
  }
  return result;
}

/** A command or code a person copies and runs: kept whole and scrolled rather than wrapped, or as a wrapped prompt in one row with its copy action. */
export function CommandBlock({ command, label = "Command", copyLabel = "Copy command", onCopy, links, layout = "block", copyLabels, restAfter, className, ...props }: CommandBlockProps) {
  if (layout === "inline") {
    return (
      <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-foreground/22 bg-card py-3 pr-3 pl-6 max-md:p-4", className)} {...props}>
        <code role="group" aria-label={label} className="min-w-0 font-mono text-prompt font-medium break-normal whitespace-normal text-foreground wrap-anywhere max-md:text-copy">
          {commandSegments(command).map(({ key, segment, breakAfter }) => (
            <span key={key}>
              {segment}
              {breakAfter ? <wbr /> : null}
            </span>
          ))}
        </code>
        <span className="flex items-center gap-3">
          {links}
          <CopyButton
            text={command}
            label={copyLabel}
            onCopy={onCopy}
            labels={copyLabels}
            tone="primary"
            restAfter={restAfter}
            className="h-11 min-w-28 gap-1.75 px-5 [&_svg]:size-3.5 max-md:min-w-11 max-md:px-0 max-md:[&_svg]:size-5 max-md:not-data-[copy=CopyFailed]:w-11 max-md:not-data-[copy=CopyFailed]:[&_[data-copy-label]]:sr-only max-md:data-[copy=CopyFailed]:px-3"
          />
        </span>
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted p-3", className)} {...props}>
      <pre role="group" aria-label={label} tabIndex={0} className={cn(exactValue, "text-sm whitespace-pre")}>
        <code>{command}</code>
      </pre>
      <div className="flex items-center justify-end gap-3 text-sm">
        {links}
        <CopyButton text={command} label={copyLabel} onCopy={onCopy} labels={copyLabels} restAfter={restAfter} variant="labeled" />
      </div>
    </div>
  );
}
