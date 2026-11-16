import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import tokens from "@repo/design-system/tokens.json" with { type: "json" };

// The token groups that name utilities (vibestack/design/generate.ts), so a later `text-body` replaces a
// size and not a color. Each group is optional in tokens.json.
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

// The same two, written out because Tailwind reads class names whole: change them together.
/** `focusRing` for each child, such as the links of a row. */
export const childFocusRing = "*:outline-none *:focus-visible:ring-2 *:focus-visible:ring-ring";
/** `focusRing` and `inactive` for an element that holds a hidden control, such as the label of a file input. */
export const holdsControl =
  "has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:pointer-events-none has-disabled:opacity-50 has-aria-disabled:pointer-events-none has-aria-disabled:opacity-50";
