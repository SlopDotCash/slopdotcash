import type { ComponentProps } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing, inactive, target } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { StatusIcon } from "./Status.tsx";

/** The look of a button by variant and size, for an element that acts as one without being a `Button`. */
export const buttonVariants = cva(
  [focusRing, inactive, target, "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-fast ease-standard motion-reduce:transition-none"],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        link: "text-primary underline underline-offset-4 hover:decoration-2",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: { sm: "h-10 px-3", md: "h-12 px-4", icon: "size-12" },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner and refuses activation while work is in flight; the button keeps its focus. */
    loading?: boolean;
    /** Renders the single child element with the button's styles, for a link that looks like a button. */
    asChild?: boolean;
  };

/**
 * An action a person can take. Give one without text, such as an icon, an `aria-label`.
 */
export function Button({ variant, size, loading = false, asChild = false, type = "button", disabled = false, className, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const { disabled: off, ...state } = controlState(disabled, loading);
  // The child of `asChild`, a link, has no `disabled`: it leaves the tab order instead.
  const element = asChild ? (off ? { tabIndex: -1 } : {}) : { type, disabled: off };
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} {...state} {...element}>
      {loading && <StatusIcon icon="Spinner" />}
      <Slottable>{children}</Slottable>
    </Comp>
  );
}
