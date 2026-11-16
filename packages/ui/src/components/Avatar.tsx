import type { ComponentProps } from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn.ts";

const avatarVariants = cva("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground select-none", {
  variants: { size: { sm: "size-6 text-xs", md: "size-8 text-sm", lg: "size-16 text-xl" } },
  defaultVariants: { size: "md" },
});

export type AvatarProps = Omit<ComponentProps<typeof AvatarPrimitive.Root>, "children"> &
  VariantProps<typeof avatarVariants> & {
    /** Whose picture it is: the image's description, and the source of the initials shown without one. */
    name: string;
    /** The picture; the initials stand in while it loads or when it fails. */
    src?: string;
    /** Hides the picture from assistive technology, for when the name is written beside it. */
    decorative?: boolean;
  };

/** A person's picture, or their initial when there is none. */
export function Avatar({ name, src, size, decorative = true, className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name })} className={cn(avatarVariants({ size }), className)} {...props}>
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback>{name.slice(0, 1).toUpperCase()}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
