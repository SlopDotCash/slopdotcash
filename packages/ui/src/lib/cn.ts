import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import tokens from "@repo/design-system/tokens.json" with { type: "json" };

const groups: Record<string, unknown> = tokens;
const names = (group: string) => Object.keys(groups[group] ?? {});
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: names("text"), radius: names("rounded"), shadow: names("shadow"), blur: names("blur"), animate: names("animate") },
  },
});

/** Joins class names; a later Tailwind utility replaces an earlier one it conflicts with. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** The ring every control shows under keyboard focus. */
export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** How every control looks while it refuses activation, disabled or busy (`controlState`): faded, and past the pointer. */
export const inactive = "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/**
 * The 44px square every standalone control can be hit in, however small it is drawn: an invisible box centered on it
 * (spec/ui/index.md, "Buttons are 48px high, 40px small, fields 52px, and every control can be hit in a 44px square"). A positioned control keeps its own position.
 */
export const target = "relative after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:min-w-11 after:-translate-1/2";

/** `focusRing` for each child, such as the links of a row. */
export const childFocusRing = "*:outline-none *:focus-visible:ring-2 *:focus-visible:ring-ring";
/** `target` for each child, such as the links of a row. */
export const childTarget = "*:relative *:after:absolute *:after:top-1/2 *:after:left-1/2 *:after:size-full *:after:min-h-11 *:after:min-w-11 *:after:-translate-1/2";
/** `focusRing` and `inactive` for an element that holds a hidden control, such as the label of a file input. */
export const holdsControl =
  "has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:pointer-events-none has-disabled:opacity-50 has-aria-disabled:pointer-events-none has-aria-disabled:opacity-50";
