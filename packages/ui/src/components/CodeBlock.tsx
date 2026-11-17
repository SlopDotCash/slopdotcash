import { type ComponentProps, useId } from "react";
import { cn, focusRing } from "../lib/cn.ts";

const kinds = {
  code: "font-mono tabular-nums whitespace-pre",
  prose: "font-sans whitespace-pre-wrap wrap-anywhere",
};

export type CodeBlockProps = Omit<ComponentProps<"pre">, "children"> & {
  /** The text exactly as it is, never cut short. */
  code: string;
  /** Shown above the block and read as its name; without it, name the block with `aria-label` or `aria-labelledby`. */
  label?: string;
  /** `code` keeps each line whole and scrolls sideways; `prose`, such as a report a person wrote, wraps in the body font. */
  kind?: keyof typeof kinds;
};

/** Preformatted text a person reads whole: kept exact, and scrolled by keyboard as well as by pointer. */
// spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
export function CodeBlock({ code, label, kind = "code", className, ...props }: CodeBlockProps) {
  const id = useId();
  const block = (
    <pre
      role="group"
      tabIndex={0}
      aria-labelledby={label === undefined ? undefined : id}
      className={cn(focusRing, "max-h-96 min-w-0 overflow-auto rounded-md border border-border bg-muted p-4 text-sm text-foreground", kinds[kind], className)}
      {...props}
    >
      {kind === "code" ? <code>{code}</code> : code}
    </pre>
  );
  if (label === undefined) return block;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span id={id} className="text-sm font-medium text-foreground">
        {label}
      </span>
      {block}
    </div>
  );
}
