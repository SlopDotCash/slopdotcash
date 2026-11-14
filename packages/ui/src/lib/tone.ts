import type { Tone } from "../../gen/designSystem.ts";

/**
 * The utilities of each tone's role, written out so Tailwind sees them: `text` for a word or icon, `fill` for a
 * bar, `alert` for the `Alert` variant that frames it. Emphasis is never a status, so no alert carries it.
 */
// spec/designSystem/index.md, "Each tone is a role that is readable as text"
export const tones = {
  Neutral: { text: "text-muted-foreground", fill: "bg-muted-foreground", alert: "neutral" },
  Emphasis: { text: "text-primary", fill: "bg-primary", alert: "neutral" },
  Positive: { text: "text-ok", fill: "bg-ok", alert: "ok" },
  Caution: { text: "text-warn", fill: "bg-warn", alert: "warn" },
  Negative: { text: "text-destructive", fill: "bg-destructive", alert: "destructive" },
  Notice: { text: "text-info", fill: "bg-info", alert: "info" },
} as const satisfies Record<Tone, { text: string; fill: string; alert: string }>;
