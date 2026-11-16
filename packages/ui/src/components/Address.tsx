import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";
import { exactValue } from "../lib/exact.ts";
import { CopyButton, type CopyButtonProps } from "./CopyButton.tsx";

export type AddressProps = Omit<ComponentProps<"div">, "onCopy" | "children"> & {
  /** The whole address, which is what is copied. */
  value: string;
  /** The accessible name of the address. */
  label?: string;
  /** The copy control's accessible name. */
  copyLabel?: string;
  /** Writes to the clipboard (CopyButton). */
  onCopy?: CopyButtonProps["onCopy"];
};

/** A wallet, contract or token address in full, never shortened, with a `CopyButton` for it. */
export function Address({ value, label = "Address", copyLabel = "Copy address", onCopy, className, ...props }: AddressProps) {
  // spec/ui/copy.md: the value always stays visible and selectable, so a refused copy leaves a manual path.
  return (
    <div className={cn("flex min-w-0 items-start gap-1", className)} {...props}>
      <div role="group" aria-label={label} tabIndex={0} className={cn(exactValue, "text-sm text-foreground")}>
        {value}
      </div>
      <CopyButton text={value} label={copyLabel} onCopy={onCopy} />
    </div>
  );
}
