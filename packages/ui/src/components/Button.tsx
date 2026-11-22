import type { ComponentProps } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing, inactive, target } from "../lib/cn.ts";
import { controlState } from "../lib/control.ts";
import { StatusIcon } from "./Status.tsx";

/** The look of a button by variant and size, for an element that acts as one without being a `Button`. */
export const buttonVariants = cva(
  [focusRing, inactive, target, "inline-flex items-center justify-center gap-2.5 rounded-md text-base leading-tight font-bold whitespace-nowrap transition-colors duration-fast ease-standard motion-reduce:transition-none [&_svg]:size-4.5 [&_svg]:shrink-0"],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
        link: "text-primary underline underline-offset-4 hover:decoration-2",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-foreground/22 bg-transparent text-foreground hover:border-foreground hover:bg-foreground/6 active:bg-foreground/12",
        inverse: "bg-foreground text-background hover:bg-foreground/90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: { sm: "h-10 px-4.5 text-control max-md:h-11 max-md:px-3 max-md:text-sm", md: "h-12 px-5.5", icon: "size-12" },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0 font-medium" }],
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
