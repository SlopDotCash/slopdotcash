import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names; a later Tailwind utility replaces an earlier one it conflicts with. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** The ring every control shows under keyboard focus. */
export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** How every control looks while it refuses activation, disabled or busy (`controlState`): faded, and past the pointer. */
export const inactive = "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";
