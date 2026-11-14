import type { ComponentProps } from "react";
import { cn } from "../lib/cn.ts";
import { exactValue } from "../lib/exact.ts";
import { CopyButton, type CopyButtonProps } from "./CopyButton.tsx";
import { Disclosure } from "./Disclosure.tsx";

export type AddressProps = Omit<ComponentProps<"div">, "onCopy" | "children"> & {
  /** The whole address, which is what is copied. */
  value: string;
  /** A short form already made by the caller, such as `0x8f3a…8f0a`; the whole address is then one press away. */
  preview?: string;
  /** The accessible name of the address. */
  label?: string;
  /** The copy control's accessible name. */
  copyLabel?: string;
  /** Writes to the clipboard (CopyButton). */
  onCopy?: CopyButtonProps["onCopy"];
};

/** A wallet, contract or token address in full, with a `CopyButton` for it. */
export function Address({ value, preview, label = "Address", copyLabel = "Copy address", onCopy, className, ...props }: AddressProps) {
  const whole = (
    <div role="group" aria-label={label} tabIndex={0} className={cn(exactValue, "rounded-sm text-sm text-foreground")}>
      {value}
    </div>
  );
  return (
    <div className={cn("flex min-w-0 items-start gap-1", className)} {...props}>
      {preview ? (
        <Disclosure summary={preview} className="min-w-0 [&>button]:font-mono">
          {whole}
        </Disclosure>
      ) : (
        whole
      )}
      <CopyButton text={value} label={copyLabel} onCopy={onCopy} />
    </div>
  );
}
